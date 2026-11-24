import {z} from "zod";
import {db} from "@/lib/db";
import {audit} from "@/lib/audit";
import {companyScope} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import {archiveJournalDraft,reverseEntry} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {allocationSchema} from "./schema";
import {accountConfig,authorize,delegate,ledgerLock,record,resourceConfig,type Tx} from "./model";
import {applyAllocations} from "./balances";
import {saveMaster,saveSettings} from "./masters";
import {cancelDocument,postDocument,previewDocument,saveDocument} from "./documents";
import {postVoucher,saveVoucher} from "./vouchers";
import {accountingToday} from "./time";
import {saveOutlet} from "./outlets";
import {saveTax} from "./tax-master";
import {preparePaymentPost} from "./payment-controls";
import {approvalRule,requestApproval} from "./approvals";
import {executeOpeningReversal} from "./opening";
async function execute(tx:Tx,actor:Actor,companyId:string,resource:string,operation:string,id:string,note:string,permission:string) {
  if(resource==="entries") {
    const before=await record(tx,resource,companyId,id);
    if(before.sourceType!=="ENTRY")throw new AppError(409,"Use the source document to cancel its posting");
    if(operation==="post")return postVoucher(tx,actor,companyId,id,permission);
    if(before.status!=="POSTED")throw new AppError(409,"Only a posted voucher can be reversed");
    return reverseEntry(tx,actor,companyId,id,accountingToday(),note,permission);
  }
  if(!["invoices","bills","payments"].includes(resource))throw new AppError(400,"This record has no posting workflow");
  return operation==="post"?postDocument(tx,actor,companyId,resource as any,id,permission):cancelDocument(tx,actor,companyId,resource as any,id,note,permission);
}

/** Sole public Accounts write boundary: permission, one transaction, audit. */
export async function saveAccountRecord(actor:Actor,companyCode:string,resource:string,input:unknown) {
  const raw=z.object({id:z.string().uuid().optional(),operation:z.enum(["save","delete","post","cancel","allocate","preview"]).default("save")}).passthrough().parse(input);
  const cfg=resourceConfig(resource);
  if(!["save","preview"].includes(raw.operation)&&!raw.id)throw new AppError(400,"A document id is required");
  const action=resource==="settings"?"update":["save","preview"].includes(raw.operation)?(raw.id?"update":"create"):raw.operation;
  const permission=`accounts.${cfg.object}.${action}`;
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,permission),companyId=company.id;
    await ledgerLock(tx,companyId);
    if(raw.operation==="preview") {
      if(resource!=="invoices"&&resource!=="bills")throw new AppError(400,"Tax preview is available for invoice/bill drafts only");
      return previewDocument(tx,companyId,resource,raw);
    }
    if(resource==="taxes")return saveTax(tx,actor,companyId,raw);
    if(resource==="outlets")return saveOutlet(tx,actor,companyId,raw);
    if(["post","cancel"].includes(raw.operation)) {
      if(!raw.id)throw new AppError(400,"Save a draft first");
      let target=await record(tx,resource,companyId,raw.id);
      if(target.openingRecordId)await authorize(tx,actor,companyId,"accounts.opening.manage");
      if(raw.operation==="post"&&target.status!=="DRAFT"||raw.operation==="cancel"&&target.status!=="POSTED")throw new AppError(409,"Document status no longer permits this action");
      if(resource==="entries"&&(target.sourceType!=="ENTRY"||target.reversalOfId))throw new AppError(409,"Use the source document's cancellation workflow");
      if(resource==="entries"&&raw.operation==="cancel"&&await tx.journalEntry.findFirst({where:{companyId,reversalOfId:target.id}}))throw new AppError(409,"This voucher is already reversed");
      if(resource==="payments"&&raw.operation==="post")target=await preparePaymentPost(tx,actor,companyId,target,raw.duplicateConfirmation);
      const note=String(raw.note??"").trim().slice(0,2000);
      if(target.openingRecordId&&note.length<10)throw new AppError(400,"Opening reversals require a written reason of at least 10 characters");
      if(raw.operation==="cancel"&&note.length<3)throw new AppError(400,"Give a reason for cancellation");
      const rule=await approvalRule(tx,companyId,resource,raw.operation,target);
      if(target.openingRecordId&&!rule)throw new AppError(409,"Opening cancellation requires an active independent document-cancellation approval rule");
      if(rule)return requestApproval(tx,actor,companyId,resource,raw.operation,target,note,rule);
      return execute(tx,actor,companyId,resource,raw.operation,raw.id,note,permission);
    }
    if(raw.operation==="allocate") {
      if(resource!=="payments"||!raw.id)throw new AppError(400,"Choose a posted payment");
      const before=await record(tx,resource,companyId,raw.id);
      if(before.status!=="POSTED")throw new AppError(409,"Only a posted payment advance can be applied");
      const allocations=z.array(allocationSchema).max(200).parse(raw.allocations);
      const change=await applyAllocations(tx,actor,companyId,before,allocations);
      const after=await tx.payment.update({where:{id:raw.id,companyId},data:{updatedBy:actor.id,version:{increment:1}}});
      await audit(tx,actor,companyId,"ALLOCATE","payment_allocations",raw.id,change.before,change.after);
      await audit(tx,actor,companyId,"UPDATE","payments",raw.id,before,after);return after;
    }
    if(resource==="settings") {
      if(raw.operation!=="save")throw new AppError(400,"Accounting mappings cannot be deleted");
      return saveSettings(tx,actor,companyId,raw);
    }
    if(["chart","parties","departments","journals"].includes(resource))return saveMaster(tx,actor,companyId,resource,raw);
    if(resource==="entries")return raw.operation==="delete"?archiveJournalDraft(tx,actor,companyId,raw.id!):saveVoucher(tx,actor,companyId,raw,permission);
    return saveDocument(tx,actor,companyId,resource as "invoices"|"bills"|"payments",raw);
  },{timeout:60000,maxWait:30000});
}

/** Invoked by the shared approval service in the SAME decision transaction. */
export async function executeAccountingApproval(tx:Tx,actor:Actor,companyId:string,approval:any) {
  const request=approval.requestData as {resource:string;operation:string;note:string};
  if(approval.docType==="OPENING") {
    if(request.resource!=="opening-documents"||request.operation!=="cancel"||approval.action!=="cancel")
      throw new AppError(400,"Invalid opening reversal approval target");
    await authorize(tx,actor,companyId,(approval.ruleSnapshot as {approverPermissionCode:string}).approverPermissionCode);
    await ledgerLock(tx,companyId);
    const target=await tx.openingRecord.findFirst({where:{id:approval.docId,companyId,status:"POSTED"}});
    if(!target||target.version!==approval.targetVersion)throw new AppError(409,"The opening document changed; withdraw and submit a new reversal request");
    return executeOpeningReversal(tx,actor,companyId,target.id,request.note);
  }
  if(!["INVOICE","BILL","PAYMENT","ENTRY"].includes(approval.docType)||!accountConfig[request.resource as keyof typeof accountConfig]||!["post","cancel"].includes(request.operation))
    throw new AppError(400,"Financial approval handler not available");
  const expectedType=({invoices:"INVOICE",bills:"BILL",payments:"PAYMENT",entries:"ENTRY"} as Record<string,string>)[request.resource];
  if(expectedType!==approval.docType||request.operation!==approval.action)throw new AppError(400,"Invalid approval target");
  const permission=(approval.ruleSnapshot as {approverPermissionCode:string}).approverPermissionCode;
  await authorize(tx,actor,companyId,permission);
  await ledgerLock(tx,companyId);
  const target=await record(tx,request.resource,companyId,approval.docId);
  if(target.version!==approval.targetVersion)throw new AppError(409,"The document changed; withdraw and submit a new request");
  return execute(tx,actor,companyId,request.resource,request.operation,approval.docId,request.note,permission);
}
