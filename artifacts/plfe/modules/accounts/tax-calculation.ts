import {Prisma} from "@prisma/client";
import Decimal from "decimal.js";
import {AppError} from "@/lib/errors";
import {money} from "@/lib/money";
import {dateOnly,dimensionCheck,outletAccountCheck,record,type Tx} from "./model";
import {validateTaxMappings} from "./tax-master";

const Exact=Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
const zero=()=>new Prisma.Decimal("0.0000");
const iso=(date:Date)=>date.toISOString().slice(0,10);
function cash(value:string|Prisma.Decimal|Decimal) {
  try{return money(new Exact(value.toString()).toFixed(4));}
  catch{throw new AppError(400,"The calculated amount exceeds the supported fourteen digits and four decimal places");}
}
function part(amount:Prisma.Decimal,qty:Prisma.Decimal,totalQty:Prisma.Decimal) {
  return cash(new Exact(amount.toFixed(4)).mul(qty.toFixed(4)).div(totalQty.toFixed(4)));
}
function percentage(base:Prisma.Decimal,rate:Prisma.Decimal) {
  return cash(new Exact(base.toFixed(4)).mul(rate.toFixed(6)).div("100"));
}
export function taxSnapshot(tax:any) {
  return {id:tax.id,code:tax.code,name:tax.name,version:tax.version,kind:tax.kind,
    authority:tax.authority,percentage:tax.percentage.toFixed(6),applicability:tax.applicability,
    province:tax.province,outputAccountId:tax.outputAccountId,inputAccountId:tax.inputAccountId,
    effectiveFrom:iso(tax.effectiveFrom),effectiveTo:tax.effectiveTo?iso(tax.effectiveTo):null};
}
export function taxLineEvidence(line:any) {
  return {...line,tax:line.taxSnapshot??null,defaultTax:line.defaultTaxSnapshot??null,
    withholdingTax:line.withholdingSnapshot??null};
}
function valid(tax:any,date:Date,party:any,invoice:boolean,withholding=false) {
  if(!tax.active||tax.deletedAt||tax.effectiveFrom>date||tax.effectiveTo&&tax.effectiveTo<date)
    throw new AppError(400,`${tax.code} v${tax.version} is not active/effective on ${iso(date)}; select an applicable version`);
  if(!["BOTH",invoice?"SALES":"PURCHASES"].includes(tax.applicability))
    throw new AppError(400,`${tax.code} does not apply to ${invoice?"sales":"purchases"}`);
  if(withholding!==(tax.kind==="WITHHOLDING"))
    throw new AppError(400,withholding?"Choose a withholding version in the separate Withholding field":"Withholding is not sales tax; use the separate Withholding field");
  if(tax.kind==="PROVINCIAL_SERVICES"&&party.province!==tax.province)
    throw new AppError(400,party.province?`${tax.authority} applies to ${tax.province}, not ${party.province}; choose the matching province's tax`:"Set the party's province before applying provincial services tax");
}
async function applicable(tx:Tx,companyId:string,date:Date,party:any,invoice:boolean,where:any,label:string) {
  const rows=await tx.tax.findMany({where:{companyId,active:true,deletedAt:null,
    effectiveFrom:{lte:date},OR:[{effectiveTo:null},{effectiveTo:{gte:date}}],
    applicability:{in:["BOTH",invoice?"SALES":"PURCHASES"]},...where}});
  if(rows.length>1)throw new AppError(409,`${label} has more than one applicable tax version; correct overlapping tax settings before saving`);
  if(rows[0])valid(rows[0],date,party,invoice);
  return rows[0];
}
async function defaultTax(tx:Tx,companyId:string,account:any,date:Date,party:any,invoice:boolean) {
  if(account.defaultTaxId) {
    const anchor=await record(tx,"taxes",companyId,account.defaultTaxId);
    const tax=await applicable(tx,companyId,date,party,invoice,{code:anchor.code},`Account ${account.code}'s default`);
    if(!tax)throw new AppError(400,`Account ${account.code}'s default ${anchor.code} has no active applicable version on ${iso(date)}; configure that version`);
    return {tax,source:"ACCOUNT"};
  }
  const federal=await applicable(tx,companyId,date,party,invoice,{kind:"FEDERAL_SALES",isDefault:true},"Company federal default");
  if(federal)return {tax:federal,source:"COMPANY_FEDERAL"};
  if(!party.province)throw new AppError(400,"Configure an applicable federal default, or set the party's province and its provincial services tax; an untaxed document cannot be assumed");
  if(party.province==="Islamabad Capital Territory")
    throw new AppError(400,"No Islamabad provincial authority is configured; choose an applicable federal or account-specific tax, not another province's authority");
  const provincial=await applicable(tx,companyId,date,party,invoice,{kind:"PROVINCIAL_SERVICES",province:party.province,isDefault:true},`${party.province} provincial default`);
  if(!provincial)throw new AppError(400,`Configure an active applicable federal or ${party.province} provincial default for ${iso(date)}; no zero-tax fallback is permitted`);
  return {tax:provincial,source:"PARTY_PROVINCE"};
}
function partyEvidence(party:any) {
  const treatment=party.taxTreatment??"STANDARD";
  if(!["STANDARD","EXEMPT","ZERO_RATED"].includes(treatment))
    throw new AppError(400,"Select an explicit tax treatment on the party");
  if(treatment!=="STANDARD"&&((party.taxExemptionReason??"").trim().length<10||!(party.taxCertificateRef??"").trim()))
    throw new AppError(400,"Exemption/zero-rating needs a written party reason and certificate reference");
  return {partyTaxTreatment:treatment,partyTaxReason:treatment==="STANDARD"?null:party.taxExemptionReason,
    partyTaxCertificate:treatment==="STANDARD"?null:party.taxCertificateRef};
}
function totals(lines:any[],evidence:any,taxOverrideReason:string|null) {
  const subtotal=cash(lines.reduce((sum,l)=>sum.add(l.total),zero()));
  if(!subtotal.gt("0"))throw new AppError(400,"The document needs a positive taxable/exempt basis");
  const taxTotal=cash(lines.reduce((sum,l)=>sum.add(l.taxAmount),zero()));
  const withholdingTotal=cash(lines.reduce((sum,l)=>sum.add(l.withholdingAmount),zero()));
  const total=cash(subtotal.add(taxTotal)),netTotal=cash(total.sub(withholdingTotal));
  if(netTotal.lt("0"))throw new AppError(400,"Withholding cannot exceed the gross document total");
  return {subtotal,taxTotal,withholdingTotal,total,netTotal,taxOverrideReason,...evidence,lines};
}
async function lineAccount(tx:Tx,companyId:string,line:any,invoice:boolean) {
  const account=await record(tx,"chart",companyId,line.accountId);
  if(!account.active||account.isGroup||(invoice?account.type!=="INCOME":!["ASSET","EXPENSE"].includes(account.type)))
    throw new AppError(400,invoice?"Sales lines need active income posting accounts":"Purchase lines need active asset/expense posting accounts");
  await dimensionCheck(tx,companyId,line);
  outletAccountCheck(account,line.outletId);
  return account;
}
/** Date/company/applicability-aware pricing. No write, audit, number or fallback rate. */
export async function calculateTaxDocument(tx:Tx,companyId:string,resource:"invoices"|"bills",data:any,party:any,excludeDocumentId?:string) {
  const invoice=resource==="invoices",note=data.kind!==(invoice?"INVOICE":"BILL");
  if(note)return calculateNote(tx,companyId,resource,data,party,excludeDocumentId);
  if(data.originalId)throw new AppError(400,"Only a credit/debit note may reference an original");
  const date=dateOnly(data.date),evidence=partyEvidence(party),reason=(data.taxOverrideReason??"").trim()||null;
  const lines:any[]=[],checked=new Set<string>();
  async function checkMapping(tax:any) {
    if(tax&&!checked.has(tax.id)) {
      await validateTaxMappings(tx,companyId,tax);checked.add(tax.id);
    }
  }
  for(const [index,input] of data.lines.entries()) {
    const account=await lineAccount(tx,companyId,input,invoice);
    const qty=cash(input.qty),rate=cash(input.rate);
    if(!qty.gt("0")||rate.lt("0"))throw new AppError(400,"Use a positive quantity and non-negative unit rate");
    const base=cash(new Exact(qty.toFixed(4)).mul(rate.toFixed(4)));
    const fallback=await defaultTax(tx,companyId,account,date,party,invoice);
    await checkMapping(fallback.tax);
    let selected:any=fallback.tax;
    const selection=input.taxSelection??"AUTO";
    if(selection==="SELECTED") {
      if(!input.taxId)throw new AppError(400,`Line ${index+1}: select the explicit sales/input tax version`);
      selected=await record(tx,"taxes",companyId,input.taxId);
      valid(selected,date,party,invoice);
      await checkMapping(selected);
    } else if(selection==="CLEARED")selected=null;
    if((!selected||selected.percentage.lt(fallback.tax.percentage))&&(!reason||reason.length<10))
      throw new AppError(400,"Clearing a default or selecting a lower rate requires a written document-level tax reason of at least ten characters");
    if(selected?.percentage.eq("0")&&evidence.partyTaxTreatment==="STANDARD")
      throw new AppError(400,"Zero-rating must be explicit on the party, with its written reason and certificate reference");
    const taxRate=new Prisma.Decimal(selected&&evidence.partyTaxTreatment==="STANDARD"?selected.percentage.toFixed(6):"0");
    let withholding:any=null;
    if(input.withholdingTaxId) {
      withholding=await record(tx,"taxes",companyId,input.withholdingTaxId);
      valid(withholding,date,party,invoice,true);
      await checkMapping(withholding);
    }
    const withholdingRate=new Prisma.Decimal(withholding?.percentage.toFixed(6)??"0");
    lines.push({companyId,accountId:account.id,lineNo:index+1,description:input.description,qty,rate,total:base,
      taxId:selected?.id??null,defaultTaxId:fallback.tax.id,taxSelection:selection,taxRate,taxAmount:percentage(base,taxRate),
      taxSnapshot:selected?taxSnapshot(selected):null,defaultTaxSnapshot:{...taxSnapshot(fallback.tax),source:fallback.source},
      withholdingTaxId:withholding?.id??null,withholdingRate,withholdingAmount:percentage(base,withholdingRate),
      withholdingSnapshot:withholding?taxSnapshot(withholding):null,originalLineId:null,
      departmentId:input.departmentId??null,outletId:input.outletId??null,eventId:null});
  }
  return totals(lines,evidence,reason);
}
async function calculateNote(tx:Tx,companyId:string,resource:"invoices"|"bills",data:any,party:any,excludeDocumentId?:string) {
  const invoice=resource==="invoices";
  if(!data.originalId)throw new AppError(400,"Select the posted original invoice/bill and its original lines");
  const original=await record(tx,resource,companyId,data.originalId);
  if(original.openingRecordId)throw new AppError(409,"An opening balance has no newly recognized tax breakdown. Use its normal independently approved cancellation/reversal, not a credit/debit note that invents historical tax");
  if(original.status!=="POSTED"||original.partyId!==party.id||original.kind!==(invoice?"INVOICE":"BILL"))
    throw new AppError(400,"Select this party's posted original invoice/bill");
  const lines:any[]=[],seen=new Set<string>();
  for(const [index,input] of data.lines.entries()) {
    if(!input.originalLineId||seen.has(input.originalLineId))
      throw new AppError(400,"Each note line must identify one distinct original line");
    seen.add(input.originalLineId);
    const model:any=invoice?tx.invoiceLine:tx.billLine;
    const source=await model.findFirst({where:{id:input.originalLineId,companyId,
      ...(invoice?{invoiceId:original.id}:{billId:original.id}),deletedAt:null}});
    if(!source)throw new AppError(400,"The selected original line does not belong to this company and original document");
    if(!source.defaultTaxId||!source.defaultTaxSnapshot)
      throw new AppError(409,"The original has no reviewed tax evidence; do not silently re-default its historical amounts");
    if(input.taxId&&input.taxId!==source.taxId||input.withholdingTaxId&&input.withholdingTaxId!==source.withholdingTaxId||
      input.taxSelection==="CLEARED"&&source.taxSelection!=="CLEARED")
      throw new AppError(400,"A note cannot replace or clear the original line's tax or withholding; its original snapshots are required");
    if(input.accountId!==source.accountId||!cash(input.rate).eq(source.rate)||
      ["departmentId","outletId","eventId"].some(key=>(input[key]??null)!==(source[key]??null)))
      throw new AppError(400,"Notes retain the original line's account, unit rate, department and outlet; change only its quantity");
    await lineAccount(tx,companyId,source,invoice);
    const parent=invoice?"invoice":"bill";
    const previous=await model.aggregate({where:{companyId,originalLineId:source.id,deletedAt:null,
      [parent]:{companyId,kind:invoice?"CREDIT_NOTE":"DEBIT_NOTE",status:"POSTED",deletedAt:null,
        ...(excludeDocumentId?{id:{not:excludeDocumentId}}:{})}},
      _sum:{qty:true,total:true,taxAmount:true,withholdingAmount:true}});
    const used=previous._sum,remainingQty=source.qty.sub(used.qty??zero()),qty=cash(input.qty);
    if(!qty.gt("0")||qty.gt(remainingQty))
      throw new AppError(400,`Line ${index+1}: only ${remainingQty.toFixed(4)} of the original quantity remains after earlier posted notes`);
    const full=qty.eq(remainingQty);
    const portion=(key:string)=>full?cash(source[key].sub(used[key]??zero())):part(source[key],qty,source.qty);
    const base=portion("total"),taxAmount=portion("taxAmount"),withholdingAmount=portion("withholdingAmount");
    for(const [key,value] of [["total",base],["taxAmount",taxAmount],["withholdingAmount",withholdingAmount]] as const)
      if(value.lt("0")||value.gt(source[key].sub(used[key]??zero())))
        throw new AppError(400,"The note would exceed an original line's remaining basis or tax after earlier notes");
    lines.push({companyId,accountId:source.accountId,lineNo:index+1,description:input.description,qty,rate:source.rate,total:base,
      taxId:source.taxId,defaultTaxId:source.defaultTaxId,taxSelection:source.taxSelection,
      taxRate:source.taxRate,taxAmount,taxSnapshot:source.taxSnapshot,defaultTaxSnapshot:source.defaultTaxSnapshot,
      withholdingTaxId:source.withholdingTaxId,withholdingRate:source.withholdingRate,withholdingAmount,
      withholdingSnapshot:source.withholdingSnapshot,originalLineId:source.id,
      departmentId:source.departmentId,eventId:source.eventId,outletId:source.outletId});
  }
  return totals(lines,{partyTaxTreatment:original.partyTaxTreatment,partyTaxReason:original.partyTaxReason,
    partyTaxCertificate:original.partyTaxCertificate},original.taxOverrideReason);
}
