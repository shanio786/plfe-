import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {permissionCodes} from "../lib/role-templates";
import {provisionCompany,saveRecord} from "../modules/core/service";
import {saveAccountRecord} from "../modules/accounts/service";
import {getAccountRecord,listAccounts} from "../modules/accounts/queries";
import {accountsReport} from "../modules/accounts/reports";
import {postEntry,reverseEntry} from "../lib/posting";
import {accountingToday} from "../modules/accounts/time";
import {chartTemplate} from "../modules/accounts/template";
import type {Actor} from "../modules/core/model";
import {setupTestTax,testTaxEvidence} from "./helpers/test-tax";

let owner:Actor,viewer:Actor,events:any,retail:any,other:any;
const suffix=randomUUID().slice(0,8).toUpperCase();
const day=accountingToday().toISOString().slice(0,10);
const outlet=(code:string,name=code,type="SHOWROOM")=>saveAccountRecord(owner,events.code,"outlets",{code,name,type,active:true});
before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"));
  owner=await db.user.create({data:{name:"Outlet test Owner",email:`outlet-owner-${suffix.toLowerCase()}@test.invalid`,passwordHash:"no-login-test-identity",isOwner:true,mustChangePassword:false}});
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  events=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`OUT-E-${suffix}`,name:"TEST events outlets",legalName:"TEST events outlets",businessType:"EVENTS"}),{timeout:60000});
  retail=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`OUT-R-${suffix}`,name:"TEST retail outlets",legalName:"TEST retail outlets",businessType:"RETAIL"}),{timeout:60000});
  await setupTestTax(owner,events.code,false);await setupTestTax(owner,retail.code,false);
  viewer=await db.user.create({data:{name:"Outlet scoped viewer",email:`outlet-viewer-${suffix.toLowerCase()}@test.invalid`,passwordHash:"no-login-test-identity",mustChangePassword:false}});
  const role=await db.role.findFirstOrThrow({where:{companyId:events.id,name:"Viewer"}});
  await saveRecord(owner,events.code,"memberships",{userId:viewer.id,roleId:role.id});
  other=await saveAccountRecord(owner,retail.code,"outlets",{code:"OTHER",name:"TEST other-company outlet",type:"COUNTER"});
},{timeout:60000});
after(async()=>db.$disconnect());

test("Templates contain no outlet accounts or predefined names/counts",async()=>{
  for(const kind of ["EVENTS","RETAIL"]) {
    const rows=chartTemplate(kind);
    assert.ok(rows.some(([code,,, ,flag])=>code==="1100"&&flag==="group"));
    assert.ok(rows.some(([code,,, ,flag])=>code==="1700"&&flag==="group"));
    assert.ok(!rows.some(([,name])=>/showroom\s+\d|pos cash -|inventory -/i.test(name)));
  }
  assert.equal(await db.outlet.count({where:{companyId:events.id}}),0);
  assert.equal(await db.account.count({where:{companyId:events.id,outletId:{not:null}}}),0);
});
test("Any company can add an arbitrary third outlet with complete once-allocated accounts",async()=>{
  const first=await outlet("FAZAIA","Fazaia");
  const second=await outlet("DHA","DHA","COUNTER");
  const third=await outlet("NORTH","North entrance","GATE");
  assert.equal(await db.outlet.count({where:{companyId:events.id}}),3);
  for(const place of [first,second,third]) {
    assert.equal(place.accounts.length,2);
    assert.deepEqual(place.accounts.map((a:any)=>a.parent.code).sort(),["1100","1700"]);
    for(const account of place.accounts) {
      assert.equal(account.outletId,place.id);
      assert.equal(account.companyId,events.id);
      assert.equal(account.type,"ASSET");assert.equal(account.isGroup,false);
      assert.equal(account.isCash,account.parent.code==="1100");
      assert.ok(account.name.endsWith(place.name));
    }
    const repeated=await outlet(place.code,place.name,place.type);
    assert.deepEqual(repeated.accounts.map((a:any)=>a.id),place.accounts.map((a:any)=>a.id));
  }
  assert.equal(new Set([first,second,third].flatMap(o=>o.accounts.map((a:any)=>a.code))).size,6);
});
test("Concurrent retries cannot create duplicate outlets or reuse another outlet's allocated numbers",async()=>{
  const requests=await Promise.all(Array.from({length:5},()=>outlet("CONCURRENT","Concurrent test","OFFICE")));
  assert.equal(new Set(requests.map(o=>o.id)).size,1);
  assert.equal(await db.account.count({where:{companyId:events.id,outletId:requests[0].id}}),2);
  await assert.rejects(()=>outlet("CONCURRENT","Different data","OFFICE"),/already exists/);
  const distinct=await Promise.all(["ALPHA","BETA"].map(code=>outlet(code)));
  const codes=distinct.flatMap(o=>o.accounts.map((a:any)=>a.code));
  assert.equal(new Set(codes).size,4);
});
test("Permission, isolation and composite foreign keys protect outlets and all dimension references",async()=>{
  const place=await db.outlet.findFirstOrThrow({where:{companyId:events.id}});
  await assert.rejects(()=>saveAccountRecord(viewer,events.code,"outlets",{code:"FORBIDDEN",name:"Forbidden",type:"GATE"}),(e:any)=>e.status===403);
  await assert.rejects(()=>listAccounts(viewer,retail.code,"outlets",{}),(e:any)=>e.status===403);
  await assert.rejects(()=>saveAccountRecord(owner,retail.code,"outlets",{id:place.id,code:place.code,name:place.name,type:place.type}),(e:any)=>e.status===404);
  assert.equal((await listAccounts(viewer,events.code,"outlets",{})).total,6);
  const account=await db.account.findFirstOrThrow({where:{companyId:events.id,isCash:true,outletId:null}});
  await assert.rejects(()=>db.account.update({where:{id:account.id},data:{outletId:other.id}}));
  await assert.rejects(()=>accountsReport(owner,events.code,"ledger",{outletId:other.id}),(e:any)=>e.status===404);
});
test("Posting retains exact outlet tags for invoices, bills, payments and journals",async()=>{
  const place=await outlet("POSTING","Posting counter","COUNTER");
  const customer=await saveAccountRecord(owner,events.code,"parties",{code:"OUT-C",name:"TEST outlet customer",...testTaxEvidence});
  const supplier=await saveAccountRecord(owner,events.code,"parties",{code:"OUT-S",name:"TEST outlet supplier",isCustomer:false,isSupplier:true,...testTaxEvidence});
  const cash=place.accounts.find((a:any)=>a.isCash),inventory=place.accounts.find((a:any)=>!a.isCash);
  const income=await db.account.findFirstOrThrow({where:{companyId:events.id,code:"4100"}});
  for(const [resource,party,account] of [["invoices",customer,income],["bills",supplier,inventory]] as const) {
    const doc=await saveAccountRecord(owner,events.code,resource,{partyId:party.id,date:day,dueDate:day,lines:[{accountId:account.id,description:"TEST outlet line",qty:"1",rate:"10.1234",outletId:place.id}]});
    await saveAccountRecord(owner,events.code,resource,{id:doc.id,operation:"post"});
    const detail=await getAccountRecord(owner,events.code,resource,doc.id);
    assert.equal(detail.lines[0].outlet.id,place.id);
    const rows=await db.journalLine.findMany({where:{companyId:events.id,entryId:detail.entryId}});
    assert.equal(rows.length,2);assert.ok(rows.every(l=>l.outletId===place.id));
  }
  const payment=await saveAccountRecord(owner,events.code,"payments",{partyId:customer.id,date:day,direction:"RECEIPT",method:"CASH",settlementAccountId:cash.id,amount:"0.1234",outletId:place.id});
  const posted=await saveAccountRecord(owner,events.code,"payments",{id:payment.id,operation:"post"});
  assert.ok((await db.journalLine.findMany({where:{entryId:posted.entryId}})).every(l=>l.outletId===place.id));
  const wrong={partyId:customer.id,date:day,direction:"RECEIPT",method:"CASH",settlementAccountId:cash.id,amount:"1",outletId:other.id};
  await assert.rejects(()=>saveAccountRecord(owner,events.code,"payments",wrong),/active outlet/);
  await assert.rejects(()=>saveAccountRecord(owner,events.code,"payments",{...wrong,outletId:null}),/outlet that owns/);
  const journal=await db.journal.findFirstOrThrow({where:{companyId:events.id,type:"GENERAL"}});
  await db.$transaction(tx=>postEntry(tx,owner,events.id,{journalId:journal.id,date:day,kind:"JOURNAL",sourceType:"ENTRY",sourceId:randomUUID(),lines:[
    {accountId:cash.id,debit:"0.0001",credit:"0",outletId:place.id},
    {accountId:income.id,debit:"0",credit:"0.0001",outletId:place.id}
  ]},"accounts.entry.post"));
  const report=await accountsReport(owner,events.code,"ledger",{outletId:place.id});
  assert.ok(report.rows.every((r:any)=>r.outletId===place.id&&r.outletName===place.name));
});
test("Deactivation and renaming retain posted history, account identities and numbers; reversals remain possible",async()=>{
  const place=await db.outlet.findFirstOrThrow({where:{companyId:events.id,code:"POSTING"},include:{accounts:true}});
  const before=await db.journalLine.findMany({where:{companyId:events.id,outletId:place.id},orderBy:{id:"asc"}});
  const original=await db.payment.findFirstOrThrow({where:{companyId:events.id,outletId:place.id,status:"POSTED"}});
  const draft=await saveAccountRecord(owner,events.code,"payments",{partyId:original.partyId,date:day,direction:"RECEIPT",method:"CASH",settlementAccountId:original.settlementAccountId,amount:"0.2345",outletId:place.id});
  const updated=await saveAccountRecord(owner,events.code,"outlets",{...place,name:"Renamed counter",active:false});
  assert.deepEqual(updated.accounts.map((a:any)=>[a.id,a.code]).sort(),place.accounts.map(a=>[a.id,a.code]).sort());
  assert.ok(updated.accounts.every((a:any)=>!a.active&&a.name.endsWith("Renamed counter")));
  assert.deepEqual(await db.journalLine.findMany({where:{companyId:events.id,outletId:place.id},orderBy:{id:"asc"}}),before);
  await assert.rejects(()=>saveAccountRecord(owner,events.code,"payments",{id:draft.id,operation:"post"}));
  const reversal=await db.$transaction(tx=>reverseEntry(tx,owner,events.id,original.entryId!,accountingToday(),"TEST outlet deactivation reversal","accounts.payment.cancel"));
  assert.ok(reversal.lines.every(l=>l.outletId===place.id));
  for(const account of place.accounts) {
    await assert.rejects(()=>saveAccountRecord(owner,events.code,"chart",{...account,name:"Bypass outlet settings"}),/managed by its outlet/);
    await assert.rejects(()=>db.account.update({where:{id:account.id},data:{code:"RENUMBER"}}));
    await assert.rejects(()=>db.account.update({where:{id:account.id},data:{outletId:null}}));
    await assert.rejects(()=>db.account.delete({where:{id:account.id}}));
  }
  await assert.rejects(()=>db.outlet.delete({where:{id:place.id}}));
  await assert.rejects(()=>saveAccountRecord(owner,events.code,"outlets",{...place,code:"RECODE"}),/permanent/);
});
test("Database composite outlet references reject cross-company tags on every draft source table",async()=>{
  const place=await db.outlet.findFirstOrThrow({where:{companyId:events.id,code:"CONCURRENT"},include:{accounts:true}});
  const cash=place.accounts.find(a=>a.isCash)!,inventory=place.accounts.find(a=>!a.isCash)!;
  const customer=await db.party.findFirstOrThrow({where:{companyId:events.id,isCustomer:true}});
  const supplier=await db.party.findFirstOrThrow({where:{companyId:events.id,isSupplier:true}});
  const income=await db.account.findFirstOrThrow({where:{companyId:events.id,code:"4100"}});
  for(const [resource,party,account,model] of [["invoices",customer,income,db.invoiceLine],["bills",supplier,inventory,db.billLine]] as const) {
    const doc=await saveAccountRecord(owner,events.code,resource,{partyId:party.id,date:day,dueDate:day,lines:[{accountId:account.id,description:"TEST cross-company constraint",qty:"1",rate:"0.01",outletId:place.id}]});
    const line=await (model as any).findFirstOrThrow({where:{companyId:events.id,...(resource==="invoices"?{invoiceId:doc.id}:{billId:doc.id})}});
    await assert.rejects(()=>(model as any).update({where:{id:line.id},data:{outletId:other.id}}),(e:any)=>e.code==="P2003");
  }
  const payment=await saveAccountRecord(owner,events.code,"payments",{partyId:customer.id,date:day,direction:"RECEIPT",method:"CASH",settlementAccountId:cash.id,amount:"0.3456",outletId:place.id});
  await assert.rejects(()=>db.payment.update({where:{id:payment.id},data:{outletId:other.id}}),(e:any)=>e.code==="P2003");
  const journal=await db.journal.findFirstOrThrow({where:{companyId:events.id,type:"GENERAL"}});
  const voucher=await saveAccountRecord(owner,events.code,"entries",{journalId:journal.id,date:day,kind:"JOURNAL",lines:[
    {accountId:cash.id,debit:"0.01",credit:"0",outletId:place.id},
    {accountId:income.id,debit:"0",credit:"0.01",outletId:place.id}
  ]});
  const line=await db.journalLine.findFirstOrThrow({where:{entryId:voucher.id}});
  await assert.rejects(()=>db.journalLine.update({where:{id:line.id},data:{outletId:other.id}}),(e:any)=>e.code==="P2003");
});
test("Missing setup rolls back the outlet and its first account, without audit fragments",async()=>{
  const company=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`OUT-X-${suffix}`,name:"TEST rollback",legalName:"TEST rollback"}),{timeout:60000});
  const parent=await db.account.findFirstOrThrow({where:{companyId:company.id,code:"1700"}});
  await db.account.update({where:{id:parent.id},data:{active:false}});
  const counts=await Promise.all([db.outlet.count({where:{companyId:company.id}}),db.account.count({where:{companyId:company.id}}),db.auditLog.count({where:{companyId:company.id}})]);
  await assert.rejects(()=>saveAccountRecord(owner,company.code,"outlets",{code:"ROLLBACK",name:"TEST rollback outlet",type:"COUNTER"}),/parent account/);
  assert.deepEqual(await Promise.all([db.outlet.count({where:{companyId:company.id}}),db.account.count({where:{companyId:company.id}}),db.auditLog.count({where:{companyId:company.id}})]),counts);
});
