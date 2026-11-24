import dotenv from "dotenv";
import {spawnSync} from "node:child_process";
import path from "node:path";
dotenv.config({path:[".env","../../.env"],quiet:true});
const url=process.env.TEST_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith("_test"))throw new Error("Set TEST_DATABASE_URL to a separate PostgreSQL database ending in _test. Production is forbidden.");
const env={...process.env,DATABASE_URL:url,PLFE_DATABASE_URL:url,UPLOAD_DIR:path.resolve("var/test-uploads/accounts")};
for(const [cmd,args] of [["prisma",["generate"]],["prisma",["migrate","deploy"]],["tsx",["--test","--test-concurrency=1","tests/accounts.test.ts","tests/accounts-correction.test.ts","tests/outlets.test.ts","tests/accounting-presentation.test.ts","tests/tax.test.ts","tests/payment-controls.test.ts","tests/opening.test.ts"]]]) {
  const result=spawnSync(cmd,args,{stdio:"inherit",env});
  if(result.status!==0)process.exit(result.status??1);
}
