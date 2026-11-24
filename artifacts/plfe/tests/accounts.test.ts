import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import {db} from "../lib/db";
import {saveRecord} from "../modules/core/service";
import {saveAccountRecord} from "../modules/accounts/service";
import {getAccountRecord,listAccounts} from "../modules/accounts/queries";
import {accountsReport,accountsOverview} from "../modules/accounts/reports";
import {postDocument} from "../modules/accounts/documents";
import {ledgerLock} from "../modules/accounts/model";
import {seedDemoBooks} from "../modules/accounts/demo";
import {initializeAccounts} from "../modules/accounts/bootstrap";
import {chartTemplate} from "../modules/accounts/template";
import {accountsFixture} from "./helpers/accounts-fixture";
let f:Awaited<ReturnType<typeof accountsFixture>>;
const denied=(e:any)=>e.status===403;
before(async()=>{f=await accountsFixture();});
after(async()=>{await db.$disconnect();});
const invoice=(rate="10.0000")=>saveAccountRecord(f.owner,f.a,"invoices",{partyId:f.demo.customerId,date:f.date,dueDate:f.date,lines:[{accountId:f.account("4100").id,description:"Automated acceptance charge",qty:"1.0000",rate}]});

test("Build order: twenty mixed posted documents per company and matching trial balance",async()=>{
  for(const [code,cid] of [[f.a,f.first.id],[f.b,f.second.id]]) {
    assert.equal(await db.journalEntry.count({where:{companyId:cid,status:"POSTED"}}),20);
    const report=await accountsReport(f.owner,code,"trial-balance",{pageSize:"500"});
    assert.equal(report.summary.balanced,true);
    assert.equal(report.summary.debit,report.summary.credit);
    assert.equal(report.summary.balance,"0.0000");
  }
  assert.equal(await db.account.count({where:{companyId:f.first.id,counterpartyCompanyId:null}}),chartTemplate("EVENTS").length);
  const other=await db.account.findFirstOrThrow({where:{companyId:f.second.id,code:"4100"}});
  assert.notEqual(other.id,f.account("4100").id);
});
test("Explicit demo and chart seeds are idempotent without duplicate postings",async()=>{
  await seedDemoBooks(f.owner,f.a);
  await db.$transaction(tx=>initializeAccounts(tx,f.owner,f.first.id));
  assert.equal(await db.journalEntry.count({where:{companyId:f.first.id,status:"POSTED"}}),20);
  assert.equal(await db.account.count({where:{companyId:f.first.id,counterpartyCompanyId:null}}),chartTemplate("EVENTS").length);
});
test("Part-paid invoices, split receipts and later advance applications are exact",async()=>{
  const doc=await getAccountRecord(f.owner,f.a,"invoices",f.demo.partPaidInvoiceId);
  assert.equal(doc.total,"100000");assert.equal(doc.paid,"40000.0000");assert.equal(doc.outstanding,"60000.0000");assert.equal(doc.settlementStatus,"PART_PAID");
  const advanced=await getAccountRecord(f.owner,f.a,"payments",f.demo.advancePaymentId);
  assert.equal(advanced.advance,"0.0000");
  const party=await accountsReport(f.owner,f.a,"party-ledger",{partyId:f.demo.customerId});
  assert.equal(party.summary.closingBalance,"117500.0000");
});
test("Deferred database trigger rejects unequal debit/credit at COMMIT, not only in app code",async()=>{
  let reachedCommit=false;const id=randomUUID();
  await assert.rejects(()=>db.$transaction(async tx=>{
    await tx.journalEntry.create({data:{id,companyId:f.first.id,journalId:f.journal.id,date:new Date(f.date),sourceType:"DATABASE_TEST",sourceId:id}});
    await tx.journalLine.createMany({data:[
      {companyId:f.first.id,entryId:id,accountId:f.account("1201").id,lineNo:1,debit:"10.0000",credit:"0.0000"},
      {companyId:f.first.id,entryId:id,accountId:f.account("3990").id,lineNo:2,debit:"0.0000",credit:"9.0000"}
    ]});
    await tx.journalEntry.update({where:{id,companyId:f.first.id},data:{status:"POSTED",fiscalYearId:f.fiscal.id,number:`DB-${id}`}});
    reachedCommit=true;
  }),(e:any)=>String(e.message).includes("does not balance"));
  assert.equal(reachedCommit,true);
  assert.equal(await db.journalEntry.count({where:{id,companyId:f.first.id}}),0);
});
test("Database rejects an empty posted parent and preserves all dimension columns",async()=>{
  await assert.rejects(()=>db.journalEntry.create({data:{companyId:f.first.id,journalId:f.journal.id,date:new Date(f.date),sourceType:"DATABASE_TEST",sourceId:randomUUID(),status:"POSTED",number:`EMPTY-${randomUUID()}`,fiscalYearId:f.fiscal.id}}));
  const columns:any[]=await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name='journal_lines' AND column_name IN ('event_id','outlet_id','department_id')`;
  assert.equal(columns.length,3);
});
test("Posted entries and lines cannot be changed, deleted, soft-deleted or truncated",async()=>{
  const doc=await db.invoice.findFirstOrThrow({where:{companyId:f.first.id,id:f.demo.partPaidInvoiceId}});
  const entry=await db.journalEntry.findFirstOrThrow({where:{companyId:f.first.id,id:doc.entryId!},include:{lines:true}});
  for(const action of [
    ()=>db.journalEntry.update({where:{id:entry.id,companyId:f.first.id},data:{narration:"Tampered"}}),
    ()=>db.journalEntry.update({where:{id:entry.id,companyId:f.first.id},data:{deletedAt:new Date()}}),
    ()=>db.journalEntry.delete({where:{id:entry.id,companyId:f.first.id}}),
    ()=>db.journalLine.update({where:{id:entry.lines[0]!.id,companyId:f.first.id},data:{memo:"Tampered"}}),
    ()=>db.journalLine.delete({where:{id:entry.lines[0]!.id,companyId:f.first.id}}),
    ()=>db.journalLine.create({data:{companyId:f.first.id,entryId:entry.id,accountId:f.account("1201").id,lineNo:99,debit:"1.0000",credit:"0.0000"}}),
    ()=>db.$executeRawUnsafe("TRUNCATE journal_lines"),
    ()=>db.$executeRawUnsafe("TRUNCATE journal_entries CASCADE")
  ])await assert.rejects(action);
});
test("Company scope protects lists, details, exports, reports, mutations and foreign IDs",async()=>{
  for(const action of [
    ()=>listAccounts(f.viewer,f.b,"invoices",{}),
    ()=>listAccounts(f.viewer,f.b,"invoices",{},true),
    ()=>getAccountRecord(f.viewer,f.b,"invoices",f.otherDemo.partPaidInvoiceId),
    ()=>accountsReport(f.viewer,f.b,"trial-balance",{}),
    ()=>accountsOverview(f.viewer,f.b),
    ()=>saveAccountRecord(f.approver,f.b,"parties",{code:"BAD",name:"Forbidden"})
  ])await assert.rejects(action,denied);
  await assert.rejects(()=>getAccountRecord(f.owner,f.a,"invoices",f.otherDemo.partPaidInvoiceId),(e:any)=>e.status===404);
  await assert.rejects(()=>accountsReport(f.owner,f.a,"party-ledger",{partyId:f.otherDemo.customerId}),(e:any)=>e.status===404);
  await assert.rejects(()=>saveAccountRecord(f.gate,f.a,"chart",{code:"BAD",name:"Forbidden",type:"ASSET"}),denied);
  await assert.rejects(()=>listAccounts(f.gate,f.a,"invoices",{}),denied);
});
test("Composite accounting foreign keys reject another company's account",async()=>{
  const account=await db.account.findFirstOrThrow({where:{companyId:f.second.id,code:"1201"}});
  await assert.rejects(()=>db.$transaction(async tx=>{
    const id=randomUUID();
    await tx.journalEntry.create({data:{id,companyId:f.first.id,journalId:f.journal.id,date:new Date(f.date),sourceType:"FK_TEST",sourceId:id}});
    await tx.journalLine.create({data:{companyId:f.first.id,entryId:id,accountId:account.id,lineNo:1,debit:"1.0000",credit:"0.0000"}});
  }));
});
test("Concurrent document posting never repeats document or journal numbers",async()=>{
  const drafts=await Promise.all(Array.from({length:12},()=>invoice("1.0000")));
  const posted=await Promise.all(drafts.map(d=>saveAccountRecord(f.owner,f.a,"invoices",{operation:"post",id:d.id})));
  assert.equal(new Set(posted.map(d=>d.number)).size,12);
  const entries=await db.journalEntry.findMany({where:{companyId:f.first.id,id:{in:posted.map(d=>d.entryId)}}});
  assert.equal(new Set(entries.map(e=>e.number)).size,12);
});
test("A failed document transaction rolls back entry, number and audit together",async()=>{
  const doc=await invoice();
  const sequence=await db.sequence.findFirstOrThrow({where:{companyId:f.first.id,docType:"INV",fiscalYearId:f.fiscal.id}});
  const auditCount=await db.auditLog.count({where:{companyId:f.first.id}});
  await assert.rejects(()=>db.$transaction(async tx=>{
    await ledgerLock(tx,f.first.id);
    await postDocument(tx,f.owner,f.first.id,"invoices",doc.id,"accounts.invoice.post");
    throw new Error("Intentional transaction rollback");
  }));
  assert.equal((await db.sequence.findFirstOrThrow({where:{companyId:f.first.id,id:sequence.id}})).nextNumber,sequence.nextNumber);
  assert.equal(await db.journalEntry.count({where:{companyId:f.first.id,sourceId:doc.id}}),0);
  assert.equal(await db.auditLog.count({where:{companyId:f.first.id}}),auditCount);
  assert.equal((await getAccountRecord(f.owner,f.a,"invoices",doc.id)).status,"DRAFT");
});
test("Build order: cancelling an invoice retains the original and posts one exact reversal",async()=>{
  const original=await db.invoice.findFirstOrThrow({where:{companyId:f.first.id,id:f.demo.cancellationInvoiceId}});
  const entry=await db.journalEntry.findFirstOrThrow({where:{companyId:f.first.id,id:original.entryId!},include:{lines:{orderBy:{lineNo:"asc"}}}});
  const request=await saveAccountRecord(f.owner,f.a,"invoices",{operation:"cancel",id:original.id,note:"TEST-P2 cancellation acceptance"});
  assert.equal(request.approvalRequested,true);
  await assert.rejects(()=>saveRecord(f.owner,f.a,"approvals",{id:request.approvalId,operation:"approve"}),denied);
  const decisions=await Promise.allSettled([1,2].map(()=>saveRecord(f.approver,f.a,"approvals",{id:request.approvalId,operation:"approve"})));
  assert.equal(decisions.filter(r=>r.status==="fulfilled").length,1);
  const cancelled=await getAccountRecord(f.owner,f.a,"invoices",original.id);
  assert.equal(cancelled.settlementStatus,"CANCELLED");
  assert.equal(cancelled.status,"CANCELLED");assert.equal(cancelled.entryId,original.entryId);assert.ok(cancelled.reversalEntryId);
  const originalAfter=await db.journalEntry.findFirstOrThrow({where:{companyId:f.first.id,id:entry.id},include:{lines:{orderBy:{lineNo:"asc"}}}});
  assert.deepEqual(originalAfter,entry);
  const reversals=await db.journalEntry.findMany({where:{companyId:f.first.id,reversalOfId:entry.id},include:{lines:{orderBy:{lineNo:"asc"}}}});
  assert.equal(reversals.length,1);assert.equal(reversals[0]!.date.toISOString().slice(0,10),f.date);
  entry.lines.forEach((line,i)=>{assert.ok(line.debit.eq(reversals[0]!.lines[i]!.credit));assert.ok(line.credit.eq(reversals[0]!.lines[i]!.debit));assert.equal(line.departmentId,reversals[0]!.lines[i]!.departmentId);});
  assert.equal((await accountsReport(f.owner,f.a,"trial-balance",{})).summary.balanced,true);
});
test("High-value payments and voucher outflows require independent approval",async()=>{
  const payment=await saveAccountRecord(f.owner,f.a,"payments",{direction:"PAYMENT",method:"BANK",partyId:f.demo.supplierId,date:f.date,settlementAccountId:f.account("1201").id,amount:"500001.0000"});
  const request=await saveAccountRecord(f.owner,f.a,"payments",{operation:"post",id:payment.id});
  assert.equal(request.approvalRequested,true);
  assert.equal(await db.journalEntry.count({where:{companyId:f.first.id,sourceId:payment.id}}),0);
  await saveRecord(f.approver,f.a,"approvals",{id:request.approvalId,operation:"approve"});
  assert.equal((await getAccountRecord(f.owner,f.a,"payments",payment.id)).status,"POSTED");
  const voucher=await saveAccountRecord(f.owner,f.a,"entries",{kind:"BANK",journalId:f.journal.id,date:f.date,lines:[{accountId:f.account("5100").id,debit:"500001.0000",credit:"0.0000"},{accountId:f.account("1201").id,debit:"0.0000",credit:"500001.0000"}]});
  assert.equal((await saveAccountRecord(f.owner,f.a,"entries",{operation:"post",id:voucher.id})).approvalRequested,true);
});
test("Over-allocation rolls back and applying an advance never edits the posted entry",async()=>{
  const payment=await db.payment.findFirstOrThrow({where:{companyId:f.first.id,narration:"TEST-P2/CORRECTED/11-receipt-with-advance"}});
  const old=await db.paymentAllocation.findMany({where:{companyId:f.first.id,paymentId:payment.id,deletedAt:null}});
  const entry=await db.journalEntry.findFirstOrThrow({where:{companyId:f.first.id,id:payment.entryId!}});
  const draft=await invoice("6000.0000");await saveAccountRecord(f.owner,f.a,"invoices",{operation:"post",id:draft.id});
  await assert.rejects(()=>saveAccountRecord(f.owner,f.a,"payments",{operation:"allocate",id:payment.id,allocations:[...old.map(a=>({invoiceId:a.invoiceId,amount:a.amount.toFixed(4)})),{invoiceId:draft.id,amount:"6000.0000"}]}),(e:any)=>e.status===400);
  assert.deepEqual(await db.paymentAllocation.findMany({where:{companyId:f.first.id,paymentId:payment.id,deletedAt:null}}),old);
  await saveAccountRecord(f.owner,f.a,"payments",{operation:"allocate",id:payment.id,allocations:[...old.map(a=>({invoiceId:a.invoiceId,amount:a.amount.toFixed(4)})),{invoiceId:draft.id,amount:"5000.0000"}]});
  assert.equal((await getAccountRecord(f.owner,f.a,"invoices",draft.id)).outstanding,"1000.0000");
  assert.deepEqual(await db.journalEntry.findFirstOrThrow({where:{companyId:f.first.id,id:entry.id}}),entry);
});
test("Money rejects JavaScript-number input and preserves four-decimal arithmetic",async()=>{
  await assert.rejects(()=>invoice(0.1 as any));
  const doc=await invoice("0.1001");await saveAccountRecord(f.owner,f.a,"invoices",{operation:"post",id:doc.id});
  assert.equal((await getAccountRecord(f.owner,f.a,"invoices",doc.id)).outstanding,"0.1001");
});
test("Every posted entry has a transactional audit record",async()=>{
  const entries=await db.journalEntry.findMany({where:{companyId:f.first.id,status:"POSTED"},select:{id:true}});
  const logs=await db.auditLog.findMany({where:{companyId:f.first.id,tableName:"journal_entries",action:{in:["POST","REVERSE"]},recordId:{in:entries.map(e=>e.id)}}});
  assert.equal(new Set(logs.map(l=>l.recordId)).size,entries.length);
});
test("Only the shared posting directory writes journal lines",async()=>{
  async function scan(dir:string):Promise<string[]> {
    const found:string[]=[];
    for(const item of await readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,item.name);
      if(item.isDirectory())found.push(...await scan(file));
      else if(/\.tsx?$/.test(file)&&/journalLine\.(create|createMany|update|updateMany|delete|deleteMany)\s*\(/.test(await readFile(file,"utf8")))found.push(file);
    }
    return found;
  }
  assert.deepEqual(await scan("modules"),[]);
});
