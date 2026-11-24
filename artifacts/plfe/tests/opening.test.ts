import {before,after,test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import ExcelJS from "exceljs";
import {db} from "../lib/db";
import {config} from "../lib/config";
import {permissionCodes} from "../lib/role-templates";
import {provisionCompany,saveRecord} from "../modules/core/service";
import {saveAccountRecord} from "../modules/accounts/service";
import {openingOverview} from "../modules/accounts/opening-state";
import {saveOpening,requestOpeningReversal} from "../modules/accounts/opening";
import {previewImport,confirmImport} from "../modules/accounts/imports";
import {accountsReport} from "../modules/accounts/reports";
import {readImportFile} from "../modules/accounts/import-file";
import {saveJournalDraft,postEntry} from "../lib/posting";
import type {Actor} from "../modules/core/model";
let owner:Actor,accountant:Actor,admin:Actor,viewer:Actor;
const suffix=randomUUID().slice(0,8).toUpperCase(),reason="TEST reviewed actual opening records and reconciled supporting evidence";
const company=async(retail=false)=>db.$transaction(tx=>provisionCompany(tx,owner,{code:`OB-${randomUUID().slice(0,10)}`,name:"TEST guided opening",legalName:"TEST guided opening",businessType:retail?"RETAIL":"EVENTS"}),{timeout:60000});
const write=(c:any,resource:string,data:any,actor=owner)=>saveAccountRecord(actor,c.code,resource,data);
const open=(c:any,data:any,actor=owner)=>saveOpening(actor,c.code,data);
const state=(c:any)=>openingOverview(owner,c.code) as Promise<any>;
const review=(c:any,stage:string,extra:any={})=>open(c,{operation:"review",stage,reason,...extra});
const capture=(c:any,stage:string,data:any)=>open(c,{operation:"post",requestKey:randomUUID(),stage,...data}) as Promise<any>;
const day=(date:any,offset=0)=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);};
const upload=(text:string,name="parties.csv")=>{const b=Buffer.from(text);return{name,size:b.length,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer};};
const confirm=(c:any,p:any,actor=owner)=>confirmImport(actor,c.code,{operation:"confirm",previewId:p.previewId,confirmationToken:p.confirmationToken,confirmed:true});
async function zeros(c:any) {
  const s=await state(c);
  for(const a of s.accounts.cash)await capture(c,"CASH",{accountId:a.id,amount:"0.0000"});
  await review(c,"CASH");
  for(const a of (await state(c)).accounts.bank)await capture(c,"BANK",{accountId:a.id,amount:"0.0000",statementReference:"TEST actual zero statement"});
  await review(c,"BANK");
}
before(async()=>{
  assert.ok(new URL(config.databaseUrl||"").pathname.endsWith("_test"));
  const user=(name:string,isOwner=false)=>db.user.create({data:{name:`TEST ${name}`,email:`opening-${name}-${suffix}@test.invalid`.toLowerCase(),passwordHash:"no-login-disposable-test-identity",isOwner,mustChangePassword:false}});
  owner=await user("owner",true);accountant=await user("accountant");admin=await user("admin");viewer=await user("viewer");
  await db.permission.createMany({data:permissionCodes.map(code=>({code,description:code})),skipDuplicates:true});
},{timeout:60000});
after(async()=>db.$disconnect());

test("Guided opening orders every stage, preserves overdue dates, posts exact retail valuation and declares once",{timeout:60000},async()=>{
  const c=await company(true),initial=await state(c),gl=day(initial.company.goLiveDate);
  const outlet:any=await write(c,"outlets",{code:"TEST-SHOWROOM",name:"TEST physical location",type:"SHOWROOM"});
  const p:any=await write(c,"parties",{code:"TEST-OPEN-PARTY",name:"TEST historical party",isCustomer:true,isSupplier:true});
  const capital:any=await write(c,"chart",{code:"TEST-OPEN-CAPITAL",name:"TEST opening capital",type:"EQUITY"});
  await assert.rejects(review(c,"BANK"),/order|stage|cash/i);
  const cash=(await state(c)).accounts.cash;
  for(const [i,a]of cash.entries())await capture(c,"CASH",{accountId:a.id,amount:i?"0.0000":"100.1234"});
  await review(c,"CASH");
  const banks=(await state(c)).accounts.bank;
  for(const [i,a]of banks.entries())await capture(c,"BANK",{accountId:a.id,amount:i?"0.0000":"20.0000",statementReference:"TEST verified bank statement"});
  await review(c,"BANK");
  const ar:any=await capture(c,"RECEIVABLES",{partyId:p.id,amount:"30.5678",originalReference:"TEST-HIST-AR",originalDate:day(gl,-30),dueDate:day(gl,-10)});
  await review(c,"RECEIVABLES");
  await capture(c,"PAYABLES",{partyId:p.id,amount:"10.1111",originalReference:"TEST-HIST-AP",originalDate:day(gl,-35),dueDate:day(gl,-15)});
  await review(c,"PAYABLES");
  await capture(c,"STOCK",{outletId:outlet.id,stockCode:"TEST-CHAIR",description:"TEST actual counted item",quantity:"2.0000",unitCost:"5.5555"});
  await review(c,"STOCK",{locationIds:(await state(c)).outlets.map((o:any)=>o.id)});
  await assert.rejects(review(c,"JOURNAL"),/equity|unmatched|reconcil/i);
  await capture(c,"JOURNAL",{lines:[{accountId:capital.id,debit:"0.0000",credit:"151.6911",memo:"TEST opening capital reconciliation"}]});
  await review(c,"JOURNAL");
  const ready=await state(c);assert.equal(ready.nextStage,"READY");assert.equal(ready.reconciliation.openingEquityBalance,"0.0000");
  const invoice=await db.invoice.findFirstOrThrow({where:{companyId:c.id,openingRecordId:ar.id},include:{entry:true,lines:true}});
  assert.equal(day(invoice.date),day(gl,-30));assert.equal(day(invoice.dueDate),day(gl,-10));assert.equal(day(invoice.entry!.date),gl);
  assert.equal(invoice.taxTotal.toFixed(4),"0.0000");assert.equal(invoice.partyTaxTreatment,"OPENING_BALANCE");
  assert.equal(invoice.lines[0].taxSnapshot,null);assert.ok(invoice.number!.includes("/ORI/"));
  const tax:any=await accountsReport(owner,c.code,"tax-summary",{from:gl,to:gl});assert.equal(tax.rows.length,0);
  const ageing:any=await accountsReport(owner,c.code,"party-ageing",{});
  assert.equal(ageing.rows.find((r:any)=>r.id===invoice.id)?.outstanding,"30.5678");
  assert.equal(ageing.rows.find((r:any)=>r.id===invoice.id)?.opening,true);
  await assert.rejects(write(c,"invoices",{id:invoice.id,kind:"INVOICE",partyId:p.id,date:gl,dueDate:gl,lines:[]}),/immutable|posted/i);
  await assert.rejects(db.openingRecord.update({where:{id:ar.id},data:{amount:"31.0000"}}),/immutable|cannot|posted/i);
  const declared=await Promise.allSettled([open(c,{operation:"declare",confirmed:true}),open(c,{operation:"declare",confirmed:true})]);
  assert.equal(declared.filter(r=>r.status==="fulfilled").length,1);
  const final=await state(c);assert.equal(final.nextStage,"OPEN");assert.equal(day(final.company.lockDate),day(gl,-1));
  await assert.rejects(review(c,"JOURNAL"),/locked|open/i);
  await assert.rejects(open(c,{operation:"configure",goLiveDate:gl}),/locked|open/i);
  await assert.rejects(db.company.update({where:{id:c.id},data:{booksOpenedAt:null,booksOpenedBy:null,booksOpenEvidence:null as any}}),/permanent|declared|immutable/i);
});

test("Go-live is an open period boundary and protects ordinary saves and direct journal paths",{timeout:60000},async()=>{
  const c=await company(),s=await state(c),gl=day(s.company.goLiveDate);
  await assert.rejects(open(c,{operation:"configure",goLiveDate:day(gl,1)}),/period|first/i);
  await open(c,{operation:"configure",goLiveDate:gl});
  const p:any=await write(c,"parties",{code:"TEST-DATE-P",name:"TEST date party"});
  const income=await db.account.findFirstOrThrow({where:{companyId:c.id,type:"INCOME",isGroup:false}});
  await assert.rejects(write(c,"invoices",{kind:"INVOICE",partyId:p.id,date:day(gl,-1),dueDate:gl,lines:[{accountId:income.id,description:"TEST",quantity:"1",rate:"1"}]}),/go.live/i);
  const settings=await db.accountingSettings.findUniqueOrThrow({where:{companyId:c.id}});
  await assert.rejects(db.$transaction(tx=>saveJournalDraft(tx,owner,c.id,{date:day(gl,-1),journalId:settings.generalJournalId,kind:"JOURNAL",sourceType:"ENTRY",sourceId:randomUUID(),narration:"TEST backdated",lines:[]} as any,"accounts.voucher.create")),/go.live/i);
  const cash=s.accounts.cash[0];
  await assert.rejects(db.$transaction(tx=>postEntry(tx,owner,c.id,{date:day(gl,-1),journalId:settings.generalJournalId,kind:"JOURNAL",sourceType:"TEST",sourceId:randomUUID(),lines:[
    {accountId:cash.id,debit:"1.0000",credit:"0.0000"},{accountId:settings.openingEquityAccountId,debit:"0.0000",credit:"1.0000"}]} as any,"accounts.journal.post")),/go.live/i);
  await capture(c,"CASH",{accountId:cash.id,amount:"0.0000"});
  await assert.rejects(open(c,{operation:"configure",goLiveDate:gl}),/posting|capture/i);
});

test("Opening capabilities exclude Admin and Viewer; same-key retries are idempotent and different keys cannot duplicate cash",{timeout:60000},async()=>{
  const c=await company();
  for(const [actor,name]of [[accountant,"Accountant"],[admin,"Admin"],[viewer,"Viewer"]] as const) {
    const r=await db.role.findFirstOrThrow({where:{companyId:c.id,name}});
    await saveRecord(owner,c.code,"memberships",{userId:actor.id,roleId:r.id});
  }
  await openingOverview(accountant,c.code);
  for(const a of [admin,viewer])await assert.rejects(openingOverview(a,c.code),/permission|access/i);
  const s=await state(c),input={operation:"post",stage:"CASH",requestKey:randomUUID(),accountId:s.accounts.cash[0].id,amount:"0.0000"};
  const [a,b]:any[]=await Promise.all([open(c,input),open(c,input)]);assert.equal(a.id,b.id);
  assert.equal(await db.openingRecord.count({where:{companyId:c.id}}),1);
  await assert.rejects(open(c,{...input,requestKey:randomUUID()}),/captured|already|duplicate/i);
  await assert.rejects(open(c,{...input,amount:"1.0000"}),/retry|key|different/i);
  await assert.rejects(saveOpening(accountant,(await company()).code,input),/permission|access|company/i);
});

test("A written reopening invalidates later reviews and zero captures reverse only through independent approval",{timeout:60000},async()=>{
  const c=await company(),r=await db.role.findFirstOrThrow({where:{companyId:c.id,name:"Accountant"}});
  await saveRecord(owner,c.code,"memberships",{userId:accountant.id,roleId:r.id});
  await zeros(c);await review(c,"RECEIVABLES");await review(c,"PAYABLES");await review(c,"STOCK");await review(c,"JOURNAL");
  const record=await db.openingRecord.findFirstOrThrow({where:{companyId:c.id,stage:"CASH"}});
  const requested:any=await requestOpeningReversal(owner,c.code,{id:record.id,operation:"cancel",note:reason});
  assert.ok(requested.approvalRequested);
  await assert.rejects(open(c,{operation:"declare",confirmed:true}),/pending|approval|reversal/i);
  await assert.rejects(saveRecord(owner,c.code,"approvals",{id:requested.approvalId,operation:"approve"}),/own/i);
  await saveRecord(accountant,c.code,"approvals",{id:requested.approvalId,operation:"approve",note:reason});
  assert.equal((await db.openingRecord.findUniqueOrThrow({where:{id:record.id}})).status,"CANCELLED");
  await open(c,{operation:"reopen-review",stage:"CASH",reason});
  assert.equal((await state(c)).nextStage,"CASH");
  assert.equal((await state(c)).stages.find((s:any)=>s.key==="BANK").reviewed,false);
});

test("Import preview reports all bad rows without writes, then stages exact amounts without posting",{timeout:60000},async()=>{
  const c=await company(),bad:any=await previewImport(owner,c.code,"parties",upload("code,name,province,openingBalance,openingSide,isSupplier\nDUP,,Wrong,1.00001,PAYABLE,false\ndup,=1+1,Punjab,1,PAYABLE,false"));
  assert.equal(bad.valid,false);assert.ok(bad.errors.some((e:any)=>e.row===2));assert.ok(bad.errors.some((e:any)=>e.row===3));
  for(const row of [2,3])assert.ok(bad.errors.some((e:any)=>e.row===row&&e.column==="code"&&/duplicate/i.test(e.reason)));
  const nul:any=await previewImport(owner,c.code,"parties",upload("code,name\nTEST\0UNSAFE,TEST rejected control character"));
  assert.equal(nul.valid,false);assert.ok(nul.errors.some((e:any)=>/control/i.test(e.reason)));
  assert.equal(await db.party.count({where:{companyId:c.id}}),0);assert.equal(await db.importPreview.count({where:{companyId:c.id}}),0);
  const p:any=await previewImport(owner,c.code,"parties",upload("code,name,province,ntn,strn,openingBalance,openingSide\nTEST-I,TEST import,Punjab,TEST-NTN,TEST-STRN,12.3456,RECEIVABLE"));
  assert.equal(p.valid,true);assert.equal(await db.party.count({where:{companyId:c.id}}),0);
  await assert.rejects(confirmImport(owner,c.code,{operation:"confirm",previewId:p.previewId,confirmationToken:p.confirmationToken,confirmed:true,rows:[]}),/unrecognized|key/i);
  const done:any=await confirm(c,p);assert.equal(done.created,1);assert.equal(done.stagedOpeningCount,1);
  const created=await db.party.findFirstOrThrow({where:{companyId:c.id,code:"TEST-I"}});
  assert.equal(created.province,"Punjab");assert.equal(created.openingBalance.toFixed(4),"0.0000");
  const staged=await db.openingStagedAmount.findFirstOrThrow({where:{companyId:c.id,partyId:created.id}});
  assert.equal(staged.amount.toFixed(4),"12.3456");
  assert.equal(await db.journalEntry.count({where:{companyId:c.id}}),0);assert.equal(await db.invoice.count({where:{companyId:c.id}}),0);
  await assert.rejects(confirm(c,p),/used|expired/i);
  await assert.rejects(write(c,"parties",{code:"TEST-LEGACY",name:"TEST legacy bypass",openingBalance:"1.0000"}),/guided|opening/i);
});

test("Import confirmation binds actor/company/current data and never accepts tampered or concurrent replay",{timeout:60000},async()=>{
  const c=await company(),other=await company(),p:any=await previewImport(owner,c.code,"parties",upload("code,name\nTEST-STALE,TEST stale"));
  await write(c,"parties",{code:"TEST-CHANGE",name:"TEST changed context"});
  await assert.rejects(confirm(c,p),/changed|preview/i);
  assert.equal(await db.party.count({where:{companyId:c.id,code:"TEST-STALE"}}),0);
  const next:any=await previewImport(owner,c.code,"parties",upload("code,name\nTEST-REPLAY,TEST replay"));
  await assert.rejects(confirmImport(owner,c.code,{operation:"confirm",previewId:next.previewId,confirmationToken:"x".repeat(43),confirmed:true}),/tamper/i);
  await assert.rejects(confirm(other,next),/not found/i);
  const results=await Promise.allSettled([confirm(c,next),confirm(c,next)]);
  assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(await db.party.count({where:{companyId:c.id,code:"TEST-REPLAY"}}),1);
});

test("Chart imports resolve same-file groups in any order and reject cycles, foreign parents and managed company children",{timeout:60000},async()=>{
  const c=await company(),ok:any=await previewImport(owner,c.code,"chart",upload("code,name,type,parentCode,isGroup\nTEST-CHILD,TEST child,ASSET,TEST-PARENT,false\nTEST-PARENT,TEST group,ASSET,,true","chart.csv"));
  assert.equal(ok.valid,true);await confirm(c,ok);
  const child=await db.account.findFirstOrThrow({where:{companyId:c.id,code:"TEST-CHILD"}});
  const parent=await db.account.findFirstOrThrow({where:{companyId:c.id,code:"TEST-PARENT"}});
  assert.equal(child.parentId,parent.id);
  const bad:any=await previewImport(owner,c.code,"chart",upload("code,name,type,parentCode,isGroup\nTEST-A,TEST A,ASSET,TEST-B,true\nTEST-B,TEST B,ASSET,TEST-A,true\nTEST-C,TEST C,ASSET,FOREIGN,false\nTEST-D,TEST D,ASSET,1600,false","chart.csv"));
  assert.equal(bad.valid,false);
  for(const row of [2,3,4,5])assert.ok(bad.errors.some((e:any)=>e.row===row),`Missing rejection for row ${row}`);
  assert.equal(await db.account.count({where:{companyId:c.id,code:{in:["TEST-A","TEST-B","TEST-C","TEST-D"]}}}),0);
});

test("Workbook import rejects formulas and reads original numeric digits without JS-float loss",async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Parties");
  sheet.addRow(["code","name","openingBalance","openingSide"]);sheet.addRow(["TEST-XLSX","TEST exact",12.3456,"RECEIVABLE"]);
  const bytes=Buffer.from(await book.xlsx.writeBuffer());
  const parsed=await readImportFile("parties.xlsx",bytes);assert.equal(parsed.rows[0][2].text,"12.3456");assert.equal(parsed.errors.length,0);
  sheet.getCell("C2").value={formula:"1+2",result:3};
  const unsafe=await readImportFile("parties.xlsx",Buffer.from(await book.xlsx.writeBuffer()));
  assert.ok(unsafe.errors.some(e=>/formula/i.test(e.reason)));
  const bomb=Buffer.from(bytes);
  for(let i=0;i<bomb.length-46;i++)if(bomb.readUInt32LE(i)===0x02014b50) {
    const length=bomb.readUInt16LE(i+28),name=bomb.subarray(i+46,i+46+length).toString("utf8");
    if(name==="xl/worksheets/sheet1.xml"){bomb.writeUInt32LE(1,i+24);break;}
  }
  await assert.rejects(readImportFile("false-sizes.xlsx",bomb),/corrupt|safe size|inconsistent/i);
  await assert.rejects(readImportFile("renamed.xlsx",Buffer.from("not a workbook at all, just unrelated bytes")),/genuine|invalid/i);
});

test("Opening invoices reverse atomically with their source at go-live, retaining originals and numbering",{timeout:60000},async()=>{
  const c=await company(),role=await db.role.findFirstOrThrow({where:{companyId:c.id,name:"Accountant"}});
  await saveRecord(owner,c.code,"memberships",{userId:accountant.id,roleId:role.id});
  const p:any=await write(c,"parties",{code:"TEST-REVERSE-AR",name:"TEST reverse historical balance"});
  const gl=day((await state(c)).company.goLiveDate);
  await zeros(c);
  const source:any=await capture(c,"RECEIVABLES",{partyId:p.id,amount:"0.1234",originalReference:"TEST-OLD-REVERSE",originalDate:day(gl,-40),dueDate:day(gl,-20)});
  const invoice=await db.invoice.findFirstOrThrow({where:{companyId:c.id,openingRecordId:source.id}});
  const request:any=await write(c,"invoices",{operation:"cancel",id:invoice.id,note:reason});
  await saveRecord(accountant,c.code,"approvals",{id:request.approvalId,operation:"approve",note:reason});
  const result=await db.openingRecord.findUniqueOrThrow({where:{id:source.id},include:{entry:true,reversalEntry:true}});
  assert.equal(result.status,"CANCELLED");assert.equal(day(result.reversalEntry!.date),gl);
  assert.equal(result.entry!.status,"POSTED");assert.equal(result.entry!.number,invoice.number);
  assert.equal((await db.invoice.findUniqueOrThrow({where:{id:invoice.id}})).status,"CANCELLED");
  assert.equal((await state(c)).reconciliation.openingEquityBalance,"0.0000");
  assert.equal((await accountsReport(owner,c.code,"party-ageing",{}) as any).rows.length,0);
});

test("Staged balances must be deliberately posted; partial use cannot be discarded",{timeout:60000},async()=>{
  const c=await company(),preview:any=await previewImport(owner,c.code,"parties",upload("code,name,openingBalance,openingSide\nTEST-QUEUE,TEST staged,12.3456,RECEIVABLE"));
  await confirm(c,preview);await zeros(c);
  const queue=await db.openingStagedAmount.findFirstOrThrow({where:{companyId:c.id}}),gl=day((await state(c)).company.goLiveDate);
  await assert.rejects(review(c,"RECEIVABLES"),/staged|remain|import/i);
  await capture(c,"RECEIVABLES",{partyId:queue.partyId,stagedImportId:queue.id,amount:"2.3456",originalReference:"TEST-Q-1",originalDate:day(gl,-30),dueDate:day(gl,-15)});
  await assert.rejects(open(c,{operation:"cancel-staged",id:queue.id,reason}),/partial|posted|unposted/i);
  const remaining=(await state(c)).stagedImports.find((q:any)=>q.id===queue.id).remaining;assert.equal(remaining,"10.0000");
  await capture(c,"RECEIVABLES",{partyId:queue.partyId,stagedImportId:queue.id,amount:"10.0000",originalReference:"TEST-Q-2",originalDate:day(gl,-30),dueDate:day(gl,-15)});
  await review(c,"RECEIVABLES");assert.equal((await state(c)).nextStage,"PAYABLES");
});

test("A late database rejection rolls back an entire confirmed import without consuming its review",{timeout:60000},async()=>{
  const c=await company(),preview:any=await previewImport(owner,c.code,"parties",upload("code,name,openingBalance,openingSide\nTEST-ATOMIC-FIRST,TEST first,1.0000,RECEIVABLE\nTEST-ATOMIC-REJECT,TEST rejected,2.0000,RECEIVABLE"));
  // Add a TEST-ONLY extra rejection, never disable/alter an accounting guard.
  await db.$executeRawUnsafe(`CREATE FUNCTION plfe_test_import_rejection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code='TEST-ATOMIC-REJECT' THEN RAISE EXCEPTION 'TEST forced late rejection'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER plfe_test_import_rejection BEFORE INSERT ON parties FOR EACH ROW EXECUTE FUNCTION plfe_test_import_rejection()`);
  try {
    await assert.rejects(confirm(c,preview),/forced late rejection/i);
    assert.equal(await db.party.count({where:{companyId:c.id}}),0);
    assert.equal(await db.openingStagedAmount.count({where:{companyId:c.id}}),0);
    assert.equal((await db.importPreview.findUniqueOrThrow({where:{id:preview.previewId}})).confirmedAt,null);
    assert.equal(await db.journalEntry.count({where:{companyId:c.id}}),0);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER plfe_test_import_rejection ON parties`);
    await db.$executeRawUnsafe(`DROP FUNCTION plfe_test_import_rejection()`);
  }
  await confirm(c,preview);assert.equal(await db.party.count({where:{companyId:c.id}}),2);
});
