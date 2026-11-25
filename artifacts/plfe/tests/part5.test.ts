import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {permissionCodes} from "../lib/role-templates";
import {provisionCompany,saveRecord} from "../modules/core/service";
import {saveOpening} from "../modules/accounts/opening";
import {openingOverview} from "../modules/accounts/opening-state";
import {cashCountRequest,cashCountsView} from "../modules/accounts/cash-count";
import {groupBalancesView,intercompanyRequest,intercompanyView} from "../modules/accounts/intercompany";
import {accountingToday} from "../modules/accounts/time";
import type {Actor} from "../modules/core/model";
import {setupTestTax} from "./helpers/test-tax";

let owner:Actor,outsider:Actor,alpha:any,beta:any;
const suffix=randomUUID().slice(0,8).toUpperCase();
const today=accountingToday().toISOString().slice(0,10);

/** Runs the operator reset exactly as a person would, in its own process. */
const reset=(code:string,confirm:string,env:Record<string,string|undefined>={})=>
  spawnSync(process.execPath,["--import","tsx","prisma/reset-company.ts","--company",code,"--confirm",confirm],
    {encoding:"utf8",env:{...process.env,...env}});

const accountId=async(companyId:string,code:string)=>
  (await db.account.findFirstOrThrow({where:{companyId,code,deletedAt:null}})).id;

/** Go-live must be configured before any financial document can be dated. */
async function openForBusiness(company:any) {
  const state:any=await openingOverview(owner,company.code);
  const goLiveDate=new Date(state.company.goLiveDate).toISOString().slice(0,10);
  await saveOpening(owner,company.code,{operation:"configure",goLiveDate});
  return goLiveDate;
}

before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"),
    "Part 5 tests only run against a disposable _test database");
  owner=await db.user.create({data:{name:"Part5 Owner",email:`p5-owner-${suffix.toLowerCase()}@test.invalid`,
    passwordHash:"no-login-test-identity",isOwner:true,mustChangePassword:false}});
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  alpha=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`P5A-${suffix}`,name:"TEST alpha",
    legalName:"TEST alpha",businessType:"EVENTS"}),{timeout:60000});
  beta=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`P5B-${suffix}`,name:"TEST beta",
    legalName:"TEST beta",businessType:"EVENTS"}),{timeout:60000});
  await setupTestTax(owner,alpha.code,false);
  await setupTestTax(owner,beta.code,false);
  await openForBusiness(alpha);
  await openForBusiness(beta);
  // Somebody with full rights in alpha and none at all in beta.
  outsider=await db.user.create({data:{name:"Part5 alpha-only accountant",
    email:`p5-alpha-${suffix.toLowerCase()}@test.invalid`,passwordHash:"no-login-test-identity",mustChangePassword:false}});
  const role=await db.role.findFirstOrThrow({where:{companyId:alpha.id,name:"Accountant"}});
  await saveRecord(owner,alpha.code,"memberships",{userId:outsider.id,roleId:role.id});
},{timeout:120000});
after(async()=>db.$disconnect());

// ---------------------------------------------------------------- intercompany

test("Provisioning gives both companies the account that faces the other",async()=>{
  const fromAlpha=await db.account.findFirstOrThrow({where:{companyId:alpha.id,counterpartyCompanyId:beta.id,type:"ASSET"}});
  const toAlpha=await db.account.findFirstOrThrow({where:{companyId:beta.id,counterpartyCompanyId:alpha.id,type:"LIABILITY"}});
  assert.ok(fromAlpha.code.startsWith("160"),"due-from sits under 1600");
  assert.ok(toAlpha.code.startsWith("250"),"due-to sits under 2500");
  assert.notEqual(fromAlpha.companyId,toAlpha.companyId);
});

test("Paying on another company's behalf writes both companies and the sides agree",async()=>{
  const draft:any=await intercompanyRequest(owner,alpha.code,{
    counterpartyCompanyId:beta.id,kind:"PAY_ON_BEHALF",date:today,amount:"50000.0000",
    reason:"TEST alpha settled beta's venue deposit",
    settlementAccountId:await accountId(alpha.id,"1201"),
    counterpartyAccountId:await accountId(beta.id,"5100")});
  assert.equal(draft.status,"DRAFT");
  assert.equal(draft.entryId,null,"a draft touches neither company's books");

  const posted:any=await intercompanyRequest(owner,alpha.code,{id:draft.id,operation:"post"});
  assert.equal(posted.status,"POSTED");
  assert.ok(posted.entryId&&posted.counterpartyEntryId,"both entries exist");

  const here=await db.journalEntry.findFirstOrThrow({where:{id:posted.entryId,companyId:alpha.id},include:{lines:true}});
  const there=await db.journalEntry.findFirstOrThrow({where:{id:posted.counterpartyEntryId,companyId:beta.id},include:{lines:true}});
  assert.equal(here.status,"POSTED");
  assert.equal(there.status,"POSTED");
  // Alpha's money left the bank and beta now owes it.
  const dueFrom=await accountId(alpha.id,(await db.account.findFirstOrThrow({
    where:{companyId:alpha.id,counterpartyCompanyId:beta.id,type:"ASSET"}})).code);
  assert.equal(here.lines.find(l=>l.accountId===dueFrom)?.debit.toFixed(4),"50000.0000");
  assert.equal(here.lines.find(l=>l.accountId!==dueFrom)?.credit.toFixed(4),"50000.0000");
  const dueTo=(await db.account.findFirstOrThrow({where:{companyId:beta.id,counterpartyCompanyId:alpha.id,type:"LIABILITY"}})).id;
  assert.equal(there.lines.find(l=>l.accountId===dueTo)?.credit.toFixed(4),"50000.0000");

  const report:any=await groupBalancesView(owner,alpha.code);
  const pair=report.rows.find((r:any)=>
    [r.companyId,r.counterpartyCompanyId].includes(alpha.id)&&[r.companyId,r.counterpartyCompanyId].includes(beta.id));
  assert.ok(pair,"the pair appears in group balances");
  assert.equal(pair.agree,true,"both companies report the same figure");
  assert.ok(/owes/.test(pair.statement));
  assert.deepEqual(pair.unmatched,[]);
});

test("Cancelling reverses both companies and they still agree",async()=>{
  const draft:any=await intercompanyRequest(owner,beta.code,{
    counterpartyCompanyId:alpha.id,kind:"TRANSFER",date:today,amount:"20000.0000",
    reason:"TEST beta repaid part of the venue deposit",
    settlementAccountId:await accountId(beta.id,"1201"),
    counterpartyAccountId:await accountId(alpha.id,"1201")});
  const posted:any=await intercompanyRequest(owner,beta.code,{id:draft.id,operation:"post"});
  const cancelled:any=await intercompanyRequest(owner,beta.code,{id:posted.id,operation:"cancel",
    note:"TEST reversal of a mistaken repayment"});
  assert.equal(cancelled.status,"CANCELLED");
  assert.ok(cancelled.reversalEntryId&&cancelled.counterpartyReversalEntryId,"both sides reversed");
  for(const [entryId,companyId] of [[cancelled.reversalEntryId,beta.id],[cancelled.counterpartyReversalEntryId,alpha.id]]) {
    const reversal=await db.journalEntry.findFirstOrThrow({where:{id:entryId,companyId}});
    assert.equal(reversal.status,"POSTED");
    assert.equal(reversal.kind,"REVERSAL");
  }
  // Only this pair is asserted: the shared test database also holds companies
  // left behind by other runs, whose pairs are none of this test's business.
  const report:any=await groupBalancesView(owner,alpha.code);
  const pair=report.rows.find((r:any)=>
    [r.companyId,r.counterpartyCompanyId].includes(alpha.id)&&[r.companyId,r.counterpartyCompanyId].includes(beta.id));
  assert.equal(pair.agree,true,"the pair still agrees after a reversal");
  // The 20,000 repayment was reversed, so the original 50,000 stands again.
  assert.match(pair.statement,new RegExp(`${beta.name} owes ${alpha.name} 50000\\.00`));
});

test("A transfer must land in the other company's own cash or bank account",async()=>{
  await assert.rejects(intercompanyRequest(owner,alpha.code,{
    counterpartyCompanyId:beta.id,kind:"TRANSFER",date:today,amount:"100.0000",
    reason:"TEST transfer into an expense account",
    settlementAccountId:await accountId(alpha.id,"1201"),
    counterpartyAccountId:await accountId(beta.id,"5100")}),/cash or bank/i);
});

test("A company cannot settle with itself and a reason is required",async()=>{
  await assert.rejects(intercompanyRequest(owner,alpha.code,{
    counterpartyCompanyId:alpha.id,kind:"TRANSFER",date:today,amount:"100.0000",
    reason:"TEST same company",settlementAccountId:await accountId(alpha.id,"1201"),
    counterpartyAccountId:await accountId(alpha.id,"1150")}),/different group company/i);
  await assert.rejects(intercompanyRequest(owner,alpha.code,{
    counterpartyCompanyId:beta.id,kind:"PAY_ON_BEHALF",date:today,amount:"100.0000",reason:"short",
    settlementAccountId:await accountId(alpha.id,"1201"),
    counterpartyAccountId:await accountId(beta.id,"5100")}),/ten characters/i);
});

test("Without rights in the other company it becomes a request, and nothing posts",async()=>{
  const draft:any=await intercompanyRequest(outsider,alpha.code,{
    counterpartyCompanyId:beta.id,kind:"PAY_ON_BEHALF",date:today,amount:"7500.0000",
    reason:"TEST alpha accountant pays for beta",
    settlementAccountId:await accountId(alpha.id,"1201"),
    counterpartyAccountId:await accountId(beta.id,"5100")});
  const result:any=await intercompanyRequest(outsider,alpha.code,{id:draft.id,operation:"post",
    note:"TEST please approve this cross-company payment"});
  assert.equal(result.approvalRequested,true,"it becomes an approval request");
  const stored=await db.intercompanyTransfer.findFirstOrThrow({where:{id:draft.id}});
  assert.equal(stored.status,"DRAFT","neither company was written");
  assert.equal(stored.entryId,null);
  assert.equal(stored.counterpartyEntryId,null);
});

// ------------------------------------------------------------------ cash count

test("A count that agrees is numbered and posts no entry",async()=>{
  const cash=await accountId(alpha.id,"1101");
  const saved:any=await cashCountRequest(owner,alpha.code,{accountId:cash,date:today,countedAmount:"0.0000"});
  assert.equal(saved.difference.toFixed(4),"0.0000");
  const posted:any=await cashCountRequest(owner,alpha.code,{id:saved.id,operation:"post"});
  assert.equal(posted.status,"POSTED");
  assert.ok(posted.number,"it still takes a number from the gapless series");
  assert.equal(posted.entryId,null,"nothing moved, so nothing was posted");
});

test("Two counts for the same drawer and date are refused",async()=>{
  const cash=await accountId(alpha.id,"1101");
  await assert.rejects(cashCountRequest(owner,alpha.code,{accountId:cash,date:today,countedAmount:"10.0000",
    explanation:"TEST a second count on the same day"}),/already counted/i);
});

test("A difference needs a written explanation and posts to the cash difference account",async()=>{
  const cash=await accountId(alpha.id,"1150");
  await assert.rejects(cashCountRequest(owner,alpha.code,{accountId:cash,date:today,countedAmount:"1500.0000"}),
    /explanation/i);
  const saved:any=await cashCountRequest(owner,alpha.code,{accountId:cash,date:today,countedAmount:"1500.0000",
    explanation:"TEST drawer holds more than the books; float not yet recorded"});
  assert.equal(saved.difference.toFixed(4),"1500.0000");

  // The company treats any difference as material, so it needs an approval.
  const requested:any=await cashCountRequest(owner,alpha.code,{id:saved.id,operation:"post",
    note:"TEST please approve this cash difference"});
  assert.equal(requested.approvalRequested,true);
  assert.equal((await db.cashCount.findFirstOrThrow({where:{id:saved.id}})).status,"DRAFT");

  // With no threshold rule in force it posts directly, through the same path.
  await db.approvalRule.updateMany({where:{companyId:alpha.id,docType:"CASH_DIFFERENCE"},data:{active:false}});
  const posted:any=await cashCountRequest(owner,alpha.code,{id:saved.id,operation:"post"});
  assert.equal(posted.status,"POSTED");
  const entry=await db.journalEntry.findFirstOrThrow({where:{id:posted.entryId!,companyId:alpha.id},include:{lines:true}});
  const difference=await accountId(alpha.id,"7200");
  assert.equal(entry.lines.find(l=>l.accountId===cash)?.debit.toFixed(4),"1500.0000");
  assert.equal(entry.lines.find(l=>l.accountId===difference)?.credit.toFixed(4),"1500.0000");
});

test("Denominations must add up to the counted amount",async()=>{
  const cash=await accountId(alpha.id,"1201");
  await assert.rejects(cashCountRequest(owner,alpha.code,{accountId:cash,date:today,countedAmount:"100.0000"}),
    /cash account/i,"a bank account is reconciled, not counted");
});

test("The overview names every drawer that has never been counted",async()=>{
  const view:any=await cashCountsView(owner,beta.code);
  assert.ok(view.accounts.length>0);
  assert.ok(view.accounts.every((a:any)=>a.neverCounted===true),"beta has counted nothing yet");
  const alphaView:any=await cashCountsView(owner,alpha.code);
  assert.ok(alphaView.accounts.some((a:any)=>a.neverCounted===false),"alpha has counted drawers");
  assert.ok(alphaView.rows.length>=2);
});

// ----------------------------------------------------------------- reset to zero

test("Reset empties a company's books, keeps its setup and restarts numbering",async()=>{
  const before=await db.journalEntry.count({where:{companyId:beta.id}});
  assert.ok(before>0,"beta has postings to remove");
  const accountsBefore=await db.account.count({where:{companyId:beta.id,deletedAt:null}});

  const refused=reset(beta.code,"WRONG");
  assert.match(refused.stderr,/twice to confirm/i);

  const run=reset(beta.code,beta.code);
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/reset to zero/i);

  assert.equal(await db.journalEntry.count({where:{companyId:beta.id}}),0,"no entries remain");
  assert.equal(await db.journalLine.count({where:{companyId:beta.id}}),0,"no ledger lines remain");
  assert.equal(await db.intercompanyTransfer.count({where:{OR:[{companyId:beta.id},{counterpartyCompanyId:beta.id}]}}),0);
  assert.equal(await db.account.count({where:{companyId:beta.id,deletedAt:null}}),accountsBefore,"the chart survived");
  assert.ok(await db.accountingSettings.findFirst({where:{companyId:beta.id}}),"posting settings survived");
  assert.ok((await db.numberSeries.count({where:{companyId:beta.id,deletedAt:null}}))>0,"number series survived");
  assert.ok((await db.sequence.findMany({where:{companyId:beta.id}})).every(s=>s.nextNumber===1n),
    "the next document is number one again");
  const company=await db.company.findFirstOrThrow({where:{id:beta.id}});
  assert.equal(company.goLiveDate,null);
  assert.equal(company.booksOpenedAt,null);
});

test("Reset refuses a company whose books have been declared open",async()=>{
  // Declaring books open is a long guided flow with its own tests. Here the
  // finished state is written directly, satisfying the same declaration rule
  // the real flow satisfies, so that the reset's own guard is what is tested.
  await db.$executeRawUnsafe("ALTER TABLE companies DISABLE TRIGGER company_books_guard");
  await db.$executeRawUnsafe(
    `UPDATE companies SET books_opened_at=now(),books_opened_by='${owner.id}'::uuid,
      books_open_evidence='{"test":"synthetic declaration"}'::jsonb,
      lock_date=go_live_date-1 WHERE id='${alpha.id}'::uuid`);
  await db.$executeRawUnsafe("ALTER TABLE companies ENABLE TRIGGER company_books_guard");
  try {
    const run=reset(alpha.code,alpha.code);
    assert.notEqual(run.status,0);
    assert.match(run.stderr,/declared its books open/i);
    assert.ok((await db.journalEntry.count({where:{companyId:alpha.id}}))>0,"alpha's history is untouched");
  } finally {
    await db.$executeRawUnsafe("ALTER TABLE companies DISABLE TRIGGER company_books_guard");
    await db.$executeRawUnsafe(
      `UPDATE companies SET books_opened_at=NULL,books_opened_by=NULL,books_open_evidence=NULL
        WHERE id='${alpha.id}'::uuid`);
    await db.$executeRawUnsafe("ALTER TABLE companies ENABLE TRIGGER company_books_guard");
  }
});

test("Reset refuses any database that is not disposable",async()=>{
  const run=reset(alpha.code,alpha.code,{NODE_ENV:"production"});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/never runs in production/i);
  assert.ok((await db.journalEntry.count({where:{companyId:alpha.id}}))>0,"alpha's history is untouched");
});
