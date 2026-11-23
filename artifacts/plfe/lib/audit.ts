import {Prisma} from "@prisma/client";
import {randomUUID} from "node:crypto";
import type {Actor} from "@/modules/core/model";
const privateKeys = /^(password|passwordHash|password_hash|currentPassword|newPassword|sessionToken|token|tokenHash|token_hash|twoFactorSecretEncrypted|secret|cookie)$/i;
export function redact(value:unknown):any {
  if(value === undefined || value === null) return null;
  if(value instanceof Date) return value.toISOString();
  if(Prisma.Decimal.isDecimal(value) || typeof value === "bigint") return value.toString();
  if(Array.isArray(value)) return value.map(redact);
  if(typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k])=>!privateKeys.test(k)).map(([k,v])=>[k,redact(v)]));
  return value;
}
export async function audit(tx:Prisma.TransactionClient,actor:Actor|null,companyId:string|null,action:string,tableName:string,recordId:string|null,before?:unknown,after?:unknown,context?:{ip?:string;device?:string}) {
  await tx.auditLog.create({data:{
    companyId,userId:actor?.id,action,tableName,recordId,
    beforeJson:redact(before)??Prisma.JsonNull,afterJson:redact(after)??Prisma.JsonNull,
    ip:actor?.ip??context?.ip,device:actor?.device??context?.device,requestId:randomUUID()
  }});
}
