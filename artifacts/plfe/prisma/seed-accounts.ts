import {db} from "../lib/db";
import {permissionCodes} from "../lib/role-templates";
import {seedDemoBooks} from "../modules/accounts/demo";
import {accountsReport} from "../modules/accounts/reports";
import {initializeGroup} from "../modules/accounts/group";
import {correctDemoChart} from "../modules/accounts/correction";
import {AppError} from "../lib/errors";
async function main() {
  const owner=await db.user.findFirst({where:{isOwner:true,active:true,mustChangePassword:false,deletedAt:null}});
  if(!owner)throw new AppError(409,"An active Owner must finish the initial password change before Accounts initialization");
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code.split(".").join(" ")})),skipDuplicates:true});
  if(process.argv.includes("--correct-demo-chart")) {
    const existing=await db.company.findMany({where:{deletedAt:null}});
    for(const company of existing) {
      const changed=await correctDemoChart(owner,company.code);
      process.stdout.write(`${company.code}: ${changed?"demo-only chart/calendar correction applied; original postings retained":"no correction needed"}.\n`);
    }
  }
  const companies=await db.$transaction(tx=>initializeGroup(tx,owner),{timeout:120000,maxWait:30000});
  for(const company of companies) {
    // Demo targets are explicit operator input, never runtime company-code logic.
    const targets=process.env.DEMO_COMPANY_CODES?.split(",").map(v=>v.trim()).filter(Boolean)??[];
    if(process.argv.includes("--demo")&&targets.includes(company.code)) {
      await seedDemoBooks(owner,company.code);
      const report=await accountsReport(owner,company.code,"trial-balance",{});
      if(!report.summary.balanced)throw new Error("Seeded trial balance does not balance");
      process.stdout.write(`${company.code}: 20 corrected TEST-P2 documents seeded; trial balance agrees (${report.summary.debit} / ${report.summary.credit}).\n`);
    } else process.stdout.write(`${company.code}: company, branches, financial year/periods, chart and posting settings initialized; no demo documents created.\n`);
  }
}
main().catch(e=>{process.stderr.write(`${e instanceof AppError?e.message:"Accounts seed failed. Check the completed Owner setup, open periods and database configuration."}\n`);process.exitCode=1;}).finally(()=>db.$disconnect());
