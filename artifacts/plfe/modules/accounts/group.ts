import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {provisionCompany} from "@/modules/core/service";
import type {Actor} from "@/modules/core/model";
import {initializeAccounts} from "./bootstrap";
import {accountingToday} from "./time";
import {groupCompanies} from "./initial-companies";
import {ledgerLock,meta,type Tx} from "./model";

export async function requireBootstrapOwner(tx:Tx,actor:Actor) {
  if(!await tx.user.findFirst({where:{id:actor.id,isOwner:true,active:true,deletedAt:null}}))
    throw new AppError(403,"Only an active Owner may initialize the group");
}

/** No credential changes, existing memberships or demo writes. Caller owns transaction. */
export async function initializeGroup(tx:Tx,actor:Actor) {
  await requireBootstrapOwner(tx,actor);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(71007101)`;
  const result=[];
  for(const spec of groupCompanies) {
    const matches=await tx.company.findMany({where:{code:spec.code,deletedAt:null}});
    let company=matches[0];
    if(!company) {
      company=await provisionCompany(tx,actor,{code:spec.code,name:spec.name,legalName:spec.name,currency:"PKR",fyStartMonth:spec.startMonth,businessType:spec.businessType,active:true});
    }
    await ledgerLock(tx,company.id);
    if(company.name!==spec.name || company.legalName!==spec.name) {
      const after=await tx.company.update({where:{id:company.id},data:{name:spec.name,legalName:spec.name,updatedBy:actor.id}});
      await audit(tx,actor,company.id,"UPDATE","companies",company.id,company,after);
      company=after;
    }
    // Changing an already-initialized calendar requires explicit guarded correction.
    if(company.fyStartMonth!==spec.startMonth)
      throw new AppError(409,`${company.code}: run accounts --correct-demo-chart to correct the demo-only financial calendar first`);
    await initializeCompanyCalendar(tx,actor,company);
    await initializeAccounts(tx,actor,company.id);
    result.push(company);
  }
  return result;
}

export async function initializeCompanyCalendar(tx:Tx,actor:Actor,company:{id:string;code:string;fyStartMonth:number;businessType:string}) {
  const business=await tx.businessType.findUniqueOrThrow({where:{code:company.businessType}});
  for(const [code,name,type] of [
    ["HQ","Head Office","OFFICE"],
    ...(business.chartKind==="RETAIL"?[["SR1","Showroom 1","SHOWROOM"],["SR2","Showroom 2","SHOWROOM"]]:[])
  ]) {
    if(!await tx.branch.findFirst({where:{companyId:company.id,code,deletedAt:null}})) {
      const branch=await tx.branch.create({data:{companyId:company.id,code:code!,name:name!,type:type!,...meta(actor)}});
      await audit(tx,actor,company.id,"CREATE","branches",branch.id,null,branch);
    }
  }
  const now=accountingToday(),month=company.fyStartMonth-1;
  const year=now.getUTCFullYear()-(now.getUTCMonth()<month?1:0);
  const startDate=new Date(Date.UTC(year,month,1)),endDate=new Date(Date.UTC(year+1,month,0));
  let fiscal=await tx.fiscalYear.findFirst({where:{companyId:company.id,startDate,endDate,deletedAt:null}});
  if(!fiscal) {
    if(await tx.fiscalYear.findFirst({where:{companyId:company.id,deletedAt:null,startDate:{lte:endDate},endDate:{gte:startDate}}}))
      throw new AppError(409,`${company.code}: overlapping financial year; explicit correction required`);
    fiscal=await tx.fiscalYear.create({data:{companyId:company.id,name:month===0?`${year}`:`${year}-${year+1}`,startDate,endDate,...meta(actor)}});
    await audit(tx,actor,company.id,"CREATE","fiscal_years",fiscal.id,null,fiscal);
  }
  for(let i=0;i<12;i++) {
    const startDate=new Date(Date.UTC(year,month+i,1)),endDate=new Date(Date.UTC(year,month+i+1,0));
    if(!await tx.period.findFirst({where:{companyId:company.id,fiscalYearId:fiscal.id,startDate,endDate,deletedAt:null}})) {
      const period=await tx.period.create({data:{companyId:company.id,fiscalYearId:fiscal.id,name:startDate.toLocaleString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"}),startDate,endDate,...meta(actor)}});
      await audit(tx,actor,company.id,"CREATE","periods",period.id,null,period);
    }
  }
}
