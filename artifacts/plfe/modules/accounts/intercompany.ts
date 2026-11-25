import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import {db} from "@/lib/db";
import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {companyScope,permissionsFor} from "@/lib/permissions";
import {postEntry,reverseEntry} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {intercompanySchema} from "./schema";
import {authorize,dateOnly,ledgerLock,settings,type Tx} from "./model";
import {decimal,positive,zero} from "./balances";
import {assertGoLiveDate} from "./book-dates";
import {accountingToday} from "./time";
import {requestApproval} from "./approvals";

/** Group companies constantly pay for each other. In the old system this is
 * exactly where the money got mixed up, so here one side of a movement can
 * never be recorded without the other: both companies' entries are written in
 * the same transaction, and the database refuses a posted row with only one. */

/** The account in `companyId` that faces `counterpartyCompanyId`. ASSET is the
 * due-from side, LIABILITY the due-to side. These accounts are created in pairs
 * when a company is provisioned, so both companies always have the mirror. */
async function facingAccount(tx:Tx,companyId:string,counterpartyCompanyId:string,side:"DUE_FROM"|"DUE_TO") {
  const account=await tx.account.findFirst({where:{companyId,counterpartyCompanyId,deletedAt:null,
    type:side==="DUE_FROM"?"ASSET":"LIABILITY"}});
  if(!account)throw new AppError(409,"This company has no group account facing the other company. Re-run company provisioning before recording intercompany movements");
  if(!account.active)throw new AppError(409,`${account.name} is inactive; reactivate it before recording intercompany movements`);
  return account;
}

async function settlementAccount(tx:Tx,companyId:string,accountId:string,mustBeLiquid:boolean,label:string) {
  const account=await tx.account.findFirst({where:{id:accountId,companyId,deletedAt:null}});
  if(!account)throw new AppError(400,`${label} was not found in that company`);
  if(!account.active||account.isGroup)throw new AppError(400,`${label} must be an active posting account`);
  if(account.counterpartyCompanyId)throw new AppError(400,`${label} cannot itself be a group company account`);
  if(mustBeLiquid&&!account.isCash&&!account.isBank)
    throw new AppError(400,`${label} must be a cash or bank account`);
  return account;
}

/** Both companies must be open on the date, and the user must be allowed to
 * record in the company whose money moves. */
async function usableCompany(tx:Tx,companyId:string,date:Date) {
  const company=await tx.company.findFirst({where:{id:companyId,active:true,deletedAt:null}});
  if(!company)throw new AppError(404,"Company not found or inactive");
  await assertGoLiveDate(tx,companyId,date);
  if(company.lockDate&&date<=company.lockDate)
    throw new AppError(400,`${company.name} is locked up to ${company.lockDate.toISOString().slice(0,10)}`);
  return company;
}

export async function saveIntercompany(tx:Tx,actor:Actor,companyId:string,raw:any,permission:string) {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const id=raw.id??randomUUID();
  const before=raw.id?await tx.intercompanyTransfer.findFirst({where:{id,companyId,deletedAt:null}}):null;
  if(raw.id&&!before)throw new AppError(404,"Intercompany movement not found in this company");
  if(before&&before.status!=="DRAFT")throw new AppError(409,"A posted intercompany movement is permanent; cancel it instead");
  if(raw.operation==="delete") {
    if(!before)throw new AppError(404,"Intercompany movement not found in this company");
    const after=await tx.intercompanyTransfer.update({where:{id:before.id},data:{deletedAt:new Date(),updatedBy:actor.id,version:{increment:1}}});
    await audit(tx,actor,companyId,"CANCEL","intercompany_transfers",before.id,before,after);
    return after;
  }
  const data=intercompanySchema.parse(raw);
  if(data.counterpartyCompanyId===companyId)throw new AppError(400,"Choose a different group company");
  const date=dateOnly(data.date);
  if(date>accountingToday())throw new AppError(400,"An intercompany movement cannot be dated in the future");
  await usableCompany(tx,companyId,date);
  await usableCompany(tx,data.counterpartyCompanyId,date);
  const amount=positive(data.amount);
  // The money leaves or arrives in this company's own cash or bank; the other
  // company's side lands wherever the movement actually belongs there, which is
  // its own cash or bank only when this is a plain transfer.
  await settlementAccount(tx,companyId,data.settlementAccountId,true,"The settlement account");
  await settlementAccount(tx,data.counterpartyCompanyId,data.counterpartyAccountId,data.kind==="TRANSFER",
    "The other company's account");
  await facingAccount(tx,companyId,data.counterpartyCompanyId,data.kind==="RECEIVE_ON_BEHALF"?"DUE_TO":"DUE_FROM");
  await facingAccount(tx,data.counterpartyCompanyId,companyId,data.kind==="RECEIVE_ON_BEHALF"?"DUE_FROM":"DUE_TO");
  const values={counterpartyCompanyId:data.counterpartyCompanyId,kind:data.kind,date,amount,reason:data.reason,
    settlementAccountId:data.settlementAccountId,counterpartyAccountId:data.counterpartyAccountId};
  const after=before
    ? await tx.intercompanyTransfer.update({where:{id:before.id},data:{...values,updatedBy:actor.id,version:{increment:1}}})
    : await tx.intercompanyTransfer.create({data:{...values,id,companyId,createdBy:actor.id,updatedBy:actor.id}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE","intercompany_transfers",after.id,before,after);
  return after;
}

export async function postIntercompany(tx:Tx,actor:Actor,companyId:string,id:string,note:string,permission:string) {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const before=await tx.intercompanyTransfer.findFirst({where:{id,companyId,deletedAt:null}});
  if(!before)throw new AppError(404,"Intercompany movement not found in this company");
  if(before.status!=="DRAFT")throw new AppError(409,"This movement has already been posted");
  // Writing into the other company's books needs the same right there. Without
  // it this becomes a request, which somebody holding both rights decides; the
  // movement does not touch either company's books meanwhile.
  const held=await permissionsFor(tx,actor,before.counterpartyCompanyId);
  if(!held.includes("accounts.intercompany.post")) {
    const rule=await tx.approvalRule.findFirst({where:{companyId,docType:"INTERCOMPANY",
      action:"post",active:true,deletedAt:null}});
    if(!rule)throw new AppError(403,"You may not post into the other company, and this company has no intercompany approval rule for somebody who can");
    return requestApproval(tx,actor,companyId,"intercompany","post",before,note,rule);
  }
  return executeIntercompanyPosting(tx,actor,companyId,id,permission);
}

/** Writes both companies' entries. Either both are written or neither is. */
export async function executeIntercompanyPosting(tx:Tx,actor:Actor,companyId:string,id:string,permission:string) {
  const before=await tx.intercompanyTransfer.findFirst({where:{id,companyId,deletedAt:null}});
  if(!before)throw new AppError(404,"Intercompany movement not found in this company");
  if(before.status!=="DRAFT")throw new AppError(409,"This movement has already been posted");
  const other=before.counterpartyCompanyId;
  await ledgerLock(tx,other);
  // Whoever writes both sets of books must be allowed in both companies. The
  // approval above exists so that such a person decides, not to let one side
  // be written by somebody the other company never authorized.
  const held=await permissionsFor(tx,actor,other);
  if(!held.includes("accounts.intercompany.post"))
    throw new AppError(403,"Posting writes both companies' books, so it needs the intercompany posting right in the other company too");
  const here=await usableCompany(tx,companyId,before.date),there=await usableCompany(tx,other,before.date);
  const receiving=before.kind==="RECEIVE_ON_BEHALF";
  const hereFacing=await facingAccount(tx,companyId,other,receiving?"DUE_TO":"DUE_FROM");
  const thereFacing=await facingAccount(tx,other,companyId,receiving?"DUE_FROM":"DUE_TO");
  await settlementAccount(tx,companyId,before.settlementAccountId,true,"The settlement account");
  await settlementAccount(tx,other,before.counterpartyAccountId,before.kind==="TRANSFER",
    "The other company's account");
  const amount=decimal(before.amount.toFixed(4));
  const narration=`${({PAY_ON_BEHALF:"Paid on behalf of",RECEIVE_ON_BEHALF:"Received on behalf of",TRANSFER:"Transferred to"} as Record<string,string>)[before.kind]} ${there.name}: ${before.reason}`;
  const hereLines=receiving
    ? [{accountId:before.settlementAccountId,debit:amount,credit:zero()},{accountId:hereFacing.id,debit:zero(),credit:amount}]
    : [{accountId:hereFacing.id,debit:amount,credit:zero()},{accountId:before.settlementAccountId,debit:zero(),credit:amount}];
  const entry=await postEntry(tx,actor,companyId,{journalId:(await settings(tx,companyId)).generalJournalId,
    date:before.date,kind:"JOURNAL",sourceType:"INTERCOMPANY",sourceId:before.id,narration,lines:hereLines},permission,"ICT");
  // The mirror. Debits and credits are the exact opposite of the side above, so
  // the two companies' group balances can never drift apart.
  const thereLines=receiving
    ? [{accountId:thereFacing.id,debit:amount,credit:zero()},{accountId:before.counterpartyAccountId,debit:zero(),credit:amount}]
    : [{accountId:before.counterpartyAccountId,debit:amount,credit:zero()},{accountId:thereFacing.id,debit:zero(),credit:amount}];
  const mirror=await postEntry(tx,actor,other,{journalId:(await settings(tx,other)).generalJournalId,
    date:before.date,kind:"JOURNAL",sourceType:"INTERCOMPANY",sourceId:before.id,
    narration:`${receiving?"Received on our behalf by":before.kind==="TRANSFER"?"Transferred from":"Paid on our behalf by"} ${here.name}: ${before.reason}`,
    lines:thereLines},"accounts.intercompany.post","ICT");
  const after=await tx.intercompanyTransfer.update({where:{id:before.id},
    data:{status:"POSTED",number:entry.number,entryId:entry.id,counterpartyEntryId:mirror.id,
      updatedBy:actor.id,version:{increment:1}}});
  await audit(tx,actor,companyId,"POST","intercompany_transfers",before.id,before,after);
  await audit(tx,actor,other,"POST","intercompany_transfers",before.id,before,after);
  return after;
}

export async function cancelIntercompany(tx:Tx,actor:Actor,companyId:string,id:string,reason:string,permission:string) {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const before=await tx.intercompanyTransfer.findFirst({where:{id,companyId,deletedAt:null}});
  if(!before)throw new AppError(404,"Intercompany movement not found in this company");
  if(before.status!=="POSTED")throw new AppError(409,"Only a posted intercompany movement can be cancelled");
  if((reason??"").trim().length<10)throw new AppError(400,"Write a cancellation reason of at least ten characters");
  const other=before.counterpartyCompanyId;
  await ledgerLock(tx,other);
  const held=await permissionsFor(tx,actor,other);
  if(!held.includes("accounts.intercompany.cancel"))
    throw new AppError(403,"Cancelling reverses both companies, so it needs the same right in the other company");
  const today=accountingToday();
  await usableCompany(tx,companyId,today);
  await usableCompany(tx,other,today);
  const reversal=await reverseEntry(tx,actor,companyId,before.entryId!,today,reason,permission);
  const mirror=await reverseEntry(tx,actor,other,before.counterpartyEntryId!,today,reason,"accounts.intercompany.cancel");
  const after=await tx.intercompanyTransfer.update({where:{id:before.id},
    data:{status:"CANCELLED",cancelReason:reason,reversalEntryId:reversal.id,counterpartyReversalEntryId:mirror.id,
      updatedBy:actor.id,version:{increment:1}}});
  await audit(tx,actor,companyId,"CANCEL","intercompany_transfers",before.id,before,after);
  await audit(tx,actor,other,"CANCEL","intercompany_transfers",before.id,before,after);
  return after;
}

/** What each company owes the other, from both companies' own books, so a
 * disagreement is visible rather than assumed away. */
export async function groupBalances(tx:Tx,actor:Actor) {
  // This report crosses company boundaries by its nature, so it is the Owner's.
  if(!actor.isOwner)throw new AppError(403,"Group balances span every company and are visible to an Owner");
  const companies=await tx.company.findMany({where:{deletedAt:null},orderBy:{code:"asc"}});
  const rows:any[]=[];
  for(const a of companies)for(const b of companies) {
    if(a.id>=b.id)continue;
    const [aDueFromB,aDueToB,bDueFromA,bDueToA]=await Promise.all([
      balanceOf(tx,a.id,b.id,"ASSET"),balanceOf(tx,a.id,b.id,"LIABILITY"),
      balanceOf(tx,b.id,a.id,"ASSET"),balanceOf(tx,b.id,a.id,"LIABILITY")]);
    // A's net claim on B, seen from A's books and again from B's books. Each
    // balance is debit minus credit, so a liability already carries its own
    // sign: A's due-to-B is negative when A owes B, and B's due-to-A is
    // negative when B owes A, which is a claim in A's favour.
    const seenByA=aDueFromB.add(aDueToB),seenByB=bDueToA.add(bDueFromA).neg();
    const agree=seenByA.eq(seenByB);
    const unmatched=agree?[]:await onlyOneSide(tx,a.id,b.id);
    rows.push({companyId:a.id,company:a.name,counterpartyCompanyId:b.id,counterparty:b.name,
      seenBy:{[a.code]:seenByA.toFixed(4),[b.code]:seenByB.toFixed(4)},
      net:seenByA.toFixed(4),agree,
      statement:agree
        ?(seenByA.eq("0")?"Settled; neither company owes the other"
          :seenByA.gt("0")?`${b.name} owes ${a.name} ${seenByA.toFixed(2)}`
          :`${a.name} owes ${b.name} ${seenByA.abs().toFixed(2)}`)
        :`The two companies do not agree: ${a.code} shows ${seenByA.toFixed(2)}, ${b.code} shows ${seenByB.toFixed(2)}`,
      unmatched});
  }
  return {rows,balanced:rows.every(r=>r.agree)};
}

async function balanceOf(tx:Tx,companyId:string,counterpartyCompanyId:string,type:"ASSET"|"LIABILITY") {
  const account=await tx.account.findFirst({where:{companyId,counterpartyCompanyId,type,deletedAt:null}});
  if(!account)return zero();
  const [row]:any[]=await tx.$queryRaw`
    SELECT coalesce(sum(l.debit-l.credit),0) AS balance
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
    WHERE l.company_id=${companyId}::uuid AND l.account_id=${account.id}::uuid
      AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.status='POSTED'`;
  return decimal(new Prisma.Decimal(row.balance).toFixed(4));
}

/** Any movement between the pair that reached one company's books only. */
async function onlyOneSide(tx:Tx,companyId:string,counterpartyCompanyId:string) {
  const movements=await tx.intercompanyTransfer.findMany({where:{status:"POSTED",deletedAt:null,
    OR:[{companyId,counterpartyCompanyId},{companyId:counterpartyCompanyId,counterpartyCompanyId:companyId}]}});
  const broken=[];
  for(const m of movements) {
    const here=await tx.journalEntry.findFirst({where:{id:m.entryId!,companyId:m.companyId,status:"POSTED",deletedAt:null}});
    const there=await tx.journalEntry.findFirst({where:{id:m.counterpartyEntryId!,companyId:m.counterpartyCompanyId,status:"POSTED",deletedAt:null}});
    if(!here||!there)broken.push({number:m.number,date:m.date.toISOString().slice(0,10),
      missingIn:here?"the counterparty company":"the initiating company"});
  }
  return broken;
}

/** HTTP entry points. One transaction per request; both companies inside it. */
export async function intercompanyRequest(actor:Actor,companyCode:string,input:any) {
  const operation=String(input?.operation??"save");
  const permission=operation==="post"?"accounts.intercompany.post"
    :operation==="cancel"?"accounts.intercompany.cancel":"accounts.intercompany.create";
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,permission);
    const note=String(input?.note??"").trim().slice(0,2000);
    if(operation==="post") {
      if(!input?.id)throw new AppError(400,"Save the movement before posting it");
      return postIntercompany(tx,actor,company.id,String(input.id),note,permission);
    }
    if(operation==="cancel") {
      if(!input?.id)throw new AppError(400,"Choose a posted movement to cancel");
      return cancelIntercompany(tx,actor,company.id,String(input.id),note,permission);
    }
    return saveIntercompany(tx,actor,company.id,input,permission);
  },{timeout:30000});
}
export async function intercompanyView(actor:Actor,companyCode:string) {
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,"accounts.intercompany.read");
    const rows=await tx.intercompanyTransfer.findMany({
      where:{deletedAt:null,OR:[{companyId:company.id},{counterpartyCompanyId:company.id}]},
      include:{company:{select:{code:true,name:true}},counterpartyCompany:{select:{code:true,name:true}},
        settlementAccount:{select:{code:true,name:true}}},
      orderBy:[{date:"desc"},{createdAt:"desc"}],take:200});
    const companies=await tx.company.findMany({where:{active:true,deletedAt:null,id:{not:company.id}},
      select:{id:true,code:true,name:true},orderBy:{code:"asc"}});
    return {companies,rows:rows.map(r=>({id:r.id,number:r.number,kind:r.kind,status:r.status,
      date:r.date.toISOString().slice(0,10),amount:r.amount.toFixed(4),reason:r.reason,
      initiating:r.company.name,counterparty:r.counterpartyCompany.name,
      ours:r.companyId===company.id,settlementAccount:r.settlementAccount.name,
      cancelReason:r.cancelReason,entryId:r.companyId===company.id?r.entryId:r.counterpartyEntryId}))};
  });
}
export async function groupBalancesView(actor:Actor,companyCode:string) {
  return db.$transaction(async tx=>{
    await companyScope(tx,actor,companyCode,"accounts.intercompany.read");
    return groupBalances(tx,actor);
  });
}
