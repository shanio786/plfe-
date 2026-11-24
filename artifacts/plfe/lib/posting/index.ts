import {Prisma} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {money} from "@/lib/money";
import {nextDocumentNumber} from "@/lib/numbering";
import type {Actor} from "@/modules/core/model";
import {authorize,dateOnly,dimensionCheck,outletAccountCheck,ledgerLock,meta,type Tx} from "@/modules/accounts/model";
import {assertGoLiveDate} from "@/modules/accounts/book-dates";

export type PostingLine={accountId:string;debit:string|Prisma.Decimal;credit:string|Prisma.Decimal;partyId?:string|null;departmentId?:string|null;eventId?:string|null;outletId?:string|null;memo?:string|null};
type PostingInput={id?:string;journalId:string;date:string|Date;narration?:string|null;kind:string;sourceType:string;sourceId:string;reversalOfId?:string|null;lines:PostingLine[]};
const zero=()=>new Prisma.Decimal("0.0000");

export async function openFiscal(tx:Tx,companyId:string,date:Date) {
  await assertGoLiveDate(tx,companyId,date);
  const company=await tx.company.findFirst({where:{id:companyId,deletedAt:null}});
  const year=await tx.fiscalYear.findFirst({where:{companyId,deletedAt:null,isClosed:false,startDate:{lte:date},endDate:{gte:date}}});
  const period=year&&await tx.period.findFirst({where:{companyId,fiscalYearId:year.id,deletedAt:null,isClosed:false,startDate:{lte:date},endDate:{gte:date}}});
  if(!company||!year||!period||(company.lockDate&&date<=company.lockDate))
    throw new AppError(400,"An open financial year and period covering this date are required");
  return year;
}

async function validateLines(tx:Tx,companyId:string,lines:PostingLine[],requireBalance:boolean) {
  if(lines.length<2||lines.length>400) throw new AppError(400,"Use between two and four hundred journal lines");
  const control=await tx.accountingSettings.findFirst({where:{companyId,deletedAt:null}});
  let debit=zero(),credit=zero();
  for(const line of lines) {
    const dr=money(line.debit),cr=money(line.credit);
    if(dr.lt("0")||cr.lt("0")||!(dr.gt("0")&&cr.eq("0")||cr.gt("0")&&dr.eq("0")))
      throw new AppError(400,"Each journal line needs either a positive debit or a positive credit");
    const account=await tx.account.findFirst({where:{id:line.accountId,companyId,deletedAt:null,active:true,isGroup:false}});
    if(!account) throw new AppError(400,"Select an active posting account in this company");
    if(control) {
      const isControl=[control.receivableAccountId,control.payableAccountId].includes(account.id);
      if(isControl&&!line.partyId)throw new AppError(400,"Receivable/payable lines require a party");
      if(!isControl&&line.partyId)throw new AppError(400,"Tag the party on the receivable/payable line, not both sides of an entry");
    }
    if(line.partyId&&!await tx.party.findFirst({where:{id:line.partyId,companyId,active:true,deletedAt:null}}))
      throw new AppError(400,"Select an active party in this company");
    await dimensionCheck(tx,companyId,line);
    outletAccountCheck(account,line.outletId);
    debit=debit.add(dr);credit=credit.add(cr);
  }
  money(debit);money(credit);
  if(requireBalance&&!debit.eq(credit)) throw new AppError(400,"Journal debit and credit totals must balance");
}

/** All journal-line writes live here, including edits to unposted vouchers. */
export async function saveJournalDraft(tx:Tx,actor:Actor,companyId:string,input:PostingInput,permission:string) {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  await assertGoLiveDate(tx,companyId,input.date);
  const id=input.id??(input.sourceType==="ENTRY"?input.sourceId:randomUUID());
  const before=input.id?await tx.journalEntry.findFirst({where:{id,companyId,deletedAt:null},include:{lines:true}}):null;
  if(input.id&&!before) throw new AppError(404,"Journal entry not found");
  if(before?.status==="POSTED") throw new AppError(409,"Posted journal entries can only be reversed");
  if(!await tx.journal.findFirst({where:{id:input.journalId,companyId,active:true,deletedAt:null}}))
    throw new AppError(400,"Select an active journal in this company");
  await validateLines(tx,companyId,input.lines,false);
  const data={journalId:input.journalId,date:dateOnly(input.date),narration:input.narration,kind:input.kind,sourceType:input.sourceType,sourceId:input.sourceId,reversalOfId:input.reversalOfId};
  if(before) {
    await tx.journalEntry.update({where:{id,companyId},data:{...data,updatedBy:actor.id,version:{increment:1}}});
    await tx.journalLine.deleteMany({where:{companyId,entryId:id}});
  } else await tx.journalEntry.create({data:{...data,id,companyId,...meta(actor)}});
  await tx.journalLine.createMany({data:input.lines.map((l,i)=>({
    companyId,entryId:id,lineNo:i+1,accountId:l.accountId,debit:money(l.debit),credit:money(l.credit),
    partyId:l.partyId??null,eventId:l.eventId??null,outletId:l.outletId??null,departmentId:l.departmentId??null,memo:l.memo??null,...meta(actor)
  }))});
  const after=await tx.journalEntry.findFirstOrThrow({where:{id,companyId},include:{lines:{orderBy:{lineNo:"asc"}}}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE","journal_entries",id,before,after);
  return after;
}

export async function postJournalDraft(tx:Tx,actor:Actor,companyId:string,id:string,permission:string,docType="JE") {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const before=await tx.journalEntry.findFirst({where:{id,companyId,deletedAt:null},include:{lines:{where:{deletedAt:null},orderBy:{lineNo:"asc"}}}});
  if(!before) throw new AppError(404,"Journal entry not found");
  if(before.status!=="DRAFT") throw new AppError(409,"Journal entry has already been posted");
  if(!await tx.journal.findFirst({where:{id:before.journalId,companyId,deletedAt:null,active:true}}))throw new AppError(400,"Journal is no longer active");
  await validateLines(tx,companyId,before.lines,true);
  const fiscal=await openFiscal(tx,companyId,before.date);
  const number=await nextDocumentNumber(tx,actor,companyId,docType,fiscal.id);
  const after=await tx.journalEntry.update({where:{id,companyId},data:{status:"POSTED",number,fiscalYearId:fiscal.id,version:{increment:1},updatedBy:actor.id},include:{lines:true}});
  await audit(tx,actor,companyId,"POST","journal_entries",id,before,after);
  return after;
}

/** Caller owns the document's single transaction, authorization and source link. */
export async function postEntry(tx:Tx,actor:Actor,companyId:string,input:PostingInput,permission:string,docType="JE") {
  const draft=await saveJournalDraft(tx,actor,companyId,input,permission);
  return postJournalDraft(tx,actor,companyId,draft.id,permission,docType);
}

export async function reverseEntry(tx:Tx,actor:Actor,companyId:string,id:string,date:Date,reason:string,permission:string) {
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const original=await tx.journalEntry.findFirst({where:{id,companyId,status:"POSTED",deletedAt:null},include:{lines:{orderBy:{lineNo:"asc"}},reversals:true}});
  if(!original||original.reversalOfId||original.reversals.length) throw new AppError(409,"Select an original posted entry that has not been reversed");
  // Historical inactive accounts/dimensions must remain reversible. Temporarily
  // reactivating masters would be unsafe: reversal validation uses the originals.
  const reversalId=randomUUID();
  const fiscal=await openFiscal(tx,companyId,dateOnly(date));
  const number=await nextDocumentNumber(tx,actor,companyId,"REV",fiscal.id);
  await tx.journalEntry.create({data:{id:reversalId,companyId,journalId:original.journalId,date:dateOnly(date),kind:"REVERSAL",sourceType:"REVERSAL",sourceId:id,reversalOfId:id,narration:reason,...meta(actor)}});
  await tx.journalLine.createMany({data:original.lines.map(l=>({companyId,entryId:reversalId,lineNo:l.lineNo,accountId:l.accountId,partyId:l.partyId,departmentId:l.departmentId,eventId:l.eventId,outletId:l.outletId,memo:l.memo,debit:l.credit,credit:l.debit,...meta(actor)}))});
  const reversal=await tx.journalEntry.update({where:{id:reversalId,companyId},data:{status:"POSTED",number,fiscalYearId:fiscal.id,updatedBy:actor.id},include:{lines:true}});
  await audit(tx,actor,companyId,"REVERSE","journal_entries",reversalId,null,{...reversal,reversalOfId:id});
  return reversal;
}

export async function archiveJournalDraft(tx:Tx,actor:Actor,companyId:string,id:string) {
  await authorize(tx,actor,companyId,"accounts.entry.delete");
  await ledgerLock(tx,companyId);
  const before=await tx.journalEntry.findFirst({where:{id,companyId,deletedAt:null},include:{lines:true}});
  if(!before||before.status!=="DRAFT"||before.sourceType!=="ENTRY") throw new AppError(409,"Only a manual draft may be archived");
  const after=await tx.journalEntry.update({where:{id,companyId},data:{deletedAt:new Date(),updatedBy:actor.id}});
  await audit(tx,actor,companyId,"CANCEL","journal_entries",id,before,after);
  return after;
}
