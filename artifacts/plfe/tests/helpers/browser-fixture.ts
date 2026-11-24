import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {db} from "../../lib/db";
import {config} from "../../lib/config";
import {permissionCodes} from "../../lib/role-templates";
import {initializeGroup} from "../../modules/accounts/group";
import {seedDemoBooks} from "../../modules/accounts/demo";

// Tester's generated login is accepted through stdin, never arguments, a file,
// console output or real operator credentials. This cannot target application books.
async function main() {
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"),"Only an isolated _test database is allowed");
  let raw="";
  for await(const chunk of process.stdin)raw+=chunk;
  const {email,password}=JSON.parse(raw);
  assert.ok(typeof email==="string"&&email.endsWith("@test.invalid")&&email===email.toLowerCase());
  assert.ok(typeof password==="string"&&password.length>=20);
  assert.equal(await db.user.count(),0,"Use a fresh disposable browser database");
  const owner=await db.user.create({data:{name:"TEST browser operator",email,passwordHash:await bcrypt.hash(password,4),isOwner:true,mustChangePassword:false}});
  await db.$transaction(async tx=>{
    await tx.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
    await initializeGroup(tx,owner);
  },{timeout:120000});
  await seedDemoBooks(owner,"PLFE");
  await seedDemoBooks(owner,"ZAHRA-HOME");
  process.stdout.write("Disposable browser books ready; no credentials were logged.\n");
}
main().catch(()=>{process.stderr.write("Disposable browser fixture failed; check the isolated database and input contract.\n");process.exitCode=1;}).finally(()=>db.$disconnect());
