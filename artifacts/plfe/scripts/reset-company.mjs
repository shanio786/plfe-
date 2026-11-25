import dotenv from "dotenv";
import {spawnSync} from "node:child_process";
// Operator-only maintenance. It refuses anything but a development or test
// database, and refuses a company whose books have been declared open.
dotenv.config({path:[".env.maintenance","../../.env.maintenance",".env","../../.env"],quiet:true});
if(process.env.MIGRATION_DATABASE_URL) {
  process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL;
  delete process.env.PLFE_DATABASE_URL;
}
const result=spawnSync("tsx",["prisma/reset-company.ts",...process.argv.slice(2)],
  {stdio:"inherit",shell:false,env:process.env});
process.exit(result.status??1);
