import {createHash,randomBytes} from "node:crypto";
import bcrypt from "bcryptjs";
import {cookies,headers} from "next/headers";
import {db} from "./db";
import {config} from "./config";
import {AppError} from "./errors";
import {audit} from "./audit";
import type {Actor} from "@/modules/core/model";
import {loginSchema,passwordSchema} from "@/modules/core/schema";

export const tokenHash=(raw:string)=>createHash("sha256").update(raw).digest("hex");
export function checkPassword(password:string) {
  if(password.length<config.passwordMinLength || password.length>200 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))
    throw new AppError(400,`Password requires ${config.passwordMinLength}+ characters, a letter and a number`);
}
export async function requestMeta() {
  const h=await headers();
  // Only trust X-Real-IP when the app is reachable exclusively through Nginx.
  return {ip:(h.get("x-real-ip")||"").slice(0,45)||undefined,device:(h.get("user-agent")||"").slice(0,500)};
}
export async function login(input:unknown) {
  const data=loginSchema.parse(input),meta=await requestMeta();
  const raw=randomBytes(32).toString("base64url");
  // Lock per normalized email serializes failed attempts without exposing email.
  const result=await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.email},0))`;
    const user=await tx.user.findFirst({where:{email:data.email,deletedAt:null}});
    const valid=await bcrypt.compare(data.password,user?.passwordHash||"$2b$12$pGJavIjJnWYXvmnNWG4XwOa9C.fXeV1CXAS8kYKnM2Yk8OVWKvHhW");
    const actor=user?{...user,...meta}:null;
    if(!user || !valid || !user.active || (user.lockedUntil && user.lockedUntil>new Date())) {
      if(user) {
        const locked=user.lockedUntil && user.lockedUntil>new Date();
        const failures=user.lockedUntil && !locked?1:user.failedLogins+1;
        if(!locked) await tx.user.update({where:{id:user.id},data:{failedLogins:failures,lockedUntil:failures>=config.maxFailedLogins?new Date(Date.now()+config.lockMinutes*60000):null}});
      }
      await audit(tx,actor,null,"LOGIN_FAILED","users",user?.id??null,null,{attemptedEmail:data.email},meta);
      return {ok:false as const};
    }
    await tx.user.update({where:{id:user.id},data:{failedLogins:0,lockedUntil:null,lastLoginAt:new Date()}});
    const session=await tx.session.create({data:{userId:user.id,tokenHash:tokenHash(raw),expiresAt:new Date(Date.now()+config.maxSessionMinutes*60000),...meta}});
    await audit(tx,actor,null,"LOGIN","sessions",session.id);
    return {ok:true as const,user};
  },{timeout:20000});
  if(!result.ok) throw new AppError(401,"Invalid credentials or account temporarily unavailable");
  (await cookies()).set(config.cookieName,raw,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:config.maxSessionMinutes*60});
  return {ok:true,mustChangePassword:result.user.mustChangePassword};
}
export async function requireActor(allowPasswordChange=false):Promise<Actor> {
  const raw=(await cookies()).get(config.cookieName)?.value;
  if(!raw) throw new AppError(401,"Sign in required");
  const session=await db.session.findUnique({where:{tokenHash:tokenHash(raw)},include:{user:true}});
  if(!session || session.expiresAt<=new Date() || session.lastSeenAt.getTime()<Date.now()-config.idleMinutes*60000 || !session.user.active || session.user.deletedAt)
    throw new AppError(401,"Your session has expired. Sign in again");
  if(session.user.mustChangePassword && !allowPasswordChange) throw new AppError(403,"Change your password before continuing");
  // Session touch is a technical write, kept transactional and out of business audit noise.
  await db.$transaction(tx=>tx.session.update({where:{id:session.id},data:{lastSeenAt:new Date()}}));
  return {id:session.user.id,name:session.user.name,email:session.user.email,isOwner:session.user.isOwner,mustChangePassword:session.user.mustChangePassword,sessionId:session.id,...await requestMeta()};
}
export async function logout() {
  const raw=(await cookies()).get(config.cookieName)?.value;
  if(raw) await db.$transaction(async tx=>{
    const s=await tx.session.findUnique({where:{tokenHash:tokenHash(raw)},include:{user:true}});
    if(s) {
      await tx.session.delete({where:{id:s.id}});
      await audit(tx,{...s.user,...await requestMeta()},null,"LOGOUT","sessions",s.id);
    }
  });
  (await cookies()).set(config.cookieName,"",{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:0});
}
export async function changePassword(actor:Actor,input:unknown) {
  const data=passwordSchema.parse(input);checkPassword(data.newPassword);
  const hash=await bcrypt.hash(data.newPassword,config.bcryptRounds);
  await db.$transaction(async tx=>{
    const u=await tx.user.findFirst({where:{id:actor.id,active:true,deletedAt:null}});
    if(!u || !await bcrypt.compare(data.currentPassword,u.passwordHash)) throw new AppError(400,"Current password is incorrect");
    if(await bcrypt.compare(data.newPassword,u.passwordHash)) throw new AppError(400,"Choose a different password");
    await tx.user.update({where:{id:actor.id},data:{passwordHash:hash,mustChangePassword:false,passwordChangedAt:new Date(),updatedBy:actor.id}});
    await tx.session.deleteMany({where:{userId:actor.id,id:{not:actor.sessionId}}});
    await audit(tx,actor,null,"PASSWORD_CHANGE","users",actor.id);
  });
  return {ok:true};
}
