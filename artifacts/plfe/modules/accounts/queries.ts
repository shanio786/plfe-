import {db} from "@/lib/db";
import {companyScope} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import {redact} from "@/lib/audit";
import {listSchema} from "@/modules/core/schema";
import type {Actor} from "@/modules/core/model";
import {dateOnly,delegate,record,resourceConfig,type Tx} from "./model";
import {outstanding,zero} from "./balances";

const docResources=["invoices","bills","payments","entries"];
function includes(resource:string,detail=false,companyId?:string):any {
  const where={companyId,deletedAt:null};
  if(resource==="chart")return {parent:true,outlet:true};
  if(resource==="outlets")return {accounts:{include:{parent:true},orderBy:{code:"asc"}}};
  if(resource==="invoices"||resource==="bills")return {party:true,...(detail?{original:true,entry:true,reversalEntry:true,lines:{where,orderBy:{lineNo:"asc"},include:{account:true,department:true,outlet:true}},allocations:{where:{...where,payment:{companyId,status:"POSTED",deletedAt:null}},include:{payment:true}}}:{})};
  if(resource==="payments")return {party:true,settlementAccount:true,department:true,outlet:true,...(detail?{entry:true,reversalEntry:true,allocations:{where,include:{invoice:true,bill:true}}}:{})};
  if(resource==="entries")return {journal:true,reversals:{where:{companyId,deletedAt:null}},...(detail?{reversalOf:true,lines:{where,orderBy:{lineNo:"asc"},include:{account:true,party:true,department:true,outlet:true}}}:{})};
  if(resource==="settings")return {receivableAccount:true,payableAccount:true,openingEquityAccount:true,salesJournal:true,purchaseJournal:true,generalJournal:true,cashJournal:true,bankJournal:true};
  return undefined;
}
async function enrich(tx:Tx,companyId:string,resource:string,rows:any[]) {
  const ids=rows.map(r=>r.id);if(!ids.length)return rows;
  if(resource==="invoices"||resource==="bills") {
    const invoice=resource==="invoices";
    const allocationWhere={companyId,deletedAt:null,payment:{companyId,status:"POSTED",deletedAt:null}};
    const allocations:any[]=await (tx.paymentAllocation as any).groupBy({
      by:[invoice?"invoiceId":"billId"],where:{...allocationWhere,...(invoice?{invoiceId:{in:ids}}:{billId:{in:ids}})},_sum:{amount:true}
    });
    const notes:any[]=await delegate(tx,resource).groupBy({by:["originalId"],where:{companyId,originalId:{in:ids},status:"POSTED",deletedAt:null},_sum:{total:true}});
    return rows.map(r=>{
      const paid=allocations.find(a=>a[invoice?"invoiceId":"billId"]===r.id)?._sum.amount??zero();
      const credited=notes.find(n=>n.originalId===r.id)?._sum.total??zero();
      const note=invoice?r.kind==="CREDIT_NOTE":r.kind==="DEBIT_NOTE";
      const balance=r.status==="CANCELLED"||note&&r.status==="POSTED"?zero():r.total.sub(paid).sub(credited);
      return {...r,paid:paid.toFixed(4),credited:credited.toFixed(4),outstanding:balance.toFixed(4),settlementStatus:r.status==="CANCELLED"?"CANCELLED":r.status==="DRAFT"?"DRAFT":note?"APPLIED":balance.eq("0")?"PAID":paid.add(credited).gt("0")?"PART_PAID":"UNPAID"};
    });
  }
  if(resource==="entries") {
    const amounts=await tx.journalLine.groupBy({by:["entryId"],where:{companyId,entryId:{in:ids},deletedAt:null},_sum:{debit:true,credit:true}});
    return rows.map(r=>{const sums=amounts.find(a=>a.entryId===r.id)?._sum;return {...r,totalDebit:(sums?.debit??zero()).toFixed(4),totalCredit:(sums?.credit??zero()).toFixed(4)};});
  }
  if(resource==="payments") {
    const amounts=await tx.paymentAllocation.groupBy({by:["paymentId"],where:{companyId,paymentId:{in:ids},deletedAt:null},_sum:{amount:true}});
    return rows.map(r=>{const allocated=amounts.find(a=>a.paymentId===r.id)?._sum.amount??zero();return {...r,allocated:allocated.toFixed(4),advance:r.amount.sub(allocated).toFixed(4),unallocatedAmount:r.amount.sub(allocated).toFixed(4)};});
  }
  return rows;
}
export async function listAccounts(actor:Actor,code:string,resource:string,raw:Record<string,string>,exporting=false) {
  const cfg=resourceConfig(resource),p=listSchema.parse(raw);
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,code,`accounts.${cfg.object}.read`),companyId=company.id;
    const where:any={companyId,deletedAt:null};
    if(p.search)where.OR=[...cfg.search.map(k=>({[k]:{contains:p.search,mode:"insensitive"}})),...(["invoices","bills","payments"].includes(resource)?[{party:{companyId,name:{contains:p.search,mode:"insensitive"}}}]:[])];
    if(docResources.includes(resource)) {
      if(p.status)where.status=p.status;
      if(raw.partyId)where.partyId=raw.partyId;
      if(raw.kind&&resource!=="payments")where.kind=raw.kind;
      if(raw.paymentDirection&&resource==="payments") {
        if(!["RECEIPT","PAYMENT"].includes(raw.paymentDirection))throw new AppError(400,"Choose receipts, payments, or all directions");
        where.direction=raw.paymentDirection;
      }
      if(raw.outletId) {
        await record(tx,"outlets",companyId,raw.outletId);
        if(resource==="payments")where.outletId=raw.outletId;
        else where.lines={some:{companyId,outletId:raw.outletId,deletedAt:null}};
      }
      if(raw.from||raw.to)where.date={...(raw.from?{gte:dateOnly(raw.from)}:{}),...(raw.to?{lte:dateOnly(raw.to)}:{})};
    } else if(["active","true","inactive","false"].includes((p.status??"").toLowerCase()))where.active=["active","true"].includes((p.status??"").toLowerCase());
    if(resource==="chart"&&raw.parentId)where.parentId=raw.parentId;
    const allowed=["id","createdAt","updatedAt",...(docResources.includes(resource)?["number","date","status",...(resource==="payments"?["amount"]:resource==="entries"?["kind"]:["total","dueDate","kind"])]:["code","name",...(resource==="settings"?[]:["active"]),...(resource==="outlets"?["type","address"]:[])])];
    const sort=allowed.includes(p.sort)?p.sort:"createdAt";
    const model=delegate(tx,resource),total=await model.count({where});
    if(exporting&&total>100000)throw new AppError(400,"Narrow the export to at most 100,000 records");
    const rows=await model.findMany({where,include:includes(resource,false,companyId),orderBy:[{[sort]:p.direction},{id:"asc"}],skip:exporting?0:(p.page-1)*p.pageSize,take:exporting?100000:p.pageSize});
    return redact({rows:await enrich(tx,companyId,resource,rows),total,page:exporting?1:p.page,pageSize:exporting?total:p.pageSize});
  },{timeout:60000});
}
export async function getAccountRecord(actor:Actor,code:string,resource:string,id:string) {
  const cfg=resourceConfig(resource);
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,code,`accounts.${cfg.object}.read`),companyId=company.id;
    const r=resource==="settings"?await tx.accountingSettings.findFirst({where:{companyId,deletedAt:null},include:includes(resource,true,companyId)}):await record(tx,resource,companyId,id,{include:includes(resource,true,companyId)});
    if(!r)throw new AppError(404,"Accounting settings have not been initialized");
    let result=(await enrich(tx,companyId,resource,[r]))[0];
    if(resource==="invoices"||resource==="bills")result={...result,...await outstanding(tx,companyId,resource,r)};
    return redact(result);
  });
}
