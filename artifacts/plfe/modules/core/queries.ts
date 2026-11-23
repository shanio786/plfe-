import {db} from "@/lib/db";
import {companyScope,permissionsFor} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import {permissionCodes} from "@/lib/role-templates";
import {redact} from "@/lib/audit";
import {listSchema} from "./schema";
import type {Actor} from "./model";
export const resourceConfig:Record<string,{model:string;object:string;search:string[];sort:string[]}> = {
  companies:{model:"company",object:"company",search:["name","code","legalName"],sort:["name","code","createdAt"]},
  branches:{model:"branch",object:"branch",search:["name","code","address"],sort:["name","code","type","createdAt"]},
  users:{model:"user",object:"user",search:["name","email","phone"],sort:["name","email","createdAt"]},
  roles:{model:"role",object:"role",search:["name","description"],sort:["name","createdAt"]},
  memberships:{model:"userCompanyRole",object:"membership",search:[],sort:["createdAt"]},
  numbering:{model:"numberSeries",object:"numbering",search:["docType","prefix"],sort:["docType","createdAt"]},
  "fiscal-years":{model:"fiscalYear",object:"fiscal",search:["name"],sort:["name","startDate","createdAt"]},
  periods:{model:"period",object:"fiscal",search:["name"],sort:["name","startDate","createdAt"]},
  "approval-rules":{model:"approvalRule",object:"approvalRule",search:["docType","action"],sort:["docType","createdAt"]},
  approvals:{model:"approval",object:"approval",search:["docType","action","requestNote"],sort:["requestedAt","status","createdAt"]},
  attachments:{model:"attachment",object:"attachment",search:["name","mime","docType"],sort:["name","size","createdAt"]},
  audit:{model:"auditLog",object:"audit",search:["action","tableName"],sort:["createdAt","action","tableName"]},
  sessions:{model:"session",object:"session",search:["device","ip"],sort:["createdAt","expiresAt","lastSeenAt"]},
  permissions:{model:"permission",object:"role",search:["code","description"],sort:["code"]}
};
// UI headers map only to allowlisted ORM fields; relation labels are translated
// below rather than interpolated into SQL.
const additionalSorts:Record<string,string[]>={
  companies:["legalName","ntn","strn","currency","fyStartMonth","lockDate","active"],
  branches:["address","phone","active"],
  users:["phone","active"],
  memberships:["userName","roleName"],
  numbering:["prefix","format","padding"],
  "fiscal-years":["endDate","isClosed"],
  periods:["endDate","isClosed"],
  "approval-rules":["action","approverPermissionCode","thresholdAmount","active"],
  approvals:["docType","action","requesterName"],
  attachments:["mime","docType"],
  audit:["actorName","recordId","ip"],
  sessions:["userName","device","ip"]
};
export async function identity(actor:Actor) {
  const companies=await db.company.findMany({
    where:{deletedAt:null,...(actor.isOwner?{}:{active:true,memberships:{some:{userId:actor.id,role:{deletedAt:null}}}})},
    orderBy:{name:"asc"},select:{id:true,code:true,name:true,legalName:true,currency:true,active:true}
  });
  return {user:{id:actor.id,name:actor.name,email:actor.email,isOwner:actor.isOwner,mustChangePassword:actor.mustChangePassword},companies};
}
export async function overview(actor:Actor,code:string) {
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,code);
    const permissions=await permissionsFor(tx,actor,company.id);
    const can=(p:string)=>permissions.includes(p);
    const [branches,users,roles,pendingApprovals,attachments,recentActivity,fiscalYear]=await Promise.all([
      can("core.branch.read")?tx.branch.count({where:{companyId:company.id,deletedAt:null}}):0,
      can("core.user.read")?tx.user.count({where:{deletedAt:null,memberships:{some:{companyId:company.id,role:{deletedAt:null}}}}}):0,
      can("core.role.read")?tx.role.count({where:{companyId:company.id,deletedAt:null}}):0,
      can("core.approval.read")?tx.approval.count({where:{companyId:company.id,status:"PENDING",deletedAt:null}}):0,
      can("core.attachment.read")?tx.attachment.count({where:{companyId:company.id,deletedAt:null}}):0,
      can("core.audit.read")?tx.auditLog.findMany({where:{companyId:company.id},take:6,orderBy:{createdAt:"desc"},include:{user:{select:{name:true}}}}):[],
      can("core.fiscal.read")?tx.fiscalYear.findFirst({where:{companyId:company.id,deletedAt:null,startDate:{lte:new Date()},endDate:{gte:new Date()}},orderBy:{startDate:"desc"}}):null
    ]);
    return {company,stats:{branches,users,roles,pendingApprovals,attachments},recentActivity:recentActivity.map(r=>({...r,actorName:r.user?.name||"System"})),permissions,fiscalYear};
  });
}
export async function listRecords(actor:Actor,code:string,resource:string,raw:Record<string,string>,exporting=false) {
  const cfg=resourceConfig[resource];if(!cfg) throw new AppError(404,"Unknown resource");
  const params=listSchema.parse(raw);
  return db.$transaction(async tx=>{
    // Session self-service is available even without a company admin permission.
    const company=await companyScope(tx,actor,code,resource==="sessions"?undefined:`core.${cfg.object}.read`);
    const permissions=await permissionsFor(tx,actor,company.id);
    const adminSessions=permissions.includes("core.session.read");
    let where:any={companyId:company.id};
    const include:any={};
    if(resource==="companies") where={deletedAt:null,...(actor.isOwner?{}:{id:company.id})};
    else if(resource==="users") {where={deletedAt:null,...(actor.isOwner&&raw.scope==="all"?{}:{memberships:{some:{companyId:company.id,role:{deletedAt:null}}}})};include.memberships={where:{companyId:company.id,role:{deletedAt:null}},include:{role:true}};}
    else if(resource==="sessions") {where={user:{deletedAt:null,...(adminSessions?{OR:[{id:actor.id},{memberships:{some:{companyId:company.id}}}]}:{id:actor.id})}};include.user={select:{name:true}};}
    else if(resource==="permissions") where={};
    else if(resource==="memberships"){include.user={select:{name:true}};include.role=true;where.role={deletedAt:null};}
    else if(resource!=="audit") where.deletedAt=null;
    if(resource==="roles") include.grants=true;
    if(resource==="numbering") include.sequences={where:{companyId:company.id,deletedAt:null}};
    if(resource==="approvals"){include.requester={select:{name:true}};include.decider={select:{name:true}};}
    if(resource==="attachments") {
      const types=["COMPANY","BRANCH","USER",...Object.entries({INVOICE:"invoice",BILL:"bill",PAYMENT:"payment",ENTRY:"entry"}).filter(([,object])=>actor.isOwner||permissions.includes(`accounts.${object}.read`)).map(([type])=>type)];
      where.docType=raw.docType&&types.includes(raw.docType)?raw.docType:{in:raw.docType?[]:types};
      if(raw.docId)where.docId=raw.docId;
    }
    if(resource==="audit") include.user={select:{name:true}};
    if(params.search && cfg.search.length) where.OR=cfg.search.map(field=>({[field]:{contains:params.search,mode:"insensitive"}}));
    if(resource==="memberships"&&params.search) where.OR=[{user:{name:{contains:params.search,mode:"insensitive"}}},{role:{name:{contains:params.search,mode:"insensitive"}}}];
    if(params.status) {
      if(resource==="approvals") where.status=params.status;
      else if(["companies","branches","users","approval-rules"].includes(resource)) where.active=params.status.toLowerCase()==="active";
      else if(resource==="audit") where.action=params.status;
    }
    if(resource==="audit") {
      if(actor.isOwner&&raw.scope==="system") {delete where.companyId;where.companyId=null;}
      if(raw.userId) where.userId=raw.userId;
      if(raw.recordId) where.recordId=raw.recordId;
      if(raw.tableName) where.tableName=raw.tableName;
      if(raw.from||raw.to) where.createdAt={...(raw.from?{gte:new Date(raw.from)}:{}),...(raw.to?{lte:new Date(`${raw.to}T23:59:59.999Z`)}:{})};
    }
    if(resource==="periods"&&raw.fiscalYearId) where.fiscalYearId=raw.fiscalYearId;
    const sort=[...cfg.sort,...(additionalSorts[resource]||[])].includes(params.sort)?params.sort:cfg.sort[0];
    const relation=resource==="memberships"?(sort==="userName"?"user":sort==="roleName"?"role":null)
      :resource==="approvals"&&sort==="requesterName"?"requester"
      :(resource==="sessions"&&sort==="userName"||resource==="audit"&&sort==="actorName")?"user":null;
    const orderBy=relation?{[relation]:{name:params.direction}}:{[sort]:params.direction};
    const model=(tx as any)[cfg.model];
    const total=await model.count({where});
    if(exporting && total>100000) throw new AppError(400,"Narrow the filters to export at most 100,000 rows");
    const rows=await model.findMany({where,...(Object.keys(include).length?{include}:{}),orderBy,skip:exporting?0:(params.page-1)*params.pageSize,take:exporting?100000:params.pageSize});
    return {rows:rows.map((r:any)=>{
      const clean=redact(r);
      delete clean.memberships;delete clean.grants;delete clean.user;delete clean.requester;delete clean.decider;
      if(resource==="users") {clean.roles=r.memberships.map((m:any)=>m.role.name);clean.roleIds=r.memberships.map((m:any)=>m.roleId);}
      if(resource==="roles") clean.permissionCodes=r.grants.map((g:any)=>g.permissionCode);
      if(resource==="memberships") {clean.userName=r.user.name;clean.roleName=r.role.name;}
      if(resource==="permissions") clean.id=r.code;
      if(resource==="sessions"){clean.userName=r.user.name;clean.isCurrent=r.id===actor.sessionId;}
      if(resource==="audit") clean.actorName=r.user?.name||"System";
      if(resource==="approvals"){clean.requesterName=r.requester.name;clean.deciderName=r.decider?.name;}
      return clean;
    }),total,page:params.page,pageSize:params.pageSize};
  });
}
export {permissionCodes};
