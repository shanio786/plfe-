import {AppError} from "@/lib/errors";
import {audit} from "@/lib/audit";
import {postEntry} from "@/lib/posting";
import {accountSchema,departmentSchema,journalSchema,partySchema,settingsSchema} from "./schema";
import {authorize,delegate,meta,record,resourceConfig,settings,type Tx} from "./model";
import {decimal,zero} from "./balances";
import type {Actor} from "@/modules/core/model";
import {accountingToday} from "./time";

async function checkAccount(tx:Tx,companyId:string,data:any,id?:string) {
  if((data.isCash||data.isBank)&&(data.type!=="ASSET"||data.isGroup)||data.isCash&&data.isBank)
    throw new AppError(400,"Cash/bank accounts must be separate non-group asset accounts");
  const seen=new Set(id?[id]:[]);
  let parentId=data.parentId;
  while(parentId) {
    if(seen.has(parentId))throw new AppError(400,"Account tree cannot contain a cycle");
    seen.add(parentId);
    const parent=await record(tx,"chart",companyId,parentId);
    if(!parent.isGroup||parent.type!==data.type||!parent.active)throw new AppError(400,"Parent must be an active group of the same account type");
    parentId=parent.parentId;
  }
  if(id&&await tx.journalLine.findFirst({where:{companyId,accountId:id,entry:{companyId,status:"POSTED"}}})) {
    const before=await record(tx,"chart",companyId,id);
    if(["type","isGroup","isCash","isBank"].some(k=>before[k]!==data[k]))
      throw new AppError(409,"A used account's classification cannot change");
  }
}
async function protectReferences(tx:Tx,companyId:string,resource:string,id:string,archiving:boolean) {
  if(resource==="chart") {
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
  if(resource==="chart"&&before?.outletId)
    throw new AppError(409,"This account is managed by its outlet; edit or deactivate the outlet instead");
  if(raw.operation==="delete") {
    if(!before)throw new AppError(404,"Record not found");
    await protectReferences(tx,companyId,resource,before.id,true);
    const after=await model.update({where:{id:before.id,companyId},data:{deletedAt:new Date(),updatedBy:actor.id}});
    await audit(tx,actor,companyId,"CANCEL",cfg.table,before.id,before,after);return after;
  }
  let data:any;
  if(resource==="chart") {data=accountSchema.parse(raw);await checkAccount(tx,companyId,data,before?.id);}
  else if(resource==="parties") {
    data=partySchema.parse(raw);
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
  if(resource==="parties"&&!before&&after.openingBalance.gt("0")) {
    await authorize(tx,actor,companyId,"accounts.entry.post");
    const s=await settings(tx,companyId),receivable=after.openingSide==="RECEIVABLE",amount=after.openingBalance;
    const date=accountingToday();
    const entry=await postEntry(tx,actor,companyId,{journalId:s.generalJournalId,date,kind:"OPENING",sourceType:"OPENING",sourceId:after.id,narration:`Opening balance: ${after.code}`,lines:[
      {accountId:receivable?s.receivableAccountId:s.payableAccountId,partyId:after.id,debit:receivable?amount:zero(),credit:receivable?zero():amount},
      {accountId:s.openingEquityAccountId,debit:receivable?zero():amount,credit:receivable?amount:zero()}
    ]},"accounts.entry.post");
    after=await model.update({where:{id:after.id,companyId},data:{openingEntryId:entry.id}});
  }
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE",cfg.table,after.id,before,after);
  return after;
}

export async function saveSettings(tx:Tx,actor:Actor,companyId:string,raw:any) {
  const data=settingsSchema.parse(raw);
  for(const [key,type] of [["receivableAccountId","ASSET"],["payableAccountId","LIABILITY"],["openingEquityAccountId","EQUITY"]]) {
    const a=await record(tx,"chart",companyId,(data as any)[key!]);
    if(a.type!==type||a.isGroup||!a.active||a.isBank||a.isCash)throw new AppError(400,"Control account mappings require active non-cash posting accounts of the correct type");
  }
  for(const [key,type] of [["salesJournalId","SALES"],["purchaseJournalId","PURCHASE"],["generalJournalId","GENERAL"],["cashJournalId","CASH"],["bankJournalId","BANK"]]) {
    const j=await record(tx,"journals",companyId,(data as any)[key!]);
    if(j.type!==type||!j.active)throw new AppError(400,"Choose an active journal of the correct type");
  }
  const before=await tx.accountingSettings.findFirst({where:{companyId,deletedAt:null}});
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
