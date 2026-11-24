import {createHash,timingSafeEqual} from "node:crypto";
import bcrypt from "bcryptjs";
import {z} from "zod";
import {db} from "./db";
import {audit} from "./audit";
import {checkPassword} from "./auth";
import {config} from "./config";
import {AppError} from "./errors";
import {permissionCodes} from "./role-templates";
import {initializeGroup} from "@/modules/accounts/group";

const schema=z.object({
  name:z.string().trim().min(1).max(200),
  email:z.string().trim().email().transform(v=>v.toLowerCase()),
  password:z.string().min(10).max(200),
  credential:z.string().min(1).max(256)
});
const digest=(v:string)=>createHash("sha256").update(v).digest();
export async function enrollmentStatus() {
  const used=await db.user.count({where:{isOwner:true}});
  const guard=await db.enrollmentGuard.findUnique({where:{id:1}});
  return {available:used===0&&!guard?.completedAt,configured:(process.env.BOOTSTRAP_ENROLLMENT_TOKEN?.length??0)>=43};
}
/** Only an operator with the deployment secret can enroll; never a public first-user-wins route. */
export async function enrollOwner(input:unknown) {
  const data=schema.parse(input);
  checkPassword(data.password);
  const expected=process.env.BOOTSTRAP_ENROLLMENT_TOKEN;
  const email=process.env.BOOTSTRAP_OWNER_EMAIL?.trim().toLowerCase();
  if(!expected||expected.length<43)throw new AppError(503,"The operator must configure a 32-byte random enrollment credential using the server's secure settings");
  const result=await db.$transaction(async tx=>{
    // Same global guard used by every identity writer and the last-Owner trigger.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71007100)`;
    const guard=await tx.enrollmentGuard.findUniqueOrThrow({where:{id:1}});
    if(guard.completedAt||await tx.user.count({where:{isOwner:true}}))throw new AppError(409,"Initial Owner enrollment is permanently closed");
    if(guard.lockedUntil&&guard.lockedUntil>new Date())throw new AppError(429,"Enrollment temporarily locked; retry after fifteen minutes");
    if((email&&data.email!==email)||!timingSafeEqual(digest(data.credential),digest(expected))) {
      const failures=guard.lockedUntil?1:guard.failures+1;
      await tx.enrollmentGuard.update({where:{id:1},data:{failures,lockedUntil:failures>=5?new Date(Date.now()+900000):null}});
      return false;
    }
    if(await tx.user.count())throw new AppError(409,"Enrollment requires an empty identity store; ask the operator to review existing identities");
    const passwordHash=await bcrypt.hash(data.password,config.bcryptRounds);
    const owner=await tx.user.create({data:{name:data.name,email:data.email,passwordHash,isOwner:true,mustChangePassword:false,passwordChangedAt:new Date()}});
    await audit(tx,owner,null,"SYSTEM","users",owner.id,null,{name:owner.name,email:owner.email,isOwner:true,event:"Operator-authorized initial enrollment"});
    await tx.permission.createMany({data:permissionCodes.map(code=>({code,description:code.split(".").join(" ")})),skipDuplicates:true});
    await initializeGroup(tx,owner);
    await tx.enrollmentGuard.update({where:{id:1},data:{completedAt:new Date(),failures:0,lockedUntil:null}});
    return true;
  },{timeout:120000,maxWait:10000});
  if(!result)throw new AppError(403,"Enrollment credentials not accepted");
  return {ok:true};
}
