"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, FileSpreadsheet, Play, RotateCw } from "lucide-react";
import { API, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { accountReport, type AccountsPage } from "../client";
import { A, Amt, EmptyBox, ErrorBox, Money, PickSelect, label, perm, useAll } from "./util";
import { sourceHref } from "./lifecycle";

type Report = "trial-balance" | "ledger" | "party-ledger";
const fyStart = () => { const d = new Date(Date.now() + 5 * 3600000); const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-07-01`; };
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);

export function ReportSection({ report }: { report: Report }) {
  const { company, can } = useAdmin();
  const sp = useSearchParams();
  const router = useRouter();
  const [f, setF] = useState({ from: sp.get("from") ?? fyStart(), to: sp.get("to") ?? today(), accountId: sp.get("accountId"), partyId: sp.get("partyId"), departmentId: sp.get("departmentId") });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AccountsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const chart = useAll("chart", report === "ledger" && can(perm("chart", "read")));
  const parties = useAll("parties", report === "party-ledger" && can(perm("parties", "read")));
  const departments = useAll("departments", can(perm("departments", "read")));
  const pageSize = report === "trial-balance" ? 500 : 100;
  const blocked = report === "party-ledger" && !applied.partyId;

  const params = useMemo(() => {
    const p = new URLSearchParams({ from: applied.from, to: applied.to, page: String(page), pageSize: String(pageSize) });
    if (applied.departmentId) p.set("departmentId", applied.departmentId);
    if (report === "ledger" && applied.accountId) p.set("accountId", applied.accountId);
    if (report === "party-ledger" && applied.partyId) p.set("partyId", applied.partyId);
    return p;
  }, [applied, page, pageSize, report]);

  useEffect(() => {
    if (blocked) { setData(null); return; }
    let live = true;
    setLoading(true); setError(null);
    accountReport(company, report, params).then((d) => live && setData(d)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [company, report, params, tick, blocked]);

  const run = () => { setApplied(f); setPage(1); setTick((t) => t + 1); };
  const exportHref = (() => { const p = new URLSearchParams(params); p.delete("page"); p.set("export", "xlsx"); return `${API}/${company}/accounts/reports/${report}?${p}`; })();
  const s = data?.summary ?? {};
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const openEntry = (r: RecordData) => r.entryId && router.push(`/${company}/accounts/vouchers?id=${r.entryId}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card px-3 py-2.5">
        <Field label={A.f.from}><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="h-8 w-40" data-testid="input-report-from" /></Field>
        <Field label={A.f.to}><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="h-8 w-40" data-testid="input-report-to" /></Field>
        {report === "ledger" && <Field label={A.f.account}><PickSelect value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} allowNone placeholder={A.a.allAccounts} className="w-64" testId="select-report-account" options={chart.rows.filter((a) => !a.isGroup).map((a) => ({ value: a.id, label: label(a) }))} /></Field>}
        {report === "party-ledger" && <Field label={A.f.party}><PickSelect value={f.partyId} onChange={(v) => setF({ ...f, partyId: v })} placeholder={A.f.party} className="w-64" testId="select-report-party" options={parties.rows.map((p) => ({ value: p.id, label: label(p) }))} /></Field>}
        <Field label={A.f.department}><PickSelect value={f.departmentId} onChange={(v) => setF({ ...f, departmentId: v })} allowNone placeholder={A.a.allDepartments} className="w-48" testId="select-report-dept" options={departments.rows.map((d) => ({ value: d.id, label: label(d) }))} /></Field>
        <Button size="sm" onClick={run} disabled={report === "party-ledger" && !f.partyId} data-testid="button-run-report"><Play />{A.a.run}</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)} disabled={blocked} title={L.common.retry}><RotateCw className={loading ? "animate-spin" : ""} /></Button>
          <Button variant="outline" size="sm" asChild disabled={blocked}><a href={blocked ? undefined : exportHref} data-testid="button-export-report"><FileSpreadsheet className="text-success" />{L.common.export}</a></Button>
        </div>
      </div>

      {blocked ? <div className="rounded-lg border bg-card"><EmptyBox title={A.a.needParty} /></div>
        : error ? <ErrorBox error={error} retry={() => setTick((t) => t + 1)} />
        : !data ? <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-72" /></div>
        : report === "trial-balance" ? (
          <>
            <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${s.balanced ? "border-success/30 bg-success/[0.05]" : "border-destructive/30 bg-destructive/[0.04]"}`} data-testid="status-trial">
              {s.balanced ? <CircleCheck className="h-5 w-5 text-success" /> : <CircleAlert className="h-5 w-5 text-destructive" />}
              <span className="font-display font-semibold">{s.balanced ? A.a.trialOk : A.a.trialBad}</span>
              <span className="ml-auto flex flex-wrap gap-5 text-sm"><span>{A.f.debit} <Money v={s.debit} strong /></span><span>{A.f.credit} <Money v={s.credit} strong /></span><span>{A.f.difference} <Money v={s.balance} /></span></span>
            </div>
            <Table loading={loading} head={[A.f.code, A.f.name, A.f.type, A.f.debit, A.f.credit, A.f.balance]} empty={!data.rows.length}>
              {data.rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b hover:bg-accent/[0.07]" onClick={() => router.push(`/${company}/accounts/ledger?accountId=${r.id}&from=${applied.from}&to=${applied.to}`)} data-testid={`row-trial-${r.id}`}>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td><td className="px-3 py-2">{r.name}</td><td className="px-3 py-2 text-xs text-muted-foreground">{A.types[r.type] ?? r.type}</td>
                  <td className="px-3 py-2 text-right"><Amt v={r.debit} /></td><td className="px-3 py-2 text-right"><Amt v={r.credit} /></td><td className="px-3 py-2 text-right"><Amt v={r.balance} className="font-semibold" /></td>
                </tr>
              ))}
              <tr className="bg-muted/50 font-semibold"><td colSpan={3} className="px-3 py-2 text-right text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{A.f.total}</td><td className="px-3 py-2 text-right"><Amt v={s.debit} /></td><td className="px-3 py-2 text-right"><Amt v={s.credit} /></td><td className="px-3 py-2 text-right"><Amt v={s.balance} /></td></tr>
            </Table>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
              {([["opening", s.openingBalance], ["debit", s.debit], ["credit", s.credit], ["closing", s.closingBalance]] as const).map(([k, v]) => (
                <div key={k} className="bg-card px-4 py-3"><div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{A.f[k]}</div><Money v={v} strong className="mt-1 block text-lg" /></div>
              ))}
            </div>
            <Table loading={loading} head={[A.f.date, A.f.number, ...(report === "ledger" ? [A.f.account] : []), report === "ledger" ? A.f.party : A.f.account, A.f.memo, A.f.debit, A.f.credit, A.f.balance]} empty={!data.rows.length}>
              {data.rows.map((r) => {
                const src = sourceHref(company, r.sourceType, r.sourceId);
                return (
                  <tr key={r.id} className={`border-b hover:bg-accent/[0.07] ${r.entryId ? "cursor-pointer" : ""}`} onClick={() => openEntry(r)} data-testid={`row-ledger-${r.id}`}>
                    <td className="px-3 py-2 font-mono text-xs">{date(r.date)}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">{r.number}</td>
                    {report === "ledger" && <td className="px-3 py-2 text-xs"><span className="font-mono text-muted-foreground">{r.accountCode}</span> {r.accountName}</td>}
                    <td className="px-3 py-2 text-xs">{report === "ledger" ? r.partyName ?? "—" : <><span className="font-mono text-muted-foreground">{r.accountCode}</span> {r.accountName}</>}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-xs text-muted-foreground">
                      {r.memo ?? ""}{src && <a href={src} onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(src); }} className="ml-2 text-[10px] font-semibold uppercase text-primary hover:underline">{A.kinds[r.sourceType] ?? r.sourceType}</a>}
                    </td>
                    <td className="px-3 py-2 text-right"><Amt v={r.debit} /></td><td className="px-3 py-2 text-right"><Amt v={r.credit} /></td><td className="px-3 py-2 text-right"><Amt v={r.balance} className="font-semibold" /></td>
                  </tr>
                );
              })}
            </Table>
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{data.total} {L.common.rows} · {L.common.page} {page} {L.common.of} {pages}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-report-prev"><ChevronLeft /></Button>
              <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} data-testid="button-report-next"><ChevronRight /></Button>
            </div>
          </>
        )}
    </div>
  );
}

function Field({ label: l, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{l}</span>{children}</label>;
}
function Table({ head, children, empty, loading }: { head: string[]; children: ReactNode; empty: boolean; loading: boolean }) {
  return (
    <div className={`overflow-hidden rounded-lg border bg-card transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40">{head.map((h, i) => <th key={h + i} className={`h-9 whitespace-nowrap px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${i >= head.length - 3 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
          <tbody>{empty ? <tr><td colSpan={head.length}><EmptyBox title={L.common.noResults} /></td></tr> : children}</tbody>
        </table>
      </div>
    </div>
  );
}
