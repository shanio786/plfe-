import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {nextDocumentNumber} from "@/lib/numbering";
import {openFiscal,postEntry,reverseEntry} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {billSchema,invoiceSchema,paymentSchema} from "./schema";
import {dateOnly,delegate,dimensionCheck,outletAccountCheck,meta,record,resourceConfig,settings,type Tx} from "./model";
import {applyAllocations,decimal,outstanding,positive,priceLines,zero} from "./balances";
import {accountingToday} from "./time";

export async function saveDocument(tx:Tx,actor:Actor,companyId:string,resource:"invoices"|"bills"|"payments",raw:any) {
  const model=delegate(tx,resource),cfg=resourceConfig(resource);
  const before=raw.id?await record(tx,resource,companyId,raw.id,{include:resource==="payments"?{allocations:{where:{companyId,deletedAt:null}}}:{lines:{where:{companyId,deletedAt:null}}}}):null;
  if(before&&before.status!=="DRAFT")throw new AppError(409,"Posted documents are read-only; request cancellation");
  if(raw.operation==="delete") {
    if(!before)throw new AppError(404,"Document not found");
    const after=await model.update({where:{id:before.id,companyId},data:{deletedAt:new Date(),updatedBy:actor.id,version:{increment:1}}});
    await audit(tx,actor,companyId,"CANCEL",cfg.table,before.id,before,after);return after;
  }
  const data=resource==="payments"?paymentSchema.parse(raw):resource==="invoices"?invoiceSchema.parse(raw):billSchema.parse(raw);
  const party=await tx.party.findFirst({where:{id:data.partyId,companyId,active:true,deletedAt:null}});
  if(!party)throw new AppError(400,"Select an active party in this company");
  const receivable=resource==="invoices"||resource==="payments"&&(data as any).direction==="RECEIPT";
  if(receivable?![party.isCustomer,party.isExhibitor,party.isSponsor,party.isStaff].some(Boolean):!party.isSupplier&&!party.isStaff)
    throw new AppError(400,receivable?"Choose a customer, exhibitor, sponsor or staff party":"Choose a supplier or staff party");
  let after:any;
  if(resource==="payments") {
    const {allocations,...values}=data as ReturnType<typeof paymentSchema.parse>;
    await dimensionCheck(tx,companyId,values);
    const account=await record(tx,"chart",companyId,values.settlementAccountId);
    outletAccountCheck(account,values.outletId);
    if(!account.active||account.isGroup||(values.method==="CASH"?!account.isCash:!account.isBank))
      throw new AppError(400,"Choose an active cash or bank account matching the method");
    const payload={...values,amount:positive(values.amount),date:dateOnly(values.date)};
    after=before?await model.update({where:{id:before.id,companyId},data:{...payload,updatedBy:actor.id,version:{increment:1}}}):await model.create({data:{...payload,companyId,...meta(actor)}});
    const change=await applyAllocations(tx,actor,companyId,after,allocations);
    await audit(tx,actor,companyId,"ALLOCATE","payment_allocations",after.id,change.before,change.after);
  } else {
    const {lines,...values}=data as ReturnType<typeof invoiceSchema.parse>|ReturnType<typeof billSchema.parse>;
    if(values.dueDate<values.date)throw new AppError(400,"Due date cannot precede document date");
    if(values.kind==="CREDIT_NOTE"||values.kind==="DEBIT_NOTE") {
      if(!values.originalId)throw new AppError(400,"Select the original invoice or bill");
      const original=await record(tx,resource,companyId,values.originalId);
      if(original.kind!==(resource==="invoices"?"INVOICE":"BILL")||original.status!=="POSTED"||original.partyId!==values.partyId)
        throw new AppError(400,"Select this party's posted original invoice or bill");
    } else if(values.originalId)throw new AppError(400,"Only credit/debit notes reference an original document");
    const priced=await priceLines(tx,companyId,lines,resource);
    const payload={...values,date:dateOnly(values.date),dueDate:dateOnly(values.dueDate),total:priced.total,subtotal:priced.total};
    after=before?await model.update({where:{id:before.id,companyId},data:{...payload,updatedBy:actor.id,version:{increment:1}}}):await model.create({data:{...payload,companyId,...meta(actor)}});
    if(resource==="invoices") {
      if(before)await tx.invoiceLine.deleteMany({where:{companyId,invoiceId:after.id}});
      await tx.invoiceLine.createMany({data:priced.lines.map(l=>({...l,invoiceId:after.id,...meta(actor)}))});
    } else {
      if(before)await tx.billLine.deleteMany({where:{companyId,billId:after.id}});
      await tx.billLine.createMany({data:priced.lines.map(l=>({...l,billId:after.id,...meta(actor)}))});
    }
  }
  const complete=await record(tx,resource,companyId,after.id,{include:resource==="payments"?{allocations:{where:{companyId,deletedAt:null}}}:{lines:{where:{companyId,deletedAt:null}}}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE",cfg.table,after.id,before,complete);return complete;
}

export async function postDocument(tx:Tx,actor:Actor,companyId:string,resource:"invoices"|"bills"|"payments",id:string,permission:string) {
  const cfg=resourceConfig(resource);
  const before=await record(tx,resource,companyId,id,{include:resource==="payments"?{allocations:{where:{companyId,deletedAt:null}}}:{lines:{where:{companyId,deletedAt:null},orderBy:{lineNo:"asc"}}}});
  if(before.status!=="DRAFT")throw new AppError(409,"Document is not a draft");
  const s=await settings(tx,companyId),fiscal=await openFiscal(tx,companyId,before.date);
  const party=await tx.party.findFirst({where:{companyId,id:before.partyId,deletedAt:null,active:true}});
  if(!party)throw new AppError(400,"Party is no longer active");
  let journalId:string,docType:string,lines:any[];
  if(resource==="payments") {
    const receipt=before.direction==="RECEIPT";
    const account=await record(tx,"chart",companyId,before.settlementAccountId);
    await dimensionCheck(tx,companyId,before);
    outletAccountCheck(account,before.outletId);
    if(!account.active||account.isGroup||(before.method==="CASH"?!account.isCash:!account.isBank))
      throw new AppError(400,"Settlement account is no longer available for this method");
    const allocations=before.allocations.map((a:any)=>({invoiceId:a.invoiceId,billId:a.billId,amount:a.amount.toFixed(4)}));
    // Revalidate immediately before posting; another posted receipt may have
    // consumed an outstanding balance since this draft was saved.
    await applyAllocations(tx,actor,companyId,before,allocations);
    journalId=before.method==="CASH"?s.cashJournalId:s.bankJournalId;
    docType=receipt?"REC":"PAY";
    const tags={departmentId:before.departmentId,eventId:before.eventId,outletId:before.outletId};
    lines=[
      {accountId:before.settlementAccountId,debit:receipt?before.amount:zero(),credit:receipt?zero():before.amount,...tags},
      {accountId:receipt?s.receivableAccountId:s.payableAccountId,partyId:before.partyId,debit:receipt?zero():before.amount,credit:receipt?before.amount:zero(),...tags}
    ];
  } else {
    const invoice=resource==="invoices",note=before.kind!==(invoice?"INVOICE":"BILL");
    if(note) {
      const original=await record(tx,resource,companyId,before.originalId);
      if(original.status!=="POSTED"||original.partyId!==before.partyId||original.kind!==(invoice?"INVOICE":"BILL"))
        throw new AppError(400,"Original document is no longer available");
      const b=await outstanding(tx,companyId,resource,original);
      if(before.total.gt(b.outstanding))throw new AppError(400,"Credit/debit note exceeds the original's unallocated outstanding");
    }
    await priceLines(tx,companyId,before.lines.map((l:any)=>({...l,qty:l.qty.toFixed(4),rate:l.rate.toFixed(4)})),resource);
    journalId=invoice?s.salesJournalId:s.purchaseJournalId;
    docType=invoice?(note?"CN":"INV"):(note?"DN":"BILL");
    const controlDebit=invoice!==note;
    // Counterparty lines follow the dimensions of each document line.
    lines=before.lines.flatMap((l:any)=>[
      {accountId:invoice?s.receivableAccountId:s.payableAccountId,partyId:before.partyId,debit:controlDebit?l.total:zero(),credit:controlDebit?zero():l.total,departmentId:l.departmentId,eventId:l.eventId,outletId:l.outletId,memo:l.description},
      {accountId:l.accountId,debit:controlDebit?zero():l.total,credit:controlDebit?l.total:zero(),departmentId:l.departmentId,eventId:l.eventId,outletId:l.outletId,memo:l.description}
    ]);
    // Zero-priced descriptive rows have no ledger effect.
    lines=lines.filter(l=>decimal(l.debit).gt("0")||decimal(l.credit).gt("0"));
  }
  const number=await nextDocumentNumber(tx,actor,companyId,docType,fiscal.id);
  const entry=await postEntry(tx,actor,companyId,{journalId,date:before.date,kind:before.kind??before.direction,sourceType:resource==="invoices"?"INVOICE":resource==="bills"?"BILL":"PAYMENT",sourceId:before.id,narration:before.narration??number,lines},permission);
  const after=await delegate(tx,resource).update({where:{id,companyId},data:{number,status:"POSTED",entryId:entry.id,updatedBy:actor.id,version:{increment:1}}});
  await audit(tx,actor,companyId,"POST",cfg.table,id,before,{...after,entryId:entry.id});
  return after;
}

export async function cancelDocument(tx:Tx,actor:Actor,companyId:string,resource:"invoices"|"bills"|"payments",id:string,note:string,permission:string) {
  const before=await record(tx,resource,companyId,id);
  if(before.status!=="POSTED")throw new AppError(409,"Only an uncancelled posted document can be reversed");
  if(resource!=="payments") {
    const invoice=resource==="invoices";
    const allocated=await tx.paymentAllocation.findFirst({where:{companyId,deletedAt:null,...(invoice?{invoiceId:id}:{billId:id}),payment:{companyId,status:"POSTED",deletedAt:null}}});
    const notes=invoice?await tx.invoice.count({where:{companyId,originalId:id,status:"POSTED",deletedAt:null}}):await tx.bill.count({where:{companyId,originalId:id,status:"POSTED",deletedAt:null}});
    if(allocated||notes)throw new AppError(409,"Reallocate/cancel payments and reverse related notes before cancelling the original");
  }
  const reversal=await reverseEntry(tx,actor,companyId,before.entryId,accountingToday(),note,permission);
  const after=await delegate(tx,resource).update({where:{id,companyId},data:{status:"CANCELLED",reversalEntryId:reversal.id,updatedBy:actor.id,version:{increment:1}}});
  await audit(tx,actor,companyId,"CANCEL",resourceConfig(resource).table,id,before,after);return after;
}
