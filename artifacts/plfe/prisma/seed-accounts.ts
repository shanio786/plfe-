import {db} from "../lib/db";
import {permissionCodes} from "../lib/role-templates";
import {initializeAccounts} from "../modules/accounts/bootstrap";
import {seedDemoBooks} from "../modules/accounts/demo";
import {accountsReport} from "../modules/accounts/reports";
import {AppError} from "../lib/errors";
async function main() {
  const owner=await db.user.findFirst({where:{isOwner:true,active:true,mustChangePassword:false,deletedAt:null}});
  if(!owner)throw new Error("An active Owner must finish the initial password change before Accounts initialization");
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code.split(".").join(" ")})),skipDuplicates:true});
  const companies=await db.company.findMany({where:{code:{in:["PLFE","ZAHRA-HOME"]},deletedAt:null}});
  if(companies.length!==2)throw new Error("Both foundation companies must exist before seeding Accounts");
  for(const company of companies) {
    await db.$transaction(tx=>initializeAccounts(tx,owner,company.id),{timeout:60000});
    if(process.argv.includes("--demo")) {
      await seedDemoBooks(owner,company.code);
      const report=await accountsReport(owner,company.code,"trial-balance",{});
      if(!report.summary.balanced)throw new Error("Seeded trial balance does not balance");
      process.stdout.write(`${company.code}: 20 TEST-P2 documents seeded; trial balance agrees.\n`);
    } else process.stdout.write(`${company.code}: chart, journals, departments and posting settings initialized; no demo documents created.\n`);
  }
}
main().catch(e=>{process.stderr.write(`${e instanceof AppError?e.message:"Accounts seed failed. Check the completed Owner setup, both companies, open periods and database configuration."}\n`);process.exitCode=1;}).finally(()=>db.$disconnect());
