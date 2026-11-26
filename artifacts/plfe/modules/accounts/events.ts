import {randomUUID} from "node:crypto";
import {Prisma} from "@prisma/client";
import {audit} from "@/lib/audit";
import {AppError} from "@/lib/errors";
import type {Actor} from "@/modules/core/model";
import {eventSchema} from "./schema";
import {authorize,dateOnly,ledgerLock,meta,type Tx} from "./model";
import {decimal,zero} from "./balances";

/** An expo is the one dimension the accountant must never be able to forget,
 * because without it "what did this expo make?" goes back to being a question
 * somebody answers from memory. */

const ORDER=["PLANNED","OPEN","RUNNING","CLOSED"] as const;

export async function saveEvent(tx:Tx,actor:Actor,companyId:string,raw:any) {
  const id=raw.id??randomUUID();
  const before=raw.id?await tx.event.findFirst({where:{id,companyId,deletedAt:null}}):null;
  if(raw.id&&!before)throw new AppError(404,"Event not found in this company");
  await authorize(tx,actor,companyId,before?"accounts.event.update":"accounts.event.create");
  await ledgerLock(tx,companyId);
  const data=eventSchema.parse(raw);
  const startDate=dateOnly(data.startDate),endDate=dateOnly(data.endDate);
  if(endDate<startDate)throw new AppError(400,"An event cannot end before it starts");
  if(before&&before.code!==data.code)throw new AppError(409,"An event keeps its code; its amounts are filed under it");

  const posted=await taggedTotals(tx,companyId,[id]);
  const used=posted.has(id);
  if(before) {
    if(before.status==="CLOSED"&&data.status!=="CLOSED")
      throw new AppError(409,"A closed event is not reopened; raise the late document against it, or create the next edition");
    if(data.status==="CANCELLED"&&used)
      throw new AppError(409,"This event already carries posted amounts and cannot be cancelled; close it instead");
    const from=ORDER.indexOf(before.status as typeof ORDER[number]),to=ORDER.indexOf(data.status as typeof ORDER[number]);
    if(from>=0&&to>=0&&to<from)
      throw new AppError(409,`An event moves forward: ${before.status} cannot go back to ${data.status}`);
    if(used&&(+before.startDate!==+startDate||+before.endDate!==+endDate))
      throw new AppError(409,"This event already carries posted amounts; its dates are part of that record");
  }

  const values={code:data.code,name:data.name,city:data.city,venue:data.venue,edition:data.edition,
    startDate,endDate,status:data.status,budgetIncome:decimal(data.budgetIncome),budgetCost:decimal(data.budgetCost),
    notes:data.notes,active:data.status!=="CANCELLED"&&data.active};
  const after=before
    ? await tx.event.update({where:{id:before.id},data:{...values,updatedBy:actor.id}})
    : await tx.event.create({data:{...values,id,companyId,...meta(actor)}});
  await audit(tx,actor,companyId,before?"UPDATE":"CREATE","events",after.id,before,after);
  return after;
}

type Totals={income:Prisma.Decimal;directCost:Prisma.Decimal;otherCost:Prisma.Decimal};

/** Posted amounts carrying each event's tag, read straight from the ledger.
 * Direct costs are the 5000 range; office costs live in 6000 and are never
 * tagged, which is exactly why an expo's profit means something. */
async function taggedTotals(tx:Tx,companyId:string,eventIds?:string[]) {
  if(eventIds&&!eventIds.length)return new Map<string,Totals>();
  const filter=eventIds?Prisma.sql`AND l.event_id = ANY(ARRAY[${Prisma.join(eventIds)}]::uuid[])`:Prisma.empty;
  const rows:{event_id:string;kind:string;amount:Prisma.Decimal}[]=await tx.$queryRaw`
    SELECT l.event_id,
      CASE WHEN a.type='INCOME' THEN 'income'
           WHEN a.type='EXPENSE' AND a.code < '6000' THEN 'direct'
           ELSE 'other' END AS kind,
      coalesce(sum(CASE WHEN a.type='INCOME' THEN l.credit-l.debit ELSE l.debit-l.credit END),0) AS amount
    FROM journal_lines l
      JOIN journal_entries e ON e.id=l.entry_id AND e.company_id=l.company_id
      JOIN accounts a ON a.id=l.account_id AND a.company_id=l.company_id
    WHERE l.company_id=${companyId}::uuid AND l.event_id IS NOT NULL
      AND l.deleted_at IS NULL AND e.deleted_at IS NULL AND e.status='POSTED'
      AND a.type IN ('INCOME','EXPENSE') ${filter}
    GROUP BY l.event_id, 2`;
  const totals=new Map<string,Totals>();
  for(const row of rows) {
    const current=totals.get(row.event_id)??{income:zero(),directCost:zero(),otherCost:zero()};
    const amount=new Prisma.Decimal(row.amount);
    if(row.kind==="income")current.income=current.income.add(amount);
    else if(row.kind==="direct")current.directCost=current.directCost.add(amount);
    else current.otherCost=current.otherCost.add(amount);
    totals.set(row.event_id,current);
  }
  return totals;
}

/** Income less direct costs per expo, against the budget that was set for it. */
export async function eventProfit(tx:Tx,companyId:string,params:Record<string,string>={}) {
  const events=await tx.event.findMany({where:{companyId,deletedAt:null,
    ...(params.status?{status:params.status}:{}),
    ...(params.eventId?{id:params.eventId}:{})},orderBy:[{startDate:"desc"},{code:"asc"}]});
  const totals=await taggedTotals(tx,companyId,events.map(e=>e.id));
  let income=zero(),direct=zero(),other=zero(),budgetIncome=zero(),budgetCost=zero();
  const rows=events.map(event=>{
    const t=totals.get(event.id)??{income:zero(),directCost:zero(),otherCost:zero()};
    const profit=t.income.sub(t.directCost);
    income=income.add(t.income);direct=direct.add(t.directCost);other=other.add(t.otherCost);
    budgetIncome=budgetIncome.add(event.budgetIncome);budgetCost=budgetCost.add(event.budgetCost);
    return {id:event.id,code:event.code,name:event.name,city:event.city,venue:event.venue,
      status:event.status,edition:event.edition,
      startDate:event.startDate.toISOString().slice(0,10),endDate:event.endDate.toISOString().slice(0,10),
      income:t.income.toFixed(4),directCost:t.directCost.toFixed(4),otherCost:t.otherCost.toFixed(4),
      profit:profit.toFixed(4),
      // A margin on no income is not zero, it is nothing to report.
      margin:t.income.isZero()?null:profit.div(t.income).mul(100).toFixed(2),
      budgetIncome:event.budgetIncome.toFixed(4),budgetCost:event.budgetCost.toFixed(4),
      incomeVariance:t.income.sub(event.budgetIncome).toFixed(4),
      costVariance:t.directCost.sub(event.budgetCost).toFixed(4),
      budgetedProfit:event.budgetIncome.sub(event.budgetCost).toFixed(4)};
  });
  return {rows,total:rows.length,
    summary:{events:rows.length,income:income.toFixed(4),directCost:direct.toFixed(4),otherCost:other.toFixed(4),
      profit:income.sub(direct).toFixed(4),budgetIncome:budgetIncome.toFixed(4),budgetCost:budgetCost.toFixed(4),
      budgetedProfit:budgetIncome.sub(budgetCost).toFixed(4)}};
}
