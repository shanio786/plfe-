import {Prisma} from "@prisma/client";
import {AppError} from "@/lib/errors";
import {redact} from "@/lib/audit";
import {zero} from "./balances";
import type {Tx} from "./model";

/** Facts come from frozen document lines and actual original/reversal entry dates. */
export async function taxSummary(tx:Tx,companyId:string,from:Date,to:Date,p:{page:number;pageSize:number},exporting:boolean,raw:Record<string,string>) {
  if(["accountId","partyId","departmentId","outletId"].some(key=>raw[key]))
    throw new AppError(400,"The tax summary supports company and period dates; clear unsupported ledger dimension filters");
  const rows:any[]=await tx.$queryRaw(Prisma.sql`
    WITH source AS (
      SELECT l.*,d.entry_id,d.reversal_entry_id,d.kind,d.party_tax_treatment,'OUTPUT'::text AS direction,
        CASE WHEN d.kind='INVOICE' THEN 1 ELSE -1 END AS doc_sign
      FROM invoice_lines l JOIN invoices d ON d.id=l.invoice_id AND d.company_id=l.company_id
      WHERE l.company_id=${companyId}::uuid AND d.status IN ('POSTED','CANCELLED') AND d.deleted_at IS NULL AND l.deleted_at IS NULL
    ), purchases AS (
      SELECT l.id,l.company_id,l.total,l.tax_amount,l.withholding_amount,l.tax_snapshot,l.default_tax_snapshot,l.withholding_snapshot,
        d.entry_id,d.reversal_entry_id,d.party_tax_treatment,'INPUT'::text AS direction,
        CASE WHEN d.kind='BILL' THEN 1 ELSE -1 END AS doc_sign
      FROM bill_lines l JOIN bills d ON d.id=l.bill_id AND d.company_id=l.company_id
      WHERE l.company_id=${companyId}::uuid AND d.status IN ('POSTED','CANCELLED') AND d.deleted_at IS NULL AND l.deleted_at IS NULL
    ), all_lines AS (
      SELECT id,company_id,total,tax_amount,withholding_amount,tax_snapshot,default_tax_snapshot,withholding_snapshot,
        entry_id,reversal_entry_id,party_tax_treatment,direction,doc_sign FROM source
      UNION ALL SELECT * FROM purchases
    ), facts AS (
      SELECT l.*,e.date,(l.doc_sign*posting.sign) AS sign,t.component,t.snapshot,t.amount
      FROM all_lines l
      CROSS JOIN LATERAL (VALUES(l.entry_id,1),(l.reversal_entry_id,-1)) posting(entry_id,sign)
      JOIN journal_entries e ON e.id=posting.entry_id AND e.company_id=l.company_id AND e.status='POSTED'
      CROSS JOIN LATERAL (VALUES
        ('SALES_TAX',coalesce(l.tax_snapshot,l.default_tax_snapshot),l.tax_amount),
        ('WITHHOLDING',l.withholding_snapshot,l.withholding_amount)
      ) t(component,snapshot,amount)
      WHERE e.date>=${from} AND e.date<=${to} AND t.snapshot IS NOT NULL
    )
    SELECT concat(snapshot->>'id',':',direction,':',component) AS id,
      snapshot->>'id' AS "taxId",snapshot->>'code' AS "taxCode",snapshot->>'name' AS "taxName",
      (snapshot->>'version')::int AS version,snapshot->>'authority' AS authority,snapshot->>'kind' AS kind,
      snapshot->>'percentage' AS percentage,direction,component,
      sum(CASE WHEN component='WITHHOLDING' OR party_tax_treatment='STANDARD' THEN total*sign ELSE 0 END) AS "taxableBasis",
      sum(CASE WHEN component='SALES_TAX' AND party_tax_treatment<>'STANDARD' THEN total*sign ELSE 0 END) AS "exemptBasis",
      sum(amount*sign) AS "taxAmount"
    FROM facts
    GROUP BY snapshot->>'id',snapshot->>'code',snapshot->>'name',snapshot->>'version',snapshot->>'authority',
      snapshot->>'kind',snapshot->>'percentage',direction,component
    ORDER BY direction,component,authority,"taxCode",version
  `);
  if(exporting&&rows.length>100000)throw new AppError(400,"Narrow the tax export to at most 100,000 version rows");
  const sum=(direction:string,component:string)=>rows.filter(r=>r.direction===direction&&r.component===component).reduce((v,r)=>v.add(r.taxAmount),zero()).toFixed(4);
  return redact({rows:exporting?rows:rows.slice((p.page-1)*p.pageSize,p.page*p.pageSize),total:rows.length,
    page:exporting?1:p.page,pageSize:exporting?rows.length:p.pageSize,
    summary:{outputTax:sum("OUTPUT","SALES_TAX"),inputTax:sum("INPUT","SALES_TAX"),
      customerWithholding:sum("OUTPUT","WITHHOLDING"),supplierWithholding:sum("INPUT","WITHHOLDING")}});
}
