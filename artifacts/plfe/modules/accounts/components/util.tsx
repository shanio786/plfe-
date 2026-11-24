"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Decimal from "decimal.js";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCheck, RotateCw } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag, useAdmin } from "@/modules/core/components/shared";
import { amount, money } from "@/modules/core/components/format";
import { accountList, accountSave } from "../client";

export const A = L.acc;
export const NONE = "__none";
export type Col = ColumnDef<RecordData, any>;

/** Permission prefix per API resource. */
export const PERM: Record<string, string> = {
  chart: "accounts.chart", parties: "accounts.party", departments: "accounts.department", journals: "accounts.journal", invoices: "accounts.invoice",
  bills: "accounts.bill", outlets: "accounts.outlet", taxes: "accounts.tax", payments: "accounts.payment", entries: "accounts.entry", settings: "accounts.settings",
};
export const perm = (resource: string, action: string) => `${PERM[resource]}.${action}`;

/* ---------- money: strings in, strings out, decimal.js for arithmetic ---------- */
export const AMOUNT_RE = /^\d{1,14}(\.\d{1,4})?$/;
export function dec(v: unknown): Decimal {
  try { const s = String(v ?? "").trim(); return s ? new Decimal(s) : new Decimal("0.0000"); } catch { return new Decimal("0.0000"); }
}
export const fix4 = (d: Decimal) => d.toFixed(4);
export const sum = (vals: unknown[]) => vals.reduce<Decimal>((t, v) => t.plus(dec(v)), new Decimal("0.0000"));
export function Money({ v, className = "", strong }: { v: unknown; className?: string; strong?: boolean }) {
  const neg = String(v ?? "").trim().startsWith("-") && !dec(v).isZero();
  return <span className={`inline-block whitespace-nowrap text-right font-mono tabular-nums ${strong ? "font-semibold" : ""} ${neg ? "text-destructive" : ""} ${className}`}>{money(v)}</span>;
}
export function Amt({ v, className = "" }: { v: unknown; className?: string }) {
  if (v === null || v === undefined || v === "") return <span className={`font-mono text-xs text-muted-foreground/60 ${className}`}>—</span>;
  return <span className={`whitespace-nowrap font-mono text-xs tabular-nums ${className}`}>{money(v)}</span>;
}

/* ---------- tags ---------- */
export function DocStatus({ s }: { s?: string }) {
  const tone = s === "POSTED" ? "ok" : s === "DRAFT" ? "muted" : s === "CANCELLED" ? "bad" : "warn";
  return <Tag tone={tone}>{A.status[s ?? ""] ?? s ?? "—"}</Tag>;
}
export function SettleTag({ s }: { s?: string }) {
  if (!s) return null;
  return <Tag tone={s === "PAID" ? "ok" : s === "PART_PAID" ? "warn" : "brand"}>{A.settle[s] ?? s}</Tag>;
}
export function KindTag({ k }: { k?: string }) {
  if (!k) return null;
  const tone = k === "CREDIT_NOTE" || k === "DEBIT_NOTE" || k === "REVERSAL" ? "warn" : k === "RECEIPT" ? "ok" : "teal";
  return <Tag tone={tone}>{A.kinds[k] ?? k}</Tag>;
}

/* ---------- states ---------- */
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/[0.03] p-6 text-center" data-testid="text-error">
      <p className="font-medium text-destructive">{L.common.errorTitle}</p>
      <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      {retry && <Button variant="outline" size="sm" className="mt-4" onClick={retry}><RotateCw />{L.common.retry}</Button>}
    </div>
  );
}
export function EmptyBox({ title, body, icon }: { title: string; body?: string; icon?: ReactNode }) {
  return (
    <div className="px-4 py-8 text-center">
      {icon}
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}
export function ApprovalNotice({ message, onClose }: { message: string; onClose?: () => void }) {
  const { company } = useAdmin();
  return (
    <div className="flex items-start gap-3 rounded-md border border-primary/30 px-3 py-2.5 text-sm rise" data-testid="notice-approval">
      <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(30_80%_28%)]" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{A.a.approvalSent}</div>
        <div className="text-muted-foreground">{message}</div>
      </div>
      <Link href={`/${company}/admin/approvals`} className="shrink-0 text-xs font-semibold text-primary hover:underline" data-testid="link-approvals">{A.a.openApprovals}</Link>
      {onClose && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>{L.common.close}</button>}
    </div>
  );
}

/* ---------- operations ---------- */
export type OpResult = { approvalRequested?: boolean; approvalId?: string; message?: string; [k: string]: any };
export function useOp() {
  const { company, notify } = useAdmin();
  return useCallback(async (resource: string, body: Record<string, unknown>, okMsg: string = L.common.saved) => {
    const r = (await accountSave(company, resource, body)) as OpResult;
    if (r?.approvalRequested) notify(r.message || A.a.approvalSent);
    else notify(okMsg);
    return r;
  }, [company, notify]);
}

/* ---------- load every page for selectors ---------- */
export function useAll(resource: string, enabled = true, extra: Record<string, string> = {}) {
  const { company } = useAdmin();
  const [rows, setRows] = useState<RecordData[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(extra);
  useEffect(() => {
    if (!enabled) { setRows([]); setLoading(false); return; }
    let live = true;
    setLoading(true);
    setError(null);
    (async () => {
      const out: RecordData[] = [];
      for (let page = 1; page < 500; page++) {
        const p = new URLSearchParams({ page: String(page), pageSize: "100", sort: "createdAt", direction: "asc", ...JSON.parse(key) });
        const d = await accountList(company, resource, p);
        out.push(...d.rows);
        if (!d.rows.length || out.length >= d.total) break;
      }
      return out;
    })().then((r) => live && setRows(r)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [company, resource, enabled, key, tick]);
  return { rows, loading, error, reload: () => setTick((t) => t + 1) };
}

/** Shared lookups gated by read permission. */
export function useLookups(open = true) {
  const { can } = useAdmin();
  const chart = useAll("chart", open && can(perm("chart", "read")));
  const parties = useAll("parties", open && can(perm("parties", "read")));
  const departments = useAll("departments", open && can(perm("departments", "read")));
  const journals = useAll("journals", open && can(perm("journals", "read")));
  const outlets = useAll("outlets", open && can(perm("outlets", "read")));
  return { chart, parties, departments, journals, outlets };
}
export const label = (r?: RecordData | null) => (r ? `${r.code ?? ""}${r.code ? " · " : ""}${r.name ?? r.number ?? r.id}` : "—");

/** Select with an explicit "None" choice that writes null (never ""). */
export function PickSelect({ value, onChange, options, placeholder, allowNone, disabled, testId, className = "" }: {
  value: string | null | undefined; onChange: (v: string | null) => void; options: { value: string; label: string; muted?: boolean }[];
  placeholder?: string; allowNone?: boolean; disabled?: boolean; testId?: string; className?: string;
}) {
  return (
    <Select value={value || (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
      <SelectTrigger className={`h-8 bg-card text-sm ${className}`} data-testid={testId}><SelectValue placeholder={placeholder ?? L.common.none} /></SelectTrigger>
      <SelectContent className="max-h-72">
        {allowNone && <SelectItem value={NONE}><span className="text-muted-foreground">{L.common.none}</span></SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** ?id= deep links: open a record detail, clear on close. */
export function useDeepId() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const id = sp.get("id");
  const open = useCallback((next: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (next) p.set("id", next); else p.delete("id");
    const q = p.toString();
    router.replace(q ? `${path}?${q}` : path, { scroll: false });
  }, [sp, router, path]);
  return [id, open] as const;
}

export const col = (key: string, cell?: (r: RecordData) => ReactNode, sortable = false): Col => ({
  id: key, accessorKey: key, header: A.f[key] ?? L.f[key] ?? key, enableSorting: sortable,
  cell: (c) => (cell ? cell(c.row.original) : (c.row.original[key] ?? "—")),
});
/** Right-aligned money column; page total shown in the table footer (exact, Decimal). */
export const numCol = (key: string, get: (r: RecordData) => unknown, sortable = false, strong = false): Col => ({
  ...col(key, (r) => <Amt v={get(r)} className={strong ? "font-semibold" : ""} />, sortable),
  meta: { align: "right", sum: (rows: RecordData[]) => fix4(sum(rows.map(get))) },
});
export const RESOURCE_OF: Record<string, string> = { INVOICE: "invoices", BILL: "bills", PAYMENT: "payments", ENTRY: "vouchers", PARTY: "parties" };

export function Section({ title, right, children, className = "" }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-card ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/* ---------- outlets ---------- */
export const OUTLET_TYPES = ["SHOWROOM", "COUNTER", "GATE", "OFFICE"] as const;
/** Active outlets as select options; keeps a currently chosen inactive outlet visible. */
export const outletOpts = (rows: RecordData[], keep?: string | null) =>
  rows.filter((o) => o.active !== false || o.id === keep).map((o) => ({ value: o.id, label: label(o) }));
export function OutletTag({ o }: { o?: RecordData | null }) {
  if (!o) return <span className="text-muted-foreground">—</span>;
  return <span className="whitespace-nowrap text-xs" data-testid={`text-outlet-${o.id}`}><span className="font-mono text-muted-foreground">{o.code}</span> {o.name}</span>;
}
/** When an account owned by an outlet is chosen, fill the line's outlet only if none is set.
 *  Returns a plain-English warning if an explicit, different outlet is already chosen. */
export function outletFor(accounts: RecordData[], accountId: string | null | undefined, current: string | null | undefined): { set?: string; warn?: string } {
  const a = accounts.find((x) => x.id === accountId);
  if (!a?.outletId) return {};
  if (!current) return { set: a.outletId };
  if (current !== a.outletId) return { warn: `${a.code} belongs to another outlet. Change the outlet to match, or pick a different account.` };
  return {};
}

/** Labelled cell for per-line editors; wraps responsively instead of scrolling sideways. */
export function LineField({ label: l, className = "", error, children }: { label: string; className?: string; error?: string | false; children: ReactNode }) {
  return (
    <div className={`min-w-0 space-y-0.5 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{l}</div>
      {children}
      {error && <p className="text-[11px] leading-tight text-destructive" role="alert">{error}</p>}
    </div>
  );
}

/* ---------- taxes ---------- */
export const PROVINCE_OF: Record<string, string> = { PRA: "Punjab", SRB: "Sindh", KPRA: "Khyber Pakhtunkhwa", BRA: "Balochistan" };
export const pct = (v: unknown) => { const s = String(v ?? ""); return s ? `${s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}%` : "—"; };
export const taxLabel = (t?: RecordData | null) => t ? `${t.code} v${t.version ?? 1} · ${pct(t.percentage)} · ${t.authority}` : "—";
/** Tax versions in force on a day for a side of the book. Dates compared as ISO strings. */
export function effectiveTaxes(rows: RecordData[], day: string, side: "SALES" | "PURCHASES", withholding: boolean) {
  const d = String(day || "").slice(0, 10);
  return rows.filter((t) => t.active !== false && (t.kind === "WITHHOLDING") === withholding
    && (t.applicability === "BOTH" || t.applicability === side)
    && (!d || (String(t.effectiveFrom ?? "").slice(0, 10) <= d && (!t.effectiveTo || String(t.effectiveTo).slice(0, 10) >= d))));
}
export function TaxEvidence({ code, version, authority, rate, amount: amt }: { code?: string | null; version?: unknown; authority?: string | null; rate?: unknown; amount?: unknown }) {
  if (!code && (amt === undefined || amt === null)) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap text-xs">
      {code && <span className="font-mono text-muted-foreground">{code}{version ? ` v${version}` : ""}{authority ? ` ${authority}` : ""} </span>}
      {rate !== undefined && rate !== null && <span className="text-muted-foreground">{pct(rate)} </span>}
      <Amt v={amt} />
    </span>
  );
}

/* ---- Tax snapshots: evidence always comes from the line's frozen snapshot, never the live tax master. ---- */
type Snap = { code?: string; version?: unknown; authority?: string; percentage?: unknown } | null | undefined;
export const snapOf = (l: RecordData | undefined, kind: "tax" | "withholding" | "default"): Snap =>
  !l ? null : kind === "tax" ? l.taxSnapshot ?? l.tax : kind === "withholding" ? l.withholdingSnapshot ?? l.withholdingTax : l.defaultTaxSnapshot ?? l.defaultTax;
export function SnapEvidence({ snap, amount: amt }: { snap: Snap; amount?: unknown }) {
  return <TaxEvidence code={snap?.code} version={snap?.version} authority={snap?.authority} rate={snap?.percentage} amount={amt} />;
}
/** True when the line charges less than its account default (cleared, or a selected lower rate). Needs a written reason. */
export function belowDefault(l: RecordData | undefined): boolean {
  const d = snapOf(l, "default");
  if (!l || !d || d.percentage === undefined || d.percentage === null || l.originalLineId) return false;
  if (l.taxSelection === "CLEARED") return dec(d.percentage as string).gt(0);
  if (l.taxSelection !== "SELECTED") return false;
  const t = snapOf(l, "tax");
  return !!t && t.percentage !== undefined && t.percentage !== null && dec(t.percentage as string).lt(dec(d.percentage as string));
}
/** Selection marker plus the account default it departed from, so a reviewer can see why less was charged. */
export function SelectionNote({ l }: { l: RecordData | undefined }) {
  if (!l?.taxSelection || l.taxSelection === "AUTO") return null;
  const d = snapOf(l, "default");
  return (
    <div className="whitespace-nowrap text-[10px] text-muted-foreground">
      <span className="uppercase">{l.taxSelection === "CLEARED" ? A.t.cleared : A.t.selection}</span>
      {d?.code ? <> · {A.t.defaultWas} <span className="font-mono">{d.code}{d.version ? ` v${String(d.version)}` : ""} {d.authority ?? ""} {d.percentage !== undefined && d.percentage !== null ? pct(d.percentage) : ""}</span></> : <> · {A.t.defaultWas} —</>}
      {belowDefault(l) && <span className="ml-1 text-destructive">{A.t.belowDefault}</span>}
    </div>
  );
}
