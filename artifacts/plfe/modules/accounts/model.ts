import {Prisma} from "@prisma/client";
import {AppError} from "@/lib/errors";
import {companyScope} from "@/lib/permissions";
import type {Actor} from "@/modules/core/model";
import type {AccountResource} from "./schema";
export type Tx=Prisma.TransactionClient;
export const accountConfig:Record<AccountResource,{model:string;table:string;object:string;search:string[]}> = {
  chart:{model:"account",table:"accounts",object:"chart",search:["code","name"]},
  parties:{model:"party",table:"parties",object:"party",search:["code","name","companyName","phone","email","city"]},
  departments:{model:"department",table:"departments",object:"department",search:["code","name"]},
  journals:{model:"journal",table:"journals",object:"journal",search:["code","name"]},
  outlets:{model:"outlet",table:"outlets",object:"outlet",search:["code","name","address"]},
  events:{model:"event",table:"events",object:"event",search:["code","name","city","venue"]},
  taxes:{model:"tax",table:"taxes",object:"tax",search:["code","name","authority","province"]},
  invoices:{model:"invoice",table:"invoices",object:"invoice",search:["number","narration"]},
  bills:{model:"bill",table:"bills",object:"bill",search:["number","narration"]},
  payments:{model:"payment",table:"payments",object:"payment",search:["number","narration"]},
  entries:{model:"journalEntry",table:"journal_entries",object:"entry",search:["number","narration"]},
  settings:{model:"accountingSettings",table:"accounting_settings",object:"settings",search:[]}
};
export function resourceConfig(resource:string) {
  const cfg=Object.hasOwn(accountConfig,resource)?accountConfig[resource as AccountResource]:null;
  if(!cfg) throw new AppError(404,"Unknown Accounts resource");
  return cfg;
}
// Model names come exclusively from the fixed map above, never from raw input.
export function delegate(tx:Tx,resource:string):any{return (tx as any)[resourceConfig(resource).model];}
export async function ledgerLock(tx:Tx,companyId:string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`accounts/${companyId}`},2))`;
}
export async function authorize(tx:Tx,actor:Actor,companyId:string,permission:string) {
  const company=await tx.company.findFirst({where:{id:companyId,deletedAt:null}});
  if(!company) throw new AppError(404,"Company not found");
  return companyScope(tx,actor,company.code,permission);
}
export async function record(tx:Tx,resource:string,companyId:string,id:string,extra:Record<string,unknown>={}) {
  const r=await delegate(tx,resource).findFirst({where:{id,companyId,deletedAt:null},...extra});
  if(!r) throw new AppError(404,"Record not found in this company");
  return r;
}
export function meta(actor:Actor){return {createdBy:actor.id,updatedBy:actor.id};}
export function dateOnly(value:string|Date) {
  const str=value instanceof Date?value.toISOString().slice(0,10):value;
  const date=new Date(`${str}T00:00:00.000Z`);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(str)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==str)
    throw new AppError(400,"Invalid accounting date");
  return date;
}
export async function dimensionCheck(tx:Tx,companyId:string,line:{departmentId?:string|null;eventId?:string|null;outletId?:string|null}) {
  // An expo's income and direct costs must carry its tag, so the tag has to be
  // a real event of this company that is still collecting amounts.
  if(line.eventId) {
    const event=await tx.event.findFirst({where:{id:line.eventId,companyId,deletedAt:null}});
    if(!event)throw new AppError(400,"Select an event of this company");
    if(event.status==="CANCELLED")throw new AppError(400,"A cancelled event cannot be tagged on new amounts");
  }
  if(line.outletId&&!await tx.outlet.findFirst({where:{id:line.outletId,companyId,active:true,deletedAt:null}}))
    throw new AppError(400,"Select an active outlet in this company");
  if(line.departmentId&&!await tx.department.findFirst({where:{id:line.departmentId,companyId,active:true,deletedAt:null}}))
    throw new AppError(400,"Select an active department in this company");
}
export function outletAccountCheck(account:{outletId?:string|null},outletId?:string|null) {
  if(account.outletId&&account.outletId!==outletId)
    throw new AppError(400,"Choose the outlet that owns this cash or inventory account");
}
export async function settings(tx:Tx,companyId:string) {
  const s=await tx.accountingSettings.findFirst({where:{companyId,deletedAt:null}});
  if(!s) throw new AppError(409,"Initialize this company's chart and accounting settings first");
  return s;
}
