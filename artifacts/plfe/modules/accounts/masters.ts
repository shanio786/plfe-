import {AppError} from "@/lib/errors";
import {audit} from "@/lib/audit";
import {accountSchema,departmentSchema,journalSchema,partySchema,settingsSchema} from "./schema";
import {authorize,delegate,meta,record,resourceConfig,settings,type Tx} from "./model";
import {decimal,zero} from "./balances";
import type {Actor} from "@/modules/core/model";

export async function checkAccount(tx:Tx,companyId:string,data:any,id?:string,planned=new Map<string,any>()) {
  if((data.isCash||data.isBank)&&(data.type!=="ASSET"||data.isGroup)||data.isCash&&data.isBank)
    throw new AppError(400,"Cash/bank accounts must be separate non-group asset accounts");
  if(data.defaultTaxId) {
    const tax=await record(tx,"taxes",companyId,data.defaultTaxId);
    if(tax.kind==="WITHHOLDING"||data.isGroup||data.isCash||data.isBank||!["ASSET","INCOME","EXPENSE"].includes(data.type))
      throw new AppError(400,"Default sales/input tax belongs to an income, expense or non-cash asset posting account; withholding is selected separately");
  }
  const seen=new Set(id?[id]:[]);
  let parentId=data.parentId;
  while(parentId) {
    if(seen.has(parentId))throw new AppError(400,"Account tree cannot contain a cycle");
    seen.add(parentId);
    const parent=planned.get(parentId)??await record(tx,"chart",companyId,parentId);
    if(!parent.isGroup||parent.type!==data.type||!parent.active)throw new AppError(400,"Parent must be an active group of the same account type");
    if(!id&&(parent.code==="1600"||parent.code==="2500"||
      await tx.account.findFirst({where:{companyId,parentId:parent.id,counterpartyCompanyId:{not:null}}})))
      throw new AppError(400,"Due-from/to children require explicit reciprocal company links and are provisioned only by company setup, not manual chart extensions");
    parentId=parent.parentId;
  }
  if(id&&await tx.journalLine.findFirst({where:{companyId,accountId:id,entry:{companyId,status:"POSTED"}}})) {
    const before=await record(tx,"chart",companyId,id);
    if(["type","isGroup","isCash","isBank"].some(k=>before[k]!==data[k]))
      throw new AppError(409,"A used account's classification cannot change");
  }
  if(id&&await tx.tax.findFirst({where:{companyId,OR:[{outputAccountId:id},{inputAccountId:id}]}})) {
    const before=await record(tx,"chart",companyId,id);
    if(["type","isGroup","isCash","isBank"].some(key=>before[key]!==data[key]))
      throw new AppError(409,"An account referenced by a tax version must retain its financial classification");
  }
  if(id) {
    const before=await record(tx,"chart",companyId,id);
    const managed=before.isGroup&&(["1100","1600","1700","2500"].includes(before.code)||
      await tx.account.findFirst({where:{companyId,parentId:id,OR:[{counterpartyCompanyId:{not:null}},{outletId:{not:null}}]}}));
    if(managed&&(before.code!==data.code||before.type!==data.type||!data.isGroup))
      throw new AppError(409,"A managed cash/inventory/group parent must retain its code, type and non-posting meaning for future company/location setup");
  }
}
async function protectReferences(tx:Tx,companyId:string,resource:string,id:string,archiving:boolean) {
  if(resource==="chart") {
    if(await tx.tax.findFirst({where:{companyId,...(archiving?{}:{active:true}),OR:[{outputAccountId:id},{inputAccountId:id}]}}))
      throw new AppError(409,archiving?"Tax version accounts are retained and cannot be archived":"Deactivate or remap the active tax version before disabling this account");
    if(await tx.account.findFirst({where:{companyId,parentId:id,deletedAt:null}}))throw new AppError(409,"Move child accounts before disabling or archiving this group");
    if(await tx.accountingSettings.findFirst({where:{companyId,OR:[{receivableAccountId:id},{payableAccountId:id},{openingEquityAccountId:id}]}}))
      throw new AppError(409,"Change posting settings before disabling this control account");
    if(archiving&&await tx.journalLine.findFirst({where:{companyId,accountId:id}}))throw new AppError(409,"A used account can be deactivated, not archived");
  } else if(resource==="journals") {
    if(await tx.accountingSettings.findFirst({where:{companyId,OR:[{salesJournalId:id},{purchaseJournalId:id},{generalJournalId:id},{cashJournalId:id},{bankJournalId:id}]}}))
      throw new AppError(409,"Change posting settings before disabling this journal");
    if(archiving&&await tx.journalEntry.findFirst({where:{companyId,journalId:id}}))throw new AppError(409,"A used journal can be deactivated, not archived");
  } else if(resource==="parties"&&archiving) {
    if(await tx.journalLine.findFirst({where:{companyId,partyId:id}})||await tx.invoice.findFirst({where:{companyId,partyId:id}})||await tx.bill.findFirst({where:{companyId,partyId:id}})||await tx.payment.findFirst({where:{companyId,partyId:id}}))
      throw new AppError(409,"A party with documents can be deactivated, not archived");
  } else if(resource==="departments"&&archiving) {
    if(await tx.journalLine.findFirst({where:{companyId,departmentId:id}})||await tx.invoiceLine.findFirst({where:{companyId,departmentId:id}})||await tx.billLine.findFirst({where:{companyId,departmentId:id}}))
      throw new AppError(409,"A used department can be deactivated, not archived");
  }
}
export async function saveMaster(tx:Tx,actor:Actor,companyId:string,resource:string,raw:any) {
  const cfg=resourceConfig(resource),model=delegate(tx,resource);
  const before=raw.id?await record(tx,resource,companyId,raw.id):null;
  if(resource==="chart"&&before?.outletId) {
    if(raw.operation==="delete")throw new AppError(409,"Outlet accounts are permanent and cannot be archived");
    const proposed=accountSchema.parse(raw);
    if(["code","name","type","parentId","isGroup","isCash","isBank","active"].some(key=>(before[key]??null)!==((proposed as any)[key]??null)))
      throw new AppError(409,"This account is managed by its outlet; only its default tax can be changed here. Edit or deactivate the outlet to change its name or active status");
  }
  if(raw.operation==="delete") {
    if(!before)throw new AppError(404,"Record not found");
    await protectReferences(tx,companyId,resource,before.id,true);
    const after=await model.update({where:{id:before.id,companyId},data:{deletedAt:new Date(),updatedBy:actor.id}});
    await audit(tx,actor,companyId,"CANCEL",cfg.table,before.id,before,after);return after;
  }
  let data:any;
  if(resource==="chart") {
    data=accountSchema.parse(raw);
    if(before&&raw.defaultTaxId===undefined)data.defaultTaxId=before.defaultTaxId;
    await checkAccount(tx,companyId,data,before?.id);
  }
  else if(resource==="parties") {
    data=partySchema.parse(raw);
    if(!before&&decimal(data.openingBalance).gt("0"))
      throw new AppError(400,"Opening balances are posted only through guided opening. Imports stage amounts for deliberate review; creating a party never posts financial documents");
    if(before)for(const key of ["strn","taxTreatment","taxExemptionReason","taxCertificateRef"])
      if(raw[key]===undefined)data[key]=before[key];
    if(before&&raw.linkedCompanyId===undefined)data.linkedCompanyId=before.linkedCompanyId;
    if(before?.linkedCompanyId&&before.linkedCompanyId!==data.linkedCompanyId&&(
      await tx.invoice.findFirst({where:{companyId,partyId:before.id,status:{in:["POSTED","CANCELLED"]}}})||
      await tx.bill.findFirst({where:{companyId,partyId:before.id,status:{in:["POSTED","CANCELLED"]}}})||
      await tx.payment.findFirst({where:{companyId,partyId:before.id,status:{in:["POSTED","CANCELLED"]}}})||
      await tx.journalLine.findFirst({where:{companyId,partyId:before.id,entry:{status:{in:["POSTED","CANCELLED"]}}}})
    ))throw new AppError(409,"A used party's linked legal company identity is permanent; create a separate party for a different legal identity");
    if(data.linkedCompanyId&&!await tx.company.findFirst({where:{id:data.linkedCompanyId,
      ...(before?.linkedCompanyId===data.linkedCompanyId?{}:{active:true,deletedAt:null})}}))
      throw new AppError(400,"Choose an existing active company identity; an old link may be retained after its deactivation");
    if(data.taxTreatment!=="STANDARD"&&((data.taxExemptionReason??"").trim().length<10||!(data.taxCertificateRef??"").trim()))
      throw new AppError(400,"Exempt and zero-rated parties need a written reason of at least ten characters and a certificate reference");
    if(![data.isCustomer,data.isSupplier,data.isExhibitor,data.isSponsor,data.isStaff].some(Boolean))throw new AppError(400,"Choose at least one party kind");
    if(before) {
      if(raw.openingBalance!==undefined&&!before.openingBalance.eq(decimal(data.openingBalance))||raw.openingSide!==undefined&&before.openingSide!==data.openingSide)
        throw new AppError(409,"Correct opening balances through an audited journal voucher");
      delete data.openingBalance;delete data.openingSide;
    } else data.openingBalance=decimal(data.openingBalance);
  } else if(resource==="journals") {
    data=journalSchema.parse(raw);
    if(before&&before.type!==data.type&&await tx.journalEntry.findFirst({where:{companyId,journalId:before.id}}))throw new AppError(409,"A used journal's type cannot change");
  } else if(resource==="departments")data=departmentSchema.parse(raw);
  else throw new AppError(400,"Unknown accounting master");
  if(before&&!data.active)await protectReferences(tx,companyId,resource,before.id,false);
  let after=before?await model.update({where:{id:before.id,companyId},data:{...data,updatedBy:actor.id}}):await model.create({data:{...data,companyId,...meta(actor)}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE",cfg.table,after.id,before,after);
  return after;
}

export async function saveSettings(tx:Tx,actor:Actor,companyId:string,raw:any) {
  const data=settingsSchema.parse(raw);
  for(const [key,type] of [["receivableAccountId","ASSET"],["payableAccountId","LIABILITY"],["openingEquityAccountId","EQUITY"]]) {
    const a=await record(tx,"chart",companyId,(data as any)[key!]);
    if(a.type!==type||a.isGroup||!a.active||a.isBank||a.isCash)throw new AppError(400,"Control account mappings require active non-cash posting accounts of the correct type");
    if(await tx.tax.findFirst({where:{companyId,OR:[{outputAccountId:a.id},{inputAccountId:a.id}]}}))
      throw new AppError(400,"A tax-version account cannot also become a receivable, payable or opening control account");
  }
  for(const [key,type] of [["salesJournalId","SALES"],["purchaseJournalId","PURCHASE"],["generalJournalId","GENERAL"],["cashJournalId","CASH"],["bankJournalId","BANK"]]) {
    const j=await record(tx,"journals",companyId,(data as any)[key!]);
    if(j.type!==type||!j.active)throw new AppError(400,"Choose an active journal of the correct type");
  }
  const before=await tx.accountingSettings.findFirst({where:{companyId,deletedAt:null}});
  if(before&&before.openingEquityAccountId!==data.openingEquityAccountId&&(
    await tx.openingRecord.findFirst({where:{companyId}})||(await tx.company.findUniqueOrThrow({where:{id:companyId}})).booksOpenedAt))
    throw new AppError(409,"Opening equity mapping is permanent once an opening is captured or books are declared open");
  if(before)for(const key of ["receivableAccountId","payableAccountId"] as const) {
    if(before[key]!==data[key]) {
      const balance=await tx.journalLine.aggregate({where:{companyId,accountId:before[key],deletedAt:null,entry:{companyId,status:"POSTED",deletedAt:null}},_sum:{debit:true,credit:true}});
      if(!(balance._sum.debit??zero()).eq(balance._sum.credit??zero()))
        throw new AppError(409,"Settle the existing control-account balance before changing its mapping");
    }
  }
  if(raw.id&&raw.id!==before?.id)throw new AppError(404,"Accounting settings not found");
  const after=before?await tx.accountingSettings.update({where:{id:before.id,companyId},data:{...data,updatedBy:actor.id}}):await tx.accountingSettings.create({data:{...data,companyId,...meta(actor)}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE","accounting_settings",after.id,before,after);return after;
}
