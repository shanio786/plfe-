"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FileSpreadsheet, RotateCw } from "lucide-react";
import { API } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { accountReport, type AccountsPage } from "../client";
import { A, Amt, EmptyBox, ErrorBox, Money, PickSelect, label, perm, useAll } from "./util";

const G = A.ag;
const BUCKETS = ["NOT_DUE", "1_30", "31_60", "61_90", "OVER_90"] as const;

/** Current outstanding only, aged on actual due dates. No as-of date filter: history is not reconstructed. */
export function PartyAgeingSection() {
  const { company, can } = useAdmin();
  const parties = useAll("parties", can(perm("parties", "read")));
  const [side, setSide] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AccountsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const pageSize = 200;
  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (side) p.set("side", side);
    if (partyId) p.set("partyId", partyId);
    return p;
  }, [side, partyId, page]);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    accountReport(company, "party-ageing", params).then((d) => live && setData(d)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [company, params, tick]);
  const exportHref = (() => { const p = new URLSearchParams(params); p.delete("page"); p.set("export", "xlsx"); return `${API}/${company}/accounts/reports/party-ageing?${p}`; })();
  const s = data?.summary ?? {};
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const th = "h-8 whitespace-nowrap border-b bg-card px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card px-3 py-2.5">
        <PickSelect value={side} onChange={(v) => { setSide(v); setPage(1); }} allowNone placeholder={G.side} className="h-8 w-44" testId="select-ageing-side" options={[{ value: "RECEIVABLE", label: G.receivables }, { value: "PAYABLE", label: G.payables }]} />
        <PickSelect value={partyId} onChange={(v) => { setPartyId(v); setPage(1); }} allowNone placeholder={A.f.party} className="h-8 w-64" testId="select-ageing-party" options={parties.rows.map((p) => ({ value: p.id, label: label(p) }))} />
        <span className="text-xs text-muted-foreground">{G.note}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)} title={L.common.retry}><RotateCw className={loading ? "animate-spin" : ""} /></Button>
          <Button variant="outline" size="sm" asChild><a href={exportHref} data-testid="button-export-ageing"><FileSpreadsheet />{L.common.export}</a></Button>
        </div>
      </div>
      {error ? <ErrorBox error={error} retry={() => setTick((t) => t + 1)} /> : !data ? <Skeleton className="h-72" /> : (
        <>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full text-sm" data-testid="table-ageing-summary">
              <thead><tr><th className={`${th} text-left`}>{G.asOf} <span className="font-mono normal-case">{date(s.asOf)}</span></th><th className={`${th} text-right`}>{G.receivables}</th><th className={`${th} text-right`}>{G.payables}</th>{BUCKETS.map((b) => <th key={b} className={`${th} text-right`}>{G.buckets[b]}</th>)}</tr></thead>
              <tbody><tr><td className="px-3 py-2 text-xs text-muted-foreground">{A.f.total}</td><td className="px-3 py-2 text-right"><Money v={s.receivables} strong /></td><td className="px-3 py-2 text-right"><Money v={s.payables} strong /></td>{BUCKETS.map((b) => <td key={b} className="px-3 py-2 text-right"><Money v={s.buckets?.[b]} /></td>)}</tr></tbody>
            </table>
          </div>
          <div className={`overflow-x-auto rounded-md border bg-card ${loading ? "opacity-60" : ""}`}>
            {rows.length === 0 ? <EmptyBox title={L.common.noResults ?? "Nothing outstanding"} /> : (
              <table className="w-full text-sm" data-testid="table-ageing">
                <thead><tr>
                  <th className={`${th} text-left`}>{A.f.party}</th><th className={`${th} text-left`}>{A.f.number}</th><th className={`${th} text-left`}>{A.op.origRef}</th>
                  <th className={`${th} text-left`}>{A.op.originalDate}</th><th className={`${th} text-left`}>{A.f.dueDate}</th><th className={`${th} text-right`}>{G.days}</th><th className={`${th} text-left`}>{G.bucket}</th><th className={`${th} text-right`}>{A.f.outstanding}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0" data-testid={`row-ageing-${r.id}`}>
                      <td className="px-3 py-1.5"><span className="font-mono text-xs text-muted-foreground">{r.partyCode}</span> {r.partyName} <span className="text-[10px] uppercase text-muted-foreground">{r.side === "RECEIVABLE" ? G.receivables : G.payables}</span></td>
                      <td className="px-3 py-1.5"><Link href={`/${company}/accounts/${r.side === "RECEIVABLE" ? "invoices" : "bills"}?id=${r.id}`} className="font-mono text-xs text-primary hover:underline">{r.number}</Link>{r.opening && <span className="ml-1"><Tag tone="brand">{A.op.badge}</Tag></span>}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.originalReference || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(r.date)}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(r.dueDate)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">{r.daysOverdue > 0 ? r.daysOverdue : "—"}</td>
                      <td className="px-3 py-1.5 text-xs">{G.buckets[r.bucket as keyof typeof G.buckets] ?? r.bucket}</td>
                      <td className="px-3 py-1.5 text-right"><Amt v={r.outstanding} className="font-semibold" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{data.total} {L.common.rows} · {L.common.page} {page} {L.common.of} {pages}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
