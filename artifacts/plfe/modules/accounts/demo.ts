import {db} from "@/lib/db";
import {companyScope} from "@/lib/permissions";
import {AppError} from "@/lib/errors";
import {uploadFile} from "@/lib/files";
import type {Actor} from "@/modules/core/model";
import {saveAccountRecord} from "./service";
import {accountingToday} from "./time";

const prefix="TEST-P2/";
/** Explicit demo fixture, never run by normal startup or production migrations. */
export async function seedDemoBooks(actor:Actor,code:string) {
  const company=await db.$transaction(tx=>companyScope(tx,actor,code,"accounts.entry.post"));
  const companyId=company.id;
  if(await db.journalEntry.findFirst({where:{companyId,status:"POSTED",NOT:{narration:{startsWith:prefix}}}}))
    throw new AppError(409,"Demo data requires empty or existing TEST-P2 books; use the isolated test database for live books");
  const accounts=await db.account.findMany({where:{companyId,deletedAt:null}});
  const journals=await db.journal.findMany({where:{companyId,deletedAt:null}});
  const department=await db.department.findFirstOrThrow({where:{companyId,code:"EVENTS",deletedAt:null}});
  const a=(c:string)=>{const account=accounts.find(a=>a.code===c);if(!account)throw new AppError(409,"Expo chart is incomplete");return account.id;};
  const journal=journals.find(j=>j.type==="GENERAL")!;
  const date=accountingToday().toISOString().slice(0,10);
  async function party(customer:boolean) {
    const code=customer?"TEST-P2-CUSTOMER":"TEST-P2-SUPPLIER";
    return await db.party.findFirst({where:{companyId,code,deletedAt:null}})??await saveAccountRecord(actor,company.code,"parties",{code,name:customer?"TEST DATA — Expo exhibitor":"TEST DATA — Expo supplier",isCustomer:customer,isSupplier:!customer,isExhibitor:customer});
  }
  const customer=await party(true),supplier=await party(false);
  async function document(resource:"invoices"|"bills"|"payments"|"entries",index:string,payload:any) {
    const narration=prefix+index;
    const model:any=({invoices:db.invoice,bills:db.bill,payments:db.payment,entries:db.journalEntry})[resource];
    let row=await model.findFirst({where:{companyId,narration,deletedAt:null}});
    if(!row)row=await saveAccountRecord(actor,company.code,resource,{...payload,narration,date});
    if(resource==="entries"&&payload.kind==="EXPENSE"&&!await db.attachment.findFirst({where:{companyId,docType:"ENTRY",docId:row.id,deletedAt:null}})) {
      const form=new FormData();form.set("docType","ENTRY");form.set("docId",row.id);
      form.set("file",new File(["TEST DATA ONLY\nExpo marketing bill\nAmount PKR 3500.0000\nNot a real supplier bill."],"TEST-P2-expense-bill.txt",{type:"text/plain"}));
      await uploadFile(actor,company.code,form);
    }
    if(row.status==="DRAFT") {
      const posted=await saveAccountRecord(actor,company.code,resource,{operation:"post",id:row.id});
      if(posted.approvalRequested)throw new AppError(409,"Demo posting needs independent approval under the current company rule");
      row=posted;
    }
    return row;
  }
  const voucher=(index:string,kind:string,dr:string,cr:string,amount:string,partyId?:string)=>document("entries",index,{kind,journalId:journal.id,lines:[
    {accountId:a(dr),debit:amount,credit:"0.0000",departmentId:department.id},
    {accountId:a(cr),debit:"0.0000",credit:amount,departmentId:department.id,partyId}
  ]});
  const invoice=(index:string,rate:string,account="4100",originalId?:string)=>document("invoices",index,{kind:originalId?"CREDIT_NOTE":"INVOICE",partyId:customer.id,dueDate:date,originalId,lines:[{accountId:a(account),description:"TEST DATA — expo charge",qty:"1.0000",rate,departmentId:department.id}]});
  const bill=(index:string,rate:string,account="5100",originalId?:string)=>document("bills",index,{kind:originalId?"DEBIT_NOTE":"BILL",partyId:supplier.id,dueDate:date,originalId,lines:[{accountId:a(account),description:"TEST DATA — expo cost",qty:"1.0000",rate,departmentId:department.id}]});
  const payment=(index:string,direction:string,amount:string,cash:boolean,allocations:any[]=[])=>document("payments",index,{direction,method:cash?"CASH":"BANK",partyId:direction==="RECEIPT"?customer.id:supplier.id,settlementAccountId:a(cash?"1110":"1120"),amount,allocations,departmentId:department.id});
  await voucher("01-opening","JOURNAL","1120","3900","1000000.0000");
  await voucher("02-bank-to-cash","TRANSFER","1110","1120","100000.0000");
  const inv1=await invoice("03-invoice","100000.0000");
  const inv2=await invoice("04-sponsor-invoice","60000.0000","4200");
  const inv3=await invoice("05-cancellation-candidate","25000.0000");
  const bill1=await bill("06-venue-bill","40000.0000");
  const bill2=await bill("07-printing-bill","20000.0000","5600");
  await invoice("08-credit-note","5000.0000","4200",inv2.id);
  await bill("09-debit-note","2000.0000","5600",bill2.id);
  await payment("10-part-receipt","RECEIPT","40000.0000",false,[{invoiceId:inv1.id,amount:"40000.0000"}]);
  await payment("11-receipt-with-advance","RECEIPT","25000.0000",true,[{invoiceId:inv2.id,amount:"20000.0000"}]);
  await payment("12-supplier-payment","PAYMENT","15000.0000",false,[{billId:bill1.id,amount:"15000.0000"}]);
  await payment("13-cash-payment","PAYMENT","5000.0000",true,[{billId:bill2.id,amount:"5000.0000"}]);
  await voucher("14-expense-with-bill","EXPENSE","5500","1120","3500.0000");
  await voucher("15-cash-voucher","CASH","5300","1110","1200.0000");
  await voucher("16-bank-voucher","BANK","5700","1120","2400.0000");
  await voucher("17-accrual-journal","JOURNAL","5400","2100","1800.0000",supplier.id);
  const inv4=await invoice("18-showroom-invoice","12500.0000","4300");
  await bill("19-fabrication-bill","6500.0000","5200");
  const advance=await payment("20-advance-applied","RECEIPT","10000.0000",false);
  if(!await db.paymentAllocation.findFirst({where:{companyId,paymentId:advance.id,invoiceId:inv4.id,deletedAt:null}}))
    await saveAccountRecord(actor,company.code,"payments",{operation:"allocate",id:advance.id,allocations:[{invoiceId:inv4.id,amount:"10000.0000"}]});
  return {companyId,code:company.code,customerId:customer.id,supplierId:supplier.id,partPaidInvoiceId:inv1.id,cancellationInvoiceId:inv3.id,advancePaymentId:advance.id};
}
