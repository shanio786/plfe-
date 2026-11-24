import {Prisma} from "@prisma/client";
import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import type {Actor} from "@/modules/core/model";
import {taxSchema} from "./schema";
import {dateOnly,meta,record,settings,type Tx} from "./model";

export const provincialAuthorities:Record<string,string>={
  PRA:"Punjab",SRB:"Sindh",KPRA:"Khyber Pakhtunkhwa",BRA:"Balochistan"
};
const includeAccounts={outputAccount:true,inputAccount:true};
const familyKeys=["code","kind","authority","applicability","province"] as const;

async function lastOriginalDate(tx:Tx,companyId:string,taxId:string) {
  const [row]=await tx.$queryRaw<{date:Date|null}[]>`SELECT max(date) AS date FROM(
    SELECT d.date FROM invoice_lines l JOIN invoices d ON d.id=l.invoice_id AND d.company_id=l.company_id
      WHERE l.company_id=${companyId}::uuid AND d.kind='INVOICE' AND d.status IN ('POSTED','CANCELLED')
      AND ${taxId}::uuid IN(l.tax_id,l.default_tax_id,l.withholding_tax_id)
    UNION ALL
    SELECT d.date FROM bill_lines l JOIN bills d ON d.id=l.bill_id AND d.company_id=l.company_id
      WHERE l.company_id=${companyId}::uuid AND d.kind='BILL' AND d.status IN ('POSTED','CANCELLED')
      AND ${taxId}::uuid IN(l.tax_id,l.default_tax_id,l.withholding_tax_id)
  ) originals`;
  return row?.date??null;
}
export async function validateTaxMappings(tx:Tx,companyId:string,data:ReturnType<typeof taxSchema.parse>) {
  if(data.kind==="PROVINCIAL_SERVICES") {
    if(provincialAuthorities[data.authority]!==data.province)
      throw new AppError(400,"Choose PRA/Punjab, SRB/Sindh, KPRA/Khyber Pakhtunkhwa or BRA/Balochistan; no Islamabad provincial authority is configured");
  } else if(data.authority!=="FBR"||data.province!=="ALL") {
    throw new AppError(400,"Federal sales tax and income-tax withholding use FBR and All provinces");
  }
  if(data.kind==="WITHHOLDING"&&data.isDefault)
    throw new AppError(400,"Withholding is selected separately from sales tax; turn off Company default");
  const s=await settings(tx,companyId);
  for(const [key,type] of [
    ["outputAccountId",data.kind==="WITHHOLDING"?"ASSET":"LIABILITY"],
    ["inputAccountId",data.kind==="WITHHOLDING"?"LIABILITY":"ASSET"]
  ] as const) {
    const a=await record(tx,"chart",companyId,data[key]);
    if(!a.active||a.isGroup||a.isBank||a.isCash||a.outletId||a.counterpartyCompanyId||a.type!==type||
      [s.receivableAccountId,s.payableAccountId,s.openingEquityAccountId].includes(a.id))
      throw new AppError(400,`${key==="outputAccountId"?"Output/advance":"Input/payable"} tax account must be an active non-cash ${type.toLowerCase()} posting account, not a party, group-company, outlet or opening control account`);
  }
}
async function assertNoOverlap(tx:Tx,companyId:string,data:any,excludeId?:string) {
  if(!data.active)return;
  const overlap=await tx.tax.findFirst({where:{
    companyId,active:true,deletedAt:null,...(excludeId?{id:{not:excludeId}}:{}),
    ...(data.effectiveTo?{effectiveFrom:{lte:data.effectiveTo}}:{}),
    AND:[
      {OR:[{effectiveTo:null},{effectiveTo:{gte:data.effectiveFrom}}]},
      {OR:[
        {code:data.code},
        ...(data.isDefault?[{kind:data.kind,province:data.province,isDefault:true,
          applicability:{in:data.applicability==="BOTH"?["BOTH","SALES","PURCHASES"]:["BOTH",data.applicability]}}]:[])
      ]}
    ]
  }});
  if(overlap)throw new AppError(409,`The effective dates overlap ${overlap.code} v${overlap.version}; close that version before the new start date or use a non-default account-specific tax`);
}

/** Only called inside the permission-checked, company-locked Accounts boundary. */
export async function saveTax(tx:Tx,actor:Actor,companyId:string,raw:any) {
  if(raw.operation&&raw.operation!=="save")throw new AppError(405,"Tax history cannot be deleted; deactivate a version instead");
  const parsed=taxSchema.parse(raw);
  await validateTaxMappings(tx,companyId,parsed);
  const {previousVersionId,...input}=parsed;
  const data={...input,percentage:new Prisma.Decimal(input.percentage),effectiveFrom:dateOnly(input.effectiveFrom),effectiveTo:input.effectiveTo?dateOnly(input.effectiveTo):null};
  if(data.effectiveTo&&data.effectiveTo<data.effectiveFrom)
    throw new AppError(400,"The tax end date cannot precede its start date");
  const before=raw.id?await record(tx,"taxes",companyId,raw.id):null;
  if(before) {
    if(previousVersionId)throw new AppError(400,"Create a new tax version without an existing record id");
    if(familyKeys.some(key=>before[key]!==data[key]))
      throw new AppError(409,"A tax code's kind, authority, province and applicability are permanent; create a different code for a different meaning");
    const [usage]=await tx.$queryRaw<{used:boolean}[]>`SELECT plfe_tax_version_used(${companyId}::uuid,${before.id}::uuid) AS used`;
    if(usage.used&&(
      before.name!==data.name||!before.percentage.eq(data.percentage)||before.outputAccountId!==data.outputAccountId||
      before.inputAccountId!==data.inputAccountId||before.isDefault!==data.isDefault||
      before.effectiveFrom.getTime()!==data.effectiveFrom.getTime()
    ))throw new AppError(409,"This tax version was used by a posted document. Create a new version for different rates, accounts or financial terms");
    if(usage.used&&before.effectiveTo&&(!data.effectiveTo||data.effectiveTo>before.effectiveTo))
      throw new AppError(409,"A used, closed tax version cannot be extended or reopened; create a new version for a later effective range");
    if(data.effectiveTo) {
      const last=await lastOriginalDate(tx,companyId,before.id);
      if(last&&last>data.effectiveTo)throw new AppError(409,`The end date cannot exclude the posted original dated ${last.toISOString().slice(0,10)}`);
    }
    await assertNoOverlap(tx,companyId,data,before.id);
    const after=await tx.tax.update({where:{id:before.id,companyId},data:{...data,updatedBy:actor.id}});
    await audit(tx,actor,companyId,"UPDATE","taxes",after.id,before,after);
    return tx.tax.findUniqueOrThrow({where:{id:after.id},include:includeAccounts});
  }
  const latest=await tx.tax.findFirst({where:{companyId,code:data.code},orderBy:{version:"desc"}});
  if(latest&&!previousVersionId)throw new AppError(409,"This tax code already exists; use Create new version to change its future rate");
  if(previousVersionId) {
    const previous=await record(tx,"taxes",companyId,previousVersionId);
    if(!latest||latest.id!==previous.id)throw new AppError(409,"Create the next version from the latest version of this tax code");
    if(familyKeys.some(key=>previous[key]!==data[key]))
      throw new AppError(400,"A new version must keep the same tax code, kind, authority, province and applicability");
    if(data.effectiveFrom<=previous.effectiveFrom)throw new AppError(400,"The new version must start after the preceding version's start date");
    const end=new Date(data.effectiveFrom);end.setUTCDate(end.getUTCDate()-1);
    const last=await lastOriginalDate(tx,companyId,previous.id);
    if(last&&last>end)throw new AppError(409,"The new rate would replace a posted original's tax date; choose a later start date");
    if(!previous.effectiveTo||previous.effectiveTo>=data.effectiveFrom) {
      const closed=await tx.tax.update({where:{id:previous.id,companyId},data:{effectiveTo:end,updatedBy:actor.id}});
      await audit(tx,actor,companyId,"UPDATE","taxes",previous.id,previous,closed);
    }
  }
  await assertNoOverlap(tx,companyId,data);
  const after=await tx.tax.create({data:{...data,companyId,version:(latest?.version??0)+1,...meta(actor)}});
  await audit(tx,actor,companyId,"CREATE","taxes",after.id,null,after);
  return tx.tax.findUniqueOrThrow({where:{id:after.id},include:includeAccounts});
}
