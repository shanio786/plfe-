import dotenv from "dotenv";
import {spawnSync} from "node:child_process";
dotenv.config({path:[".env","../../.env"],quiet:true});
const url=process.env.TEST_DATABASE_URL;
if(!url || !new URL(url).pathname.endsWith("_test")){
  throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL database whose name ends in _test. Never use production.");
}
const env={...process.env,DATABASE_URL:url,PLFE_DATABASE_URL:url};
for(const [command,args] of [["prisma",["migrate","deploy"]],["tsx",["--test","tests/foundation.test.ts"]]]){
  const r=spawnSync(command,args,{stdio:"inherit",env});
  if(r.status!==0) process.exit(r.status??1);
}
