import {db} from "../lib/db";
import {permissionCodes} from "../lib/role-templates";
import {initializeGroup} from "../modules/accounts/group";

async function main() {
  const owner=await db.user.findFirst({where:{isOwner:true,active:true,mustChangePassword:false,deletedAt:null}});
  if(!owner)throw new Error("Finish authorized first-run enrollment at /enroll before initializing companies. Seeding never creates credentials.");
  await db.$transaction(async tx=>{
    await tx.permission.createMany({data:permissionCodes.map(code=>({code,description:code.split(".").join(" ")})),skipDuplicates:true});
    await initializeGroup(tx,owner);
  },{timeout:120000,maxWait:30000});
  process.stdout.write("Initial company configuration ready. No credentials or financial documents created or changed.\n");
}
main().catch(()=>{process.stderr.write("Seed not completed. Finish first-run enrollment and check database configuration.\n");process.exitCode=1;}).finally(()=>db.$disconnect());
