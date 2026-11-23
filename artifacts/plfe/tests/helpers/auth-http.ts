import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {createRequire} from "node:module";
import {once} from "node:events";
import {saveRecord} from "../../modules/core/service";
import type {Actor} from "../../modules/core/model";

export async function checkAuthHttp(owner:Actor,company:string,otherCompany:string,roleId:string) {
  const password=`Aa1${randomBytes(24).toString("hex")}`;
  const changedPassword=`Bb2${randomBytes(24).toString("hex")}`;
  const resetPassword=`Cc3${randomBytes(24).toString("hex")}`;
  const email=`http-${randomBytes(8).toString("hex")}@test.invalid`;
  const user=await saveRecord(owner,company,"users",{name:"HTTP acceptance identity",email,password,roleIds:[roleId]});
  const socket=createServer();
  socket.listen(0,"127.0.0.1");
  await once(socket,"listening");
  const address=socket.address();
  if(!address||typeof address==="string") throw new Error("No test port");
  const port=address.port;
  await new Promise<void>(resolve=>socket.close(()=>resolve()));
  const origin=`http://127.0.0.1:${port}`;
  const server=spawn(process.execPath,[createRequire(import.meta.url).resolve("next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{
    cwd:new URL("../../",import.meta.url),
    env:{...process.env,NODE_ENV:"production",APP_URL:origin,PORT:String(port)},
    stdio:"ignore",
  });
  let cookie="";
  const request=(path:string,method="GET",body?:unknown,sendOrigin=true)=>fetch(`${origin}/api/plfe/${path}`,{
    method,headers:{...(sendOrigin?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(body?{"Content-Type":"application/json"}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  try {
    let ready=false;
    for(let i=0;i<100;i++) {
      if(server.exitCode!==null) throw new Error("Isolated test server exited");
      try {ready=(await request("healthz")).ok;} catch {}
      if(ready) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,"Isolated production server did not become ready");
    assert.equal((await request("session","POST",{email,password},false)).status,403);
    const login=await request("session","POST",{email,password});
    assert.equal(login.status,200);
    assert.equal((await login.json()).mustChangePassword,true);
    const header=login.headers.get("set-cookie")||"";
    // Never include a session token in assertion output, even on failure.
    assert.ok(/HttpOnly/i.test(header),"Missing HttpOnly flag");
    assert.ok(/Secure/i.test(header),"Missing Secure flag");
    assert.ok(/SameSite=Lax/i.test(header),"Missing SameSite flag");
    cookie=header.split(";")[0];
    assert.equal((await request(`${company}/branches`)).status,403);
    assert.equal((await request("password","POST",{currentPassword:password,newPassword:changedPassword,confirmPassword:changedPassword})).status,200);
    assert.equal((await request(`${company}/branches`)).status,200);
    assert.equal((await request(`${otherCompany}/branches?export=xlsx`)).status,403);
    assert.equal((await request(`${company}/profile`,"POST",{name:"HTTP updated identity",phone:""})).status,200);
    assert.equal((await (await request(`${company}/profile`)).json()).name,"HTTP updated identity");
    await saveRecord(owner,company,"users",{id:user.id,operation:"reset-password",password:resetPassword});
    assert.equal((await request("session")).status,401);
    cookie="";
    assert.equal((await request("session","POST",{email,password:changedPassword})).status,401);
    const resetLogin=await request("session","POST",{email,password:resetPassword});
    assert.equal(resetLogin.status,200);
    assert.equal((await resetLogin.json()).mustChangePassword,true);
    cookie=(resetLogin.headers.get("set-cookie")||"").split(";")[0];
    assert.equal((await request("session","DELETE")).status,200);
    assert.equal((await request("session")).status,401);
  } finally {
    if(server.exitCode===null) {
      const stopped=once(server,"exit");
      server.kill("SIGTERM");
      const kill=setTimeout(()=>server.kill("SIGKILL"),5000);
      kill.unref();
      await stopped;
      clearTimeout(kill);
    }
  }
}
