import {db} from "@/lib/db";
import {Prisma} from "@prisma/client";
import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {reverseEntry,archiveJournalDraft} from "@/lib/posting";
import type {Actor} from "@/modules/core/model";
import {installChart} from "./bootstrap";
import {saveSettings} from "./masters";
import {cancelDocument,saveDocument} from "./documents";
import {authorize,ledgerLock,type Tx} from "./model";
import {requireBootstrapOwner,initializeCompanyCalendar} from "./group";
import {accountingToday} from "./time";

/** Refuse even unposted/archived non-demo financial data. Reversals must link to a TEST-P2 original. */
export async function assertDemoOnly(tx:Tx,companyId:string) {
  for(const model of [tx.invoice,tx.bill,tx.payment] as const) {
    if(await (model as any).findFirst({where:{companyId,OR:[{narration:null},{NOT:{narration:{startsWith:"TEST-P2/"}}}]}}))
      throw new AppError(409,"Chart correction refused: non-TEST-P2 financial documents exist");
  }
  const entries=await tx.journalEntry.findMany({where:{companyId},select:{id:true,narration:true,reversalOfId:true}});
  const demos=new Set(entries.filter(e=>e.narration?.startsWith("TEST-P2/")).map(e=>e.id));
  if(entries.some(e=>!demos.has(e.id)&&!(e.reversalOfId&&demos.has(e.reversalOfId))))
    throw new AppError(409,"Chart correction refused: non-TEST-P2 journal entries exist");
  if(await tx.party.findFirst({where:{companyId,openingBalance:{not:"0"}}}))
    throw new AppError(409,"Chart correction refused: party opening balances exist");
}

/**
 * Explicit, Owner-only maintenance service; not an HTTP action or normal initializer.
 * One transaction retains originals, posts linked reversals, retires old chart rows,
 * installs new company-owned rows and updates validated posting mappings.
 * Existing approval rules, lock dates, periods and numbering counters are never bypassed/reset.
 */
export async function correctDemoChart(actor:Actor,companyCode:string,targetStartMonth?:number) {
  return db.$transaction(async tx=>{
    await requireBootstrapOwner(tx,actor);
    const company=await tx.company.findFirstOrThrow({where:{code:companyCode,deletedAt:null}});
    await authorize(tx,actor,company.id,"accounts.settings.update");
    await ledgerLock(tx,company.id);
    const current=await tx.accountingSettings.findFirst({where:{companyId:company.id,deletedAt:null},include:{receivableAccount:true,openingEquityAccount:true}});
    const oldChart=current&&current.receivableAccount.code==="1200"&&current.openingEquityAccount.code==="3900";
    if(targetStartMonth!==undefined&&(!Number.isInteger(targetStartMonth)||targetStartMonth<1||targetStartMonth>12))throw new AppError(400,"Invalid target calendar start month");
    const spec={startMonth:targetStartMonth??company.fyStartMonth};
    const calendarChange=company.fyStartMonth!==spec.startMonth;
    if(!oldChart&&!calendarChange)return false;
    await assertDemoOnly(tx,company.id);
    // Cancellation has its usual dependency order: payments, notes, originals, vouchers.
    // This operator-only conversion is specifically authorized by the Owner; no approval
    // rule is disabled and the shared reversal service enforces dates and DB invariants.
    for(const resource of ["payments","invoices","bills"] as const) {
      const model=resource==="payments"?tx.payment:resource==="invoices"?tx.invoice:tx.bill;
      const drafts=await (model as any).findMany({where:{companyId:company.id,status:"DRAFT",deletedAt:null}});
      for(const draft of drafts)await saveDocument(tx,actor,company.id,resource,{id:draft.id,operation:"delete"});
      const rows=await (model as any).findMany({where:{companyId:company.id,status:"POSTED"},orderBy:{createdAt:"desc"}});
      rows.sort((a:any,b:any)=>Number(!!b.originalId)-Number(!!a.originalId));
      for(const row of rows)await cancelDocument(tx,actor,company.id,resource,row.id,"TEST-P2/chart-correction",`accounts.${resource==="payments"?"payment":resource==="invoices"?"invoice":"bill"}.cancel`);
    }
    const vouchers=await tx.journalEntry.findMany({where:{companyId:company.id,status:"POSTED",sourceType:"ENTRY",reversalOfId:null}});
    for(const entry of vouchers) {
      if(!await tx.journalEntry.findFirst({where:{companyId:company.id,reversalOfId:entry.id}}))
        await reverseEntry(tx,actor,company.id,entry.id,accountingToday(),"TEST-P2/chart-correction","accounts.entry.cancel");
    }
    for(const draft of await tx.journalEntry.findMany({where:{companyId:company.id,status:"DRAFT",sourceType:"ENTRY",deletedAt:null}}))
      await archiveJournalDraft(tx,actor,company.id,draft.id);
    if(oldChart) {
      for(const before of await tx.account.findMany({where:{companyId:company.id,deletedAt:null}})) {
        // Allocated links and their non-posting parents remain permanent, even
        // during this legacy demo-only maintenance operation.
        if(before.counterpartyCompanyId||before.outletId||await tx.account.findFirst({where:{companyId:company.id,parentId:before.id,OR:[{counterpartyCompanyId:{not:null}},{outletId:{not:null}}]}}))continue;
        if(await tx.tax.findFirst({where:{companyId:company.id,OR:[{outputAccountId:before.id},{inputAccountId:before.id}]}}))continue;
        const sums=await tx.journalLine.aggregate({where:{companyId:company.id,accountId:before.id,entry:{status:"POSTED"}},_sum:{debit:true,credit:true}});
        if(!new Prisma.Decimal(sums._sum.debit??"0").eq(sums._sum.credit??"0"))
          throw new AppError(409,"Chart correction refused: old account balance is not zero");
        const after=await tx.account.update({where:{id:before.id,companyId:company.id},data:{code:`LEGACY-${before.code}-${before.id}`,active:false,updatedBy:actor.id}});
        await audit(tx,actor,company.id,"UPDATE","accounts",before.id,before,after);
      }
      const type=await tx.businessType.findUniqueOrThrow({where:{code:company.businessType}});
      const accounts=await installChart(tx,actor,company.id,type.chartKind);
      for(const [group,root] of [["1100","1000"],["1700","1000"],["1600","1000"],["2500","2000"]]) {
        const before=await tx.account.findUniqueOrThrow({where:{id:accounts.get(group)!}});
        if(before.parentId!==accounts.get(root)) {
          const after=await tx.account.update({where:{id:before.id},data:{parentId:accounts.get(root),updatedBy:actor.id}});
          await audit(tx,actor,company.id,"UPDATE","accounts",before.id,before,after);
        }
      }
      await saveSettings(tx,actor,company.id,{...current,receivableAccountId:accounts.get("1300"),payableAccountId:accounts.get("2100"),openingEquityAccountId:accounts.get("3990")});
    }
    if(calendarChange) {
      // Keep fiscal IDs and counters referenced by immutable TEST-P2 entries. Only
      // correct a calendar when every original posting fits the replacement year.
      const years=await tx.fiscalYear.findMany({where:{companyId:company.id,deletedAt:null}});
      if(years.length>1)throw new AppError(409,"Calendar correction requires at most one demo financial year");
      for(const before of years) {
        const today=accountingToday(),month=spec.startMonth-1;
        const year=today.getUTCFullYear()-(today.getUTCMonth()<month?1:0);
        const startDate=new Date(Date.UTC(year,month,1)),endDate=new Date(Date.UTC(year+1,month,0));
        if(before.isClosed||company.lockDate||await tx.period.findFirst({where:{companyId:company.id,fiscalYearId:before.id,isClosed:true}}))
          throw new AppError(409,"Calendar correction refuses locked dates and closed years/periods");
        if(await tx.journalEntry.findFirst({where:{companyId:company.id,fiscalYearId:before.id,OR:[{date:{lt:startDate}},{date:{gt:endDate}}]}}))
          throw new AppError(409,"Demo postings span calendar years; explicit accountant review required");
        // Soft-retain the old periods; never delete financial configuration/history.
        for(const period of await tx.period.findMany({where:{companyId:company.id,fiscalYearId:before.id,deletedAt:null}})) {
          const after=await tx.period.update({where:{id:period.id},data:{deletedAt:new Date(),updatedBy:actor.id}});
          await audit(tx,actor,company.id,"CANCEL","periods",period.id,period,after);
        }
        const after=await tx.fiscalYear.update({where:{id:before.id},data:{name:String(year),startDate,endDate,updatedBy:actor.id}});
        await audit(tx,actor,company.id,"UPDATE","fiscal_years",before.id,before,after);
      }
      const after=await tx.company.update({where:{id:company.id},data:{fyStartMonth:spec.startMonth,updatedBy:actor.id}});
      await audit(tx,actor,company.id,"UPDATE","companies",company.id,company,after);
      await initializeCompanyCalendar(tx,actor,after);
    }
    return true;
  },{timeout:120000,maxWait:30000});
}
