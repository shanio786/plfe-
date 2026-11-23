import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import bcrypt from "bcryptjs";
import {db} from "../../lib/db";
import {config} from "../../lib/config";
import {permissionCodes} from "../../lib/role-templates";
import {provisionCompany,saveRecord} from "../../modules/core/service";
import {seedDemoBooks} from "../../modules/accounts/demo";
import {accountingToday} from "../../modules/accounts/time";

export async function accountsFixture() {
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"),"Refusing writes outside a dedicated _test database");
  const suffix=randomUUID().slice(0,8).toUpperCase(),passwordHash=await bcrypt.hash(randomBytes(32).toString("hex"),4);
  const user=(name:string,owner=false)=>db.user.create({data:{name,email:`${name.replaceAll(" ","-")}-${suffix}@test.invalid`.toLowerCase(),passwordHash,isOwner:owner,mustChangePassword:false}});
  const owner=await user("Accounts Test Owner",true);
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  const a=`P2A-${suffix}`,b=`P2B-${suffix}`;
  const [first,second]=await Promise.all([a,b].map(code=>db.$transaction(tx=>provisionCompany(tx,owner,{code,name:code,legalName:code,currency:"PKR",fyStartMonth:7,active:true}),{timeout:60000})));
  const now=accountingToday(),year=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1;
  const f={name:`${year}-${year+1}`,startDate:`${year}-07-01`,endDate:`${year+1}-06-30`};
  const fiscal=await saveRecord(owner,a,"fiscal-years",f);await saveRecord(owner,b,"fiscal-years",f);
  const approver=await user("Accounts Independent Approver"),viewer=await user("Accounts Single Company Viewer"),gate=await user("Accounts Gate Staff");
  for(const [u,name] of [[approver,"Accountant"],[viewer,"Viewer"],[gate,"Gate Staff"]] as const) {
    const role=await db.role.findFirstOrThrow({where:{companyId:first.id,name,deletedAt:null}});
    await saveRecord(owner,a,"memberships",{userId:u.id,roleId:role.id});
  }
  const demo=await seedDemoBooks(owner,a),otherDemo=await seedDemoBooks(owner,b);
  const accounts=await db.account.findMany({where:{companyId:first.id,deletedAt:null}});
  const journals=await db.journal.findMany({where:{companyId:first.id,deletedAt:null}});
  return {owner,approver,viewer,gate,first,second,a,b,fiscal,demo,otherDemo,date:now.toISOString().slice(0,10),
    account:(code:string)=>accounts.find(a=>a.code===code)!,journal:journals.find(j=>j.type==="GENERAL")!};
}
