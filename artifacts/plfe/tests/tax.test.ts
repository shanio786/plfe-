import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {permissionCodes} from "../lib/role-templates";
import {excelBuffer} from "../lib/excel";
import {provisionCompany,saveRecord} from "../modules/core/service";
import {saveAccountRecord} from "../modules/accounts/service";
import {getAccountRecord,listAccounts} from "../modules/accounts/queries";
import {accountsReport,accountsOverview} from "../modules/accounts/reports";
import {accountingToday} from "../modules/accounts/time";
import type {Actor} from "../modules/core/model";

// Every percentage below is synthetic TEST data, not a representation of law.
let owner:Actor,viewer:Actor,approver:Actor,a:any,b:any,customer:any,supplier:any;
let fed:any,wht:any,prov:any,retailTax:any,income:any,cost:any,outlet:any,department:any,main:any;
const day=accountingToday().toISOString().slice(0,10);
const suffix=randomUUID().slice(0,8).toUpperCase();
const previousMonth=new Date(`${day}T00:00:00Z`);previousMonth.setUTCDate(1);previousMonth.setUTCMonth(previousMonth.getUTCMonth()-1);
const past=previousMonth.toISOString().slice(0,10);
const tomorrow=new Date(`${day}T00:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
const next=tomorrow.toISOString().slice(0,10);
const eq=(v:any,expected:string)=>assert.equal(new Prisma.Decimal(v).toFixed(4),expected);
const save=(resource:string,data:any,company=a)=>saveAccountRecord(owner,company.code,resource,data);
const input=(t:any)=>({...t,percentage:t.percentage.toString(),effectiveFrom:t.effectiveFrom.toISOString().slice(0,10),effectiveTo:t.effectiveTo?.toISOString().slice(0,10)??null});
async function updateTax(t:any,change:any) {
  return save("taxes",{...input(await db.tax.findUniqueOrThrow({where:{id:t.id}})),...change});
}
async function tax(company:any,code:string,percentage:string,extra:any={}) {
  const accounts=await db.account.findMany({where:{companyId:company.id,active:true,deletedAt:null}});
  return save("taxes",{code,name:`TEST ONLY ${code} — not a legal rate`,kind:"FEDERAL_SALES",authority:"FBR",
    percentage,applicability:"BOTH",province:"ALL",inputAccountId:accounts.find(v=>v.code==="1500")!.id,
    outputAccountId:accounts.find(v=>v.code==="2300")!.id,isDefault:true,effectiveFrom:"1900-01-01",...extra},company);
}
function trade(extra:any={}) {
  return {partyId:customer.id,date:day,dueDate:day,lines:[{accountId:income.id,description:"TEST taxable charge",qty:"3",rate:"33.3333",
    departmentId:department.id,outletId:outlet.id,withholdingTaxId:wht.id}],...extra};
}
async function post(resource:string,data:any,company=a) {
  const draft=await save(resource,data,company);
  const result=await save(resource,{id:draft.id,operation:"post"},company);
  assert.ok(!result.approvalRequested);
  return getAccountRecord(owner,company.code,resource,draft.id);
}
async function note(source:any,qty:string,extra:any={}) {
  const l=await db.invoiceLine.findFirstOrThrow({where:{companyId:a.id,invoiceId:source.id},orderBy:{lineNo:"asc"}});
  return save("invoices",{kind:"CREDIT_NOTE",originalId:source.id,partyId:customer.id,date:day,dueDate:day,
    lines:[{accountId:l.accountId,description:"TEST proportional credit",qty,rate:l.rate.toFixed(4),originalLineId:l.id,
      departmentId:l.departmentId,outletId:l.outletId,taxId:l.taxId,taxSelection:l.taxSelection,withholdingTaxId:l.withholdingTaxId}],...extra});
}
before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"),"Only disposable tax test books are permitted");
  const user=(name:string,isOwner=false)=>db.user.create({data:{name,email:`tax-${name}-${suffix}@test.invalid`.toLowerCase(),
    passwordHash:"no-login-disposable-test-identity",isOwner,mustChangePassword:false}});
  owner=await user("owner",true);viewer=await user("viewer");approver=await user("approver");
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
  // Always include last month, even when tests run in January.
  const fyStartMonth=day.slice(5,7)==="01"?7:1;
  a=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`TAX-A-${suffix}`,name:"TEST events tax",legalName:"TEST events tax",fyStartMonth}),{timeout:60000});
  b=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`TAX-B-${suffix}`,name:"TEST retail tax",legalName:"TEST retail tax",businessType:"RETAIL",fyStartMonth}),{timeout:60000});
  for(const [actor,name] of [[viewer,"Viewer"],[approver,"Accountant"]] as const) {
    const role=await db.role.findFirstOrThrow({where:{companyId:a.id,name}});
    await saveRecord(owner,a.code,"memberships",{userId:actor.id,roleId:role.id});
  }
  const accounts=await db.account.findMany({where:{companyId:a.id,active:true,deletedAt:null}});
  income=accounts.find(v=>v.code==="4100");cost=accounts.find(v=>v.code==="5100");
  fed=await tax(a,"TEST-FED-SYNTH","7.125321");
  wht=await tax(a,"TEST-WHT-SYNTH","2.500001",{kind:"WITHHOLDING",isDefault:false,
    outputAccountId:accounts.find(v=>v.code==="1510")!.id,inputAccountId:accounts.find(v=>v.code==="2310")!.id});
  prov=await tax(a,"TEST-PRA-SYNTH","3.123456",{kind:"PROVINCIAL_SERVICES",authority:"PRA",province:"Punjab",isDefault:false});
  retailTax=await tax(b,"TEST-RETAIL-SYNTH","4.321987");
  customer=await save("parties",{code:"TEST-TAX-CUSTOMER",name:"TEST tax customer",province:"Punjab"});
  supplier=await save("parties",{code:"TEST-TAX-SUPPLIER",name:"TEST tax supplier",province:"Punjab",isCustomer:false,isSupplier:true});
  outlet=await save("outlets",{code:"TEST-TAX-DESK",name:"TEST tax desk",type:"OFFICE"});
  department=await db.department.findFirstOrThrow({where:{companyId:a.id,active:true}});
},{timeout:60000});
after(async()=>db.$disconnect());

test("Tax master permissions, exact authority mappings and database overlap exclusions",async()=>{
  await assert.rejects(()=>saveAccountRecord(viewer,a.code,"taxes",input(fed)),/permission|allowed|denied/i);
  await assert.rejects(()=>listAccounts(viewer,b.code,"taxes",{}),/permission|allowed|access|denied/i);
  assert.ok((await listAccounts(viewer,a.code,"taxes",{})).rows.some((r:any)=>r.id===fed.id));
  await assert.rejects(()=>tax(a,"TEST-BAD-ISLAMABAD","1",{kind:"PROVINCIAL_SERVICES",authority:"PRA",province:"Islamabad Capital Territory",isDefault:false}),/Islamabad|Punjab/);
  await assert.rejects(()=>tax(a,"TEST-OVERLAP","1"),/overlap/);
  await assert.rejects(()=>db.tax.create({data:{companyId:a.id,code:"TEST-RAW-OVERLAP",name:"TEST invalid overlap",kind:"FEDERAL_SALES",
    authority:"FBR",percentage:"1",applicability:"BOTH",province:"ALL",outputAccountId:fed.outputAccountId,
    inputAccountId:fed.inputAccountId,effectiveFrom:new Date("2000-01-01"),isDefault:true}}));
  await assert.rejects(()=>save("chart",{...income,defaultTaxId:retailTax.id}),/not found|company/i);
  await assert.rejects(()=>db.account.update({where:{id:income.id},data:{defaultTaxId:retailTax.id}}));
  await assert.rejects(()=>save("chart",{...income,defaultTaxId:wht.id}),/withholding/i);
});
test("Preview writes nothing; line sales tax and separate withholding post exact tagged balanced entries",async()=>{
  const before=await Promise.all([db.invoice.count({where:{companyId:a.id}}),db.auditLog.count({where:{companyId:a.id}}),db.numberSeries.findMany({where:{companyId:a.id},orderBy:{id:"asc"}})]);
  const preview=await save("invoices",{...trade(),operation:"preview"});
  eq(preview.subtotal,"99.9999");eq(preview.taxTotal,"7.1253");eq(preview.withholdingTotal,"2.5000");eq(preview.total,"107.1252");eq(preview.netTotal,"104.6252");
  assert.equal(preview.lines[0].taxSnapshot.percentage,"7.125321");
  const after=await Promise.all([db.invoice.count({where:{companyId:a.id}}),db.auditLog.count({where:{companyId:a.id}}),db.numberSeries.findMany({where:{companyId:a.id},orderBy:{id:"asc"}})]);
  assert.deepEqual(after,before);
  main=await post("invoices",trade());
  const rows=await db.journalLine.findMany({where:{entryId:main.entryId,companyId:a.id}});
  assert.equal(rows.length,4);
  assert.ok(rows.every(l=>l.departmentId===department.id&&l.outletId===outlet.id&&l.eventId===null));
  eq(rows.find(l=>l.accountId===fed.outputAccountId)!.credit,"7.1253");
  eq(rows.find(l=>l.accountId===wht.outputAccountId)!.debit,"2.5000");
  eq(rows.reduce((v,l)=>v.add(l.debit).sub(l.credit),new Prisma.Decimal("0")),"0.0000");
  eq(main.outstanding,"104.6252");
});
test("Customer allocations and overview use net receivable, never gross including withholding",async()=>{
  const doc=await post("invoices",trade({lines:[{accountId:income.id,description:"TEST net allocation",qty:"1",rate:"100",withholdingTaxId:wht.id}]}));
  eq(doc.total,"107.1253");eq(doc.netTotal,"104.6253");
  const bank=await db.account.findFirstOrThrow({where:{companyId:a.id,isBank:true,active:true,isGroup:false}});
  const count=await db.payment.count({where:{companyId:a.id}});
  await assert.rejects(()=>save("payments",{partyId:customer.id,date:day,direction:"RECEIPT",method:"BANK",settlementAccountId:bank.id,
    amount:"107.1253",allocations:[{invoiceId:doc.id,amount:"107.1253"}]}),/outstanding/);
  assert.equal(await db.payment.count({where:{companyId:a.id}}),count);
  await post("payments",{partyId:customer.id,date:day,direction:"RECEIPT",method:"BANK",settlementAccountId:bank.id,
    amount:"104.6253",allocations:[{invoiceId:doc.id,amount:"104.6253"}]});
  eq((await getAccountRecord(owner,a.code,"invoices",doc.id)).outstanding,"0.0000");
  const overview=await accountsOverview(owner,a.code);
  eq(overview.invoiceOutstanding,"104.6252");
});
test("Per-account default precedes federal; every line has its own decimal rate and amount",async()=>{
  const service=await save("chart",{code:"TEST-TAX-SERVICE",name:"TEST provincial service income",type:"INCOME",defaultTaxId:prov.id});
  const doc=await post("invoices",trade({lines:[
    {accountId:income.id,description:"TEST federal basis",qty:"1",rate:"100"},
    {accountId:service.id,description:"TEST account provincial basis",qty:"1",rate:"100",outletId:outlet.id}
  ]}));
  eq(doc.taxTotal,"10.2488");eq(doc.total,"210.2488");
  assert.equal(doc.lines[0].taxSnapshot.id,fed.id);assert.equal(doc.lines[1].taxSnapshot.id,prov.id);
  assert.equal(doc.lines[1].defaultTaxSnapshot.source,"ACCOUNT");
});
test("Clearing/lowering needs a written reason; exemptions retain default and certificate snapshots",async()=>{
  const line={accountId:income.id,description:"TEST lower tax",qty:"1",rate:"100",taxSelection:"SELECTED",taxId:prov.id};
  await assert.rejects(()=>save("invoices",trade({lines:[line]})),/written document-level tax reason/);
  const lower=await post("invoices",trade({lines:[line],taxOverrideReason:"TEST explicit synthetic concession reason"}));
  assert.equal(lower.lines[0].defaultTaxSnapshot.id,fed.id);assert.equal(lower.lines[0].taxSnapshot.id,prov.id);
  const cleared={...line,taxSelection:"CLEARED",taxId:null};
  await assert.rejects(()=>save("invoices",trade({lines:[cleared]})),/written document-level tax reason/);
  const clear=await post("invoices",trade({lines:[cleared],taxOverrideReason:"TEST explicit removal approved for fixture"}));
  eq(clear.taxTotal,"0.0000");assert.equal(clear.lines[0].taxSnapshot,null);assert.equal(clear.lines[0].defaultTaxSnapshot.id,fed.id);
  await assert.rejects(()=>save("parties",{code:"TEST-NO-EVIDENCE",name:"TEST invalid exemption",taxTreatment:"EXEMPT"}),/reason.*certificate/i);
  const exempt=await save("parties",{code:"TEST-EXEMPT",name:"TEST explicit exemption",taxTreatment:"EXEMPT",
    taxExemptionReason:"TEST ONLY synthetic exemption evidence",taxCertificateRef:"TEST-NOT-LEGAL-CERT"});
  const doc=await post("invoices",trade({partyId:exempt.id,lines:[{...line,taxSelection:"AUTO",taxId:null}]}));
  eq(doc.taxTotal,"0.0000");assert.equal(doc.partyTaxCertificate,"TEST-NOT-LEGAL-CERT");
  assert.equal(doc.lines[0].taxSnapshot.percentage,"7.125321");eq(doc.lines[0].taxRate,"0.0000");
  await save("parties",{...exempt,openingBalance:exempt.openingBalance.toFixed(4),taxTreatment:"STANDARD"});
  assert.equal((await getAccountRecord(owner,a.code,"invoices",doc.id)).partyTaxCertificate,"TEST-NOT-LEGAL-CERT");
});
test("Missing defaults/province and invalid dated/applicability selections fail, with no untaxed fallback",async()=>{
  const company=await db.$transaction(tx=>provisionCompany(tx,owner,{code:`TAX-C-${suffix}`,name:"TEST provincial fallback",legalName:"TEST provincial fallback"}),{timeout:60000});
  const party=await save("parties",{code:"TEST-PROVINCE",name:"TEST province required"},company);
  const account=await db.account.findFirstOrThrow({where:{companyId:company.id,code:"4100",active:true}});
  const raw={partyId:party.id,date:day,dueDate:day,lines:[{accountId:account.id,description:"TEST provincial basis",qty:"1",rate:"100"}]};
  await assert.rejects(()=>save("invoices",raw,company),/province|federal/);
  const regional=await tax(company,"TEST-SRB","1.234567",{kind:"PROVINCIAL_SERVICES",authority:"SRB",province:"Sindh"});
  await assert.rejects(()=>save("invoices",raw,company),/province/);
  await save("parties",{...party,openingBalance:party.openingBalance.toFixed(4),province:"Sindh"},company);
  const valid=await save("invoices",{...raw,operation:"preview"},company);
  assert.equal(valid.lines[0].taxSnapshot.id,regional.id);eq(valid.taxTotal,"1.2346");
  await save("parties",{...party,openingBalance:party.openingBalance.toFixed(4),province:"Islamabad Capital Territory"},company);
  await assert.rejects(()=>save("invoices",raw,company),/Islamabad/);
  const expired=await tax(a,"TEST-EXPIRED","2",{isDefault:false,effectiveTo:"2001-01-01"});
  const purchaseOnly=await tax(a,"TEST-PURCHASE-ONLY","2",{isDefault:false,applicability:"PURCHASES"});
  for(const t of [expired,purchaseOnly])await assert.rejects(()=>save("invoices",trade({lines:[{accountId:income.id,description:"TEST invalid selected version",qty:"1",rate:"100",taxSelection:"SELECTED",taxId:t.id}],taxOverrideReason:"TEST explicit lower-rate reason"})),/active|effective|purchases|sales/i);
  await assert.rejects(()=>save("invoices",trade({lines:[{accountId:income.id,description:"TEST cross-company tax",qty:"1",rate:"1",taxSelection:"SELECTED",taxId:retailTax.id}]})),/not found|company/i);
});
test("Retail purchases post input tax and distinct supplier withholding with original outlet tags",async()=>{
  const place=await save("outlets",{code:"TEST-STOCK-LOCATION",name:"TEST retail stock location",type:"SHOWROOM"},b);
  const inventory=place.accounts.find((v:any)=>!v.isCash);
  const party=await save("parties",{code:"TEST-RETAIL-SUPPLIER",name:"TEST retail supplier",isCustomer:false,isSupplier:true},b);
  const doc=await post("bills",{partyId:party.id,date:day,dueDate:day,lines:[{accountId:inventory.id,description:"TEST opening-independent purchase",
    qty:"1",rate:"100",outletId:place.id}]},b);
  eq(doc.taxTotal,"4.3220");
  const rows=await db.journalLine.findMany({where:{entryId:doc.entryId,companyId:b.id}});
  eq(rows.find(l=>l.accountId===retailTax.inputAccountId)!.debit,"4.3220");
  assert.ok(rows.every(l=>l.outletId===place.id));
  const bill=await post("bills",{partyId:supplier.id,date:day,dueDate:day,lines:[{accountId:cost.id,description:"TEST purchase withholding",
    qty:"1",rate:"100",withholdingTaxId:wht.id,departmentId:department.id,outletId:outlet.id}]});
  eq(bill.netTotal,"104.6253");
  const supplierRows=await db.journalLine.findMany({where:{entryId:bill.entryId}});
  eq(supplierRows.find(l=>l.accountId===wht.inputAccountId)!.credit,"2.5000");
  assert.ok(supplierRows.every(l=>l.departmentId===department.id&&l.outletId===outlet.id));
  const source=await db.billLine.findFirstOrThrow({where:{billId:bill.id}});
  const debit=await post("bills",{kind:"DEBIT_NOTE",originalId:bill.id,partyId:supplier.id,date:day,dueDate:day,
    lines:[{originalLineId:source.id,accountId:source.accountId,description:"TEST proportional supplier debit",qty:"0.5",rate:"100",
      taxId:source.taxId,withholdingTaxId:source.withholdingTaxId,departmentId:source.departmentId,outletId:source.outletId}]});
  eq(debit.taxTotal,"3.5627");eq(debit.withholdingTotal,"1.2500");eq(debit.netTotal,"52.3127");
  const reversed=await db.journalLine.findMany({where:{entryId:debit.entryId}});
  eq(reversed.find(l=>l.accountId===fed.inputAccountId)!.credit,"3.5627");
  eq(reversed.find(l=>l.accountId===wht.inputAccountId)!.debit,"1.2500");
  assert.deepEqual((await db.billLine.findFirstOrThrow({where:{billId:debit.id}})).taxSnapshot,source.taxSnapshot);
});
test("Proportional notes retain original snapshots and exhaust fractional withholding exactly",async()=>{
  const amounts=[];
  for(let i=0;i<3;i++) {
    const draft=await note(main,"1");
    await save("invoices",{id:draft.id,operation:"post"});
    amounts.push(await db.invoice.findUniqueOrThrow({where:{id:draft.id}}));
    const line=await db.invoiceLine.findFirstOrThrow({where:{invoiceId:draft.id}});
    assert.deepEqual(line.taxSnapshot,main.lines[0].taxSnapshot);
    assert.deepEqual(line.withholdingSnapshot,main.lines[0].withholdingSnapshot);
    assert.equal(line.outletId,outlet.id);
  }
  eq(amounts.reduce((v,d)=>v.add(d.taxTotal),new Prisma.Decimal("0")),"7.1253");
  eq(amounts.reduce((v,d)=>v.add(d.withholdingTotal),new Prisma.Decimal("0")),"2.5000");
  eq((await getAccountRecord(owner,a.code,"invoices",main.id)).outstanding,"0.0000");
  await assert.rejects(()=>note(main,"0.0001"),/remain|outstanding/);
});
test("Concurrent notes cannot exceed one original or leave a posting/numbering fragment",async()=>{
  const original=await post("invoices",trade({lines:[{accountId:income.id,description:"TEST concurrent note source",qty:"2",rate:"10"}]}));
  const drafts=await Promise.all([note(original,"2"),note(original,"2")]);
  const result=await Promise.allSettled(drafts.map(d=>save("invoices",{id:d.id,operation:"post"})));
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(await db.invoice.count({where:{companyId:a.id,originalId:original.id,status:"POSTED"}}),1);
  const failed=drafts.find((_,i)=>result[i].status==="rejected")!;
  const retained=await db.invoice.findUniqueOrThrow({where:{id:failed.id}});
  assert.equal(retained.status,"DRAFT");assert.equal(retained.number,null);assert.equal(retained.entryId,null);
});
test("Tax-version failure rolls back closure/audit; concurrent versions allocate one successor only",async()=>{
  const specific=await tax(a,"TEST-VERSION-ROLLBACK","1",{isDefault:false});
  const auditBefore=await db.auditLog.count({where:{companyId:a.id}});
  await assert.rejects(()=>save("taxes",{...input(specific),id:undefined,previousVersionId:specific.id,effectiveFrom:next,isDefault:true}),/overlap/);
  assert.equal((await db.tax.findUniqueOrThrow({where:{id:specific.id}})).effectiveTo,null);
  assert.equal(await db.tax.count({where:{companyId:a.id,code:specific.code}}),1);
  assert.equal(await db.auditLog.count({where:{companyId:a.id}}),auditBefore);
  const result=await Promise.allSettled(["2","3"].map(percentage=>save("taxes",{...input(specific),id:undefined,
    previousVersionId:specific.id,effectiveFrom:next,percentage})));
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  assert.deepEqual((await db.tax.findMany({where:{companyId:a.id,code:specific.code},orderBy:{version:"asc"}})).map(t=>t.version),[1,2]);
});
test("Every draft tax reference is company-bound and notes cannot substitute tax or withholding",async()=>{
  const draft=await save("invoices",trade());
  for(const key of ["taxId","defaultTaxId","withholdingTaxId"])
    await assert.rejects(()=>db.invoiceLine.update({where:{id:draft.lines[0].id},data:{[key]:retailTax.id}}));
  const original=await post("invoices",trade({lines:[{accountId:income.id,description:"TEST fixed note tax source",qty:"1",rate:"100",withholdingTaxId:wht.id}]}));
  const source=await db.invoiceLine.findFirstOrThrow({where:{invoiceId:original.id}});
  await assert.rejects(()=>note(original,"1",{lines:[{accountId:income.id,description:"TEST tampered tax",qty:"1",rate:"100",
    originalLineId:source.id,taxSelection:"SELECTED",taxId:retailTax.id,withholdingTaxId:wht.id}]}),/cannot replace|original/i);
  await assert.rejects(()=>save("invoices",trade({lines:[{accountId:income.id,description:"TEST wrong tax kind",qty:"1",rate:"100",withholdingTaxId:fed.id}]})),/withholding/i);
});
test("Tax summary/export dates cancellation in its later period, preserving the original period and input/output separation",async()=>{
  const original=await post("invoices",trade({date:past,dueDate:past,lines:[{accountId:income.id,description:"TEST later-period tax reversal",qty:"1",rate:"100",withholdingTaxId:wht.id}]}));
  const before=await accountsReport(owner,a.code,"tax-summary",{from:day,to:day});
  const prior=await accountsReport(owner,a.code,"tax-summary",{from:past,to:past});
  eq(prior.summary.outputTax,"7.1253");eq(prior.summary.customerWithholding,"2.5000");
  const request=await save("invoices",{id:original.id,operation:"cancel",note:"TEST cancellation in the later financial period"});
  assert.equal(request.approvalRequested,true);
  await assert.rejects(()=>saveRecord(owner,a.code,"approvals",{id:request.approvalId,operation:"approve"}),/own|independent/i);
  await saveRecord(approver,a.code,"approvals",{id:request.approvalId,operation:"approve"});
  const after=await accountsReport(owner,a.code,"tax-summary",{from:day,to:day});
  eq(new Prisma.Decimal(after.summary.outputTax).sub(before.summary.outputTax),"-7.1253");
  eq(new Prisma.Decimal(after.summary.customerWithholding).sub(before.summary.customerWithholding),"-2.5000");
  assert.deepEqual((await accountsReport(owner,a.code,"tax-summary",{from:past,to:past})).summary,prior.summary);
  const report=await accountsReport(owner,a.code,"tax-summary",{from:past,to:day},true);
  assert.ok(report.rows.some((r:any)=>r.direction==="INPUT"));assert.ok(report.rows.some((r:any)=>r.component==="WITHHOLDING"));
  assert.ok((await excelBuffer(report.rows,"tax-summary")).length>500);
  const other=await accountsReport(owner,b.code,"tax-summary",{from:past,to:day},true);
  assert.ok(other.rows.every((r:any)=>r.taxId===retailTax.id));
});
test("Used versions and snapshots are immutable; new versions close dates safely and stale drafts require review",async()=>{
  const stale=await save("invoices",trade());
  await assert.rejects(()=>updateTax(fed,{percentage:"9"}),/new version|posted/i);
  await assert.rejects(()=>db.tax.update({where:{id:fed.id},data:{percentage:"9"}}));
  await assert.rejects(()=>db.tax.delete({where:{id:fed.id}}));
  await assert.rejects(()=>db.invoiceLine.update({where:{id:main.lines[0].id},data:{taxAmount:"0"}}));
  const frozen=await db.invoice.findUniqueOrThrow({where:{id:main.id}});
  await assert.rejects(()=>db.invoice.update({where:{id:main.id},data:{taxTotal:"0",total:frozen.subtotal}}));
  const version=await save("taxes",{...input(fed),id:undefined,previousVersionId:fed.id,effectiveFrom:next,percentage:"8.765432"});
  assert.equal(version.version,2);
  assert.equal((await db.tax.findUniqueOrThrow({where:{id:fed.id}})).effectiveTo!.toISOString().slice(0,10),day);
  await assert.rejects(()=>updateTax(fed,{effectiveTo:past}),/posted original|exclude/i);
  await assert.rejects(()=>db.tax.update({where:{id:fed.id},data:{effectiveTo:previousMonth}}));
  await updateTax(version,{active:false});
  await assert.rejects(()=>updateTax(fed,{effectiveTo:null}),/extended|reopened|new version/i);
  await assert.rejects(()=>db.tax.update({where:{id:fed.id},data:{effectiveTo:null}}));
  await updateTax(version,{active:true});
  await assert.rejects(()=>save("invoices",{id:stale.id,operation:"post"}),/review|save the draft/i);
  await save("invoices",{...trade(),id:stale.id});await save("invoices",{id:stale.id,operation:"post"});
  const count=await db.tax.count({where:{companyId:a.id,code:fed.code}});
  await assert.rejects(()=>save("taxes",{...input(version),id:undefined,previousVersionId:version.id,effectiveFrom:day}),/after|posted|later/);
  assert.equal(await db.tax.count({where:{companyId:a.id,code:fed.code}}),count);
  assert.deepEqual((await db.invoiceLine.findUniqueOrThrow({where:{id:main.lines[0].id}})).taxSnapshot,main.lines[0].taxSnapshot);
  assert.equal((await getAccountRecord(owner,a.code,"taxes",fed.id)).used,true);
  const historicalSource=await post("invoices",trade());
  await updateTax(fed,{active:false});
  try {
    const credit=await note(historicalSource,"1");
    await save("invoices",{id:credit.id,operation:"post"});
    assert.equal((await db.invoiceLine.findFirstOrThrow({where:{invoiceId:credit.id}})).taxId,fed.id);
  } finally {await updateTax(fed,{active:true});}
});
