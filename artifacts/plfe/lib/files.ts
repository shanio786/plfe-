import {mkdir,writeFile,unlink,readFile} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import path from "node:path";
import {db} from "./db";
import {config} from "./config";
import {lockRow} from "./locking";
import {companyScope} from "./permissions";
import {audit} from "./audit";
import {AppError} from "./errors";
import type {Actor} from "@/modules/core/model";
import type {Prisma} from "@prisma/client";
import {authorize,ledgerLock} from "@/modules/accounts/model";
async function targetCheck(tx:Prisma.TransactionClient,companyId:string,docType:string,docId:string,actor:Actor) {
  const cfg=({INVOICE:{model:"invoice",permission:"accounts.invoice.read"},BILL:{model:"bill",permission:"accounts.bill.read"},PAYMENT:{model:"payment",permission:"accounts.payment.read"},ENTRY:{model:"journalEntry",permission:"accounts.entry.read"}} as Record<string,{model:string;permission:string}>)[docType];
  if(cfg) {
    await authorize(tx,actor,companyId,cfg.permission);
    if(!await (tx as any)[cfg.model].findFirst({where:{id:docId,companyId,deletedAt:null}}))throw new AppError(404,"Attachment target not found in this company");
    return;
  }
  const target=docType==="COMPANY"
    ? (docId===companyId?await tx.company.findFirst({where:{id:docId,deletedAt:null}}):null)
    : docType==="BRANCH"?await tx.branch.findFirst({where:{id:docId,companyId,deletedAt:null}})
    : docType==="USER"?await tx.user.findFirst({where:{id:docId,deletedAt:null,OR:[{isOwner:true},{memberships:{some:{companyId}}}]}}):null;
  if(!target) throw new AppError(404,"Attachment target not found in this company");
}
function detect(bytes:Buffer,claimed:string) {
  if(bytes.subarray(0,5).toString()==="%PDF-") return "application/pdf";
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return "image/jpeg";
  if(claimed==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && bytes.subarray(0,4).equals(Buffer.from([80,75,3,4]))) return claimed;
  if(claimed==="text/plain"&&!bytes.includes(0)) return claimed;
  throw new AppError(400,"Unsupported file contents");
}
export async function uploadFile(actor:Actor,code:string,form:FormData) {
  const file=form.get("file"),docType=String(form.get("docType")),docId=String(form.get("docId"));
  if(!(file instanceof File)||file.size===0||file.size>config.maxUploadBytes) throw new AppError(400,"File is empty or exceeds the upload limit");
  if(!/^[a-f0-9-]{36}$/i.test(docId)) throw new AppError(400,"Invalid attachment target");
  // Authorize before reading bytes from the submitted File.
  const company=await db.$transaction(async tx=>{
    const c=await companyScope(tx,actor,code,"core.attachment.create");await targetCheck(tx,c.id,docType,docId,actor);return c;
  });
  const bytes=Buffer.from(await file.arrayBuffer()),mime=detect(bytes,file.type);
  if(!config.allowedMime.includes(mime)) throw new AppError(400,"File type not allowed");
  const storageKey=`${company.id}/${randomUUID()}`;
  const directory=path.join(config.uploadDir,company.id);
  await mkdir(directory,{recursive:true,mode:0o700});
  const dest=path.join(config.uploadDir,storageKey);
  await writeFile(dest,bytes,{mode:0o600,flag:"wx"});
  try {
    return await db.$transaction(async tx=>{
      await companyScope(tx,actor,code,"core.attachment.create");
      await targetCheck(tx,company.id,docType,docId,actor);
      const record=await tx.attachment.create({data:{companyId:company.id,docType,docId,filePath:storageKey,name:path.basename(file.name).slice(0,255),size:BigInt(bytes.length),mime,checksum:createHash("sha256").update(bytes).digest("hex"),uploadedBy:actor.id,createdBy:actor.id,updatedBy:actor.id}});
      await audit(tx,actor,company.id,"CREATE","attachments",record.id,null,record);return record;
    });
  } catch(e) {await unlink(dest).catch(()=>{});throw e;}
}
export async function downloadFile(actor:Actor,code:string,id:string) {
  const record=await db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,code,"core.attachment.read");
    const r=await tx.attachment.findFirst({where:{id,companyId:company.id,deletedAt:null}});
    if(!r) throw new AppError(404,"File not found");
    await targetCheck(tx,company.id,r.docType,r.docId,actor);return r;
  });
  const resolved=path.resolve(config.uploadDir,record.filePath);
  if(!resolved.startsWith(config.uploadDir+path.sep)) throw new AppError(403,"Invalid file path");
  try {return {record,bytes:await readFile(resolved)};} catch {throw new AppError(404,"File bytes unavailable; restore the matching uploads backup");}
}
export async function removeFile(actor:Actor,code:string,id:string) {
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,code,"core.attachment.delete");
    await lockRow(tx,"attachments",id,company.id);
    const before=await tx.attachment.findFirst({where:{id,companyId:company.id,deletedAt:null}});
    if(!before) throw new AppError(404,"Attachment not found");
    await targetCheck(tx,company.id,before.docType,before.docId,actor);
    if(before.docType==="ENTRY") {
      await ledgerLock(tx,company.id);
      const entry=await tx.journalEntry.findFirst({where:{id:before.docId,companyId:company.id,status:"POSTED",kind:"EXPENSE"}});
      if(entry&&await tx.attachment.count({where:{companyId:company.id,docType:"ENTRY",docId:before.docId,deletedAt:null}})<=1)
        throw new AppError(409,"The supporting bill for a posted expense must be retained");
    }
    if(await tx.company.findFirst({where:{id:company.id,logoAttachmentId:id}})) throw new AppError(409,"Remove the company logo reference first");
    if(await tx.user.findFirst({where:{photoStorageKey:before.filePath,deletedAt:null}})) throw new AppError(409,"Remove the user photo reference first");
    const changed=await tx.attachment.update({where:{id},data:{deletedAt:new Date(),updatedBy:actor.id}});
    await audit(tx,actor,company.id,"CANCEL","attachments",id,before,changed);
    // Retain bytes for audit/backup retention; the download API now denies access.
    return {ok:true};
  });
}
