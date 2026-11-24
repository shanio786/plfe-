import {Prisma} from "@prisma/client";
import Decimal from "decimal.js";
import {z} from "zod";
import {AppError} from "@/lib/errors";
import {redact} from "@/lib/audit";
import {accountingToday} from "./time";
import {record,type Tx} from "./model";
const Exact=Decimal.clone({precision:50});
export async function partyAgeing(tx:Tx,companyId:string,raw:Record<string,string>,p:{page:number;pageSize:number},exporting:boolean) {
  const side=z.enum(["RECEIVABLE","PAYABLE"]).optional().parse(raw.side||undefined);
  const today=accountingToday(),asOf=today.toISOString().slice(0,10);
  if(raw.from||raw.to||raw.asOf&&raw.asOf!==asOf)
    throw new AppError(400,"This report ages current unpaid invoices/bills, not reconstructed historical allocations; clear past-date filters");
  if(["accountId","departmentId","eventId","outletId"].some(k=>raw[k]))
    throw new AppError(400,"Party ageing uses whole-document balances; use the ledger for account/department/outlet detail");
  if(raw.partyId)await record(tx,"parties",companyId,raw.partyId);
  const result=await tx.$queryRaw<any[]>(Prisma.sql`
    WITH documents AS(
      SELECT d.id,d.company_id,d.party_id,d.number,d.date,d.due_date,d.total-d.withholding_total AS net,
        d.opening_record_id IS NOT NULL AS opening,r.original_reference,'RECEIVABLE'::text AS side
      FROM invoices d LEFT JOIN opening_records r ON r.id=d.opening_record_id AND r.company_id=d.company_id
      WHERE d.company_id=${companyId}::uuid AND d.kind='INVOICE' AND d.status='POSTED' AND d.deleted_at IS NULL
      UNION ALL
      SELECT d.id,d.company_id,d.party_id,d.number,d.date,d.due_date,d.total-d.withholding_total,
        d.opening_record_id IS NOT NULL,r.original_reference,'PAYABLE'
      FROM bills d LEFT JOIN opening_records r ON r.id=d.opening_record_id AND r.company_id=d.company_id
      WHERE d.company_id=${companyId}::uuid AND d.kind='BILL' AND d.status='POSTED' AND d.deleted_at IS NULL
    ),notes AS(
      SELECT original_id AS id,'RECEIVABLE'::text AS side,sum(total-withholding_total) AS amount FROM invoices
      WHERE company_id=${companyId}::uuid AND kind='CREDIT_NOTE' AND status='POSTED' AND deleted_at IS NULL GROUP BY original_id
      UNION ALL
      SELECT original_id,'PAYABLE',sum(total-withholding_total) FROM bills
      WHERE company_id=${companyId}::uuid AND kind='DEBIT_NOTE' AND status='POSTED' AND deleted_at IS NULL GROUP BY original_id
    ),allocated AS(
      SELECT coalesce(a.invoice_id,a.bill_id) AS id,CASE WHEN a.invoice_id IS NOT NULL THEN 'RECEIVABLE' ELSE 'PAYABLE' END AS side,sum(a.amount) AS amount
      FROM payment_allocations a JOIN payments p ON p.id=a.payment_id AND p.company_id=a.company_id
      WHERE a.company_id=${companyId}::uuid AND a.deleted_at IS NULL AND p.status='POSTED' AND p.deleted_at IS NULL
      GROUP BY coalesce(a.invoice_id,a.bill_id),CASE WHEN a.invoice_id IS NOT NULL THEN 'RECEIVABLE' ELSE 'PAYABLE' END
    ),balances AS(
      SELECT d.*,d.net-coalesce(n.amount,0)-coalesce(a.amount,0) AS outstanding,${today}::date-d.due_date AS days
      FROM documents d LEFT JOIN notes n ON n.id=d.id AND n.side=d.side LEFT JOIN allocated a ON a.id=d.id AND a.side=d.side
    )
    SELECT d.id,d.party_id AS "partyId",p.code AS "partyCode",p.name AS "partyName",d.side,d.number,d.opening,
      d.original_reference AS "originalReference",d.date,d.due_date AS "dueDate",d.outstanding,d.days AS "daysOverdue",
      CASE WHEN days<=0 THEN 'NOT_DUE' WHEN days<=30 THEN '1_30' WHEN days<=60 THEN '31_60' WHEN days<=90 THEN '61_90' ELSE 'OVER_90' END AS bucket
    FROM balances d JOIN parties p ON p.id=d.party_id AND p.company_id=d.company_id
    WHERE d.outstanding>0 ${side?Prisma.sql`AND d.side=${side}`:Prisma.empty}
      ${raw.partyId?Prisma.sql`AND d.party_id=${raw.partyId}::uuid`:Prisma.empty}
    ORDER BY p.code,d.due_date,d.id LIMIT 100001`);
  if(result.length>100000)throw new AppError(400,"Narrow ageing to a party/side before requesting more than 100,000 unpaid documents");
  const sum=(rows:any[])=>rows.reduce((v,r)=>v.add(r.outstanding.toString()),new Exact("0")).toFixed(4);
  const buckets=Object.fromEntries(["NOT_DUE","1_30","31_60","61_90","OVER_90"].map(k=>[k,sum(result.filter(r=>r.bucket===k))]));
  const rows=(exporting?result:result.slice((p.page-1)*p.pageSize,p.page*p.pageSize)).map(r=>({...r,outstanding:r.outstanding.toFixed(4)}));
  return redact({rows,total:result.length,page:exporting?1:p.page,pageSize:exporting?rows.length:p.pageSize,
    summary:{asOf,receivables:sum(result.filter(r=>r.side==="RECEIVABLE")),payables:sum(result.filter(r=>r.side==="PAYABLE")),buckets,
      basis:"Current unpaid invoice/bill amounts. Unallocated advances and credits remain in party statements; this is not a historical allocation reconstruction."}});
}
