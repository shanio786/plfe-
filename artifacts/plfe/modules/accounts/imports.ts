import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {db} from "@/lib/db";
import {audit,redact} from "@/lib/audit";
import {companyScope,permissionsFor} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import type {Actor} from "@/modules/core/model";
import {authorize,ledgerLock,type Tx} from "./model";
import {saveMaster} from "./masters";
import {importMaxBytes,importMaxRows,readImportFile,type ImportFile} from "./import-file";
import {importTemplates,validateImportRows,type ImportKind,type NormalizedImportRow} from "./import-validation";
import {openingHash} from "./opening-state";
const kindSchema=z.enum(["parties","chart"]);
const tokenHash=(token:string)=>createHash("sha256").update(token).digest("hex");

async function importContext(tx:Tx,companyId:string) {
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId}});
  const accounts=await tx.account.findMany({where:{companyId},orderBy:{id:"asc"},
    select:{id:true,code:true,parentId:true,type:true,isGroup:true,isCash:true,isBank:true,active:true,deletedAt:true,updatedAt:true}});
  const parties=await tx.party.findMany({where:{companyId},orderBy:{id:"asc"},select:{id:true,code:true,updatedAt:true,deletedAt:true}});
  return openingHash({company,accounts,parties});
}
const masterPermission=(kind:ImportKind)=>`accounts.${kind==="chart"?"chart":"party"}.create`;
export async function importInfo(actor:Actor,companyCode:string) {
  return db.$transaction(async tx=>{
    await companyScope(tx,actor,companyCode,"accounts.import.create");
    return {templates:importTemplates,maxRows:importMaxRows,maxBytes:importMaxBytes};
  });
}
export async function previewImport(actor:Actor,companyCode:string,kindInput:unknown,file:{name:string;size:number;arrayBuffer():Promise<ArrayBuffer>}) {
  const kind=kindSchema.parse(kindInput);
  // Authorize before spending time parsing an untrusted workbook.
  await db.$transaction(async tx=>{
    const c=await companyScope(tx,actor,companyCode,"accounts.import.create");
    await authorize(tx,actor,c.id,masterPermission(kind));
  });
  if(!file||typeof file.arrayBuffer!=="function"||file.size>importMaxBytes||file.size<1)
    throw new AppError(400,"Select a nonempty CSV/XLSX file of at most 2 MiB");
  const bytes=Buffer.from(await file.arrayBuffer()),source=await readImportFile(file.name,bytes);
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,"accounts.import.create");
    await ledgerLock(tx,company.id);
    await authorize(tx,actor,company.id,masterPermission(kind));
    const fresh=await tx.company.findUniqueOrThrow({where:{id:company.id}});
    const permissions=await permissionsFor(tx,actor,company.id),canOpen=permissions.includes("accounts.opening.manage");
    const checked=await validateImportRows(tx,company.id,kind,source,canOpen,!!fresh.booksOpenedAt);
    if(checked.errors.length)return {valid:false,errors:checked.errors,rows:[],totalRows:source.totalRows};
    const payload=checked.plans,contextHash=await importContext(tx,company.id);
    const confirmationToken=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+15*60*1000);
    const sourceHash=createHash("sha256").update(bytes).digest("hex");
    // File bytes are discarded; only validated normalized rows and a digest are
    // retained for review. There is no stored executable spreadsheet/attachment.
    const preview=await tx.importPreview.create({data:{companyId:company.id,kind,filename:file.name,payload,
      payloadHash:openingHash(payload),sourceHash,contextHash,tokenHash:tokenHash(confirmationToken),createdBy:actor.id,expiresAt}});
    await audit(tx,actor,company.id,"PREVIEW_IMPORT","import_previews",preview.id,null,
      {kind,filename:file.name,sourceHash,rows:payload.length,expiresAt});
    return {valid:true,previewId:preview.id,confirmationToken,expiresAt,kind,totalRows:payload.length,
      stagedOpeningCount:kind==="parties"?payload.filter(p=>p.values.openingBalance!=="0.0000").length:0,
      rows:payload.map(p=>({row:p.row,...p.values,...(kind==="chart"?{parentCode:p.parentCode}: {})}))};
  },{timeout:60000,maxWait:30000});
}
function sourceFromPlans(kind:ImportKind,plans:NormalizedImportRow[]):ImportFile {
  const headers=[...importTemplates[kind]];
  return {headers,errors:[],totalRows:plans.length,rows:plans.map(p=>headers.map(key=>{
    const v=key==="parentCode"?p.parentCode:p.values[key];return {text:v==null?"":String(v)};
  }))};
}
export async function confirmImport(actor:Actor,companyCode:string,input:unknown) {
  const data=z.object({operation:z.literal("confirm"),previewId:z.uuid(),confirmationToken:z.string().min(40).max(100),confirmed:z.literal(true)}).strict().parse(input);
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,"accounts.import.create"),companyId=company.id;
    await ledgerLock(tx,companyId);
    await authorize(tx,actor,companyId,"accounts.import.create");
    const fresh=await tx.company.findUniqueOrThrow({where:{id:companyId}});
    const preview=await tx.importPreview.findFirst({where:{id:data.previewId,companyId,createdBy:actor.id}});
    if(!preview)throw new AppError(404,"This user's company-scoped import preview was not found; preview the file again");
    const expected=Buffer.from(preview.tokenHash,"hex"),actual=Buffer.from(tokenHash(data.confirmationToken),"hex");
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))
      throw new AppError(409,"Import confirmation was tampered with; preview the file again");
    if(preview.confirmedAt||preview.expiresAt.getTime()<Date.now())
      throw new AppError(409,"Import review was already used or expired; preview the file again");
    const kind=kindSchema.parse(preview.kind);
    await authorize(tx,actor,companyId,masterPermission(kind));
    if(preview.contextHash!==await importContext(tx,companyId)||preview.payloadHash!==openingHash(preview.payload))
      throw new AppError(409,"Company/master data or import evidence changed after preview; preview again before any write");
    const stored=preview.payload as unknown as NormalizedImportRow[];
    const permissions=await permissionsFor(tx,actor,companyId);
    const checked=await validateImportRows(tx,companyId,kind,sourceFromPlans(kind,stored),permissions.includes("accounts.opening.manage"),!!fresh.booksOpenedAt);
    if(checked.errors.length)throw new AppError(409,"Import validation changed; preview again before any write",{code:"IMPORT_STALE",errors:checked.errors});
    if(openingHash(checked.plans)!==preview.payloadHash)
      throw new AppError(409,"Normalized import evidence changed; preview again before any write");
    // ALL rows have been revalidated above, before the first master write.
    const ids:string[]=[];let stagedOpeningCount=0;
    if(kind==="parties") {
      for(const row of checked.plans) {
        const openingBalance=row.values.openingBalance;
        const party=await saveMaster(tx,actor,companyId,"parties",{...row.values,openingBalance:"0.0000"});
        ids.push(party.id);
        if(openingBalance!=="0.0000") {
          await tx.openingStagedAmount.create({data:{companyId,partyId:party.id,previewId:preview.id,
            side:row.values.openingSide,amount:openingBalance,createdBy:actor.id}});
          stagedOpeningCount++;
        }
      }
    } else {
      const existing=await tx.account.findMany({where:{companyId,deletedAt:null}});
      const byCode=new Map(existing.map(a=>[a.code,a.id]));
      const pending=[...checked.plans];
      // Validator canonicalized parent codes using DB collation. Parents in the
      // same file are created before children, regardless of spreadsheet order.
      while(pending.length) {
        const index=pending.findIndex(p=>!p.parentCode||byCode.has(p.parentCode));
        if(index<0)throw new AppError(409,"Chart hierarchy changed; import rolled back completely");
        const [row]=pending.splice(index,1);
        const account=await saveMaster(tx,actor,companyId,"chart",{...row.values,parentId:row.parentCode?byCode.get(row.parentCode):null});
        byCode.set(account.code,account.id);ids.push(account.id);
      }
    }
    const result={created:ids.length,stagedOpeningCount,ids,message:`Created ${ids.length} master records and staged ${stagedOpeningCount} opening amounts. No financial document was posted.`};
    await tx.importPreview.update({where:{id:preview.id,companyId},data:{confirmedAt:new Date(),result}});
    await audit(tx,actor,companyId,"CONFIRM_IMPORT","import_previews",preview.id,null,
      {kind,sourceHash:preview.sourceHash,createdIds:ids,stagedOpeningCount});
    return redact(result);
  },{timeout:60000,maxWait:30000});
}
