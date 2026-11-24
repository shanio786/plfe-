import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {permissionCodes} from "../lib/role-templates";
import {excelBuffer} from "../lib/excel";
import {provisionCompany,saveRecord} from "../modules/core/service";
import {saveAccountRecord} from "../modules/accounts/service";
import {listAccounts} from "../modules/accounts/queries";
import {accountsReport} from "../modules/accounts/reports";
import {initializeGroup} from "../modules/accounts/group";
import {correctDemoChart} from "../modules/accounts/correction";
import {chartTemplate} from "../modules/accounts/template";
import {groupCompanies} from "../modules/accounts/initial-companies";
import {seedDemoBooks} from "../modules/accounts/demo";
import {accountingToday} from "../modules/accounts/time";
import {partySchema,provinces} from "../modules/accounts/schema";
import type {Actor} from "../modules/core/model";

let owner:Actor;
let originals:Awaited<ReturnType<typeof db.company.findMany>>;
let identities:any[],memberships:any[],oldEntries:any[],oldSequences:any[];
const date=accountingToday().toISOString().slice(0,10);
before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"));
  owner=await db.user.create({data:{name:"Correction test Owner",email:`correction-${randomUUID()}@test.invalid`,passwordHash:await bcrypt.hash(randomBytes(32).toString("hex"),4),isOwner:true,mustChangePassword:false}});
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  // Two pre-existing companies and existing memberships/credentials, deliberately
  // using the old condensed chart and July calendar even for Zahra Home.
  for(const code of ["PLFE","ZAHRA-HOME"]) {
    let company=await db.company.findFirst({where:{code,deletedAt:null}});
    // A rerun verifies the corrected setup rather than destroying earlier fixtures.
    if(company)continue;
    company=await db.$transaction(tx=>provisionCompany(tx,owner,{code,name:code,legalName:code,currency:"PKR",fyStartMonth:7,businessType:code==="ZAHRA-HOME"?"RETAIL":"EVENTS"}),{timeout:60000});
    await db.$transaction(async tx=>{
      // Retain unused modern fixture rows; install the precise old conflicting
      // control/cash codes that make a chart replacement unsafe without reversal.
      await tx.account.updateMany({where:{companyId:company!.id,counterpartyCompanyId:null,code:{notIn:["1600","2500"]}},data:{deletedAt:new Date(),active:false}});
      const rows=[
        ["1000","Assets","ASSET",true,false,false],
        ["1110","Cash in hand","ASSET",false,true,false],
        ["1120","Bank current account","ASSET",false,false,true],
        ["1200","Customer / exhibitor receivables","ASSET",false,false,false],
        ["2100","Supplier payables","LIABILITY",false,false,false],
        ["3900","Opening balance equity","EQUITY",false,false,false],
        ["4100","Booth rent income","INCOME",false,false,false],
        ["5100","Venue rent","EXPENSE",false,false,false]
      ] as const;
      const ids=new Map<string,string>();
      for(const [code,name,type,isGroup,isCash,isBank] of rows) {
        const a=await tx.account.create({data:{companyId:company!.id,code,name,type,isGroup,isCash,isBank}});
        ids.set(code,a.id);
      }
      await tx.accountingSettings.update({where:{companyId:company!.id},data:{receivableAccountId:ids.get("1200"),payableAccountId:ids.get("2100"),openingEquityAccountId:ids.get("3900")}});
    });
    const accounts=await db.account.findMany({where:{companyId:company.id,deletedAt:null}});
    const a=(code:string)=>accounts.find(a=>a.code===code)!.id;
    const journal=await db.journal.findFirstOrThrow({where:{companyId:company.id,type:"GENERAL"}});
    const customer=await saveAccountRecord(owner,code,"parties",{code:"TEST-P2-CUSTOMER",name:"TEST customer",isCustomer:true});
    const supplier=await saveAccountRecord(owner,code,"parties",{code:"TEST-P2-SUPPLIER",name:"TEST supplier",isCustomer:false,isSupplier:true});
    const post=async(resource:string,payload:any)=>{
      const row=await saveAccountRecord(owner,code,resource,{...payload,date,narration:`TEST-P2/legacy-${randomUUID()}`});
      const posted=await saveAccountRecord(owner,code,resource,{id:row.id,operation:"post"});
      assert.ok(!posted.approvalRequested);return posted;
    };
    await post("entries",{kind:"JOURNAL",journalId:journal.id,lines:[{accountId:a("1120"),debit:"1000000.0000",credit:"0"},{accountId:a("3900"),debit:"0",credit:"1000000.0000"}]});
    const invoice=await post("invoices",{partyId:customer.id,dueDate:date,lines:[{accountId:a("4100"),description:"TEST charge",qty:"1",rate:"100000"}]});
    await post("invoices",{kind:"CREDIT_NOTE",originalId:invoice.id,partyId:customer.id,dueDate:date,lines:[{accountId:a("4100"),description:"TEST credit",qty:"1",rate:"5000"}]});
    await post("payments",{direction:"RECEIPT",method:"BANK",partyId:customer.id,settlementAccountId:a("1120"),amount:"40000",allocations:[{invoiceId:invoice.id,amount:"40000"}]});
    const bill=await post("bills",{partyId:supplier.id,dueDate:date,lines:[{accountId:a("5100"),description:"TEST cost",qty:"1",rate:"20000"}]});
    await post("bills",{kind:"DEBIT_NOTE",originalId:bill.id,partyId:supplier.id,dueDate:date,lines:[{accountId:a("5100"),description:"TEST debit",qty:"1",rate:"2000"}]});
    await post("payments",{direction:"PAYMENT",method:"CASH",partyId:supplier.id,settlementAccountId:a("1110"),amount:"5000",allocations:[{billId:bill.id,amount:"5000"}]});
  }
  originals=await db.company.findMany({where:{code:{in:["PLFE","ZAHRA-HOME"]},deletedAt:null}});
  identities=await db.user.findMany({orderBy:{id:"asc"}});
  memberships=await db.userCompanyRole.findMany({where:{companyId:{in:originals.map(c=>c.id)}},orderBy:{id:"asc"}});
  oldEntries=await db.journalEntry.findMany({where:{companyId:{in:originals.map(c=>c.id)},status:"POSTED"},include:{lines:{orderBy:{lineNo:"asc"}}},orderBy:{id:"asc"}});
  oldSequences=await db.sequence.findMany({where:{companyId:{in:originals.map(c=>c.id)}}});
},{timeout:120000});
after(async()=>db.$disconnect());

test("Guarded correction preserves posted originals, identities, memberships and counters",async()=>{
  for(const company of originals)await correctDemoChart(owner,company.code,company.businessType==="RETAIL"?1:7);
  assert.deepEqual(await db.user.findMany({orderBy:{id:"asc"}}),identities);
  assert.deepEqual(await db.userCompanyRole.findMany({where:{companyId:{in:originals.map(c=>c.id)}},orderBy:{id:"asc"}}),memberships);
  for(const entry of oldEntries)assert.deepEqual(await db.journalEntry.findUniqueOrThrow({where:{id:entry.id},include:{lines:{orderBy:{lineNo:"asc"}}}}),entry);
  for(const sequence of oldSequences)assert.ok((await db.sequence.findUniqueOrThrow({where:{id:sequence.id}})).nextNumber>=sequence.nextNumber);
  for(const company of originals) {
    const legacy=await db.account.findMany({where:{companyId:company.id,code:{startsWith:"LEGACY-"}}});
    for(const account of legacy) {
      assert.equal(account.active,false);
      const total=await db.journalLine.aggregate({where:{companyId:company.id,accountId:account.id,entry:{status:"POSTED"}},_sum:{debit:true,credit:true}});
      assert.ok(new Prisma.Decimal(total._sum.debit??0).eq(total._sum.credit??0));
    }
  }
});

test("All six company setups are complete, calendar-correct and safe to rerun",async()=>{
  const companies=await db.$transaction(tx=>initializeGroup(tx,owner),{timeout:120000});
  assert.equal(companies.length,6);
  for(const company of companies) {
    const spec=groupCompanies.find(s=>s.code===company.code)!;
    assert.equal(company.fyStartMonth,spec.startMonth);
    assert.equal(await db.role.count({where:{companyId:company.id,deletedAt:null}}),11);
    assert.equal(await db.branch.count({where:{companyId:company.id,code:"HQ",deletedAt:null}}),1);
    assert.equal(await db.approvalRule.count({where:{companyId:company.id,deletedAt:null}}),5);
    const years=await db.fiscalYear.findMany({where:{companyId:company.id,deletedAt:null}});
    assert.equal(years.length,1);
    assert.equal(years[0].startDate.getUTCMonth()+1,spec.startMonth);
    assert.equal(years[0].endDate.getUTCMonth(),spec.startMonth===7?5:11);
    const periods=await db.period.findMany({where:{companyId:company.id,fiscalYearId:years[0].id,deletedAt:null},orderBy:{startDate:"asc"}});
    assert.equal(periods.length,12);
    assert.equal(+periods[0].startDate,+years[0].startDate);
    assert.equal(+periods[11].endDate,+years[0].endDate);
    periods.slice(1).forEach((p,i)=>assert.equal(+p.startDate-+periods[i].endDate,86400000));
    assert.equal(await db.numberSeries.count({where:{companyId:company.id,deletedAt:null}}),13);
    assert.equal(await db.accountingSettings.count({where:{companyId:company.id}}),1);
    assert.equal(await db.invoice.count({where:{companyId:company.id,status:"DRAFT",deletedAt:null}}),0);
  }
  const snapshot=async()=>Promise.all(companies.map(async c=>[
    await db.branch.count({where:{companyId:c.id}}),await db.role.count({where:{companyId:c.id}}),
    await db.period.count({where:{companyId:c.id}}),await db.numberSeries.count({where:{companyId:c.id}}),
    await db.account.count({where:{companyId:c.id}}),await db.userCompanyRole.count({where:{companyId:c.id}})
  ]));
  const before=await snapshot();
  await db.$transaction(tx=>initializeGroup(tx,owner),{timeout:120000});
  assert.deepEqual(await snapshot(),before);
});

test("Events and Retail charts contain exact posting/group semantics and aligned group subaccounts",async()=>{
  for(const spec of groupCompanies) {
    const company=await db.company.findFirstOrThrow({where:{code:spec.code,deletedAt:null}});
    const rows=await db.account.findMany({where:{companyId:company.id,active:true,deletedAt:null},include:{parent:true}});
    assert.equal(rows.filter(a=>!a.counterpartyCompanyId).length,chartTemplate(spec.businessType).length);
    for(const [code,name,type,parent,flag] of chartTemplate(spec.businessType)) {
      const row=rows.find(a=>a.code===code)!;assert.ok(row,code);
      assert.equal(row.name,name);assert.equal(row.type,type);
      assert.equal(row.parent?.code??null,parent);
      assert.equal(row.isGroup,flag==="group");assert.equal(row.isBank,flag==="bank");assert.equal(row.isCash,flag==="cash");
    }
    const others=await db.company.count({where:{id:{not:company.id},active:true,deletedAt:null}});
    assert.equal(rows.filter(a=>a.parent?.code==="1600").length,others);
    assert.equal(rows.filter(a=>a.parent?.code==="2500").length,others);
    if(spec.businessType==="RETAIL") {
      assert.equal(rows.filter(a=>a.outletId!==null).length,0);
      assert.equal(await db.outlet.count({where:{companyId:company.id}}),0);
      assert.equal(await db.branch.count({where:{companyId:company.id,type:"SHOWROOM",deletedAt:null}}),0);
      assert.ok(!rows.find(a=>["4200","4300","4400","1410","5300"].includes(a.code)));
    }
    const settings=await db.accountingSettings.findUniqueOrThrow({where:{companyId:company.id},include:{receivableAccount:true,openingEquityAccount:true}});
    assert.equal(settings.receivableAccount.code,"1300");assert.equal(settings.openingEquityAccount.code,"3990");
  }
});

test("Explicit corrected demos agree in both original trial balances and reruns do not duplicate",async()=>{
  for(const company of originals) {
    await seedDemoBooks(owner,company.code);
    const count=await db.journalEntry.count({where:{companyId:company.id,status:"POSTED"}});
    await seedDemoBooks(owner,company.code);
    assert.equal(await db.journalEntry.count({where:{companyId:company.id,status:"POSTED"}}),count);
    assert.equal(await db.journalEntry.count({where:{companyId:company.id,narration:{startsWith:"TEST-P2/CORRECTED/"},status:"POSTED"}}),20);
    const report=await accountsReport(owner,company.code,"trial-balance",{});
    assert.equal(report.summary.balanced,true);assert.equal(report.summary.debit,report.summary.credit);
    console.log(`${company.code}: trial balance ${report.summary.debit} / ${report.summary.credit}`);
    assert.equal(await correctDemoChart(owner,company.code),false);
  }
});

test("Optional province is validated, persisted, cleared, company-scoped and exported",async()=>{
  assert.equal(partySchema.parse({code:"P",name:"Party"}).province,undefined);
  assert.throws(()=>partySchema.parse({code:"P",name:"Party",province:"Invalid"}));
  const party=await saveAccountRecord(owner,"PLFE","parties",{code:`PROVINCE-${randomUUID()}`,name:"Province party"});
  assert.equal(party.province,null);
  for(const province of provinces) {
    const updated=await saveAccountRecord(owner,"PLFE","parties",{id:party.id,code:party.code,name:party.name,province});
    assert.equal(updated.province,province);
  }
  let result=await listAccounts(owner,"PLFE","parties",{search:party.code},true);
  assert.equal(result.rows[0].province,"Islamabad Capital Territory");
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(await excelBuffer(result.rows,"parties") as any);
  const sheet=workbook.worksheets[0],headers=sheet.getRow(1).values as string[];
  const index=headers.indexOf("province");assert.ok(index>0);
  assert.equal(sheet.getRow(2).getCell(index).value,"Islamabad Capital Territory");
  await saveAccountRecord(owner,"PLFE","parties",{id:party.id,code:party.code,name:party.name,province:""});
  result=await listAccounts(owner,"PLFE","parties",{search:party.code},true);
  assert.equal(result.rows[0].province,null);
  await assert.rejects(()=>db.party.update({where:{id:party.id},data:{province:"Invalid"}}));
});

test("Chart correction rejects non-Owners, live drafts and locked demo books without changes",async()=>{
  const user=await db.user.create({data:{name:"Not Owner",email:`not-owner-${randomUUID()}@test.invalid`,passwordHash:"not-a-password",mustChangePassword:false}});
  await assert.rejects(()=>correctDemoChart(user,"PLFE"),(e:any)=>e.status===403);
  // Reuse a fresh company under an approved code by selecting SE's initialized
  // empty books and setting just its calendar wrong: correction must preflight.
  const company=await db.company.findFirstOrThrow({where:{code:"SE",deletedAt:null}});
  await db.company.update({where:{id:company.id},data:{fyStartMonth:1}});
  const party=await saveAccountRecord(owner,"SE","parties",{code:`REAL-${randomUUID()}`,name:"Not a demo"});
  const account=await db.account.findFirstOrThrow({where:{companyId:company.id,code:"4100",active:true}});
  const draft=await saveAccountRecord(owner,"SE","invoices",{partyId:party.id,date,dueDate:date,narration:"Real draft",lines:[{accountId:account.id,description:"Real draft",qty:"1",rate:"10"}]});
  const before=await db.account.count({where:{companyId:company.id}});
  await assert.rejects(()=>correctDemoChart(owner,"SE",7),/non-TEST-P2/);
  assert.equal(await db.account.count({where:{companyId:company.id}}),before);
  await saveAccountRecord(owner,"SE","invoices",{id:draft.id,operation:"delete"});
  await db.company.update({where:{id:company.id},data:{fyStartMonth:7}});
  const retail=await db.company.findFirstOrThrow({where:{code:"ZAHRA-HOME",deletedAt:null}});
  await db.company.update({where:{id:retail.id},data:{fyStartMonth:7,lockDate:accountingToday()}});
  const count=await db.journalEntry.count({where:{companyId:retail.id}});
  await assert.rejects(()=>correctDemoChart(owner,retail.code,1),/open financial year|locked/);
  assert.equal(await db.journalEntry.count({where:{companyId:retail.id}}),count);
  await db.company.update({where:{id:retail.id},data:{fyStartMonth:1,lockDate:null}});
});
