import dotenv from "dotenv";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
dotenv.config({path:[".env","../../.env"],quiet:true});
const require=createRequire(import.meta.url);
const mode=process.argv[2]==="dev"?"dev":"start";
const child=spawn(process.execPath,[require.resolve("next/dist/bin/next"),mode,"--hostname",process.env.APP_HOST||"0.0.0.0","--port",process.env.PORT||"3000"],{stdio:"inherit",env:process.env});
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>process.exit(code??1));
