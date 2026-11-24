import {randomUUID} from "node:crypto";
import {z} from "zod";
import {db} from "@/lib/db";
import {audit} from "@/lib/audit";
import {companyScope} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import {openFiscal,reverseEntry} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {authorize,dateOnly,ledgerLock,type Tx} from "./model";
import {openingHash,openingStages,openingState} from "./opening-state";
import {openingOperationSchema,openingReason} from "./opening-schema";
import {postOpening} from "./opening-posting";
import {approvalRule,requestApproval} from "./approvals";
import {cancelDocument} from "./documents";
import {openingReversalDate} from "./book-dates";

/** Separate narrow public boundary; every guided mutation requires the opening
 * capability (initially Owner/Accountant only), and rechecks under ledger lock. */
export async function saveOpening(actor:Actor,companyCode:string,input:unknown) {
  return db.$transaction(async tx=>{
    const scoped=await companyScope(tx,actor,companyCode,"accounts.opening.manage"),companyId=scoped.id;
    await ledgerLock(tx,companyId);
    await authorize(tx,actor,companyId,"accounts.opening.manage");
    const state=await openingState(tx,companyId),{company}=state;
    if(company.booksOpenedAt)throw new AppError(409,"Guided opening is permanently locked after books are declared open; use normal controlled reversals, never guided edits");
    if((input as any)?.operation==="post")return postOpening(tx,actor,companyId,input);
    const data=openingOperationSchema.parse(input);
    if(data.operation==="configure") {
      if(!state.publicState.canConfigure)throw new AppError(409,"Go-live cannot change after posting or any opening capture");
      const date=dateOnly(data.goLiveDate);
      if(!state.publicState.periods.some(p=>p.startDate.getTime()===date.getTime()))
        throw new AppError(400,"Choose the first day of an existing open financial period");
      const invalid=await Promise.all([
        tx.invoice.count({where:{companyId,deletedAt:null,openingRecordId:null,date:{lt:date}}}),
        tx.bill.count({where:{companyId,deletedAt:null,openingRecordId:null,date:{lt:date}}}),
        tx.payment.count({where:{companyId,deletedAt:null,date:{lt:date}}}),
        tx.journalEntry.count({where:{companyId,deletedAt:null,date:{lt:date}}})]);
      if(invalid.some(Boolean))throw new AppError(409,"This go-live date would invalidate existing draft dates; correct/archive those drafts through their normal controls first");
      const after=await tx.company.update({where:{id:companyId},data:{goLiveDate:date,updatedBy:actor.id}});
      await audit(tx,actor,companyId,"CONFIGURE_GO_LIVE","companies",companyId,company,after);return after;
    }
    if(!company.goLiveDate)throw new AppError(400,"Configure go-live before reviewing or posting any opening");
    if(state.ordinary)throw new AppError(409,state.publicState.blockers[0]);
    if(data.operation==="cancel-staged") {
      const queue=state.stagedImports.find(q=>q.id===data.id);
      if(!queue||queue.status!=="STAGED")throw new AppError(404,"Uncancelled staged opening amount not found in this company");
      if(queue.remaining!==queue.amount)throw new AppError(409,"Reverse its posted opening documents through normal controls before cancelling staged import evidence");
      const after=await tx.openingStagedAmount.update({where:{id:queue.id,companyId},data:{status:"CANCELLED",cancelReason:data.reason}});
      await audit(tx,actor,companyId,"CANCEL_STAGED","opening_staged_amounts",queue.id,queue,after);return after;
    }
    if(data.operation==="reopen-review") {
      const review=state.reviews.find(r=>r.stage===data.stage);
      if(!review)throw new AppError(409,"This stage has not been reviewed");
      const after=await tx.openingReview.update({where:{companyId_stage:{companyId,stage:data.stage}},data:{
        fingerprint:openingHash({reopened:randomUUID()}),reason:data.reason,reviewedBy:actor.id,reviewedAt:new Date(),
        evidence:{reopened:true,reason:data.reason,previousFingerprint:review.fingerprint}}});
      await audit(tx,actor,companyId,"REOPEN_REVIEW","opening_reviews",review.id,review,after);return after;
    }
    if(data.operation==="review") {
      if(state.publicState.nextStage!==data.stage)throw new AppError(409,`Review stages in order; the current stage is ${state.publicState.nextStage}`);
      if(data.stage==="CASH"||data.stage==="BANK") {
        const missing=state.publicState.accounts[data.stage==="CASH"?"cash":"bank"].filter(a=>!a.captured);
        if(missing.length)throw new AppError(409,`Enter actual balances, including explicit zero, for: ${missing.map(a=>`${a.code} ${a.name}`).join(", ")}`);
      }
      if(data.stage==="RECEIVABLES"||data.stage==="PAYABLES") {
        const side=data.stage==="RECEIVABLES"?"RECEIVABLE":"PAYABLE";
        const missing=state.stagedImports.filter(q=>q.side===side&&q.status==="STAGED"&&q.remaining!=="0.0000");
        if(missing.length)throw new AppError(409,`Unposted imported balances remain: ${missing.map(q=>`${q.partyName} (${q.remaining})`).join(", ")}`);
      }
      if(data.stage==="STOCK") {
        const required=company.businessType==="RETAIL"?state.publicState.outlets.map(o=>o.id).sort():[];
        const ids=data.locationIds??[];
        if(new Set(ids).size!==ids.length||ids.slice().sort().join(",")!==required.join(","))
          throw new AppError(400,"Deliberately review every active retail location, including locations with no opening stock; use only this company's location ids");
      }
      if(data.stage==="JOURNAL"&&state.publicState.reconciliation.openingEquityBalance!=="0.0000")
        throw new AppError(409,`Opening equity remains ${state.publicState.reconciliation.openingEquityBalance}. Reconcile ${state.publicState.reconciliation.unmatched.map(a=>`${a.code} ${a.name}: ${a.balance}`).join("; ")} before reviewing the final stage`);
      const before=state.reviews.find(r=>r.stage===data.stage);
      const values={reason:data.reason,fingerprint:state.stageFingerprints[data.stage],reviewedBy:actor.id,reviewedAt:new Date(),
        evidence:{goLiveDate:company.goLiveDate.toISOString().slice(0,10),
          recordIds:state.records.filter(r=>r.stage===data.stage).map(r=>r.id),locationIds:data.locationIds??[]}};
      const after=await tx.openingReview.upsert({where:{companyId_stage:{companyId,stage:data.stage}},
        create:{companyId,stage:data.stage,...values},update:values});
      await audit(tx,actor,companyId,"REVIEW","opening_reviews",after.id,before??null,after);return after;
    }
    if(state.publicState.nextStage!=="READY"||state.publicState.reconciliation.openingEquityBalance!=="0.0000")
      throw new AppError(409,"All six ordered stages must be reviewed against current evidence and opening equity must be exactly zero at go-live");
    const documents=state.records.flatMap(r=>[...r.receivables.map(d=>d.id),...r.payables.map(d=>d.id)]);
    const pending=await tx.approval.count({where:{companyId,status:"PENDING",deletedAt:null,OR:[
      {docType:"OPENING",docId:{in:state.records.map(r=>r.id)}},{docType:{in:["INVOICE","BILL"]},docId:{in:documents}}]}});
    if(pending)throw new AppError(409,"Resolve or withdraw pending opening cancellation approvals before declaring books open");
    for(const [id,type] of [[state.s.openingEquityAccountId,"EQUITY"],[state.s.receivableAccountId,"ASSET"],[state.s.payableAccountId,"LIABILITY"]]) {
      if(!state.accounts.some(a=>a.id===id&&a.active&&!a.deletedAt&&!a.isGroup&&!a.isCash&&!a.isBank&&a.type===type))
        throw new AppError(409,"Opening, receivable and payable control mappings must be active posting accounts of the correct type");
    }
    await openFiscal(tx,companyId,company.goLiveDate);
    const lockDate=new Date(company.goLiveDate);lockDate.setUTCDate(lockDate.getUTCDate()-1);
    if(company.lockDate&&company.lockDate>lockDate)throw new AppError(409,"An existing accounting lock is later than the opening lock; declaration cannot silently move it backwards");
    const after=await tx.company.update({where:{id:companyId,booksOpenedAt:null},data:{booksOpenedAt:new Date(),booksOpenedBy:actor.id,
      lockDate,updatedBy:actor.id,booksOpenEvidence:{version:1,goLiveDate:company.goLiveDate.toISOString().slice(0,10),
        reviewIds:openingStages.map(k=>state.reviews.find(r=>r.stage===k)!.id),fingerprints:state.stageFingerprints,openingEquityBalance:"0.0000"}}});
    await audit(tx,actor,companyId,"DECLARE_BOOKS","companies",companyId,company,after);return after;
  },{timeout:60000,maxWait:30000});
}
export async function requestOpeningReversal(actor:Actor,companyCode:string,input:unknown) {
  const data=z.object({id:z.uuid(),operation:z.literal("cancel"),note:openingReason}).strict().parse(input);
  return db.$transaction(async tx=>{
    const c=await companyScope(tx,actor,companyCode,"accounts.opening.manage");
    await ledgerLock(tx,c.id);await authorize(tx,actor,c.id,"accounts.opening.manage");
    const target=await tx.openingRecord.findFirst({where:{id:data.id,companyId:c.id,status:"POSTED"}});
    if(!target)throw new AppError(404,"Uncancelled opening document not found in this company");
    const rule=await approvalRule(tx,c.id,"opening-documents","cancel",target);
    if(!rule)throw new AppError(409,"Configure an active independent document-cancellation approval rule before reversing an opening");
    await openFiscal(tx,c.id,await openingReversalDate(tx,c.id));
    return requestApproval(tx,actor,c.id,"opening-documents","cancel",target,data.note,rule);
  },{timeout:60000,maxWait:30000});
}
/** Called only by the shared independent-approval decision transaction. */
export async function executeOpeningReversal(tx:Tx,actor:Actor,companyId:string,id:string,note:string) {
  await authorize(tx,actor,companyId,"accounts.opening.manage");
  const before=await tx.openingRecord.findFirst({where:{id,companyId,status:"POSTED"}});
  if(!before)throw new AppError(409,"Opening document is no longer an uncancelled posting");
  if(before.stage==="RECEIVABLES"||before.stage==="PAYABLES") {
    const invoice=before.stage==="RECEIVABLES",model:any=invoice?tx.invoice:tx.bill;
    const document=await model.findFirstOrThrow({where:{companyId,openingRecordId:id}});
    await cancelDocument(tx,actor,companyId,invoice?"invoices":"bills",document.id,note,"accounts.opening.manage");
    return tx.openingRecord.findUniqueOrThrow({where:{id,companyId}});
  }
  const date=await openingReversalDate(tx,companyId);
  await openFiscal(tx,companyId,date);
  const reversal=before.entryId?await reverseEntry(tx,actor,companyId,before.entryId,date,note,"accounts.opening.manage"):null;
  const after=await tx.openingRecord.update({where:{id,companyId},data:{status:"CANCELLED",reversalEntryId:reversal?.id??null,
    cancelReason:note,updatedBy:actor.id,version:{increment:1}}});
  await audit(tx,actor,companyId,"CANCEL","opening_records",id,before,after);return after;
}
