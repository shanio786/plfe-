import dotenv from "dotenv";
import {spawnSync} from "node:child_process";
// Operator-only file; the application and worker never load it.
dotenv.config({path:[".env.maintenance","../../.env.maintenance",".env","../../.env"],quiet:true});
if(process.env.MIGRATION_DATABASE_URL) {
  process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL;
  delete process.env.PLFE_DATABASE_URL;
}
const accounts=process.argv[2]==="accounts";
const result=spawnSync("tsx",[accounts?"prisma/seed-accounts.ts":"prisma/seed.ts",...(accounts?process.argv.slice(3):process.argv.slice(2))],{stdio:"inherit",shell:false,env:process.env});
process.exit(result.status??1);
