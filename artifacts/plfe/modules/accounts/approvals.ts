import {randomUUID} from "node:crypto";
import {audit,redact} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import type {Actor} from "@/modules/core/model";
import type {Tx} from "./model";
import {zero} from "./balances";

export async function approvalRule(tx:Tx,companyId:string,resource:string,operation:string,target:any) {
  let amount=target.amount;
  if(operation==="post") {
    if(resource==="entries") {
      const lines=await tx.journalLine.findMany({where:{companyId,entryId:target.id,deletedAt:null,account:{companyId,OR:[{isBank:true},{isCash:true}]}},select:{debit:true,credit:true}});
      amount=lines.reduce((total,l)=>total.add(l.credit).sub(l.debit),zero());
      if(!amount.gt("0"))return null;
    } else if(resource!=="payments"||target.direction!=="PAYMENT")return null;
  }
  if(!["cancel","post"].includes(operation))return null;
  const rule=await tx.approvalRule.findFirst({where:{companyId,docType:operation==="cancel"?"DOCUMENT":"PAYMENT",action:operation,active:true,deletedAt:null}});
  if(!rule)return null;
  return operation==="cancel"||!rule.thresholdAmount||amount.gt(rule.thresholdAmount)?rule:null;
}
export async function requestApproval(tx:Tx,actor:Actor,companyId:string,resource:string,operation:string,target:any,note:string,rule:any) {
  const docType=({invoices:"INVOICE",bills:"BILL",payments:"PAYMENT",entries:"ENTRY","opening-documents":"OPENING",
    "cash-counts":"CASH_COUNT",intercompany:"INTERCOMPANY"} as Record<string,string>)[resource];
  if(!docType)throw new AppError(400,"Unsupported financial approval source");
  const existing=await tx.approval.findFirst({where:{companyId,docType,docId:target.id,action:operation,status:"PENDING",deletedAt:null}});
  if(existing&&existing.targetVersion!==target.version)throw new AppError(409,"Withdraw the stale approval request and submit it again");
  let approval=existing;
  if(!approval) {
    approval=await tx.approval.create({data:{companyId,ruleId:rule.id,docType,docId:target.id,action:operation,operationKey:randomUUID(),requestedBy:actor.id,requestNote:note,requestData:{resource,operation,note},targetVersion:target.version,ruleSnapshot:redact(rule),createdBy:actor.id,updatedBy:actor.id}});
    await audit(tx,actor,companyId,"APPROVAL_REQUEST","approvals",approval.id,null,approval);
  }
  return {id:target.id,approvalRequested:true,approvalId:approval.id,message:"Independent approval requested. The document has not changed yet."};
}
