import {randomUUID} from "node:crypto";
import {AppError} from "@/lib/errors";
import {postJournalDraft,saveJournalDraft} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {entrySchema} from "./schema";
import {record,type Tx} from "./model";

export async function saveVoucher(tx:Tx,actor:Actor,companyId:string,raw:any,permission:string) {
  const data=entrySchema.parse(raw),id=raw.id??randomUUID();
  if(raw.id) {
    const old=await record(tx,"entries",companyId,id);
    if(old.sourceType!=="ENTRY")throw new AppError(409,"Edit the source document, not its generated entry");
  }
  return saveJournalDraft(tx,actor,companyId,{...data,id:raw.id,sourceType:"ENTRY",sourceId:id},permission);
}
export async function postVoucher(tx:Tx,actor:Actor,companyId:string,id:string,permission:string) {
  const before=await record(tx,"entries",companyId,id,{include:{lines:{where:{companyId,deletedAt:null},include:{account:true}}}});
  if(before.sourceType!=="ENTRY")throw new AppError(409,"Post the source document, not its generated entry");
  const lines=before.lines;
  if(before.kind==="CASH"&&!lines.some((l:any)=>l.account.isCash))throw new AppError(400,"A cash voucher requires a cash account");
  if(before.kind==="BANK"&&!lines.some((l:any)=>l.account.isBank))throw new AppError(400,"A bank voucher requires a bank account");
  if(before.kind==="TRANSFER"&&(lines.length!==2||!lines.some((l:any)=>l.account.isBank)||!lines.some((l:any)=>l.account.isCash)))
    throw new AppError(400,"A transfer needs one bank and one cash line");
  if(before.kind==="EXPENSE") {
    if(!lines.some((l:any)=>l.account.type==="EXPENSE"&&l.debit.gt("0")))throw new AppError(400,"An expense voucher needs a debit to an expense account");
    if(!await tx.attachment.findFirst({where:{companyId,docType:"ENTRY",docId:id,deletedAt:null}}))throw new AppError(400,"Attach the expense bill before posting");
  }
  const docType=({JOURNAL:"JV",CASH:"CV",BANK:"BV",TRANSFER:"TRF",EXPENSE:"EXP"} as Record<string,string>)[before.kind];
  if(!docType)throw new AppError(400,"Unsupported manual voucher type");
  return postJournalDraft(tx,actor,companyId,id,permission,docType);
}
