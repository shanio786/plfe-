import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import bcrypt from "bcryptjs";
import {db} from "../lib/db";
import {saveRecord} from "../modules/core/service";
import {identity,listRecords,overview} from "../modules/core/queries";
import {permissionCodes} from "../lib/role-templates";
import {audit,redact} from "../lib/audit";
import {tokenHash,checkPassword} from "../lib/auth";
import {nextDocumentNumber} from "../lib/numbering";
import {money} from "../lib/money";
import {excelBuffer} from "../lib/excel";
import {readFile} from "node:fs/promises";
import {config} from "../lib/config";
import {checkAuthHttp} from "./helpers/auth-http";
import type {Actor} from "../modules/core/model";

let owner:Actor,admin:Actor,viewer:Actor;
let first:any,second:any,branch:any,adminRole:any,viewerRole:any,fy:any;
const suffix=randomUUID().slice(0,8).toUpperCase();
const a=`A-${suffix}`,b=`B-${suffix}`;
before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"),"Refusing fixture writes outside a dedicated _test database");
  const hash=await bcrypt.hash(randomBytes(24).toString("hex"),4);
  const u=await db.user.create({data:{name:"Acceptance Owner",email:`owner-${suffix.toLowerCase()}@test.invalid`,passwordHash:hash,isOwner:true,mustChangePassword:false}});
  owner=u;
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  // Existing test Owners become ordinary test identities, preserving this Owner.
  await db.user.updateMany({where:{isOwner:true,id:{not:u.id}},data:{isOwner:false}});
  // Create initial tenant using the same provisioning routine as production.
  const {provisionCompany}=await import("../modules/core/service");
  first=await db.$transaction(tx=>provisionCompany(tx,owner,{code:a,name:"PLFE acceptance",legalName:"PLFE",currency:"PKR",fyStartMonth:7}));
  second=await saveRecord(owner,a,"companies",{code:b,name:"ZAHRA HOME acceptance",legalName:"ZAHRA HOME",currency:"PKR",fyStartMonth:7});
  adminRole=await db.role.findFirstOrThrow({where:{companyId:first.id,name:"Admin",deletedAt:null}});
  viewerRole=await db.role.findFirstOrThrow({where:{companyId:first.id,name:"Viewer",deletedAt:null}});
  admin=await saveRecord(owner,a,"users",{name:"Scoped administrator",email:`admin-${suffix.toLowerCase()}@test.invalid`,password:"Testing987654321",roleIds:[adminRole.id]});
  viewer=await saveRecord(owner,a,"users",{name:"Read only",email:`viewer-${suffix.toLowerCase()}@test.invalid`,password:"Testing987654321",roleIds:[viewerRole.id]});
  await db.user.updateMany({where:{id:{in:[admin.id,viewer.id]}},data:{mustChangePassword:false}});
  branch=await saveRecord(owner,a,"branches",{code:"HQ",name:"Head Office",type:"OFFICE"});
}, {timeout:60000});
after(async()=>db.$disconnect());

test("Company creation copies eleven independent role templates",async()=>{
  assert.equal(await db.role.count({where:{companyId:first.id,deletedAt:null}}),11);
  assert.equal(await db.role.count({where:{companyId:second.id,deletedAt:null}}),11);
});
test("A one-company user cannot read, mutate, export or get another company's overview",async()=>{
  assert.deepEqual((await identity(admin)).companies.map(c=>c.id),[first.id]);
  for(const action of [
    ()=>listRecords(admin,b,"branches",{}),
    ()=>listRecords(admin,b,"branches",{},true),
    ()=>overview(admin,b),
    ()=>saveRecord(admin,b,"branches",{code:"X",name:"Forbidden",type:"OFFICE"})
  ]) await assert.rejects(action,(e:any)=>e.status===403);
});
test("Record identifiers do not bypass company scope",async()=>{
  await assert.rejects(()=>saveRecord(owner,b,"branches",{id:branch.id,code:"HQ",name:"Wrong company",type:"OFFICE"}),(e:any)=>e.status===404);
});
test("Permissions are checked on the service, not just the screen",async()=>{
  await assert.rejects(()=>saveRecord(viewer,a,"branches",{code:"X",name:"Forbidden",type:"OFFICE"}),(e:any)=>e.status===403);
});
test("A user can hold different roles in different companies",async()=>{
  const role=await db.role.findFirstOrThrow({where:{companyId:second.id,name:"Viewer"}});
  await saveRecord(owner,b,"memberships",{userId:admin.id,roleId:role.id});
  assert.equal((await identity(admin)).companies.length,2);
  await assert.rejects(()=>saveRecord(admin,b,"branches",{code:"X",name:"Forbidden",type:"OFFICE"}),(e:any)=>e.status===403);
  const m=await db.userCompanyRole.findFirstOrThrow({where:{companyId:second.id,userId:admin.id}});
  await saveRecord(owner,b,"memberships",{id:m.id,operation:"delete"});
});
test("Composite foreign keys reject cross-company role assignments",async()=>{
  await assert.rejects(()=>db.userCompanyRole.create({data:{companyId:second.id,userId:viewer.id,roleId:viewerRole.id}}));
});
test("A non-Owner cannot grant global ownership",async()=>{
  await assert.rejects(()=>saveRecord(admin,a,"users",{id:viewer.id,name:viewer.name,email:viewer.email,active:true,isOwner:true}),(e:any)=>e.status===403);
});
test("Service and database protect the last active Owner",async()=>{
  await assert.rejects(()=>saveRecord(owner,a,"users",{id:owner.id,name:owner.name,email:owner.email,active:false,isOwner:false}),(e:any)=>e.status===409);
  await assert.rejects(()=>db.user.update({where:{id:owner.id},data:{active:false}}));
});
test("Soft-deleted keys can be reused; live duplicates are rejected",async()=>{
  const item=await saveRecord(owner,a,"branches",{code:"REUSE",name:"Old",type:"OFFICE",active:false});
  await assert.rejects(()=>saveRecord(owner,a,"branches",{code:"REUSE",name:"Duplicate",type:"OFFICE"}));
  await saveRecord(owner,a,"branches",{id:item.id,operation:"delete"});
  const replacement=await saveRecord(owner,a,"branches",{code:"REUSE",name:"New",type:"OFFICE"});
  assert.notEqual(item.id,replacement.id);
});
test("Audit rows are recorded, immutable and free of credentials",async()=>{
  const row=await db.auditLog.findFirstOrThrow({where:{companyId:first.id,recordId:branch.id}});
  assert.equal(row.action,"CREATE");
  await assert.rejects(()=>db.auditLog.update({where:{id:row.id},data:{action:"CHANGED"}}));
  await assert.rejects(()=>db.auditLog.delete({where:{id:row.id}}));
  assert.deepEqual(redact({password:"secret",passwordHash:"hash",tokenHash:"hash",mustChangePassword:true,amount:money("1.2345")}),{mustChangePassword:true,amount:"1.2345"});
});
test("An audit failure rolls back the business mutation",async()=>{
  const before=await db.branch.findUniqueOrThrow({where:{id:branch.id}});
  await assert.rejects(()=>db.$transaction(async tx=>{
    await tx.branch.update({where:{id:branch.id},data:{name:"Should roll back"}});
    await audit(tx,{...owner,id:randomUUID()},first.id,"UPDATE","branches",branch.id,before,{name:"Should roll back"});
  }));
  assert.equal((await db.branch.findUniqueOrThrow({where:{id:branch.id}})).name,before.name);
});
test("Opaque session hashes are SHA-256; password policy rejects weak values",()=>{
  const raw=randomBytes(32).toString("base64url");
  assert.match(tokenHash(raw),/^[a-f0-9]{64}$/);assert.notEqual(tokenHash(raw),raw);
  assert.throws(()=>checkPassword("short1"));assert.throws(()=>checkPassword("allletterslong"));
  assert.doesNotThrow(()=>checkPassword("StrongTest12345"));
});
test("Financial years create twelve periods and overlapping dates are rejected",async()=>{
  fy=await saveRecord(owner,a,"fiscal-years",{name:"2026-2027",startDate:"2026-07-01",endDate:"2027-06-30"});
  assert.equal(await db.period.count({where:{companyId:first.id,fiscalYearId:fy.id}}),12);
  await assert.rejects(()=>saveRecord(owner,a,"fiscal-years",{name:"Overlap",startDate:"2026-07-01",endDate:"2027-06-30"}));
});
test("Number allocation is concurrent-safe and rolls back with its document",async()=>{
  await saveRecord(owner,a,"numbering",{docType:"TEST",prefix:"PLFE",format:"{PREFIX}/{TYPE}/{FY}/{NUMBER}",padding:4});
  const numbers=await Promise.all(Array.from({length:12},()=>db.$transaction(tx=>nextDocumentNumber(tx,owner,first.id,"TEST",fy.id),{timeout:30000})));
  assert.equal(new Set(numbers).size,12);assert.ok(numbers.includes("PLFE/TEST/26-27/0001"));
  const prior=await db.sequence.findFirstOrThrow({where:{companyId:first.id,docType:"TEST"}});
  await assert.rejects(()=>db.$transaction(async tx=>{await nextDocumentNumber(tx,owner,first.id,"TEST",fy.id);throw new Error("Rollback");}));
  assert.equal((await db.sequence.findFirstOrThrow({where:{id:prior.id}})).nextNumber,prior.nextNumber);
});
test("Money remains exact decimal, including the default approval limit",async()=>{
  const rule=await db.approvalRule.findFirstOrThrow({where:{companyId:first.id,docType:"PAYMENT"}});
  assert.equal(rule.thresholdAmount?.toFixed(4),"500000.0000");
  assert.equal(money("0.1000").plus(money("0.2000")).toFixed(4),"0.3000");
  assert.throws(()=>money("1.00001"));
});
test("Approvals reject self-approval and execute once with the target audit",async()=>{
  const request=await saveRecord(admin,a,"approvals",{docType:"BRANCH",docId:branch.id,action:"deactivate",requestNote:"Acceptance test"});
  await assert.rejects(()=>saveRecord(admin,a,"approvals",{id:request.id,operation:"approve"}),(e:any)=>e.status===403);
  await saveRecord(owner,a,"approvals",{id:request.id,operation:"approve",note:"Approved independently"});
  assert.equal((await db.branch.findUniqueOrThrow({where:{id:branch.id}})).active,false);
  await assert.rejects(()=>saveRecord(owner,a,"approvals",{id:request.id,operation:"approve"}),(e:any)=>e.status===409);
  assert.equal(await db.auditLog.count({where:{companyId:first.id,recordId:request.id,action:"APPROVE"}}),1);
});
test("Requester may withdraw a pending request without approver permission",async()=>{
  const requesterRole=await saveRecord(owner,a,"roles",{name:"Requester",permissionCodes:["core.company.read","core.approval.read","core.approval.create"]});
  await saveRecord(owner,a,"users",{id:viewer.id,name:viewer.name,email:viewer.email,active:true,roleIds:[requesterRole.id]});
  const target=await saveRecord(owner,a,"branches",{code:"WITHDRAW",name:"Withdraw example",type:"OFFICE"});
  const request=await saveRecord(viewer,a,"approvals",{docType:"BRANCH",docId:target.id,action:"deactivate"});
  await saveRecord(viewer,a,"approvals",{id:request.id,operation:"withdraw"});
  assert.equal((await db.approval.findUniqueOrThrow({where:{id:request.id}})).status,"CANCELLED");
  assert.equal((await db.branch.findUniqueOrThrow({where:{id:target.id}})).active,true);
});

test("An active branch cannot be disabled or archived around its approval rule, even by Owner",async()=>{
  const target=await saveRecord(owner,a,"branches",{code:"GUARDED",name:"Guarded branch",type:"OFFICE"});
  for(const actor of [admin,owner]) {
    await assert.rejects(()=>saveRecord(actor,a,"branches",{id:target.id,code:target.code,name:target.name,type:"OFFICE",active:false}),(e:any)=>e.status===409);
    await assert.rejects(()=>saveRecord(actor,a,"branches",{id:target.id,operation:"delete"}),(e:any)=>e.status===409);
  }
  assert.equal((await db.branch.findUniqueOrThrow({where:{id:target.id}})).active,true);
  assert.equal(await db.auditLog.count({where:{companyId:first.id,recordId:target.id,action:{in:["UPDATE","CANCEL"]}}}),0);
  const request=await saveRecord(admin,a,"approvals",{docType:"BRANCH",docId:target.id,action:"deactivate"});
  await saveRecord(owner,a,"approvals",{id:request.id,operation:"approve"});
  await saveRecord(admin,a,"branches",{id:target.id,operation:"delete"});
  assert.ok((await db.branch.findUniqueOrThrow({where:{id:target.id}})).deletedAt);
});

test("Delegated account management cannot reset or edit a stronger identity",async()=>{
  const role=await saveRecord(owner,a,"roles",{name:"Limited account operator",permissionCodes:["core.company.read","core.branch.read","core.user.read","core.user.update","core.user.reset"]});
  const operator=await saveRecord(owner,a,"users",{name:"Limited operator",email:`operator-${suffix.toLowerCase()}@test.invalid`,password:"Testing987654321",roleIds:[role.id]});
  await db.user.update({where:{id:operator.id},data:{mustChangePassword:false}});
  await assert.rejects(()=>saveRecord(operator,a,"users",{id:admin.id,operation:"reset-password",password:"Temporary123456789"}),(e:any)=>e.status===403);
  await assert.rejects(()=>saveRecord(operator,a,"users",{id:admin.id,email:`taken-${suffix.toLowerCase()}@test.invalid`}),(e:any)=>e.status===403);
  await assert.rejects(()=>saveRecord(operator,a,"users",{id:owner.id,operation:"reset-password",password:"Temporary123456789"}),(e:any)=>e.status===403||e.status===404);
  assert.equal((await db.user.findUniqueOrThrow({where:{id:admin.id}})).mustChangePassword,false);
  const target=await saveRecord(owner,a,"users",{name:"Resettable viewer",email:`resettable-${suffix.toLowerCase()}@test.invalid`,password:"Testing987654321",roleIds:[viewerRole.id]});
  await db.session.create({data:{userId:target.id,tokenHash:tokenHash(randomBytes(32).toString("hex")),expiresAt:new Date(Date.now()+3600000)}});
  await saveRecord(operator,a,"users",{id:target.id,operation:"reset-password",password:"Temporary123456789"});
  assert.equal((await db.user.findUniqueOrThrow({where:{id:target.id}})).mustChangePassword,true);
  assert.equal(await db.session.count({where:{userId:target.id}}),0);
});

test("Concurrent branch changes have complete, consecutive audit before-images",async()=>{
  const target=await saveRecord(owner,a,"branches",{code:"CONCURRENT",name:"Before concurrent edits",type:"OFFICE"});
  await Promise.all(Array.from({length:6},(_,i)=>saveRecord(owner,a,"branches",{id:target.id,code:target.code,name:`Concurrent edit ${i}`,type:"OFFICE",active:true})));
  const logs=await db.auditLog.findMany({where:{companyId:first.id,recordId:target.id,action:"UPDATE"}});
  const ordered=logs.map(log=>({before:log.beforeJson as any,after:log.afterJson as any})).sort((x,y)=>x.after.version-y.after.version);
  assert.equal(ordered.length,6);
  for(let i=0;i<ordered.length;i++) {
    assert.equal(ordered[i].before.version,target.version+i);
    assert.equal(ordered[i].after.version,target.version+i+1);
    assert.equal(ordered[i].before.name,i===0?target.name:ordered[i-1].after.name);
  }
});

test("Compose passes only the runtime allowlist to app and worker",async()=>{
  const compose=await readFile(new URL("../../../docker-compose.yml",import.meta.url),"utf8");
  const runtime=compose.split("\nservices:")[0];
  assert.doesNotMatch(compose,/^\s+env_file:/m);
  assert.doesNotMatch(runtime,/^\s+(POSTGRES_PASSWORD|MIGRATION_DATABASE_URL|SEED_OWNER_PASSWORD|SEED_TEST_PASSWORD):/m);
  for(const service of ["app","worker"]) {
    const block=compose.match(new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:|\\nvolumes:)`))?.[1];
    assert.ok(block);
    assert.match(block,/environment: \*runtime-environment/);
  }
  assert.match(compose,/profiles: \["maintenance"\]/);
});

test("Excel export writes a real workbook with the patched dependency tree",async()=>{
  const bytes=await excelBuffer([{company:first.code,amount:"12.3456"}],"Acceptance");
  assert.equal(bytes[0],0x50);
  assert.equal(bytes[1],0x4b);
  assert.ok(bytes.length>1000);
});

test("HTTP login, password change, profile, company scope, reset revocation and logout",{
  timeout:30000,
},async()=>checkAuthHttp(owner,a,b,viewerRole.id));
