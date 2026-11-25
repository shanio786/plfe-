import {audit} from "@/lib/audit";
import type {Actor} from "@/modules/core/model";
import {authorize,ledgerLock,meta,type Tx} from "./model";
import {chartTemplate,journalTemplate,accountsDocumentTypes} from "./template";
import {accountsPermissions,accountsReadPermissions} from "./permissions";
import {AppError} from "@/lib/errors";

export async function installChart(tx:Tx,actor:Actor,companyId:string,chartKind:string) {
  const accounts=new Map<string,string>();
  for(const [code,name,type,parent,flag] of chartTemplate(chartKind)) {
    let a=await tx.account.findFirst({where:{companyId,code:{equals:code,mode:"insensitive"},deletedAt:null}});
    if(!a) {
      a=await tx.account.create({data:{companyId,code,name,type,parentId:parent?accounts.get(parent):null,isGroup:flag==="group",isCash:flag==="cash",isBank:flag==="bank",...meta(actor)}});
      await audit(tx,actor,companyId,"CREATE","accounts",a.id,null,a);
    }
    accounts.set(code,a.id);
  }
  return accounts;
}

/** Idempotent first install; never resets edited charts, mappings or role grants. */
export async function initializeAccounts(tx:Tx,actor:Actor,companyId:string,provisioning=false) {
  // Initial database seeding precedes the Owner's forced password change.
  // This non-HTTP bootstrap therefore verifies live global ownership directly.
  const user=await tx.user.findFirst({where:{id:actor.id,active:true,deletedAt:null}});
  if(!user||(!user.isOwner&&!provisioning))
    throw new AppError(403,"Only an active Owner may initialize company books");
  await ledgerLock(tx,companyId);
  const current=await tx.accountingSettings.findFirst({where:{companyId,deletedAt:null}});
  if(current)return current;
  const company=await tx.company.findFirstOrThrow({where:{id:companyId,deletedAt:null},include:{businessTypeRecord:true}});
  const accounts=await installChart(tx,actor,companyId,company.businessTypeRecord.chartKind),journals=new Map<string,string>();
  for(const [code,name,type] of journalTemplate) {
    let j=await tx.journal.findFirst({where:{companyId,code:{equals:code,mode:"insensitive"},deletedAt:null}});
    if(!j){j=await tx.journal.create({data:{companyId,code,name,type,...meta(actor)}});await audit(tx,actor,companyId,"CREATE","journals",j.id,null,j);}
    journals.set(code,j.id);
  }
  for(const [code,name] of [["ADMIN","Administration"],["EVENTS","Events team"],["SHOWROOM","Showroom"]]) {
    if(!await tx.department.findFirst({where:{companyId,code,deletedAt:null}})) {
      const d=await tx.department.create({data:{companyId,code:code!,name:name!,...meta(actor)}});
      await audit(tx,actor,companyId,"CREATE","departments",d.id,null,d);
    }
  }
  for(const docType of accountsDocumentTypes)if(!await tx.numberSeries.findFirst({where:{companyId,docType,deletedAt:null}})) {
    const n=await tx.numberSeries.create({data:{companyId,docType,prefix:company.code,format:"{PREFIX}/{TYPE}/{FY}/{NUMBER}",padding:4,...meta(actor)}});
    await audit(tx,actor,companyId,"CREATE","number_series",n.id,null,n);
  }
  if(!provisioning)for(const role of await tx.role.findMany({where:{companyId,isSystem:true,deletedAt:null,name:{in:["Owner","Admin","Accountant","Viewer"]}},include:{grants:true}})) {
    const permissions=role.name==="Viewer"?accountsReadPermissions:accountsPermissions;
    const extra=role.name==="Accountant"?["core.approval.read","core.approval.create","core.attachment.read","core.attachment.create","core.attachment.delete"]:[];
    const missing=[...permissions,...extra].filter(p=>!role.grants.some(g=>g.permissionCode===p));
    if(missing.length) {
      await tx.rolePermission.createMany({data:missing.map(permissionCode=>({companyId,roleId:role.id,permissionCode,...meta(actor)})),skipDuplicates:true});
      await audit(tx,actor,companyId,"UPDATE","roles",role.id,{...role,permissionCodes:role.grants.map(g=>g.permissionCode)},{...role,permissionCodes:[...role.grants.map(g=>g.permissionCode),...missing]});
    }
  }
  for(const rule of await tx.approvalRule.findMany({where:{companyId,docType:{in:["DOCUMENT","PAYMENT","CASH_DIFFERENCE","INTERCOMPANY"]},approverPermissionCode:"core.approval.approve",deletedAt:null}})) {
    const changed=await tx.approvalRule.update({where:{id:rule.id,companyId},data:{approverPermissionCode:"accounts.approval.approve",updatedBy:actor.id}});
    await audit(tx,actor,companyId,"UPDATE","approval_rules",rule.id,rule,changed);
  }
  const s=await tx.accountingSettings.create({data:{companyId,receivableAccountId:accounts.get("1300")!,payableAccountId:accounts.get("2100")!,openingEquityAccountId:accounts.get("3990")!,cashDifferenceAccountId:accounts.get("7200")??null,salesJournalId:journals.get("SALES")!,purchaseJournalId:journals.get("PURCHASE")!,generalJournalId:journals.get("GENERAL")!,cashJournalId:journals.get("CASH")!,bankJournalId:journals.get("BANK")!,...meta(actor)}});
  await audit(tx,actor,companyId,"CREATE","accounting_settings",s.id,null,s);
  return s;
}
