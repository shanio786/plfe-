import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "@/lib/db";
import {companyScope} from "@/lib/permissions";
import {redact} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import {listSchema} from "@/modules/core/schema";
import type {Actor} from "@/modules/core/model";
import {dateOnly,record,type Tx} from "./model";
import {zero} from "./balances";
const reportPageSchema=listSchema.extend({pageSize:z.coerce.number().int().min(1).max(1000).default(100)});

async function conditions(tx:Tx,companyId:string,raw:Record<string,string>) {
  for(const [key,resource] of [["accountId","chart"],["partyId","parties"],["departmentId","departments"]])
    if(raw[key!])await record(tx,resource!,companyId,raw[key!]!);
  const from=dateOnly(raw.from||"1900-01-01"),to=dateOnly(raw.to||"9999-12-31");
  if(from>to)throw new AppError(400,"The start date must not follow the end date");
  let filter=Prisma.sql`l.company_id=${companyId}::uuid AND e.company_id=${companyId}::uuid AND e.status='POSTED' AND e.deleted_at IS NULL AND l.deleted_at IS NULL AND e.date<=${to}`;
  for(const key of ["accountId","partyId","departmentId","eventId","outletId"] as const) {
    if(!raw[key])continue;
    if(!/^[a-f0-9-]{36}$/i.test(raw[key]))throw new AppError(400,"Invalid accounting filter");
    const column={accountId:"account_id",partyId:"party_id",departmentId:"department_id",eventId:"event_id",outletId:"outlet_id"}[key];
    filter=Prisma.sql`${filter} AND l.${Prisma.raw(column)}=${raw[key]}::uuid`;
  }
  return {from,to,filter};
}
export async function accountsReport(actor:Actor,code:string,report:string,raw:Record<string,string>,exporting=false) {
  if(!["trial-balance","ledger","party-ledger"].includes(report))throw new AppError(404,"Unknown accounting report");
  const p=reportPageSchema.parse(raw);
  return db.$transaction(async tx=>{
    const company=await companyScope(tx,actor,code,"accounts.report.read"),companyId=company.id;
    if(report==="party-ledger"&&!raw.partyId)throw new AppError(400,"Select a party for its ledger");
    const {from,filter}=await conditions(tx,companyId,raw);
    if(report==="trial-balance") {
      const rows:any[]=await tx.$queryRaw(Prisma.sql`
        WITH book AS (SELECT l.*,e.date FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id WHERE ${filter})
        SELECT a.id,a.code,a.name,a.type,
          coalesce(sum(CASE WHEN b.date>=${from} THEN b.debit ELSE 0 END),0) AS debit,
          coalesce(sum(CASE WHEN b.date>=${from} THEN b.credit ELSE 0 END),0) AS credit,
          coalesce(sum(CASE WHEN b.date<${from} THEN b.debit-b.credit ELSE 0 END),0) AS "openingBalance",
          coalesce(sum(b.debit-b.credit),0) AS balance
        FROM accounts a LEFT JOIN book b ON b.account_id=a.id AND b.company_id=a.company_id
        WHERE a.company_id=${companyId}::uuid AND NOT a.is_group AND (a.deleted_at IS NULL OR b.id IS NOT NULL)
        GROUP BY a.id ORDER BY a.code,a.id`);
      if(exporting&&rows.length>100000)throw new AppError(400,"Narrow the export to at most 100,000 accounts");
      const debit=rows.reduce((v,r)=>v.add(r.debit),zero()),credit=rows.reduce((v,r)=>v.add(r.credit),zero());
      const balance=rows.reduce((v,r)=>v.add(r.balance),zero());
      return redact({rows:exporting?rows:rows.slice((p.page-1)*p.pageSize,p.page*p.pageSize),total:rows.length,page:exporting?1:p.page,pageSize:exporting?rows.length:p.pageSize,summary:{debit:debit.toFixed(4),credit:credit.toFixed(4),balance:balance.toFixed(4),balanced:debit.eq(credit)&&balance.eq("0")}});
    }
    const partition=report==="ledger"&&!raw.accountId?Prisma.sql`PARTITION BY l.account_id`:Prisma.empty;
    const book=Prisma.sql`SELECT l.id,e.date,e.number,e.id AS "entryId",l.line_no,l.account_id AS "accountId",
      a.code AS "accountCode",a.name AS "accountName",l.party_id AS "partyId",p.name AS "partyName",
      l.department_id AS "departmentId",l.debit,l.credit,l.memo,e.source_type AS "sourceType",e.source_id AS "sourceId",
      sum(l.debit-l.credit) OVER (${partition} ORDER BY e.date,e.number,l.line_no,l.id ROWS UNBOUNDED PRECEDING) AS balance
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
      JOIN accounts a ON a.id=l.account_id AND a.company_id=l.company_id
      LEFT JOIN parties p ON p.id=l.party_id AND p.company_id=l.company_id WHERE ${filter}`;
    const [totals]:any[]=await tx.$queryRaw(Prisma.sql`WITH book AS (${book}) SELECT
      count(*) FILTER(WHERE date>=${from})::int AS total,
      coalesce(sum(debit) FILTER(WHERE date>=${from}),0) AS debit,
      coalesce(sum(credit) FILTER(WHERE date>=${from}),0) AS credit,
      coalesce(sum(debit-credit) FILTER(WHERE date<${from}),0) AS "openingBalance",
      coalesce(sum(debit-credit),0) AS "closingBalance" FROM book`);
    if(exporting&&totals.total>100000)throw new AppError(400,"Narrow the export to at most 100,000 ledger lines");
    const rows=await tx.$queryRaw(Prisma.sql`WITH book AS (${book}) SELECT * FROM book WHERE date>=${from}
      ORDER BY ${report==="ledger"&&!raw.accountId?Prisma.sql`"accountCode",`:Prisma.empty}date,number,line_no,id
      LIMIT ${exporting?100000:p.pageSize} OFFSET ${exporting?0:(p.page-1)*p.pageSize}`);
    return redact({rows,total:totals.total,page:exporting?1:p.page,pageSize:exporting?totals.total:p.pageSize,summary:{openingBalance:totals.openingBalance.toFixed(4),debit:totals.debit.toFixed(4),credit:totals.credit.toFixed(4),closingBalance:totals.closingBalance.toFixed(4)}});
  },{timeout:60000});
}
export async function accountsOverview(actor:Actor,code:string) {
  return db.$transaction(async tx=>{
    const c=await companyScope(tx,actor,code,"accounts.report.read"),companyId=c.id;
    const [cash]:any[]=await tx.$queryRaw`SELECT
      coalesce(sum(l.debit-l.credit) FILTER(WHERE a.is_cash),0) AS cash,
      coalesce(sum(l.debit-l.credit) FILTER(WHERE a.is_bank),0) AS bank
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
      JOIN accounts a ON a.id=l.account_id AND a.company_id=l.company_id
      WHERE l.company_id=${companyId}::uuid AND e.status='POSTED' AND e.deleted_at IS NULL AND l.deleted_at IS NULL`;
    const [receivables]:any[]=await tx.$queryRaw`SELECT
      coalesce((SELECT sum(total) FROM invoices WHERE company_id=${companyId}::uuid AND status='POSTED' AND kind='INVOICE' AND deleted_at IS NULL),0)
      -coalesce((SELECT sum(total) FROM invoices WHERE company_id=${companyId}::uuid AND status='POSTED' AND kind='CREDIT_NOTE' AND deleted_at IS NULL),0)
      -coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id AND p.company_id=a.company_id WHERE a.company_id=${companyId}::uuid AND a.invoice_id IS NOT NULL AND a.deleted_at IS NULL AND p.status='POSTED' AND p.deleted_at IS NULL),0) AS amount`;
    const [payables]:any[]=await tx.$queryRaw`SELECT
      coalesce((SELECT sum(total) FROM bills WHERE company_id=${companyId}::uuid AND status='POSTED' AND kind='BILL' AND deleted_at IS NULL),0)
      -coalesce((SELECT sum(total) FROM bills WHERE company_id=${companyId}::uuid AND status='POSTED' AND kind='DEBIT_NOTE' AND deleted_at IS NULL),0)
      -coalesce((SELECT sum(a.amount) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id AND p.company_id=a.company_id WHERE a.company_id=${companyId}::uuid AND a.bill_id IS NOT NULL AND a.deleted_at IS NULL AND p.status='POSTED' AND p.deleted_at IS NULL),0) AS amount`;
    const recentEntries=await tx.journalEntry.findMany({where:{companyId,status:"POSTED",deletedAt:null},take:8,orderBy:[{date:"desc"},{createdAt:"desc"}],include:{journal:true}});
    const postedEntries=await tx.journalEntry.count({where:{companyId,status:"POSTED",deletedAt:null}});
    return redact({id:companyId,companyName:c.name,invoiceOutstanding:receivables.amount.toFixed(4),billOutstanding:payables.amount.toFixed(4),cashBalance:cash.cash.toFixed(4),bankBalance:cash.bank.toFixed(4),postedEntries,recentEntries});
  });
}
