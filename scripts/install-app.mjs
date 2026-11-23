import {spawnSync} from "node:child_process";
// pnpm already installs workspace packages. Plain npm users get the standalone
// app without depending on pnpm or other workspace packages.
if((process.env.npm_config_user_agent||"").startsWith("npm/")){
  const result=spawnSync("npm",["--prefix","artifacts/plfe","install","--ignore-scripts"],{stdio:"inherit"});
  process.exit(result.status??1);
}
