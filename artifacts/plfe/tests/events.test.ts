import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {permissionCodes} from "../lib/role-templates";
import {provisionCompany} from "../modules/core/service";
import {saveAccountRecord} from "../modules/accounts/service";
import {listAccounts} from "../modules/accounts/queries";
import {accountsReport} from "../modules/accounts/reports";
import {postEntry} from "../lib/posting";
import {accountingToday} from "../modules/accounts/time";
import type {Actor} from "../modules/core/model";
import {setupTestTax} from "./helpers/test-tax";

let owner:Actor,expo:any,other:any;
const suffix=randomUUID().slice(0,8).toUpperCase();
const today=accountingToday();
const day=today.toISOString().slice(0,10);
const iso=(d:Date)=>d.toISOString().slice(0,10);

const event=(data:Record<string,unknown>,company=expo)=>saveAccountRecord(owner,company.code,"events",data);
const accountId=async(companyId:string,code:string)=>
  (await db.account.findFirstOrThrow({where:{companyId,code,deletedAt:null}})).id;

/** A balanced pair of posted lines, the second one carrying the event tag. */
async function tag(companyId:string,eventId:string|null,accountCode:string,amount:string,income:boolean) {
  const bank=await accountId(companyId,"1201"),account=await accountId(companyId,accountCode);
  const settings=await db.accountingSettings.findFirstOrThrow({where:{companyId}});
  return db.$transaction(tx=>postEntry(tx,owner,companyId,{
    journalId:settings.generalJournalId,date:today,kind:"JOURNAL",sourceType:"ENTRY",sourceId:randomUUID(),
    narration:`TEST event tag ${accountCode}`,
    lines:income
      ? [{accountId:bank,debit:amount,credit:"0"},{accountId:account,debit:"0",credit:amount,eventId}]
      : [{accountId:account,debit:amount,credit:"0",eventId},{accountId:bank,debit:"0",credit:amount}]
  },"accounts.entry.post"),{timeout:60000});
}

before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"),
    "Event tests only run against a disposable _test database");
  owner=await db.user.create({data:{name:"Events Owner",email:`ev-owner-${suffix.toLowerCase()}@test.invalid`,
    passwordHash:"no-login-test-identity",isOwner:true,mustChangePassword:false}});
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  expo=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`EV-A-${suffix}`,name:"TEST expo company",
    legalName:"TEST expo company",businessType:"EVENTS"}),{timeout:60000});
  other=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`EV-B-${suffix}`,name:"TEST other expo company",
    legalName:"TEST other expo company",businessType:"EVENTS"}),{timeout:60000});
  await setupTestTax(owner,expo.code,false);
  await setupTestTax(owner,other.code,false);
},{timeout:120000});
after(async()=>db.$disconnect());

test("An event is created with its own code, dates and budget",async()=>{
  const created:any=await event({code:`khi-${suffix}`,name:"TEST Karachi Expo",city:"Karachi",venue:"Expo Centre",
    edition:3,startDate:day,endDate:day,budgetIncome:"1000000.0000",budgetCost:"600000.0000",status:"OPEN"});
  assert.equal(created.code,`KHI-${suffix}`,"the code is stored uppercased");
  assert.equal(created.status,"OPEN");
  assert.equal(created.edition,3);
  assert.equal(created.budgetIncome.toFixed(4),"1000000.0000");
  const listed=await listAccounts(owner,expo.code,"events",{page:"1",pageSize:"50"});
  assert.ok(listed.rows.some((r:any)=>r.id===created.id),"it appears in the company's event list");
});

test("An event cannot end before it starts, and its code cannot change",async()=>{
  await assert.rejects(event({code:`BAD-${suffix}`,name:"TEST backwards",startDate:day,
    endDate:iso(new Date(today.getTime()-86400000))}),/end before it starts/i);
  const made:any=await event({code:`REN-${suffix}`,name:"TEST renaming",startDate:day,endDate:day});
  const renamed:any=await event({id:made.id,code:`REN-${suffix}`,name:"TEST renamed",startDate:day,endDate:day});
  assert.equal(renamed.name,"TEST renamed","the name may change");
  await assert.rejects(event({id:made.id,code:`REN2-${suffix}`,name:"TEST renamed",startDate:day,endDate:day}),
    /keeps its code/i);
});

test("Income and direct costs carrying the tag become profit per expo",async()=>{
  const expoEvent:any=await event({code:`PRF-${suffix}`,name:"TEST profit expo",startDate:day,endDate:day,
    status:"RUNNING",budgetIncome:"500000.0000",budgetCost:"300000.0000"});
  await tag(expo.id,expoEvent.id,"4100","800000",true);   // booth sales
  await tag(expo.id,expoEvent.id,"5100","250000",false);  // venue rent, a direct cost
  await tag(expo.id,expoEvent.id,"6100","90000",false);   // salaries, an office cost

  const report:any=await accountsReport(owner,expo.code,"event-profit",{eventId:expoEvent.id});
  const row=report.rows[0];
  assert.equal(row.income,"800000.0000");
  assert.equal(row.directCost,"250000.0000");
  assert.equal(row.otherCost,"90000.0000","an office cost is reported apart, not inside the expo's profit");
  assert.equal(row.profit,"550000.0000","income less direct costs");
  assert.equal(row.margin,"68.75");
  assert.equal(row.incomeVariance,"300000.0000","three hundred thousand above the budgeted income");
  assert.equal(row.costVariance,"-50000.0000","fifty thousand below the budgeted cost");
  assert.equal(row.budgetedProfit,"200000.0000");
});

test("An untagged office cost belongs to no expo",async()=>{
  const before:any=await accountsReport(owner,expo.code,"event-profit",{});
  await tag(expo.id,null,"6200","40000",false);
  const after:any=await accountsReport(owner,expo.code,"event-profit",{});
  assert.equal(after.summary.otherCost,before.summary.otherCost,"it never reaches any event");
  assert.equal(after.summary.profit,before.summary.profit);
});

test("An event of another company cannot be tagged",async()=>{
  const theirs:any=await event({code:`OTH-${suffix}`,name:"TEST other company expo",startDate:day,endDate:day},other);
  await assert.rejects(tag(expo.id,theirs.id,"5100","1000",false),/event of this company/i);
});

test("A cancelled event stops collecting, and one with amounts cannot be cancelled",async()=>{
  const dropped:any=await event({code:`CAN-${suffix}`,name:"TEST cancelled expo",startDate:day,endDate:day});
  const cancelled:any=await event({id:dropped.id,code:`CAN-${suffix}`,name:"TEST cancelled expo",
    startDate:day,endDate:day,status:"CANCELLED"});
  assert.equal(cancelled.status,"CANCELLED");
  assert.equal(cancelled.active,false,"cancelling also takes it out of the pick lists");
  await assert.rejects(tag(expo.id,dropped.id,"5100","1000",false),/cancelled event/i);

  const live:any=await event({code:`LIV-${suffix}`,name:"TEST live expo",startDate:day,endDate:day,status:"OPEN"});
  await tag(expo.id,live.id,"4100","5000",true);
  await assert.rejects(event({id:live.id,code:`LIV-${suffix}`,name:"TEST live expo",startDate:day,endDate:day,
    status:"CANCELLED"}),/cannot be cancelled|close it/i);
});

test("Once an expo carries posted amounts its dates are part of that record",async()=>{
  const dated:any=await event({code:`DAT-${suffix}`,name:"TEST dated expo",startDate:day,endDate:day,status:"OPEN"});
  await tag(expo.id,dated.id,"4200","12000",true);
  await assert.rejects(event({id:dated.id,code:`DAT-${suffix}`,name:"TEST dated expo",
    startDate:iso(new Date(today.getTime()-86400000)),endDate:day,status:"OPEN"}),/dates are part of that record/i);
  const renamed:any=await event({id:dated.id,code:`DAT-${suffix}`,name:"TEST dated expo renamed",
    startDate:day,endDate:day,status:"CLOSED"});
  assert.equal(renamed.status,"CLOSED","it can still be closed");
  await assert.rejects(event({id:dated.id,code:`DAT-${suffix}`,name:"TEST dated expo renamed",
    startDate:day,endDate:day,status:"OPEN"}),/not reopened/i);
});

test("An event is never deleted from the database",async()=>{
  const kept=await db.event.findFirstOrThrow({where:{companyId:expo.id}});
  await assert.rejects(db.event.delete({where:{id:kept.id}}));
  await assert.rejects(db.event.update({where:{id:kept.id},data:{code:"CHANGED"}}));
  await assert.rejects(db.event.update({where:{id:kept.id},data:{deletedAt:new Date()}}));
});
