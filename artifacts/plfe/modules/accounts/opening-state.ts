import {createHash} from "node:crypto";
import {Prisma} from "@prisma/client";
import {db} from "@/lib/db";
import {redact} from "@/lib/audit";
import {companyScope} from "@/lib/permissions";
import type {Actor} from "@/modules/core/model";
import {settings,type Tx} from "./model";
import {zero} from "./balances";

export const openingStages=["CASH","BANK","RECEIVABLES","PAYABLES","STOCK","JOURNAL"] as const;
export type OpeningStage=typeof openingStages[number];
export const openingSeries={CASH:"OCA",BANK:"OBK",RECEIVABLES:"ORI",PAYABLES:"OPB",STOCK:"OST",JOURNAL:"OPJ"} as const;
// PostgreSQL JSONB reorders object keys. Evidence hashes must not depend on JS
// insertion order or change merely because a validated payload was persisted.
export const openingHash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value,(_key,v)=>
  v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v)).digest("hex");
const labels={CASH:"Cash balances",BANK:"Bank statements",RECEIVABLES:"Opening receivables",PAYABLES:"Opening payables",STOCK:"Physical stock",JOURNAL:"Capital and other opening balances"};

export async function openingState(tx:Tx,companyId:string) {
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId}});
  const s=await settings(tx,companyId);
  const accounts=await tx.account.findMany({where:{companyId},orderBy:{code:"asc"}});
  const parties=await tx.party.findMany({where:{companyId,deletedAt:null,active:true},orderBy:{code:"asc"}});
  const outlets=await tx.outlet.findMany({where:{companyId},orderBy:{code:"asc"},include:{accounts:true}});
  const records=await tx.openingRecord.findMany({where:{companyId},orderBy:{createdAt:"asc"},
    include:{account:true,party:true,outlet:true,receivables:{select:{id:true}},payables:{select:{id:true}}}});
  const reviews=await tx.openingReview.findMany({where:{companyId},orderBy:{stage:"asc"}});
  const queues=await tx.openingStagedAmount.findMany({where:{companyId},include:{party:true},orderBy:{createdAt:"asc"}});
  const posted=records.filter(r=>r.status==="POSTED");
  const stagedImports=queues.map(q=>{
    const used=posted.filter(r=>r.stagedImportId===q.id).reduce((v,r)=>v.add(r.amount),zero());
    return {...q,partyName:q.party.name,remaining:q.status==="CANCELLED"?"0.0000":q.amount.sub(used).toFixed(4),amount:q.amount.toFixed(4)};
  });
  const active=(a:any)=>a.active&&!a.deletedAt&&!a.isGroup&&(!a.outletId||outlets.some(o=>o.id===a.outletId&&o.active&&!o.deletedAt));
  const cash=accounts.filter(a=>active(a)&&a.isCash),bank=accounts.filter(a=>active(a)&&a.isBank);
  // Inventory parents have the agreed chart meaning; permanent outlet links also
  // identify them if a chart label/code has subsequently changed.
  const inventoryParents=new Set(accounts.filter(a=>a.code==="1700"&&a.isGroup).map(a=>a.id));
  for(const o of outlets)for(const a of o.accounts)if(!a.isCash&&!a.isBank&&a.parentId)inventoryParents.add(a.parentId);
  function inventory(a:any) {
    const seen=new Set<string>();
    while(a&&!seen.has(a.id)) {if(inventoryParents.has(a.id))return true;seen.add(a.id);a=accounts.find(p=>p.id===a.parentId);}
    return false;
  }
  const journal=accounts.filter(a=>active(a)&&!a.isCash&&!a.isBank&&!a.outletId&&!a.counterpartyCompanyId&&!inventory(a)&&
    ["ASSET","LIABILITY","EQUITY"].includes(a.type)&&![s.receivableAccountId,s.payableAccountId,s.openingEquityAccountId].includes(a.id));
  const balances=await tx.$queryRaw<{accountId:string;code:string;name:string;debit:Prisma.Decimal;credit:Prisma.Decimal;balance:Prisma.Decimal}[]>`
    SELECT a.id AS "accountId",a.code,a.name,sum(l.debit) AS debit,sum(l.credit) AS credit,sum(l.debit-l.credit) AS balance
    FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
    JOIN accounts a ON a.id=l.account_id AND a.company_id=l.company_id
    WHERE l.company_id=${companyId}::uuid AND e.status='POSTED' AND e.deleted_at IS NULL AND l.deleted_at IS NULL
      AND (${company.goLiveDate}::date IS NULL OR e.date<=${company.goLiveDate}::date)
    GROUP BY a.id,a.code,a.name ORDER BY a.code`;
  const equity=balances.find(a=>a.accountId===s.openingEquityAccountId)?.balance??zero();
  const anyPosting=await tx.journalEntry.findFirst({where:{companyId,status:"POSTED"},select:{id:true}});
  const ordinary=await tx.journalEntry.count({where:{companyId,status:"POSTED",deletedAt:null,
    sourceType:{notIn:["GUIDED_OPENING","REVERSAL"]},reversals:{none:{companyId,status:"POSTED"}},
    invoices:{none:{companyId,openingRecordId:{not:null}}},bills:{none:{companyId,openingRecordId:{not:null}}}}});
  const stageFingerprints:Record<string,string>={},stages:any[]=[];
  let prior=true;
  for(const [index,key] of openingStages.entries()) {
    const review=reviews.find(r=>r.stage===key);
    const relevantAccounts=key==="CASH"?cash:key==="BANK"?bank:key==="JOURNAL"?journal:[];
    const context={goLiveDate:company.goLiveDate,businessType:company.businessType,settings:s,
      records:records.filter(r=>r.stage===key).map(r=>({id:r.id,status:r.status,version:r.version})),
      accounts:relevantAccounts.map(a=>({id:a.id,updatedAt:a.updatedAt})),
      outlets:key==="STOCK"?outlets.filter(o=>o.active&&!o.deletedAt).map(o=>({id:o.id,updatedAt:o.updatedAt})):[],
      parties:["RECEIVABLES","PAYABLES"].includes(key)?parties.map(p=>({id:p.id,updatedAt:p.updatedAt})):[],
      staged:stagedImports.filter(q=>q.side===(key==="RECEIVABLES"?"RECEIVABLE":key==="PAYABLES"?"PAYABLE":"")).map(q=>({id:q.id,status:q.status,remaining:q.remaining})),
      prerequisites:openingStages.slice(0,index).map(stage=>reviews.find(r=>r.stage===stage)).map(r=>r?{id:r.id,fingerprint:r.fingerprint,reviewedAt:r.reviewedAt}:null)};
    const fp=openingHash(context);stageFingerprints[key]=fp;
    const valid:boolean=prior&&review?.fingerprint===fp;
    stages.push({key,label:labels[key],reviewed:!!valid,reviewedAt:review?.reviewedAt??null,
      reason:valid?review!.reason:review?"Configuration or opening evidence changed; review this stage again":null,current:false});
    prior=!!valid;
  }
  const nextStage=company.booksOpenedAt?"OPEN":stages.find(stage=>!stage.reviewed)?.key??"READY";
  stages.forEach(stage=>{stage.current=stage.key===nextStage;});
  const capture=(list:typeof accounts)=>list.map(a=>{
    const r=posted.find(r=>r.accountId===a.id&&["CASH","BANK"].includes(r.stage));
    return {...a,captured:!!r,recordId:r?.id??null,openingBalance:r?.amount.toFixed(4)??null};
  });
  const ledger=balances.map(a=>({...a,debit:a.debit.toFixed(4),credit:a.credit.toFixed(4),balance:a.balance.toFixed(4)}));
  const publicState={company,canConfigure:!company.booksOpenedAt&&!anyPosting&&!records.length,
    periods:await tx.period.findMany({where:{companyId,isClosed:false,deletedAt:null,fiscalYear:{companyId,isClosed:false,deletedAt:null}},orderBy:{startDate:"asc"},select:{id:true,name:true,startDate:true}}),
    nextStage,stages,accounts:{cash:capture(cash),bank:capture(bank),journal},parties,
    outlets:outlets.filter(o=>o.active&&!o.deletedAt).map(({accounts,...o})=>o),
    records:records.map(({receivables,payables,...r})=>({...r,amount:r.amount.toFixed(4),quantity:r.quantity?.toFixed(4)??null,
      unitCost:r.unitCost?.toFixed(4)??null,invoiceId:receivables[0]?.id??null,billId:payables[0]?.id??null})),
    stagedImports,reconciliation:{openingEquityBalance:equity.toFixed(4),accounts:ledger,
      unmatched:equity.eq("0")?[]:ledger.filter(a=>a.accountId!==s.openingEquityAccountId&&a.balance!=="0.0000")},
    blockers:ordinary?["Ordinary posted financial documents exist. Guided opening requires them to be reversed through normal controls first."]:[]};
  return {company,s,accounts,parties,outlets,records,reviews,stageFingerprints,stagedImports,ordinary,publicState};
}
export async function openingOverview(actor:Actor,companyCode:string) {
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,companyCode,"accounts.opening.manage");
    return redact((await openingState(tx,company.id)).publicState);
  },{isolationLevel:"RepeatableRead",timeout:30000});
}
