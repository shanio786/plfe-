import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import {db} from "@/lib/db";
import {companyScope} from "@/lib/permissions";
import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {nextDocumentNumber} from "@/lib/numbering";
import {postEntry} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {cashCountSchema} from "./schema";
import {authorize,dateOnly,ledgerLock,meta,settings,type Tx} from "./model";
import {decimal,zero} from "./balances";
import {assertGoLiveDate} from "./book-dates";
import {accountingToday} from "./time";
import {approvalRule,requestApproval} from "./approvals";

/** Cash in a drawer can only be trusted if somebody counts it and the count is
 * compared with the books. This is the whole point of one cash account per
 * drawer: a shared "Cash in hand" account can never be verified. */

async function countedAccount(tx:Tx,companyId:string,accountId:string) {
  const account=await tx.account.findFirst({where:{id:accountId,companyId,deletedAt:null},include:{outlet:true}});
  if(!account)throw new AppError(404,"Cash account not found in this company");
  if(!account.active||account.isGroup||!account.isCash)
    throw new AppError(400,"Count an active cash account; bank accounts are reconciled against their statement instead");
  return account;
}

/** What the books say this cash account held at the end of that date. */
export async function cashBookBalance(tx:Tx,companyId:string,accountId:string,date:Date) {
  const [row]:any[]=await tx.$queryRaw`
    SELECT coalesce(sum(l.debit-l.credit),0) AS balance
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
    WHERE l.company_id=${companyId}::uuid AND l.account_id=${accountId}::uuid
      AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.status='POSTED' AND e.date<=${date}`;
  return decimal(new Prisma.Decimal(row.balance).toFixed(4));
}

export async function saveCashCount(tx:Tx,actor:Actor,companyId:string,raw:any,permission:string) {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const id=raw.id??randomUUID();
  const before=raw.id?await tx.cashCount.findFirst({where:{id,companyId}}):null;
  if(raw.id&&!before)throw new AppError(404,"Cash count not found in this company");
  if(before?.status==="POSTED")throw new AppError(409,"A posted cash count is permanent; correct it with a later count");
  if(raw.operation==="delete") {
    if(!before)throw new AppError(404,"Cash count not found in this company");
    await tx.cashCount.delete({where:{id:before.id}});
    await audit(tx,actor,companyId,"CANCEL","cash_counts",before.id,before,null);
    return {id:before.id,deleted:true};
  }
  const data=cashCountSchema.parse(raw);
  const date=dateOnly(data.date);
  if(date>accountingToday())throw new AppError(400,"A cash count cannot be dated in the future");
  await assertGoLiveDate(tx,companyId,date);
  const account=await countedAccount(tx,companyId,data.accountId);
  const clash=await tx.cashCount.findFirst({where:{companyId,accountId:account.id,date,...(before?{id:{not:before.id}}:{})}});
  if(clash)throw new AppError(409,`${account.name} was already counted on ${data.date}; open that count instead of recording a second one`);
  const counted=decimal(data.countedAmount);
  if(counted.lt("0"))throw new AppError(400,"A counted amount cannot be negative");
  const book=await cashBookBalance(tx,companyId,account.id,date);
  const difference=decimal(counted.sub(book).toFixed(4));
  if(!difference.eq("0")&&(data.explanation??"").trim().length<10)
    throw new AppError(400,"The drawer does not agree with the books. Write an explanation of at least ten characters");
  const counts=data.denominations.filter(d=>d.count>0);
  if(counts.length) {
    const total=counts.reduce((sum,d)=>sum.add(decimal(d.value).mul(d.count)),zero());
    if(!decimal(total.toFixed(4)).eq(counted))
      throw new AppError(400,`The notes and coins add up to ${total.toFixed(2)}, not the counted amount ${counted.toFixed(2)}`);
  }
  const values={accountId:account.id,outletId:account.outletId,date,countedAmount:counted,bookAmount:book,difference,
    denominations:counts.length?(counts as unknown as Prisma.InputJsonValue):Prisma.DbNull,explanation:data.explanation};
  const after=before
    ? await tx.cashCount.update({where:{id:before.id},data:{...values,updatedBy:actor.id,version:{increment:1}}})
    : await tx.cashCount.create({data:{...values,id,companyId,createdBy:actor.id,updatedBy:actor.id}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE","cash_counts",after.id,before,after);
  return after;
}

export async function postCashCount(tx:Tx,actor:Actor,companyId:string,id:string,note:string,permission:string) {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const before=await tx.cashCount.findFirst({where:{id,companyId},include:{account:true}});
  if(!before)throw new AppError(404,"Cash count not found in this company");
  if(before.status!=="DRAFT")throw new AppError(409,"This cash count has already been posted");
  // The book balance is recomputed now: another document may have been posted
  // into this account since the count was saved.
  const book=await cashBookBalance(tx,companyId,before.accountId,before.date);
  if(!book.eq(before.bookAmount))
    throw new AppError(409,`The book balance for ${before.date.toISOString().slice(0,10)} changed to ${book.toFixed(2)} after this count was saved. Open it, check the drawer again and save before posting`);
  const difference=decimal(before.countedAmount.sub(book).toFixed(4));
  if(!difference.eq(before.difference))throw new AppError(409,"Recheck and save this cash count before posting");
  if(!difference.eq("0")) {
    const rule=await cashDifferenceRule(tx,companyId,difference);
    if(rule)return requestApproval(tx,actor,companyId,"cash-counts","post",before,note,rule);
  }
  return executeCashCountPosting(tx,actor,companyId,before.id,permission);
}

/** A difference the company considers material needs somebody else's approval. */
export async function cashDifferenceRule(tx:Tx,companyId:string,difference:Prisma.Decimal) {
  const rule=await tx.approvalRule.findFirst({where:{companyId,docType:"CASH_DIFFERENCE",action:"post",active:true,deletedAt:null}});
  if(!rule)return null;
  const size=difference.abs();
  return !rule.thresholdAmount||size.gt(rule.thresholdAmount)?rule:null;
}

export async function executeCashCountPosting(tx:Tx,actor:Actor,companyId:string,id:string,permission:string) {
  const before=await tx.cashCount.findFirst({where:{id,companyId},include:{account:true}});
  if(!before)throw new AppError(404,"Cash count not found in this company");
  if(before.status!=="DRAFT")throw new AppError(409,"This cash count has already been posted");
  const difference=before.difference;
  let entryId:string|null=null,number:string|null=null;
  if(difference.eq("0")) {
    // Nothing moved, so nothing is posted; the count itself is the evidence,
    // and it still takes a number from the same gapless series.
    const year=await tx.fiscalYear.findFirst({where:{companyId,deletedAt:null,isClosed:false,
      startDate:{lte:before.date},endDate:{gte:before.date}}});
    if(!year)throw new AppError(400,"An open financial year covering this date is required");
    number=await nextDocumentNumber(tx,actor,companyId,"CC",year.id);
  } else {
    const s=await settings(tx,companyId);
    const differenceAccountId=s.cashDifferenceAccountId??(await tx.account.findFirst({
      where:{companyId,code:"7200",active:true,isGroup:false,deletedAt:null}}))?.id;
    if(!differenceAccountId)
      throw new AppError(409,"Set this company's cash difference account in Accounts settings before posting a count that does not agree");
    const short=difference.lt("0");
    const amount=difference.abs();
    const tags={outletId:before.outletId,departmentId:null,eventId:null};
    const entry=await postEntry(tx,actor,companyId,{
      journalId:s.cashJournalId,date:before.date,kind:"CASH",sourceType:"CASHCOUNT",sourceId:before.id,
      narration:`Cash count ${before.account.name}: ${short?"short":"over"} ${amount.toFixed(2)} — ${before.explanation??""}`.trim(),
      lines:[
        {accountId:before.accountId,debit:short?zero():amount,credit:short?amount:zero(),...tags},
        {accountId:differenceAccountId,debit:short?amount:zero(),credit:short?zero():amount,...tags}
      ]},permission,"CC");
    entryId=entry.id;number=entry.number;
  }
  const after=await tx.cashCount.update({where:{id:before.id},data:{status:"POSTED",number,entryId,updatedBy:actor.id,version:{increment:1}}});
  await audit(tx,actor,companyId,"POST","cash_counts",before.id,before,after);
  return after;
}

/** Every cash account with its last count, so an uncounted drawer is visible. */
export async function cashCountOverview(tx:Tx,companyId:string) {
  const accounts=await tx.account.findMany({where:{companyId,isCash:true,isGroup:false,deletedAt:null},
    include:{outlet:true},orderBy:{code:"asc"}});
  const today=accountingToday();
  return Promise.all(accounts.map(async(account)=>{
    const last=await tx.cashCount.findFirst({where:{companyId,accountId:account.id,status:"POSTED"},orderBy:{date:"desc"}});
    const balance=await cashBookBalance(tx,companyId,account.id,today);
    const days=last?Math.round((today.getTime()-last.date.getTime())/86400000):null;
    return {accountId:account.id,code:account.code,name:account.name,outlet:account.outlet?.name??null,
      bookBalance:balance.toFixed(4),
      lastCountDate:last?last.date.toISOString().slice(0,10):null,
      lastCountDifference:last?last.difference.toFixed(4):null,
      daysSinceCount:days,neverCounted:!last};
  }));
}

/** HTTP entry points. One transaction per request, like every other service. */
export async function cashCountRequest(actor:Actor,companyCode:string,input:any) {
  const posting=input?.operation==="post";
  const permission=posting?"accounts.cashcount.post":"accounts.cashcount.create";
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,permission);
    if(posting) {
      if(!input?.id)throw new AppError(400,"Save the count before posting it");
      return postCashCount(tx,actor,company.id,String(input.id),String(input.note??"").trim().slice(0,2000),permission);
    }
    return saveCashCount(tx,actor,company.id,input,permission);
  },{timeout:30000});
}
export async function cashCountsView(actor:Actor,companyCode:string) {
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,"accounts.cashcount.read");
    const rows=await tx.cashCount.findMany({where:{companyId:company.id},
      include:{account:{select:{code:true,name:true}},outlet:{select:{name:true}}},
      orderBy:[{date:"desc"},{createdAt:"desc"}],take:200});
    return {accounts:await cashCountOverview(tx,company.id),
      rows:rows.map(r=>({id:r.id,number:r.number,date:r.date.toISOString().slice(0,10),status:r.status,
        accountCode:r.account.code,accountName:r.account.name,outlet:r.outlet?.name??null,
        countedAmount:r.countedAmount.toFixed(4),bookAmount:r.bookAmount.toFixed(4),
        difference:r.difference.toFixed(4),explanation:r.explanation,entryId:r.entryId}))};
  });
}
