import {createHash,createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import {Prisma} from "@prisma/client";
import {AppError} from "@/lib/errors";
import {audit} from "@/lib/audit";
import type {Actor} from "@/modules/core/model";
import {duplicateConfirmationSchema} from "./schema";
import {dateOnly,record,type Tx} from "./model";

const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const day=(value:string|Date)=>typeof value==="string"?dateOnly(value).toISOString().slice(0,10):value.toISOString().slice(0,10);
function signingKey() {
  // Read only in application memory; never return/log the configured secret.
  const key=process.env.SESSION_SECRET;
  if(!key||key.length<32)throw new AppError(503,"Duplicate-payment confirmation requires a securely configured SESSION_SECRET of at least 32 characters");
  return key;
}
function sign(body:string) {
  return createHmac("sha256",signingKey()).update(`plfe/payment-duplicate/v1/${body}`).digest("base64url");
}
function fingerprint(companyId:string,value:any) {
  const allocations=(value.allocations??[]).map((a:any)=>({invoiceId:a.invoiceId??null,billId:a.billId??null,
    amount:new Prisma.Decimal(a.amount).toFixed(4)}));
  allocations.sort((a:any,b:any)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
  return hash({companyId,partyId:value.partyId,date:day(value.date),amount:new Prisma.Decimal(value.amount).toFixed(4),
    direction:value.direction,method:value.method,settlementAccountId:value.settlementAccountId,
    departmentId:value.departmentId??null,outletId:value.outletId??null,eventId:value.eventId??null,allocations});
}
function verified(token:string,expected:any) {
  try {
    const pieces=token.split(".");if(pieces.length!==2)return false;
    const actual=Buffer.from(pieces[1],"base64url"),want=Buffer.from(sign(pieces[0]),"base64url");
    if(actual.length!==want.length||!timingSafeEqual(actual,want))return false;
    const body=JSON.parse(Buffer.from(pieces[0],"base64url").toString("utf8"));
    return body.v===1&&body.expiresAt>=Date.now()&&Object.entries(expected).every(([k,v])=>body[k]===v);
  } catch{return false;}
}
function warning(actor:Actor,companyId:string,id:string|null,operation:string,fp:string,matchHash:string,matches:any[]) {
  const expiresAt=Date.now()+10*60*1000;
  const body=Buffer.from(JSON.stringify({v:1,actorId:actor.id,companyId,id,operation,fingerprint:fp,matchHash,
    expiresAt,nonce:randomBytes(16).toString("base64url")})).toString("base64url");
  const refs=matches.slice(0,5).map(m=>`${m.reference} (${m.date})`).join(", ");
  return new AppError(409,`Possible duplicate: ${refs}${matches.length>5?` and ${matches.length-5} more`:""}. Review the matching payments and explicitly confirm with a written reason. For a pending approval, withdraw/reconfirm/resubmit or reject it before retrying.`,{
    code:"PAYMENT_DUPLICATE",token:`${body}.${sign(body)}`,expiresAt:new Date(expiresAt).toISOString(),operation,matches
  });
}
export async function rejectSelfPayment(tx:Tx,companyId:string,party:any) {
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{ntn:true,strn:true}});
  const normalized=(value:string|null)=>value?.toUpperCase().replace(/[^A-Z0-9]/g,"")||null;
  const sameRegistration=["ntn","strn"].some(key=>normalized((company as any)[key])&&normalized((company as any)[key])===normalized(party[key]));
  if(party.linkedCompanyId===companyId||sameRegistration)
    throw new AppError(400,"A receipt/payment cannot be to this company itself. Use a Transfer voucher between two distinct company-owned cash/bank accounts without a party",{code:"SELF_PAYMENT"});
}
/** Caller holds the company ledger lock across this check and its write. */
export async function paymentConsent(tx:Tx,actor:Actor,companyId:string,value:any,before:any,confirmation:unknown,operation:"save"|"post") {
  const date=dateOnly(day(value.date)),from=new Date(date),to=new Date(date);
  from.setUTCDate(from.getUTCDate()-7);to.setUTCDate(to.getUTCDate()+7);
  const found=await tx.payment.findMany({where:{companyId,partyId:value.partyId,amount:new Prisma.Decimal(value.amount),
    status:{not:"CANCELLED"},deletedAt:null,date:{gte:from,lte:to},...(before?{id:{not:before.id}}:{})},
    select:{id:true,number:true,date:true,amount:true,direction:true,status:true,version:true},orderBy:[{date:"asc"},{id:"asc"}]});
  const matches=found.map(p=>({...p,date:day(p.date),amount:p.amount.toFixed(4),reference:p.number??`DRAFT-${p.id}`}));
  const empty={duplicateEvidence:Prisma.DbNull,duplicateConfirmedBy:null,duplicateConfirmedAt:null,duplicateNote:null};
  if(!matches.length)return {fields:empty,confirmedNow:false};
  const fp=fingerprint(companyId,value),matchHash=hash(matches),evidence=before?.duplicateEvidence as any;
  if(!confirmation&&before?.duplicateConfirmedBy&&before.duplicateConfirmedAt&&before.duplicateNote?.trim().length>=10&&
    evidence?.fingerprint===fp&&evidence?.matchHash===matchHash)
    return {fields:{duplicateEvidence:evidence,duplicateConfirmedBy:before.duplicateConfirmedBy,
      duplicateConfirmedAt:before.duplicateConfirmedAt,duplicateNote:before.duplicateNote},confirmedNow:false};
  if(confirmation) {
    const parsed=duplicateConfirmationSchema.parse(confirmation);
    if(verified(parsed.token,{actorId:actor.id,companyId,id:before?.id??null,operation,fingerprint:fp,matchHash})) {
      return {fields:{duplicateEvidence:{fingerprint:fp,matchHash,matches,confirmedByName:actor.name},
        duplicateConfirmedBy:actor.id,duplicateConfirmedAt:new Date(),duplicateNote:parsed.note},confirmedNow:true};
    }
  }
  throw warning(actor,companyId,before?.id??null,operation,fp,matchHash,matches);
}
/** Confirmation precedes approval request creation, so approval pins its new version. */
export async function preparePaymentPost(tx:Tx,actor:Actor,companyId:string,target:any,confirmation:unknown) {
  const party=await record(tx,"parties",companyId,target.partyId);
  await rejectSelfPayment(tx,companyId,party);
  const allocations=await tx.paymentAllocation.findMany({where:{companyId,paymentId:target.id,deletedAt:null}});
  const decision=await paymentConsent(tx,actor,companyId,{...target,allocations},target,confirmation,"post");
  if(!decision.confirmedNow)return target;
  const after=await tx.payment.update({where:{id:target.id,companyId},data:{...decision.fields,updatedBy:actor.id,version:{increment:1}}});
  await audit(tx,actor,companyId,"CONFIRM_DUPLICATE","payments",target.id,target,after);
  return after;
}
