import {NextRequest,NextResponse} from "next/server";
import {ZodError} from "zod";
import {Prisma} from "@prisma/client";
import {login,logout,requireActor,changePassword} from "@/lib/auth";
import {identity,listRecords,overview} from "@/modules/core/queries";
import {saveRecord} from "@/modules/core/service";
import {redact,audit} from "@/lib/audit";
import {db} from "@/lib/db";
import {companyScope} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import {config} from "@/lib/config";
import {excelBuffer} from "@/lib/excel";
import {downloadFile,uploadFile,removeFile} from "@/lib/files";
import {profileSchema} from "@/modules/core/schema";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function json(body:unknown,status=200){return NextResponse.json(redact(body),{status,headers:{"Cache-Control":"no-store"}});}
function csrf(req:NextRequest) {
  const origin=req.headers.get("origin");
  const expected=config.appUrl?new URL(config.appUrl).origin:null;
  const host=req.headers.get("x-forwarded-host")||req.headers.get("host");
  const hostMatches=origin && new URL(origin).host===host;
  if(!origin || (expected?origin!==expected:!hostMatches)) throw new AppError(403,"Invalid request origin");
  if(req.headers.get("sec-fetch-site")==="cross-site") throw new AppError(403,"Cross-site request denied");
}
async function boundedForm(req:NextRequest) {
  if(!req.body) throw new AppError(400,"Missing upload");
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];
  let length=0;
  while(true){
    const result=await reader.read();
    if(result.done) break;
    length+=result.value.length;
    if(length>config.maxUploadBytes+65536){await reader.cancel();throw new AppError(413,"Upload exceeds limit");}
    chunks.push(result.value);
  }
  return new Request(req.url,{method:"POST",headers:{"Content-Type":req.headers.get("content-type")||""},body:new Uint8Array(Buffer.concat(chunks))}).formData();
}
async function handle(req:NextRequest,context:{params:Promise<{path:string[]}>}) {
  try {
    const {path}=await context.params;
    if(req.method!=="GET") csrf(req);
    if(path[0]==="healthz") {await db.$queryRaw`SELECT 1`;return json({status:"ok"});}
    if(path[0]==="session") {
      if(req.method==="POST") return json(await login(await req.json()));
      if(req.method==="DELETE"){await logout();return json({ok:true});}
      return json(await identity(await requireActor(true)));
    }
    if(path[0]==="password" && req.method==="POST") return json(await changePassword(await requireActor(true),await req.json()));
    const actor=await requireActor();
    const [company,resource,id]=path;
    if(resource==="overview"&&req.method==="GET") return json(await overview(actor,company));
    if(resource==="profile") {
      if(req.method==="GET") {
        const profile=await db.$transaction(async tx=>{
          const c=await companyScope(tx,actor,company);
          const user=await tx.user.findUniqueOrThrow({where:{id:actor.id}});
          const photo=user.photoStorageKey?await tx.attachment.findFirst({where:{companyId:c.id,filePath:user.photoStorageKey,deletedAt:null,docType:"USER",docId:actor.id}}):null;
          return {id:user.id,name:user.name,email:user.email,phone:user.phone,photoAttachmentId:photo?.id,photoUrl:photo?`/api/plfe/${company}/files/${photo.id}`:null};
        });return json(profile);
      }
      const data=profileSchema.parse(await req.json());
      const changed=await db.$transaction(async tx=>{
        const c=await companyScope(tx,actor,company);
        const before=await tx.user.findUniqueOrThrow({where:{id:actor.id}});
        const after=await tx.user.update({where:{id:actor.id},data:{...data,updatedBy:actor.id}});
        await audit(tx,actor,c.id,"UPDATE","users",actor.id,before,after);return after;
      });return json(changed);
    }
    if(resource==="files"&&id&&req.method==="GET") {
      const {record,bytes}=await downloadFile(actor,company,id);
      return new NextResponse(new Uint8Array(bytes),{headers:{"Content-Type":record.mime,"Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
    if(resource==="attachments"&&req.method==="POST"){
      const length=Number(req.headers.get("content-length")||0);
      if(length>config.maxUploadBytes+65536) throw new AppError(413,"Upload exceeds limit");
      if(req.headers.get("content-type")?.startsWith("multipart/form-data")) return json(await uploadFile(actor,company,await boundedForm(req)));
      const body=await req.json();
      if(body.operation==="delete") return json(await removeFile(actor,company,body.id));
      throw new AppError(400,"Use a multipart file upload");
    }
    if(req.method==="GET") {
      const params=Object.fromEntries(req.nextUrl.searchParams);
      const exporting=params.export==="xlsx";
      const result=await listRecords(actor,company,resource,params,exporting);
      if(exporting) return new NextResponse(new Uint8Array(await excelBuffer(result.rows,resource)),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":`attachment; filename="${resource}.xlsx"`,"Cache-Control":"private, no-store"}});
      return json(result);
    }
    if(req.method==="POST") return json(await saveRecord(actor,company,resource,await req.json()));
    throw new AppError(405,"Method not allowed");
  } catch(error) {
    if(error instanceof AppError) return json({error:error.message},error.status);
    if(error instanceof ZodError) return json({error:error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")},400);
    if(error instanceof Prisma.PrismaClientKnownRequestError) {
      if(error.code==="P2002") return json({error:"An active record already uses this value"},409);
      if(["P2003","P2004","P2010"].includes(error.code)) return json({error:"This change violates a database integrity rule"},409);
      if(error.code==="P2025") return json({error:"Record not found"},404);
    }
    // Never serialize errors, credentials, request payloads or connection URLs.
    process.stderr.write(JSON.stringify({event:"foundation_request_failed",errorType:error instanceof Error?error.constructor.name:"Unknown"})+"\n");
    return json({error:"The operation could not be completed. Check database availability and server configuration."},500);
  }
}
export const GET=handle;
export const POST=handle;
export const DELETE=handle;
