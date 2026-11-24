import {db} from "../lib/db";
import {checkPassword} from "../lib/auth";
import {config} from "../lib/config";
import {audit} from "../lib/audit";
import {permissionCodes} from "../lib/role-templates";
import {initializeGroup} from "../modules/accounts/group";
import bcrypt from "bcryptjs";
async function main(){
  const email=process.env.SEED_OWNER_EMAIL?.toLowerCase().trim();
  const password=process.env.SEED_OWNER_PASSWORD;
  const name=process.env.SEED_OWNER_NAME||"System Owner";
  if(!email||!password) throw new Error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD in .env before seeding");
  checkPassword(password);
  const hash=await bcrypt.hash(password,config.bcryptRounds);
  const actor=await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71007100)`;
    let owner=await tx.user.findFirst({where:{email,deletedAt:null}});
    if(owner && (!owner.isOwner||!owner.active)) throw new Error("Seed identity must be an existing active Owner");
    if(!owner) {
      if(await tx.user.count({where:{isOwner:true,active:true,deletedAt:null}})) throw new Error("An Owner already exists; new Owners must be granted by that Owner");
      owner=await tx.user.create({data:{name,email,passwordHash:hash,isOwner:true,active:true,mustChangePassword:true}});
      await audit(tx,owner,null,"SYSTEM","users",owner.id,null,{name,email,isOwner:true,event:"Initial Owner created"});
    }
    await tx.permission.createMany({data:permissionCodes.map(code=>({code,description:code.split(".").join(" ")})),skipDuplicates:true});
    await initializeGroup(tx,owner);
    return owner;
  },{timeout:60000});
  // Optional acceptance-test identity: never create a publicly known password.
  if(process.env.SEED_TEST_EMAIL && process.env.SEED_TEST_PASSWORD) {
    const testEmail=process.env.SEED_TEST_EMAIL.toLowerCase();
    if(!await db.user.findFirst({where:{email:testEmail,deletedAt:null}})) {
      checkPassword(process.env.SEED_TEST_PASSWORD);
      const passwordHash=await bcrypt.hash(process.env.SEED_TEST_PASSWORD,config.bcryptRounds);
      await db.$transaction(async tx=>{
        const c=await tx.company.findFirstOrThrow({where:{code:"PLFE",deletedAt:null}});
        const role=await tx.role.findFirstOrThrow({where:{companyId:c.id,name:"Admin",deletedAt:null}});
        const u=await tx.user.create({data:{name:"PLFE Test Administrator",email:testEmail,passwordHash,mustChangePassword:true,createdBy:actor.id,updatedBy:actor.id}});
        await tx.userCompanyRole.create({data:{companyId:c.id,userId:u.id,roleId:role.id,createdBy:actor.id,updatedBy:actor.id}});
        await audit(tx,actor,c.id,"CREATE","users",u.id,null,{name:u.name,email:u.email,role:"Admin"});
      });
    }
  }
  process.stdout.write("Seed completed: six group companies, company-specific calendars and charts, eleven roles each. Existing credentials and memberships were not changed. No demo documents created.\n");
}
main().catch(()=>{process.stderr.write("Seed failed. Check seed environment values, database availability and existing Owner configuration.\n");process.exitCode=1;}).finally(()=>db.$disconnect());
