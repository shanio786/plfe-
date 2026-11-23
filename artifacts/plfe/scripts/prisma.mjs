import dotenv from "dotenv";
import {spawnSync} from "node:child_process";
dotenv.config({path:[".env","../../.env"],quiet:true});
if(process.env.MIGRATION_DATABASE_URL || process.env.PLFE_DATABASE_URL) process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL || process.env.PLFE_DATABASE_URL;
const result=spawnSync("prisma",process.argv.slice(2),{stdio:"inherit",shell:false,env:process.env});
process.exit(result.status??1);
