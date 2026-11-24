import {randomUUID} from "node:crypto";
import Decimal from "decimal.js";
import {Prisma} from "@prisma/client";
import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {money} from "@/lib/money";
import {nextDocumentNumber} from "@/lib/numbering";
import {openFiscal,postEntry,type PostingLine} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {dateOnly,dimensionCheck,meta,type Tx} from "./model";
import {openingPostSchema} from "./opening-schema";
import {openingHash,openingSeries,openingState} from "./opening-state";
import {zero} from "./balances";
const Exact=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});

export async function postOpening(tx:Tx,actor:Actor,companyId:string,input:unknown) {
  const data=openingPostSchema.parse(input),state=await openingState(tx,companyId);
  const {company,s}=state;
  if(company.booksOpenedAt)throw new AppError(409,"Guided opening is permanently locked after books are declared open");
  if(!company.goLiveDate)throw new AppError(400,"Choose the first day of an open financial period as go-live first");
  const payloadHash=openingHash({actorId:actor.id,goLiveDate:company.goLiveDate,data});
  const existing=await tx.openingRecord.findUnique({where:{companyId_requestKey:{companyId,requestKey:data.requestKey}}});
  if(existing) {
    if(existing.createdBy!==actor.id||existing.payloadHash!==payloadHash||existing.status!=="POSTED")
      throw new AppError(409,"This opening operation key has already been used; refresh and start a new entry");
    return existing;
  }
  if(state.ordinary)throw new AppError(409,state.publicState.blockers[0]);
  if(state.publicState.nextStage!==data.stage)throw new AppError(409,`Review the ordered opening stages first. The current stage is ${state.publicState.nextStage}`);
  const id=randomUUID(),documentId=["RECEIVABLES","PAYABLES"].includes(data.stage)?randomUUID():null;
  const lines:PostingLine[]=[];
  let amount=zero(),accountId:string|null=null,partyId:string|null=null,outletId:string|null=null;
  const details:any={policy:"Go-live ledger; historical original dates retained; no new sales/input tax",documentId};
  function leg(account:string,net:Prisma.Decimal,party?:string|null,outlet?:string|null,memo?:string) {
    if(net.eq("0"))return;
    const positive=net.gt("0"),value=net.abs();
    lines.push({accountId:account,partyId:party,outletId:outlet,memo,debit:positive?value:zero(),credit:positive?zero():value},
      {accountId:s.openingEquityAccountId,outletId:outlet,memo,debit:positive?zero():value,credit:positive?value:zero()});
  }
  if(data.stage==="CASH"||data.stage==="BANK") {
    const account=state.publicState.accounts[data.stage==="CASH"?"cash":"bank"].find(a=>a.id===data.accountId);
    if(!account)throw new AppError(400,"Choose an active company-owned account of this opening stage");
    if(account.captured)throw new AppError(409,"This account already has an immutable opening capture; use its normal controlled reversal to correct it");
    amount=money(data.amount);
    if(data.stage==="CASH"&&amount.lt("0"))throw new AppError(400,"A physical cash opening balance cannot be negative");
    accountId=account.id;outletId=account.outletId;
    await dimensionCheck(tx,companyId,{outletId});
    Object.assign(details,{account:{id:account.id,code:account.code,name:account.name},
      ...(data.stage==="BANK"?{statementReference:data.statementReference}:{})});
    leg(account.id,amount,null,outletId);
  } else if(data.stage==="RECEIVABLES"||data.stage==="PAYABLES") {
    const p=state.parties.find(p=>p.id===data.partyId),receivable=data.stage==="RECEIVABLES";
    if(!p||(receivable?![p.isCustomer,p.isExhibitor,p.isSponsor,p.isStaff].some(Boolean):!p.isSupplier&&!p.isStaff))
      throw new AppError(400,"Choose an active same-company party with the appropriate customer/supplier role");
    amount=money(data.amount);
    if(!amount.gt("0"))throw new AppError(400,"Enter the actual positive historical outstanding amount");
    if(dateOnly(data.originalDate)>company.goLiveDate||data.dueDate<data.originalDate)
      throw new AppError(400,"Original date cannot follow go-live; due date cannot precede the original date. An overdue due date before go-live is allowed");
    if(data.stagedImportId) {
      const queue=state.stagedImports.find(q=>q.id===data.stagedImportId);
      if(!queue||queue.status!=="STAGED"||queue.partyId!==p.id||queue.side!==(receivable?"RECEIVABLE":"PAYABLE"))
        throw new AppError(400,"Choose this party's same-company staged balance of the correct side");
      if(amount.gt(queue.remaining))throw new AppError(409,`Only ${queue.remaining} of this imported balance remains for deliberate opening posting`);
    }
    partyId=p.id;accountId=receivable?s.receivableAccountId:s.payableAccountId;
    details.party={id:p.id,code:p.code,name:p.name,linkedCompanyId:p.linkedCompanyId};
    leg(accountId,receivable?amount:amount.neg(),partyId);
  } else if(data.stage==="STOCK") {
    if(company.businessType!=="RETAIL")throw new AppError(400,"Physical opening stock is available only for retail companies");
    const o=state.outlets.find(o=>o.id===data.outletId&&o.active&&!o.deletedAt);
    if(!o)throw new AppError(400,"Choose an active location in this company");
    const inventory=o.accounts.filter(a=>a.active&&!a.deletedAt&&!a.isGroup&&!a.isCash&&!a.isBank&&a.type==="ASSET");
    if(inventory.length!==1)throw new AppError(400,"This location needs its single properly provisioned inventory posting account");
    const qty=money(data.quantity),cost=money(data.unitCost);
    if(qty.lt("0")||cost.lt("0"))throw new AppError(400,"Physical quantities and unit costs cannot be negative");
    amount=money(new Exact(qty.toFixed(4)).mul(cost.toFixed(4)).toFixed(4));
    outletId=o.id;accountId=inventory[0].id;
    await dimensionCheck(tx,companyId,{outletId});
    leg(accountId,amount,null,outletId,data.description);
  } else {
    for(const line of data.lines) {
      const account=state.publicState.accounts.journal.find(a=>a.id===line.accountId);
      if(!account)throw new AppError(400,"Opening journal uses active capital/fixed-asset/depreciation/director/retained-earnings posting accounts, not cash, control, stock, income or expense accounts");
      const dr=money(line.debit),cr=money(line.credit);
      if(!(dr.gt("0")&&cr.eq("0")||cr.gt("0")&&dr.eq("0")))throw new AppError(400,"Each opening journal leg needs one positive debit or credit, not both");
      amount=amount.add(dr).sub(cr);money(amount);
      leg(account.id,dr.sub(cr),null,null,line.memo);
    }
    details.lines=data.lines;
  }
  const fiscal=await openFiscal(tx,companyId,company.goLiveDate);
  const record=await tx.openingRecord.create({data:{id,companyId,stage:data.stage,date:company.goLiveDate,amount,
    accountId,partyId,outletId,requestKey:data.requestKey,payloadHash,details,...meta(actor),
    ...("originalReference" in data?{originalReference:data.originalReference,originalDate:dateOnly(data.originalDate),dueDate:dateOnly(data.dueDate),stagedImportId:data.stagedImportId}:{}),
    ...(data.stage==="STOCK"?{stockCode:data.stockCode,description:data.description,quantity:money(data.quantity),unitCost:money(data.unitCost)}:{})}});
  const entry=lines.length?await postEntry(tx,actor,companyId,{journalId:data.stage==="CASH"?s.cashJournalId:data.stage==="BANK"?s.bankJournalId:s.generalJournalId,
    date:company.goLiveDate,kind:"OPENING",sourceType:data.stage==="RECEIVABLES"?"INVOICE":data.stage==="PAYABLES"?"BILL":"GUIDED_OPENING",
    sourceId:documentId??id,narration:`Guided opening: ${data.stage}`,lines},"accounts.opening.manage",openingSeries[data.stage]):null;
  const number=entry?.number??await nextDocumentNumber(tx,actor,companyId,openingSeries[data.stage],fiscal.id);
  const posted=await tx.openingRecord.update({where:{id,companyId},data:{entryId:entry?.id??null,number,status:"POSTED",updatedBy:actor.id}});
  if(documentId&&("originalReference" in data)) {
    const invoice=data.stage==="RECEIVABLES",model:any=invoice?tx.invoice:tx.bill,lineModel:any=invoice?tx.invoiceLine:tx.billLine;
    await model.create({data:{id:documentId,companyId,partyId:partyId!,kind:invoice?"INVOICE":"BILL",openingRecordId:id,
      date:dateOnly(data.originalDate),dueDate:dateOnly(data.dueDate),entryId:entry!.id,narration:`Historical opening balance: ${data.originalReference}`,
      subtotal:amount,total:amount,taxTotal:zero(),withholdingTotal:zero(),partyTaxTreatment:"OPENING_BALANCE",
      partyTaxReason:"Historical outstanding net balance; no new sales/input tax is recognized and no legal tax rate or exemption is asserted",...meta(actor)}});
    await lineModel.create({data:{companyId,...(invoice?{invoiceId:documentId}:{billId:documentId}),lineNo:1,
      accountId:s.openingEquityAccountId,description:`Opening outstanding: ${data.originalReference}`,qty:new Prisma.Decimal("1"),rate:amount,total:amount,
      taxSelection:"CLEARED",taxRate:zero(),taxAmount:zero(),withholdingRate:zero(),withholdingAmount:zero(),...meta(actor)}});
    await model.update({where:{id:documentId,companyId},data:{status:"POSTED",number,updatedBy:actor.id}});
    await audit(tx,actor,companyId,"POST_OPENING",invoice?"invoices":"bills",documentId,null,{openingRecordId:id,entryId:entry!.id,number,amount:amount.toFixed(4),
      originalReference:data.originalReference,originalDate:data.originalDate,dueDate:data.dueDate,ledgerDate:company.goLiveDate});
  }
  await audit(tx,actor,companyId,"POST","opening_records",id,record,posted);
  return posted;
}
