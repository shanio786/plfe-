import {db} from "../lib/db";
import {checkPassword} from "../lib/auth";
import {config} from "../lib/config";
import {audit} from "../lib/audit";
import {permissionCodes} from "../lib/role-templates";
import {provisionCompany,saveRecord} from "../modules/core/service";
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
    for(const [code,companyName] of [["PLFE","PLFE"],["ZAHRA-HOME","ZAHRA HOME"]]) {
      if(!await tx.company.findFirst({where:{code,deletedAt:null}})){
        const company=await provisionCompany(tx,owner,{code,name:companyName,legalName:companyName,currency:"PKR",fyStartMonth:7,active:true});
        const role=await tx.role.findFirstOrThrow({where:{companyId:company.id,name:"Owner",deletedAt:null}});
        await tx.userCompanyRole.create({data:{companyId:company.id,userId:owner.id,roleId:role.id,createdBy:owner.id,updatedBy:owner.id}});
        await audit(tx,owner,company.id,"CREATE","user_company_roles",owner.id,null,{roleId:role.id,userId:owner.id});
      }
    }
    return owner;
  },{timeout:60000});
  // Seed year, series and branch through the same business service. The seed is
  // idempotent and never resets an existing user's password or business settings.
  // Initial Owner must change the password on first actual sign-in.
  const seedActor={...actor,mustChangePassword:false};
  // companyScope reads the current DB flag; bootstrap these records explicitly.
  for(const code of ["PLFE","ZAHRA-HOME"]) {
    await db.$transaction(async tx=>{
      const company=await tx.company.findFirstOrThrow({where:{code,deletedAt:null}});
      if(!await tx.branch.count({where:{companyId:company.id,deletedAt:null}})){
        const b=await tx.branch.create({data:{companyId:company.id,name:"Head Office",code:"HQ",type:"OFFICE",createdBy:actor.id,updatedBy:actor.id}});
        await audit(tx,actor,company.id,"CREATE","branches",b.id,null,b);
      }
      const now=new Date();const y=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1;
      if(!await tx.fiscalYear.count({where:{companyId:company.id,deletedAt:null}})){
        const fy=await tx.fiscalYear.create({data:{companyId:company.id,name:`${y}-${y+1}`,startDate:new Date(Date.UTC(y,6,1)),endDate:new Date(Date.UTC(y+1,5,30)),createdBy:actor.id,updatedBy:actor.id}});
        await audit(tx,actor,company.id,"CREATE","fiscal_years",fy.id,null,fy);
        for(let i=0;i<12;i++){
          const start=new Date(Date.UTC(y,6+i,1)),end=new Date(Date.UTC(y,7+i,0));
          const p=await tx.period.create({data:{companyId:company.id,fiscalYearId:fy.id,name:start.toLocaleString("en-GB",{month:"long",year:"numeric",timeZone:"UTC"}),startDate:start,endDate:end,createdBy:actor.id,updatedBy:actor.id}});
          await audit(tx,actor,company.id,"CREATE","periods",p.id,null,p);
        }
      }
      if(!await tx.numberSeries.count({where:{companyId:company.id,docType:"INV",deletedAt:null}})){
        const s=await tx.numberSeries.create({data:{companyId:company.id,docType:"INV",prefix:company.code,format:"{PREFIX}/{TYPE}/{FY}/{NUMBER}",padding:4,createdBy:actor.id,updatedBy:actor.id}});
        await audit(tx,actor,company.id,"CREATE","number_series",s.id,null,s);
      }
    });
  }
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
  process.stdout.write("Seed completed: PLFE and ZAHRA HOME, eleven roles each. Existing credentials were not changed.\n");
}
main().catch(()=>{process.stderr.write("Seed failed. Check seed environment values, database availability and existing Owner configuration.\n");process.exitCode=1;}).finally(()=>db.$disconnect());
