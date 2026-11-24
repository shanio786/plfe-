import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {AppError} from "../lib/errors";
import {permissionCodes} from "../lib/role-templates";
import {provisionCompany,saveRecord} from "../modules/core/service";
import {saveAccountRecord} from "../modules/accounts/service";
import {getAccountRecord} from "../modules/accounts/queries";
import {accountingToday} from "../modules/accounts/time";
import {setupTestTax,testTaxEvidence} from "./helpers/test-tax";
import type {Actor} from "../modules/core/model";
let owner:Actor,approver:Actor,viewer:Actor,a:any,b:any,bank:any,cash:any,equity:any,journal:any,income:any;
const day=accountingToday().toISOString().slice(0,10),suffix=randomUUID().slice(0,8).toUpperCase();
const write=(resource:string,data:any,actor=owner,company=a)=>saveAccountRecord(actor,company.code,resource,data);
const party=(extra:any={})=>write("parties",{code:`PC-${randomUUID().slice(0,12)}`,name:"TEST payment-control party",isCustomer:true,isSupplier:true,...testTaxEvidence,...extra});
const payment=(p:any,amount:string,extra:any={})=>({partyId:p.id,direction:"RECEIPT",method:"BANK",date:day,settlementAccountId:bank.id,amount,...extra});
const confirm=(warning:any)=>({confirmed:true,token:warning.token,note:"TEST deliberate additional payment after reviewing every match"});
async function warned(action:()=>Promise<any>) {
  try {await action();assert.fail("Expected an explicit duplicate warning");}
  catch(error) {
    assert.ok(error instanceof AppError,"Expected the domain warning, not a database failure");
    assert.equal(error.status,409);assert.equal(error.details?.code,"PAYMENT_DUPLICATE");
    assert.ok(typeof error.details?.token==="string","A fresh signed confirmation token is required");
    return error.details as any;
  }
}
async function post(resource:string,data:any) {
  const draft=await write(resource,data);
  const posted=await write(resource,{id:draft.id,operation:"post"});assert.ok(!posted.approvalRequested);
  return getAccountRecord(owner,a.code,resource,draft.id);
}
before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"));
  const user=(name:string,isOwner=false)=>db.user.create({data:{name,email:`payment-${name}-${suffix}@test.invalid`.toLowerCase(),
    passwordHash:"no-login-disposable-test-identity",isOwner,mustChangePassword:false}});
  owner=await user("owner",true);approver=await user("approver");viewer=await user("viewer");
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  a=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`PC-A-${suffix}`,name:"TEST payment company",legalName:"TEST payment company",ntn:"TEST-COMPANY-NTN"}),{timeout:60000});
  b=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`PC-B-${suffix}`,name:"TEST linked company",legalName:"TEST linked company"}),{timeout:60000});
  for(const [actor,name] of [[approver,"Accountant"],[viewer,"Viewer"]] as const) {
    const role=await db.role.findFirstOrThrow({where:{companyId:a.id,name}});
    await saveRecord(owner,a.code,"memberships",{userId:actor.id,roleId:role.id});
  }
  await setupTestTax(owner,a.code,false);
  bank=await db.account.findFirstOrThrow({where:{companyId:a.id,isBank:true,active:true,isGroup:false}});
  cash=await db.account.findFirstOrThrow({where:{companyId:a.id,isCash:true,active:true,isGroup:false}});
  const s=await db.accountingSettings.findUniqueOrThrow({where:{companyId:a.id}});
  equity=await db.account.findUniqueOrThrow({where:{id:s.openingEquityAccountId}});
  journal=await db.journal.findUniqueOrThrow({where:{id:s.generalJournalId}});
  income=await db.account.findFirstOrThrow({where:{companyId:a.id,code:"4100",active:true}});
},{timeout:60000});
after(async()=>db.$disconnect());

test("Duplicate detection is exact decimal, includes both directions and both seven-day calendar boundaries",async()=>{
  const p=await party(),base=new Date(`${day}T00:00:00Z`);
  const at=(offset:number)=>{const d=new Date(base);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
  const first=await write("payments",payment(p,"1.2345"));
  for(const offset of [-7,7]) {
    const warning=await warned(()=>write("payments",payment(p,"1.2345",{date:at(offset),direction:"PAYMENT"})));
    assert.ok(warning.matches.some((m:any)=>m.id===first.id&&m.reference===`DRAFT-${first.id}`&&m.date===day));
  }
  await write("payments",payment(p,"1.2345",{date:at(-8)}));
  await write("payments",payment(p,"1.2345",{date:at(8)}));
  await write("payments",payment(p,"1.2346"));
  assert.equal(await db.payment.count({where:{companyId:a.id,partyId:p.id}}),4);
  const edited=await write("payments",{...payment(p,"1.2346"),id:(await db.payment.findFirstOrThrow({where:{companyId:a.id,partyId:p.id,amount:"1.2346"}})).id,narration:"TEST exclude self"});
  assert.equal(edited.amount.toFixed(4),"1.2346");
});
test("Warning blocks every write; a deliberate signed, actor-bound note is stored and audited",async()=>{
  const p=await party(),first=await post("payments",payment(p,"21.0001")),raw=payment(p,"21.0001");
  const count=await db.payment.count({where:{companyId:a.id}});
  const warning=await warned(()=>write("payments",raw));
  assert.ok(warning.matches.some((m:any)=>m.number===first.number&&m.date===day));
  assert.equal(await db.payment.count({where:{companyId:a.id}}),count);
  await warned(()=>write("payments",{...raw,duplicateConfirmation:{...confirm(warning),token:`bad.${warning.token}`}}));
  await warned(()=>write("payments",{...raw,duplicateConfirmation:confirm(warning)},approver));
  await assert.rejects(()=>write("payments",{...raw,duplicateConfirmation:{...confirm(warning),note:"short"}}),/ten|10|characters/);
  const saved=await write("payments",{...raw,duplicateConfirmation:confirm(warning)});
  assert.equal(saved.duplicateConfirmedBy,owner.id);assert.ok(saved.duplicateConfirmedAt);
  assert.equal(saved.duplicateEvidence.matches[0].id,first.id);
  assert.ok(await db.auditLog.findFirst({where:{companyId:a.id,recordId:saved.id,action:"CONFIRM_DUPLICATE"}}));
  await assert.rejects(()=>write("payments",payment(p,"21.0001"),viewer),/permission|allowed|denied/i);
});
test("Concurrent first saves and repeated confirmation retries cannot pass unnoticed",async()=>{
  const p=await party(),raw=payment(p,"77.7777");
  const attempts=await Promise.allSettled([write("payments",raw),write("payments",raw)]);
  assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
  const warning=await warned(()=>write("payments",raw));
  const retry=await Promise.allSettled([1,2].map(()=>write("payments",{...raw,duplicateConfirmation:confirm(warning)})));
  assert.equal(retry.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(await db.payment.count({where:{companyId:a.id,partyId:p.id}}),2);
});
test("Confirmation cannot cover a new party, payload or duplicate set; posting explicitly reconfirms",async()=>{
  const p=await party(),other=await party(),raw=payment(p,"31.0001");
  await write("payments",raw);await write("payments",payment(other,"31.0001"));
  const warning=await warned(()=>write("payments",raw));
  await warned(()=>write("payments",{...raw,partyId:other.id,duplicateConfirmation:confirm(warning)}));
  const second=await write("payments",{...raw,duplicateConfirmation:confirm(warning)});
  const thirdWarning=await warned(()=>write("payments",raw));
  await write("payments",{...raw,duplicateConfirmation:confirm(thirdWarning)});
  const stale=await warned(()=>write("payments",{id:second.id,operation:"post"}));
  assert.ok(!stale.matches.some((m:any)=>m.id===second.id));assert.equal(stale.operation,"post");
  const original=await db.payment.findUniqueOrThrow({where:{id:second.id}});
  assert.equal(original.number,null);assert.equal(original.entryId,null);assert.equal(original.status,"DRAFT");
  const posted=await write("payments",{id:second.id,operation:"post",duplicateConfirmation:confirm(stale)});
  assert.equal(posted.status,"POSTED");
  await assert.rejects(()=>db.payment.update({where:{id:posted.id},data:{duplicateNote:"TEST history rewrite attempt"}}));
});
test("Expired confirmations require fresh review and do not create a document",async()=>{
  const p=await party(),raw=payment(p,"18.0001");await write("payments",raw);
  const warning=await warned(()=>write("payments",raw)),clock=Date.now;
  try {
    Date.now=()=>clock()+11*60*1000;
    await warned(()=>write("payments",{...raw,duplicateConfirmation:confirm(warning)}));
  } finally {Date.now=clock;}
  assert.equal(await db.payment.count({where:{companyId:a.id,partyId:p.id}}),1);
});
test("Cancelled and archived drafts are excluded; a same-company match never leaks across companies",async()=>{
  const p=await party(),raw=payment(p,"24.0001"),first=await post("payments",raw);
  const request=await write("payments",{id:first.id,operation:"cancel",note:"TEST cancellation removes active duplicate"});
  await saveRecord(approver,a.code,"approvals",{id:request.approvalId,operation:"approve"});
  const replacement=await write("payments",raw);
  await write("payments",{id:replacement.id,operation:"delete"});
  await write("payments",raw);
  const other=await write("parties",{code:"TEST-PC-OTHER",name:"TEST scoped other party"},owner,b);
  const otherBank=await db.account.findFirstOrThrow({where:{companyId:b.id,isBank:true,isGroup:false,active:true}});
  await write("payments",{...raw,partyId:other.id,settlementAccountId:otherBank.id},owner,b);
});
test("Duplicate confirmation cannot bypass allocation limits or independent high-value approval",async()=>{
  const p=await party(),invoice=await post("invoices",{partyId:p.id,date:day,dueDate:day,lines:[{accountId:income.id,description:"TEST exact remaining balance",qty:"1",rate:"1"}]});
  await write("payments",payment(p,"10.0001"));
  const raw=payment(p,"10.0001",{allocations:[{invoiceId:invoice.id,amount:"2"}]});
  const warning=await warned(()=>write("payments",raw));
  const count=await db.payment.count({where:{companyId:a.id,partyId:p.id}});
  await assert.rejects(()=>write("payments",{...raw,duplicateConfirmation:confirm(warning)}),/outstanding/);
  assert.equal(await db.payment.count({where:{companyId:a.id,partyId:p.id}}),count);
  const high=await party(),source=payment(high,"500001.0000");
  await post("payments",source);
  const outgoing={...source,direction:"PAYMENT"};
  const duplicate=await warned(()=>write("payments",outgoing));
  const target=await write("payments",{...outgoing,duplicateConfirmation:confirm(duplicate)});
  const request=await write("payments",{id:target.id,operation:"post"});
  assert.equal(request.approvalRequested,true);
  const another=await warned(()=>write("payments",source));
  await write("payments",{...source,duplicateConfirmation:confirm(another)});
  await warned(()=>saveRecord(approver,a.code,"approvals",{id:request.approvalId,operation:"approve"}));
  assert.equal((await db.approval.findUniqueOrThrow({where:{id:request.approvalId}})).status,"PENDING");
  await saveRecord(owner,a.code,"approvals",{id:request.approvalId,operation:"withdraw"});
  const latest=await warned(()=>write("payments",{id:target.id,operation:"post"}));
  const nextRequest=await write("payments",{id:target.id,operation:"post",duplicateConfirmation:confirm(latest)});
  assert.equal(nextRequest.approvalRequested,true);
  await assert.rejects(()=>saveRecord(owner,a.code,"approvals",{id:nextRequest.approvalId,operation:"approve"}),/own|independent/i);
  await saveRecord(approver,a.code,"approvals",{id:nextRequest.approvalId,operation:"approve"});
  assert.equal((await db.payment.findUniqueOrThrow({where:{id:target.id}})).status,"POSTED");
});
test("Self identity is blocked on save and post; name aliases cannot change a used legal identity",async()=>{
  const self=await party({linkedCompanyId:a.id,name:"TEST unrelated displayed name"});
  await assert.rejects(()=>write("payments",payment(self,"1")),/itself|Transfer/);
  const reg=await party({ntn:"test company ntn"});
  await assert.rejects(()=>write("payments",payment(reg,"1")),/itself|Transfer/);
  const late=await party(),draft=await write("payments",payment(late,"19.0001"));
  await write("parties",{...late,openingBalance:late.openingBalance.toFixed(4),linkedCompanyId:a.id});
  await assert.rejects(()=>write("payments",{id:draft.id,operation:"post"}),/itself|Transfer/);
  assert.equal((await db.payment.findUniqueOrThrow({where:{id:draft.id}})).number,null);
  const external=await party({name:a.name,linkedCompanyId:b.id});
  await post("payments",payment(external,"4.0001"));
  assert.equal((await getAccountRecord(owner,a.code,"parties",external.id)).companyIdentityLocked,true);
  await assert.rejects(()=>write("parties",{...external,openingBalance:external.openingBalance.toFixed(4),linkedCompanyId:null}),/identity.*permanent/i);
  await assert.rejects(()=>db.party.update({where:{id:external.id},data:{linkedCompanyId:null}}));
});
test("Own transfers allow cash/cash and bank/bank, but never self accounts, parties or unbalanced legs",async()=>{
  await post("entries",{kind:"JOURNAL",journalId:journal.id,date:day,lines:[
    {accountId:bank.id,debit:"1000",credit:"0"},{accountId:equity.id,debit:"0",credit:"1000"}]});
  const secondBank=await write("chart",{code:"TEST-PC-BANK",name:"TEST second company bank",type:"ASSET",isBank:true});
  const place=await write("outlets",{code:"TEST-PC-CASH",name:"TEST second company till",type:"COUNTER"});
  const secondCash=place.accounts.find((v:any)=>v.isCash);
  const legs=(from:any,to:any,amount="1")=>[{accountId:to.id,debit:amount,credit:"0",outletId:to.outletId??null},{accountId:from.id,debit:"0",credit:amount,outletId:from.outletId??null}];
  for(const [from,to] of [[bank,cash],[cash,secondCash],[bank,secondBank]]) {
    const posted=await post("entries",{kind:"TRANSFER",journalId:journal.id,date:day,lines:legs(from,to)});
    assert.equal(posted.status,"POSTED");assert.ok(posted.lines.every((l:any)=>!l.partyId));
  }
  const base={kind:"TRANSFER",journalId:journal.id,date:day};
  await assert.rejects(()=>write("entries",{...base,lines:legs(bank,bank)}),/distinct/);
  await assert.rejects(()=>write("entries",{...base,lines:legs(bank,secondBank).map(l=>({...l,partyId:(selfPartyId())}))}),/party/);
  await assert.rejects(()=>write("entries",{...base,lines:[{accountId:bank.id,debit:"1",credit:"0"},{accountId:secondBank.id,debit:"0",credit:"2"}]}),/equal|balanced/);
  await assert.rejects(()=>write("entries",{...base,kind:"JOURNAL",lines:legs(bank,secondBank)}),/Transfer/);
  const tampered=await write("entries",{...base,lines:legs(bank,secondBank)});
  const line=await db.journalLine.findFirstOrThrow({where:{entryId:tampered.id,credit:{gt:"0"}}});
  await db.journalLine.update({where:{id:line.id},data:{accountId:secondBank.id}});
  await assert.rejects(()=>write("entries",{id:tampered.id,operation:"post"}),/distinct/);
  function selfPartyId(){return randomUUID();} // Valid UUID; party prohibition is checked before FK resolution.
});
test("A party used only on a posted journal also retains its legal company identity",async()=>{
  const p=await party({linkedCompanyId:b.id});
  const s=await db.accountingSettings.findUniqueOrThrow({where:{companyId:a.id}});
  await post("entries",{kind:"JOURNAL",journalId:journal.id,date:day,lines:[
    {accountId:s.receivableAccountId,debit:"1",credit:"0",partyId:p.id},{accountId:equity.id,debit:"0",credit:"1"}]});
  assert.equal((await getAccountRecord(owner,a.code,"parties",p.id)).companyIdentityLocked,true);
  await assert.rejects(()=>write("parties",{...p,openingBalance:p.openingBalance.toFixed(4),linkedCompanyId:null}),/identity.*permanent/i);
  await assert.rejects(()=>db.party.update({where:{id:p.id},data:{linkedCompanyId:a.id}}));
});
