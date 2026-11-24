import dotenv from "dotenv";
import {spawnSync} from "node:child_process";
dotenv.config({path:[".env","../../.env"],quiet:true});
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith("_test"))throw new Error("Use a fresh dedicated PostgreSQL database ending in _test; this suite never erases existing identities.");
const env={...process.env,DATABASE_URL:url,PLFE_DATABASE_URL:url};
for(const [cmd,args] of [["prisma",["migrate","deploy"]],["tsx",["--test","--test-concurrency=1","tests/company-provisioning.test.ts"]]]) {
  const result=spawnSync(cmd,args,{stdio:"inherit",env});
  if(result.status!==0)process.exit(result.status??1);
}
