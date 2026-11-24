import {randomUUID} from "node:crypto";
import {AppError} from "@/lib/errors";
import {postJournalDraft,saveJournalDraft} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {entrySchema} from "./schema";
import {record,type Tx} from "./model";
import {decimal,zero} from "./balances";

async function validateMovement(tx:Tx,companyId:string,kind:string,lines:any[]) {
  const accounts=await Promise.all(lines.map(l=>l.account??record(tx,"chart",companyId,l.accountId)));
  const allCashBank=accounts.length>0&&accounts.every(a=>a.isCash||a.isBank);
  if(kind!=="TRANSFER") {
    if(allCashBank)throw new AppError(400,"Use a Transfer voucher for movements solely between company cash/bank accounts");
    return;
  }
  if(lines.length!==2||lines[0].accountId===lines[1].accountId||!allCashBank||accounts.some(a=>!a.active||a.isGroup))
    throw new AppError(400,"A transfer needs two distinct active company-owned cash/bank posting accounts");
  if(lines.some(l=>l.partyId))throw new AppError(400,"Own cash/bank transfers cannot name a party; do not use an invoice/bill payment");
  const legs=lines.map(l=>({debit:decimal(l.debit),credit:decimal(l.credit)}));
  if(legs.some(l=>!(l.debit.gt("0")&&l.credit.eq("0")||l.credit.gt("0")&&l.debit.eq("0")))||
    !legs.reduce((v,l)=>v.add(l.debit),zero()).eq(legs.reduce((v,l)=>v.add(l.credit),zero())))
    throw new AppError(400,"A transfer needs one positive debit and one equal positive credit");
}

export async function saveVoucher(tx:Tx,actor:Actor,companyId:string,raw:any,permission:string) {
  const data=entrySchema.parse(raw),id=raw.id??randomUUID();
  if(raw.id) {
    const old=await record(tx,"entries",companyId,id);
    if(old.sourceType!=="ENTRY")throw new AppError(409,"Edit the source document, not its generated entry");
  }
  await validateMovement(tx,companyId,data.kind,data.lines);
  return saveJournalDraft(tx,actor,companyId,{...data,id:raw.id,sourceType:"ENTRY",sourceId:id},permission);
}
export async function postVoucher(tx:Tx,actor:Actor,companyId:string,id:string,permission:string) {
  const before=await record(tx,"entries",companyId,id,{include:{lines:{where:{companyId,deletedAt:null},include:{account:true}}}});
  if(before.sourceType!=="ENTRY")throw new AppError(409,"Post the source document, not its generated entry");
  const lines=before.lines;
  await validateMovement(tx,companyId,before.kind,lines);
  if(before.kind==="CASH"&&!lines.some((l:any)=>l.account.isCash))throw new AppError(400,"A cash voucher requires a cash account");
  if(before.kind==="BANK"&&!lines.some((l:any)=>l.account.isBank))throw new AppError(400,"A bank voucher requires a bank account");
  if(before.kind==="EXPENSE") {
    if(!lines.some((l:any)=>l.account.type==="EXPENSE"&&l.debit.gt("0")))throw new AppError(400,"An expense voucher needs a debit to an expense account");
    if(!await tx.attachment.findFirst({where:{companyId,docType:"ENTRY",docId:id,deletedAt:null}}))throw new AppError(400,"Attach the expense bill before posting");
  }
  const docType=({JOURNAL:"JV",CASH:"CV",BANK:"BV",TRANSFER:"TRF",EXPENSE:"EXP"} as Record<string,string>)[before.kind];
  if(!docType)throw new AppError(400,"Unsupported manual voucher type");
  return postJournalDraft(tx,actor,companyId,id,permission,docType);
}
