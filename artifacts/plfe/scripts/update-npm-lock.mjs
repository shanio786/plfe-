import {mkdtemp,copyFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";

// npm can otherwise serialize the existing pnpm symlinks into package-lock.json.
// Resolve from the standalone manifest with no workspace node_modules present.
const root=fileURLToPath(new URL("../",import.meta.url));
const temp=await mkdtemp(path.join(tmpdir(),"plfe-npm-lock-"));
try {
  await copyFile(path.join(root,"package.json"),path.join(temp,"package.json"));
  const result=spawnSync("npm",["install","--package-lock-only","--ignore-scripts","--no-audit","--no-fund"],{cwd:temp,stdio:"inherit"});
  if(result.status!==0) throw new Error("Standalone npm lock generation failed");
  const lock=JSON.parse(await readFile(path.join(temp,"package-lock.json"),"utf8"));
  for(const [name,entry] of Object.entries(lock.packages||{})) {
    if(name.startsWith("../") || entry.link || entry.resolved?.startsWith("../"))
      throw new Error("Standalone lock contains a workspace link");
  }
  await copyFile(path.join(temp,"package-lock.json"),path.join(root,"package-lock.json"));
  console.log("Generated a standalone registry-backed npm lockfile");
} finally {
  await rm(temp,{recursive:true,force:true});
}
