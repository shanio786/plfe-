import {Prisma} from "@prisma/client";
import {AppError} from "@/lib/errors";
import {money} from "@/lib/money";
import {dimensionCheck,outletAccountCheck,meta,record,type Tx} from "./model";
import type {Actor} from "@/modules/core/model";
export const zero=()=>new Prisma.Decimal("0.0000");
export function decimal(value:string|Prisma.Decimal) {
  try{return money(value);}catch{throw new AppError(400,"Amount exceeds numeric(18,4) or has more than four decimal places");}
}
export function positive(value:string|Prisma.Decimal) {
  const d=decimal(value);if(!d.gt("0"))throw new AppError(400,"Amount must be greater than zero");return d;
}
export async function outstanding(tx:Tx,companyId:string,resource:"invoices"|"bills",doc:any,excludePaymentId?:string) {
  const invoice=resource==="invoices";
  const allocations=await tx.paymentAllocation.aggregate({where:{companyId,deletedAt:null,...(invoice?{invoiceId:doc.id}:{billId:doc.id}),payment:{companyId,status:"POSTED",deletedAt:null,...(excludePaymentId?{id:{not:excludePaymentId}}:{})}},_sum:{amount:true}});
  const notes=invoice
    ? await tx.invoice.aggregate({where:{companyId,originalId:doc.id,kind:"CREDIT_NOTE",status:"POSTED",deletedAt:null},_sum:{total:true}})
    : await tx.bill.aggregate({where:{companyId,originalId:doc.id,kind:"DEBIT_NOTE",status:"POSTED",deletedAt:null},_sum:{total:true}});
  const paid=allocations._sum.amount??zero(),credited=notes._sum.total??zero();
  const note=invoice?doc.kind==="CREDIT_NOTE":doc.kind==="DEBIT_NOTE";
  const balance=doc.status==="CANCELLED"||note&&doc.status==="POSTED"?zero():doc.total.sub(paid).sub(credited);
  return {paid:paid.toFixed(4),credited:credited.toFixed(4),outstanding:balance.toFixed(4),settlementStatus:doc.status==="CANCELLED"?"CANCELLED":doc.status==="DRAFT"?"DRAFT":note?"APPLIED":balance.eq("0")?"PAID":paid.add(credited).gt("0")?"PART_PAID":"UNPAID"};
}
export async function priceLines(tx:Tx,companyId:string,lines:any[],resource:"invoices"|"bills") {
  let total=zero();
  const result=[];
  for(const [index,line] of lines.entries()) {
    const account=await tx.account.findFirst({where:{id:line.accountId,companyId,active:true,isGroup:false,deletedAt:null}});
    if(!account||(resource==="invoices"?account.type!=="INCOME":!["EXPENSE","ASSET"].includes(account.type)))
      throw new AppError(400,resource==="invoices"?"Sales lines require an active income account":"Bill lines require an active expense or asset account");
    await dimensionCheck(tx,companyId,line);
    outletAccountCheck(account,line.outletId);
    const qty=positive(line.qty),rate=decimal(line.rate),lineTotal=decimal(qty.mul(rate).toDecimalPlaces(4));
    total=total.add(lineTotal);
    result.push({companyId,accountId:line.accountId,lineNo:index+1,description:line.description,qty,rate,total:lineTotal,departmentId:line.departmentId,eventId:line.eventId,outletId:line.outletId});
  }
  return {total:positive(total),lines:result};
}
export async function applyAllocations(tx:Tx,actor:Actor,companyId:string,payment:any,allocations:any[]) {
  let allocated=zero();const seen=new Set<string>();
  for(const a of allocations) {
    if(!!a.invoiceId===!!a.billId) throw new AppError(400,"Each allocation needs exactly one invoice or bill");
    const invoices=!!a.invoiceId;
    if(invoices!==(payment.direction==="RECEIPT")) throw new AppError(400,"Receipts allocate to invoices; outgoing payments allocate to bills");
    const id=a.invoiceId??a.billId;
    if(seen.has(id))throw new AppError(400,"Combine duplicate document allocations");
    seen.add(id);
    const doc=await record(tx,invoices?"invoices":"bills",companyId,id);
    if(doc.status!=="POSTED"||doc.kind!==(invoices?"INVOICE":"BILL")||doc.partyId!==payment.partyId)
      throw new AppError(400,"Allocate only to this party's posted, uncancelled invoice or bill");
    const balance=await outstanding(tx,companyId,invoices?"invoices":"bills",doc,payment.id);
    const amount=positive(a.amount);
    if(amount.gt(balance.outstanding))throw new AppError(400,"Allocation exceeds the document's outstanding amount");
    allocated=allocated.add(amount);
  }
  if(allocated.gt(payment.amount))throw new AppError(400,"Allocations exceed the payment amount");
  const before=await tx.paymentAllocation.findMany({where:{companyId,paymentId:payment.id,deletedAt:null}});
  await tx.paymentAllocation.updateMany({where:{companyId,paymentId:payment.id,deletedAt:null},data:{deletedAt:new Date(),updatedBy:actor.id}});
  if(allocations.length)await tx.paymentAllocation.createMany({data:allocations.map(a=>({companyId,paymentId:payment.id,invoiceId:a.invoiceId??null,billId:a.billId??null,amount:positive(a.amount),...meta(actor)}))});
  const after=await tx.paymentAllocation.findMany({where:{companyId,paymentId:payment.id,deletedAt:null}});
  return {before,after};
}
