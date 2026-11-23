import dotenv from "dotenv";
import {spawnSync} from "node:child_process";
// Operator-only file; the application and worker never load it.
dotenv.config({path:[".env.maintenance","../../.env.maintenance",".env","../../.env"],quiet:true});
if(process.env.MIGRATION_DATABASE_URL) {
  process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL;
  delete process.env.PLFE_DATABASE_URL;
}
const result=spawnSync("tsx",["prisma/seed.ts"],{stdio:"inherit",shell:false,env:process.env});
process.exit(result.status??1);
