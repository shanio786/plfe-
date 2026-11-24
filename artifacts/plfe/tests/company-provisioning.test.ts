import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import bcrypt from "bcryptjs";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {enrollOwner,enrollmentStatus} from "../lib/enrollment";
import {provisionCompany,saveRecord} from "../modules/core/service";
import {linkCounterparties} from "../modules/accounts/counterparties";
import {initializeGroup} from "../modules/accounts/group";
import {chartTemplate} from "../modules/accounts/template";
import {permissionCodes} from "../lib/role-templates";
import type {Actor} from "../modules/core/model";

let owner:Actor;
before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"));
});
after(async()=>db.$disconnect());
test("Operator-gated enrollment atomically creates only one Owner and six setups",async()=>{
  // This suite must run on a fresh disposable database; never erase identities.
  assert.equal(await db.user.count(),0,"Use a fresh dedicated provisioning test database");
  assert.equal((await enrollmentStatus()).available,true);
  process.env.BOOTSTRAP_OWNER_EMAIL=`operator-${randomUUID()}@test.invalid`;
  process.env.BOOTSTRAP_ENROLLMENT_TOKEN=randomBytes(32).toString("base64url");
  const input={name:"Disposable enrollment operator",email:process.env.BOOTSTRAP_OWNER_EMAIL,password:randomBytes(32).toString("hex"),credential:process.env.BOOTSTRAP_ENROLLMENT_TOKEN};
  await assert.rejects(()=>enrollOwner({...input,credential:"wrong"}),(e:any)=>e.status===403);
  assert.equal(await db.user.count(),0);
  assert.equal((await db.enrollmentGuard.findUniqueOrThrow({where:{id:1}})).failures,1);
  const results=await Promise.allSettled([enrollOwner(input),enrollOwner(input)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(await db.user.count({where:{isOwner:true}}),1);
  const user=await db.user.findFirstOrThrow({where:{isOwner:true}});
  assert.equal(user.mustChangePassword,false);assert.ok(await bcrypt.compare(input.password,user.passwordHash));
  owner=user;
  assert.equal((await enrollmentStatus()).available,false);
  await assert.rejects(()=>enrollOwner(input),(e:any)=>e.status===409);
  assert.equal(await db.company.count(),6);
  for(const company of await db.company.findMany()) {
    assert.equal(await db.period.count({where:{companyId:company.id,deletedAt:null}}),12);
    assert.equal(await db.account.count({where:{companyId:company.id,counterpartyCompanyId:{not:null}}}),10);
    const fiscal=await db.fiscalYear.findFirstOrThrow({where:{companyId:company.id}});
    assert.equal(fiscal.startDate.getUTCMonth()+1,company.fyStartMonth);
    assert.equal(fiscal.endDate.getUTCMonth()+1,company.fyStartMonth===1?12:company.fyStartMonth-1);
  }
  const before=await db.account.findMany({orderBy:{id:"asc"}});
  await db.$transaction(tx=>initializeGroup(tx,owner),{timeout:120000});
  assert.deepEqual(await db.account.findMany({orderBy:{id:"asc"}}),before);
});
test("Seventh screen service company receives complete Events setup and permanent reciprocal numbers",async()=>{
  const source=await db.company.findFirstOrThrow();
  const raw={code:"SEVENTH",name:"Seventh events company",legalName:"Seventh events company",businessType:"EVENTS",currency:"PKR",fyStartMonth:7};
  const results=await Promise.allSettled([saveRecord(owner,source.code,"companies",raw),saveRecord(owner,source.code,"companies",raw)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  const company=await db.company.findFirstOrThrow({where:{code:raw.code}});
  assert.equal(await db.role.count({where:{companyId:company.id}}),11);
  assert.equal(await db.approvalRule.count({where:{companyId:company.id}}),5);
  assert.equal(await db.numberSeries.count({where:{companyId:company.id}}),19);
  assert.equal(await db.period.count({where:{companyId:company.id}}),12);
  assert.equal(await db.branch.count({where:{companyId:company.id,code:"HQ"}}),1);
  assert.equal(await db.accountingSettings.count({where:{companyId:company.id}}),1);
  assert.equal(await db.account.count({where:{companyId:company.id,counterpartyCompanyId:null}}),chartTemplate("EVENTS").length);
  const snapshot=await db.account.findMany({where:{counterpartyCompanyId:{not:null}},orderBy:{id:"asc"}});
  await Promise.all([1,2].map(()=>db.$transaction(tx=>linkCounterparties(tx,owner,company.id),{timeout:60000})));
  assert.deepEqual(await db.account.findMany({where:{counterpartyCompanyId:{not:null}},orderBy:{id:"asc"}}),snapshot);
  const links=await db.account.findMany({where:{companyId:company.id,counterpartyCompanyId:{not:null}},include:{parent:true}});
  assert.equal(links.length,12);
  for(const link of links) {
    assert.ok(["1600","2500"].includes(link.parent!.code));
    assert.ok(await db.account.findFirst({where:{companyId:link.counterpartyCompanyId!,counterpartyCompanyId:company.id,type:link.type==="ASSET"?"LIABILITY":"ASSET"}}));
    await assert.rejects(()=>db.account.update({where:{id:link.id},data:{code:"CHANGED"}}));
    await assert.rejects(()=>db.account.update({where:{id:link.id},data:{counterpartyCompanyId:null}}));
    await assert.rejects(()=>db.account.delete({where:{id:link.id}}));
  }
  await saveRecord(owner,source.code,"companies",{id:company.id,active:false});
  assert.deepEqual(await db.account.findMany({where:{counterpartyCompanyId:{not:null}},orderBy:{id:"asc"}}),snapshot);
});
test("Retail uses business-type data regardless of code, and failed provisioning rolls back",async()=>{
  const source=await db.company.findFirstOrThrow();
  const company=await saveRecord(owner,source.code,"companies",{code:"OTHER-RETAIL",name:"Unrelated retailer",legalName:"Unrelated retailer",businessType:"RETAIL",fyStartMonth:1});
  assert.equal(await db.outlet.count({where:{companyId:company.id}}),0);
  assert.equal(await db.account.count({where:{companyId:company.id,outletId:{not:null}}}),0);
  assert.equal(await db.branch.count({where:{companyId:company.id,type:"SHOWROOM"}}),0);
  assert.equal(await db.account.count({where:{companyId:company.id,code:"4200"}}),0);
  assert.equal(await db.account.count({where:{companyId:company.id,code:"1700",isGroup:true}}),1);
  const before=await db.company.count();
  await assert.rejects(()=>db.$transaction(async tx=>{
    await provisionCompany(tx,owner,{code:"ROLLBACK",name:"Rollback",legalName:"Rollback"});
    throw new Error("force rollback");
  },{timeout:60000}));
  assert.equal(await db.company.count(),before);
  await assert.rejects(()=>saveRecord(owner,source.code,"companies",{code:"BAD-TYPE",name:"Bad",legalName:"Bad",businessType:"MISSING"}),/configured business type/);
});
test("Delegated creation requires permission and cannot grant the creator stronger access",async()=>{
  const company=await db.company.findFirstOrThrow({where:{active:true}});
  const user=await db.user.create({data:{name:"Scoped creator",email:`creator-${randomUUID()}@test.invalid`,passwordHash:"disabled-test-credential",mustChangePassword:false}});
  await assert.rejects(()=>saveRecord(user,company.code,"companies",{code:"DENIED",name:"Denied",legalName:"Denied"}),(e:any)=>e.status===403);
  const role=await db.role.create({data:{companyId:company.id,name:`Creator-${randomUUID()}`}});
  const permissions=["core.company.create","core.company.read"];
  await db.rolePermission.createMany({data:permissions.map(permissionCode=>({companyId:company.id,roleId:role.id,permissionCode}))});
  await db.userCompanyRole.create({data:{companyId:company.id,roleId:role.id,userId:user.id}});
  const created=await saveRecord(user,company.code,"companies",{code:"DELEGATED",name:"Delegated company",legalName:"Delegated company"});
  const grants=await db.rolePermission.findMany({where:{companyId:created.id,role:{memberships:{some:{userId:user.id}}}}});
  assert.deepEqual(grants.map(g=>g.permissionCode).sort(),permissions.sort());
  assert.equal(await db.accountingSettings.count({where:{companyId:created.id}}),1);
  await assert.rejects(()=>saveRecord(user,created.code,"companies",{id:created.id,active:false}),(e:any)=>e.status===403);
});
