import {Prisma} from "@prisma/client";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import {db} from "@/lib/db";
import {audit,redact} from "@/lib/audit";
import {companyScope,permissionsFor} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import {checkPassword} from "@/lib/auth";
import {config} from "@/lib/config";
import {roleTemplates,permissionCodes} from "@/lib/role-templates";
import {money} from "@/lib/money";
import {lockRow} from "@/lib/locking";
import * as schemas from "./schema";
import {resourceConfig} from "./queries";
import type {Actor} from "./model";

export async function provisionCompany(tx:Prisma.TransactionClient,actor:Actor,input:unknown) {
  const data=schemas.companySchema.parse(input);
  const c=await tx.company.create({data:{...data,createdBy:actor.id,updatedBy:actor.id}});
  await audit(tx,actor,c.id,"CREATE","companies",c.id,null,c);
  for(const template of roleTemplates) {
    const r=await tx.role.create({data:{companyId:c.id,name:template.name,description:template.description,isSystem:true,createdBy:actor.id,updatedBy:actor.id}});
    await tx.rolePermission.createMany({data:template.permissions.map(permissionCode=>({companyId:c.id,roleId:r.id,permissionCode,createdBy:actor.id,updatedBy:actor.id}))});
    await audit(tx,actor,c.id,"CREATE","roles",r.id,null,{...r,permissionCodes:template.permissions});
  }
  for(const [docType,action,thresholdAmount] of [["PAYMENT","post","500000.0000"],["BRANCH","deactivate",null],["DOCUMENT","cancel",null],["POS_RETURN","approve",null],["REFUND","approve",null]]) {
    const rule=await tx.approvalRule.create({data:{companyId:c.id,docType:docType!,action:action!,thresholdAmount:thresholdAmount?money(thresholdAmount):null,approverPermissionCode:"core.approval.approve",createdBy:actor.id,updatedBy:actor.id}});
    await audit(tx,actor,c.id,"CREATE","approval_rules",rule.id,null,rule);
  }
  return c;
}

async function checkGrants(tx:Prisma.TransactionClient,actor:Actor,companyId:string,codes:string[]) {
  if(codes.some(c=>!permissionCodes.includes(c))) throw new AppError(400,"Unknown permission code");
  if(!actor.isOwner) {
    const own=await permissionsFor(tx,actor,companyId);
    if(codes.some(c=>!own.includes(c))) throw new AppError(403,"You cannot grant a permission you do not hold");
  }
}
async function setMemberships(tx:Prisma.TransactionClient,actor:Actor,companyId:string,userId:string,roleIds:string[]) {
  const ids=[...new Set(roleIds)];
  const roles=await tx.role.findMany({where:{id:{in:ids},companyId,deletedAt:null},include:{grants:true}});
  if(roles.length!==ids.length) throw new AppError(400,"Choose roles belonging to this company");
  await checkGrants(tx,actor,companyId,roles.flatMap(r=>r.grants.map(g=>g.permissionCode)));
  const before=await tx.userCompanyRole.findMany({where:{companyId,userId}});
  await tx.userCompanyRole.deleteMany({where:{companyId,userId}});
  await tx.userCompanyRole.createMany({data:ids.map(roleId=>({companyId,userId,roleId,createdBy:actor.id,updatedBy:actor.id}))});
  await audit(tx,actor,companyId,"UPDATE","user_company_roles",userId,before,{roleIds:ids});
}

async function checkUserCeiling(tx:Prisma.TransactionClient,actor:Actor,companyId:string,target:Actor) {
  if(actor.isOwner) return;
  if(target.isOwner) throw new AppError(403,"Only an Owner may manage an Owner identity");
  const own=new Set(await permissionsFor(tx,actor,companyId));
  const targetPermissions=await permissionsFor(tx,target,companyId);
  if(targetPermissions.some(code=>!own.has(code)))
    throw new AppError(403,"You cannot manage a user with permissions you do not hold");
}

async function requireBranchApproval(tx:Prisma.TransactionClient,companyId:string,before:any) {
  if(before?.active && await tx.approvalRule.findFirst({where:{companyId,docType:"BRANCH",action:"deactivate",active:true,deletedAt:null}}))
    throw new AppError(409,"Request independent deactivation approval before disabling or archiving this branch");
}

export async function updateProfile(actor:Actor,code:string,input:unknown) {
  const data=schemas.profileSchema.parse(input);
  return db.$transaction(async tx=>{
    // Same order as the last-Owner guard and all other identity writers.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71007100)`;
    const company=await companyScope(tx,actor,code);
    await lockRow(tx,"users",actor.id);
    const before=await tx.user.findUniqueOrThrow({where:{id:actor.id}});
    const after=await tx.user.update({where:{id:actor.id},data:{...data,updatedBy:actor.id}});
    await audit(tx,actor,company.id,"UPDATE","users",actor.id,before,after);
    return redact(after);
  });
}

export async function saveRecord(actor:Actor,code:string,resource:string,input:unknown) {
  if(!input || typeof input!=="object" || Array.isArray(input)) throw new AppError(400,"Invalid request");
  const raw=input as Record<string,any>;
  const cfg=resourceConfig[resource];
  if(!cfg || ["audit","permissions","periods","attachments"].includes(resource)) throw new AppError(405,"This resource is read-only here");
  if(raw.id && !/^[a-f0-9-]{36}$/i.test(raw.id)) throw new AppError(400,"Invalid record id");
  const operation=raw.operation||"save";
  if(["delete","reset-password","revoke","approve","reject","withdraw"].includes(operation)&&!raw.id)
    throw new AppError(400,"A record id is required");
  const action=operation==="delete"?"delete":operation==="reset-password"?"reset":operation==="revoke"?"revoke":resource==="approvals"&&raw.id?"approve":raw.id?"update":"create";
  const password=(resource==="users" && raw.password)?String(raw.password):null;
  if(password) checkPassword(password);
  const hash=password?await bcrypt.hash(password,config.bcryptRounds):null;
  return db.$transaction(async tx=>{
    if(resource==="users"||resource==="memberships")
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(71007100)`;
    const current=await tx.user.findFirst({where:{id:actor.id,active:true,deletedAt:null}});
    if(!current) throw new AppError(401,"Sign in required");
    actor={...actor,isOwner:current.isOwner,mustChangePassword:current.mustChangePassword};
    const company=await companyScope(tx,actor,code,resource==="sessions"||resource==="approvals"&&["approve","reject"].includes(operation)?undefined:resource==="approvals"&&operation==="withdraw"?"core.approval.create":`core.${cfg.object}.${action}`);
    const companyId=company.id,meta={updatedBy:actor.id},createMeta={...meta,createdBy:actor.id,companyId};
    let before:any=null,after:any;
    if(resource==="companies") {
      if(!raw.id) {if(!actor.isOwner) throw new AppError(403,"Only an Owner may create companies");return provisionCompany(tx,actor,raw);}
      if(!actor.isOwner && raw.id!==companyId) throw new AppError(403,"Company access denied");
      await lockRow(tx,"companies",raw.id);
      before=await tx.company.findFirst({where:{id:raw.id,deletedAt:null}});
      if(!before) throw new AppError(404,"Company not found");
      const data=schemas.companySchema.parse({...before,...raw});
      if(!data.active && !actor.isOwner) throw new AppError(403,"Only an Owner may deactivate a company");
      if(data.logoAttachmentId) {
        await lockRow(tx,"attachments",data.logoAttachmentId,before.id);
        if(!await tx.attachment.findFirst({where:{id:data.logoAttachmentId,companyId:before.id,deletedAt:null,docType:"COMPANY",docId:before.id,mime:{in:["image/png","image/jpeg"]}}})) throw new AppError(400,"Choose a company logo attachment");
      }
      after=await tx.company.update({where:{id:before.id},data:{...data,...meta}});
      await audit(tx,actor,before.id,"UPDATE","companies",before.id,before,after);return after;
    }
    if(resource==="users") {
      // Serialize global identity/Owner changes to protect the last active Owner.
      if(raw.id) await lockRow(tx,"users",raw.id);
      if(raw.id) before=await tx.user.findFirst({where:{id:raw.id,deletedAt:null,...(actor.isOwner?{}:{memberships:{some:{companyId}}})}});
      if(raw.id && !before) throw new AppError(404,"User not found");
      if(operation==="reset-password") {
        if(!hash) throw new AppError(400,"A new temporary password is required");
        if(!actor.isOwner && (before.isOwner || await tx.userCompanyRole.findFirst({where:{userId:before.id,companyId:{not:companyId}}}))) throw new AppError(403,"An Owner must reset this global identity");
        await checkUserCeiling(tx,actor,companyId,before);
        after=await tx.user.update({where:{id:before.id},data:{passwordHash:hash,mustChangePassword:true,passwordChangedAt:new Date(),failedLogins:0,lockedUntil:null,...meta}});
        await tx.session.deleteMany({where:{userId:before.id}});
        await audit(tx,actor,companyId,"PASSWORD_RESET","users",before.id);return redact(after);
      }
      const data=schemas.userSchema.parse({...before,...raw});
      if(before) await checkUserCeiling(tx,actor,companyId,before);
      if((data.isOwner!==undefined && data.isOwner!==(before?.isOwner??false)) && !actor.isOwner) throw new AppError(403,"Only an Owner may change ownership");
      if(before && !actor.isOwner) {
        const other=await tx.userCompanyRole.findFirst({where:{userId:before.id,companyId:{not:companyId}}});
        if(before.isOwner || other) {
          if(data.name!==before.name || data.email!==before.email || (data.phone??null)!==before.phone || data.active!==before.active || data.photoAttachmentId!==undefined)
            throw new AppError(403,"An Owner must edit a cross-company identity");
        }
      }
      if(before?.isOwner && before.active && (!data.active || data.isOwner===false)) {
        if(await tx.user.count({where:{isOwner:true,active:true,deletedAt:null}})<=1) throw new AppError(409,"The last active Owner cannot be removed or deactivated");
      }
      const {roleIds,password:_password,isOwner,photoAttachmentId,...fields}=data;
      let photoFields:{photoStorageKey?:string|null}={};
      if(photoAttachmentId!==undefined) {
        if(!before) throw new AppError(400,"Save the user before uploading a photo");
        if(photoAttachmentId) await lockRow(tx,"attachments",photoAttachmentId,companyId);
        const attachment=photoAttachmentId?await tx.attachment.findFirst({where:{id:photoAttachmentId,companyId,docType:"USER",docId:before.id,deletedAt:null,mime:{in:["image/png","image/jpeg"]}}}):null;
        if(photoAttachmentId&&!attachment) throw new AppError(400,"Choose a photo attached to this user");
        photoFields={photoStorageKey:attachment?.filePath??null};
      }
      if(!before) {
        const existing=await tx.user.findFirst({where:{email:data.email,deletedAt:null}});
        if(existing) throw new AppError(409,"This email already exists. An Owner can assign the existing user through Company access");
        if(!hash) throw new AppError(400,"Set a temporary password");
        after=await tx.user.create({data:{...fields,isOwner:actor.isOwner?!!isOwner:false,passwordHash:hash,mustChangePassword:true,createdBy:actor.id,...meta}});
      } else after=await tx.user.update({where:{id:before.id},data:{...fields,...photoFields,...(actor.isOwner&&isOwner!==undefined?{isOwner}:{}),...meta}});
      if(roleIds) {
        if(!actor.isOwner) {
          const permissions=await permissionsFor(tx,actor,companyId);
          if(!permissions.includes("core.membership.create")||!permissions.includes("core.membership.delete")) throw new AppError(403,"Company access permissions required");
          if(before?.id===actor.id) throw new AppError(403,"You cannot change your own access");
        }
        await setMemberships(tx,actor,companyId,after.id,roleIds);
      }
      else if(!before) {
        const viewer=await tx.role.findFirst({where:{companyId,name:"Viewer",deletedAt:null}});
        if(viewer) await setMemberships(tx,actor,companyId,after.id,[viewer.id]);
      }
      if(!after.active || (before&&before.isOwner!==after.isOwner)) await tx.session.deleteMany({where:{userId:after.id}});
      await audit(tx,actor,companyId,before?"UPDATE":"CREATE","users",after.id,before,after);return redact(after);
    }
    if(resource==="sessions") {
      if(raw.id) await lockRow(tx,"sessions",raw.id);
      const ownPermissions=await permissionsFor(tx,actor,companyId);
      before=await tx.session.findFirst({where:{id:raw.id,...(ownPermissions.includes("core.session.revoke")?{OR:[{userId:actor.id},{user:{memberships:{some:{companyId}}}}]}:{userId:actor.id})}});
      if(!before) throw new AppError(404,"Session not found");
      if(operation!=="revoke") throw new AppError(400,"Use revoke");
      await tx.session.delete({where:{id:before.id}});
      await audit(tx,actor,companyId,"SESSION_REVOKE","sessions",before.id);return {ok:true};
    }
    if(resource==="approvals") return approvalAction(tx,actor,companyId,raw);
    const model=(tx as any)[cfg.model];
    if(raw.id) {
      const tables={"branches":"branches","roles":"roles","memberships":"user_company_roles","numbering":"number_series","fiscal-years":"fiscal_years","approval-rules":"approval_rules"} as const;
      const table=tables[resource as keyof typeof tables];
      if(table) await lockRow(tx,table,raw.id,companyId);
      before=await model.findFirst({where:{id:raw.id,companyId,...(resource==="memberships"?{}:{deletedAt:null})}});
      if(!before) throw new AppError(404,"Record not found");
    }
    if(operation==="delete") {
      if(resource==="memberships") {
        if(before.userId===actor.id && !actor.isOwner) throw new AppError(409,"Ask another administrator to change your own access");
        await model.delete({where:{id:before.id}});
      } else {
        if(resource==="branches") await requireBranchApproval(tx,companyId,before);
        if(resource==="roles" && await tx.userCompanyRole.count({where:{companyId,roleId:before.id}})) throw new AppError(409,"Remove user assignments before deleting this role");
        if(resource==="numbering" && await tx.sequence.count({where:{companyId,seriesId:before.id}})) throw new AppError(409,"A used number series cannot be deleted");
        await model.update({where:{id:before.id},data:{deletedAt:new Date(),...meta}});
      }
      await audit(tx,actor,companyId,"CANCEL",cfg.model,before.id,before,null);return {ok:true};
    }
    if(resource==="branches") {
      const data=schemas.branchSchema.parse(raw);
      if(before && !data.active) await requireBranchApproval(tx,companyId,before);
      after=before?await tx.branch.update({where:{id:before.id},data:{...data,...meta,version:{increment:1}}}):await tx.branch.create({data:{...data,...createMeta}});
    } else if(resource==="roles") {
      const {permissionCodes:codes,...data}=schemas.roleSchema.parse(raw);
      await checkGrants(tx,actor,companyId,codes);
      if(before && !actor.isOwner && await tx.userCompanyRole.findFirst({where:{companyId,userId:actor.id,roleId:before.id}})) throw new AppError(409,"Ask another administrator to change your own role");
      after=before?await tx.role.update({where:{id:before.id},data:{...data,...meta}}):await tx.role.create({data:{...data,...createMeta}});
      const previous=await tx.rolePermission.findMany({where:{companyId,roleId:after.id}});
      await tx.rolePermission.deleteMany({where:{companyId,roleId:after.id}});
      await tx.rolePermission.createMany({data:[...new Set(codes)].map(permissionCode=>({...createMeta,roleId:after.id,permissionCode}))});
      before=before?{...before,permissionCodes:previous.map(g=>g.permissionCode)}:null;
      after={...after,permissionCodes:codes};
    } else if(resource==="memberships") {
      const userId=String(raw.userId),roleId=String(raw.roleId);
      if(!actor.isOwner && userId===actor.id) throw new AppError(403,"You cannot change your own access");
      const user=await tx.user.findFirst({where:{id:userId,active:true,deletedAt:null,...(actor.isOwner?{}:{memberships:{some:{companyId}}})}});
      const role=await tx.role.findFirst({where:{id:roleId,companyId,deletedAt:null},include:{grants:true}});
      if(!user||!role) throw new AppError(400,"Choose an accessible user and role");
      await checkGrants(tx,actor,companyId,role.grants.map(g=>g.permissionCode));
      after=await tx.userCompanyRole.create({data:{...createMeta,userId,roleId}});
    } else if(resource==="numbering") {
      const data=schemas.numberingSchema.parse(raw);
      if(before && await tx.sequence.count({where:{companyId,seriesId:before.id,nextNumber:{gt:1}}})) throw new AppError(409,"A used series is immutable. Create a new document type instead");
      after=before?await tx.numberSeries.update({where:{id:before.id},data:{...data,...meta}}):await tx.numberSeries.create({data:{...data,...createMeta}});
    } else if(resource==="fiscal-years") {
      if(before) throw new AppError(409,"Financial-year dates are immutable after creation");
      const parsed=schemas.fiscalYearSchema.parse(raw);
      const startDate=new Date(`${parsed.startDate}T00:00:00Z`),endDate=new Date(`${parsed.endDate}T00:00:00Z`);
      if(!(startDate<endDate) || startDate.getUTCDate()!==1 || startDate.getUTCMonth()+1!==company.fyStartMonth) throw new AppError(400,"Financial year must start on day one of the configured start month");
      const expectedEnd=new Date(startDate);expectedEnd.setUTCFullYear(expectedEnd.getUTCFullYear()+1);expectedEnd.setUTCDate(expectedEnd.getUTCDate()-1);
      if(expectedEnd.getTime()!==endDate.getTime()) throw new AppError(400,"A financial year must cover exactly twelve months");
      after=await tx.fiscalYear.create({data:{name:parsed.name,startDate,endDate,...createMeta}});
      for(let i=0;i<12;i++){
        const start=new Date(Date.UTC(startDate.getUTCFullYear(),startDate.getUTCMonth()+i,1));
        const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0));
        const p=await tx.period.create({data:{...createMeta,fiscalYearId:after.id,name:start.toLocaleDateString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"}),startDate:start,endDate:end}});
        await audit(tx,actor,companyId,"CREATE","periods",p.id,null,p);
      }
    } else if(resource==="approval-rules") {
      const data=schemas.approvalRuleSchema.parse(raw);
      await checkGrants(tx,actor,companyId,[data.approverPermissionCode]);
      const values={...data,thresholdAmount:data.thresholdAmount?money(data.thresholdAmount):null};
      after=before?await tx.approvalRule.update({where:{id:before.id},data:{...values,...meta}}):await tx.approvalRule.create({data:{...values,...createMeta}});
    } else throw new AppError(405,"Unsupported action");
    await audit(tx,actor,companyId,before?"UPDATE":"CREATE",cfg.model,after.id,before,after);
    return redact(after);
  },{timeout:30000,maxWait:10000});
}

async function approvalAction(tx:Prisma.TransactionClient,actor:Actor,companyId:string,raw:Record<string,any>) {
  if(!raw.id) {
    if(raw.docType!=="BRANCH" || raw.action!=="deactivate") throw new AppError(400,"Only the foundation branch-deactivation handler is available in Phase 1");
    const target=await tx.branch.findFirst({where:{id:String(raw.docId),companyId,deletedAt:null,active:true}});
    const rule=await tx.approvalRule.findFirst({where:{companyId,docType:"BRANCH",action:"deactivate",active:true,deletedAt:null}});
    if(!target||!rule) throw new AppError(400,"An active branch and approval rule are required");
    const approval=await tx.approval.create({data:{companyId,ruleId:rule.id,docType:"BRANCH",docId:target.id,action:"deactivate",operationKey:randomUUID(),requestedBy:actor.id,requestNote:String(raw.requestNote||"").slice(0,2000),requestData:{active:false},targetVersion:target.version,ruleSnapshot:redact(rule),createdBy:actor.id,updatedBy:actor.id}});
    await audit(tx,actor,companyId,"APPROVAL_REQUEST","approvals",approval.id,null,approval);return approval;
  }
  await tx.$executeRaw`SELECT id FROM approvals WHERE id=${raw.id}::uuid AND company_id=${companyId}::uuid FOR UPDATE`;
  const approval=await tx.approval.findFirst({where:{id:raw.id,companyId,deletedAt:null},include:{rule:true}});
  if(!approval||approval.status!=="PENDING") throw new AppError(409,"Request is no longer pending");
  if(raw.operation==="withdraw") {
    if(approval.requestedBy!==actor.id) throw new AppError(403,"Only the requester can withdraw");
    const changed=await tx.approval.update({where:{id:approval.id},data:{status:"CANCELLED",updatedBy:actor.id}});
    await audit(tx,actor,companyId,"CANCEL","approvals",approval.id,approval,changed);return changed;
  }
  if(!["approve","reject"].includes(raw.operation)) throw new AppError(400,"Choose approve, reject or withdraw");
  if(approval.requestedBy===actor.id) throw new AppError(403,"You cannot approve or reject your own request");
  const permissions=await permissionsFor(tx,actor,companyId);
  const snapshot=approval.ruleSnapshot as {approverPermissionCode:string};
  if(!permissions.includes(snapshot.approverPermissionCode)) throw new AppError(403,"Approver permission required");
  if(raw.operation==="approve") {
    if(approval.docType!=="BRANCH"||approval.action!=="deactivate") throw new AppError(400,"Document handler not available");
    await tx.$executeRaw`SELECT id FROM branches WHERE id=${approval.docId}::uuid AND company_id=${companyId}::uuid FOR UPDATE`;
    const before=await tx.branch.findFirst({where:{id:approval.docId,companyId,deletedAt:null,version:approval.targetVersion}});
    if(!before) throw new AppError(409,"The target changed; withdraw and submit a new request");
    const changed=await tx.branch.update({where:{id:before.id},data:{active:false,version:{increment:1},updatedBy:actor.id}});
    await audit(tx,actor,companyId,"UPDATE","branches",before.id,before,changed);
  }
  const changed=await tx.approval.update({where:{id:approval.id},data:{status:raw.operation==="approve"?"APPROVED":"REJECTED",decidedBy:actor.id,decidedAt:new Date(),decisionNote:String(raw.note||"").slice(0,2000),executedAt:raw.operation==="approve"?new Date():null,updatedBy:actor.id}});
  await audit(tx,actor,companyId,raw.operation==="approve"?"APPROVE":"REJECT","approvals",approval.id,approval,changed);return changed;
}
