"use client";
import { useMemo } from "react";
import Decimal from "decimal.js";
import type { RecordData } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { date } from "@/modules/core/components/format";
import { A, AMOUNT_RE, Money, dec, fix4, perm, sum, useAll } from "./util";
import { useAdmin } from "@/modules/core/components/shared";

export type Alloc = { invoiceId: string | null; billId: string | null; amount: string };
type Props = {
  direction: "RECEIPT" | "PAYMENT"; partyId: string | null; amount: string; value: Alloc[]; onChange: (v: Alloc[]) => void;
  /** Amount already allocated by this payment per document id, so it counts as available when re-editing. */
  mine?: Record<string, string>; enabled?: boolean;
};

export function AllocationPicker({ direction, partyId, amount, value, onChange, mine = {}, enabled = true }: Props) {
  const { can } = useAdmin();
  const res = direction === "RECEIPT" ? "invoices" : "bills";
  const kind = direction === "RECEIPT" ? "INVOICE" : "BILL";
  const field = direction === "RECEIPT" ? "invoiceId" : "billId";
  const readable = can(perm(res, "read"));
  const docs = useAll(res, enabled && readable && !!partyId, { partyId: partyId ?? "", status: "POSTED", kind });
  const open = useMemo(() => docs.rows
    .filter((d) => (d.kind ?? kind) === kind && d.partyId === partyId)
    .map((d) => ({ ...d, available: dec(d.outstanding).plus(dec(mine[d.id])) }) as RecordData & { available: Decimal })
    .filter((d) => d.available.gt(0) || value.some((v) => v[field] === d.id)), [docs.rows, partyId, kind, mine, value, field]);
  const get = (id: string) => value.find((v) => v[field] === id)?.amount ?? "";
  const set = (id: string, amt: string) => {
    const rest = value.filter((v) => v[field] !== id);
    onChange(amt.trim() ? [...rest, { invoiceId: field === "invoiceId" ? id : null, billId: field === "billId" ? id : null, amount: amt.trim() }] : rest);
  };
  const allocated = sum(value.filter((v) => AMOUNT_RE.test(v.amount)).map((v) => v.amount));
  const total = AMOUNT_RE.test(amount) ? dec(amount) : new Decimal(0);
  const remainder = total.minus(allocated);
  const fill = (d: RecordData & { available: Decimal }) => {
    const others = allocated.minus(dec(get(d.id)));
    const room = Decimal.max(0, total.minus(others));
    set(d.id, fix4(Decimal.min(room, d.available)));
  };

  if (!partyId) return <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{A.a.pickParty}</p>;
  if (!readable) return <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{A.a.noAccess}</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{A.a.openDocs}</div>
      {docs.loading ? <div className="space-y-2 p-3"><Skeleton className="h-7" /><Skeleton className="h-7" /></div>
        : docs.error ? <p className="p-3 text-sm text-destructive">{docs.error}</p>
        : open.length === 0 ? <p className="px-3 py-5 text-center text-sm text-muted-foreground">{A.a.noOpenDocs}</p>
        : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-3 py-1.5">{A.f.number}</th><th className="px-3 py-1.5">{A.f.date}</th><th className="px-3 py-1.5 text-right">{A.f.total}</th><th className="px-3 py-1.5 text-right">{A.f.outstanding}</th><th className="w-44 px-3 py-1.5 text-right">{A.f.allocated}</th></tr></thead>
            <tbody>
              {open.map((d) => {
                const v = get(d.id);
                const bad = v && (!AMOUNT_RE.test(v) || dec(v).gt(d.available));
                return (
                  <tr key={d.id} className="border-t">
                    <td className="px-3 py-1.5 font-mono text-xs font-semibold">{d.number}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{date(d.date)}</td>
                    <td className="px-3 py-1.5 text-right"><Money v={d.total} className="text-xs" /></td>
                    <td className="px-3 py-1.5 text-right"><Money v={fix4(d.available)} className="text-xs" /></td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        <Input value={v} inputMode="decimal" placeholder="0.0000" onChange={(e) => set(d.id, e.target.value)} className={`h-7 text-right font-mono text-xs ${bad ? "border-destructive" : ""}`} data-testid={`input-alloc-${d.id}`} />
                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => fill(d)} data-testid={`button-fill-${d.id}`}>{A.a.fill}</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      <div className="grid grid-cols-3 border-t bg-muted/30 text-xs">
        <div className="px-3 py-2"><div className="text-muted-foreground">{A.f.amount}</div><Money v={fix4(total)} /></div>
        <div className="border-l px-3 py-2"><div className="text-muted-foreground">{A.f.allocated}</div><Money v={fix4(allocated)} className={allocated.gt(total) ? "text-destructive" : ""} /></div>
        <div className="border-l px-3 py-2"><div className="text-muted-foreground">{A.f.advance}</div><Money v={fix4(remainder)} strong /></div>
      </div>
      {allocated.gt(total) && <p className="border-t px-3 py-1.5 text-xs text-destructive">{A.a.allocCap}</p>}
    </div>
  );
}
