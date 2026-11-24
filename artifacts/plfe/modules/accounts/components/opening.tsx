"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { api, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tag, useAdmin } from "@/modules/core/components/shared";
import { date, dateTime } from "@/modules/core/components/format";
import { A, AMOUNT_RE, Amt, ErrorBox, LineField, Money, PickSelect, Section, dec, label, useOp } from "./util";

const O = A.op;
const SIGNED_RE = /^-?\d{1,14}(\.\d{1,4})?$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
type Data = RecordData;
const stageName = (k?: string, fallback?: string) => fallback ?? (O.stages as Record<string, string>)[k ?? ""] ?? k ?? "—";
const newKey = () => crypto.randomUUID();
const isRetail = (d: Data) => d.company?.businessType === "RETAIL";

/** One idempotency key per attempt; renewed only after a successful post so a retried network failure reuses it. */
function useRequestKey() {
  const k = useRef(newKey());
  return { get: () => k.current, renew: () => { k.current = newKey(); } };
}

export function OpeningSection() {
  const { company } = useAdmin();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [reopen, setReopen] = useState<RecordData | null>(null);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let live = true; setError(null);
    api<Data>(`/${company}/accounts/opening`).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, tick]);
  if (error && !data) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;

  const open = data.nextStage === "OPEN" || !!data.company?.booksOpenedAt;
  const stages: RecordData[] = data.stages ?? [];
  const blockers: string[] = Array.isArray(data.blockers) ? data.blockers : [];
  const current = stages.find((s) => s.current) ?? stages.find((s) => s.key === data.nextStage);
  return (
    <div className="space-y-4" data-testid="page-opening">
      <Header data={data} open={open} reload={reload} />
      {blockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 px-3 py-2 text-sm" data-testid="banner-opening-blockers">
          <div className="font-medium text-destructive">{O.blockers}</div>
          <ul className="mt-1 list-disc pl-5 text-xs">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {error && <ErrorBox error={error} retry={reload} />}
      <ol className="flex flex-wrap gap-1 rounded-md border bg-card p-1.5" data-testid="list-opening-stages">
        {stages.map((s, i) => (
          <li key={s.key} className={`flex min-w-[8.5rem] flex-1 items-start gap-2 rounded px-2 py-1.5 text-xs ${s.current ? "bg-primary/10 ring-1 ring-primary/40" : ""}`} data-testid={`stage-${s.key}`}>
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] ${s.reviewed ? "border-success text-success" : "text-muted-foreground"}`}>{s.reviewed ? <Check className="h-3 w-3" /> : i + 1}</span>
            <span className="min-w-0">
              <span className="block font-medium">{stageName(s.key, s.label)}</span>
              <span className="block text-[10.5px] text-muted-foreground">{s.reviewed ? `${O.reviewed} ${s.reviewedAt ? dateTime(s.reviewedAt) : ""}` : s.current ? O.current : O.pending}</span>
              {s.reviewed && !open && <button type="button" className="mt-0.5 text-[10.5px] font-medium text-primary hover:underline" onClick={() => setReopen(s)} data-testid={`button-reopen-${s.key}`}>{O.reopen}</button>}
            </span>
          </li>
        ))}
      </ol>
      {open ? <p className="rounded-md border px-3 py-2 text-sm" data-testid="text-books-open">{O.openNotice}</p>
        : !data.company?.goLiveDate ? null
        : current && data.nextStage !== "READY" ? <StagePanel key={`${current.key}-${tick}`} data={data} stage={current.key} reload={reload} />
        : null}
      <Reconciliation data={data} />
      {!open && <Declare data={data} reload={reload} />}
      {!open && <StagedQueue data={data} reload={reload} />}
      <History data={data} reload={reload} />
      {reopen && !open && <NoteDialog title={`${O.reopen} · ${stageName(reopen.key, reopen.label)}`} body={O.reopenBody} confirmLabel={O.reopen}
        onClose={() => setReopen(null)} submit={async (op, note) => { await op("opening", { operation: "reopen-review", stage: reopen.key, reason: note }); reload(); }} />}
    </div>
  );
}

/* ---------- header: company, ledger date, locks ---------- */
function Header({ data, open, reload }: { data: Data; open: boolean; reload: () => void }) {
  const op = useOp();
  const c = data.company ?? {};
  // Server decides: canConfigure already covers captures and any ordinary posted history.
  const dateLocked = open || !data.canConfigure;
  const [goLive, setGoLive] = useState<string | null>(c.goLiveDate ? String(c.goLiveDate).slice(0, 10) : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const periods: RecordData[] = data.periods ?? [];
  const save = async () => {
    if (!goLive) return;
    setBusy(true); setErr(null);
    try { await op("opening", { operation: "configure", goLiveDate: goLive }); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-3 rounded-md border bg-card p-3 md:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{c.code} · {c.name} · {c.businessType} · {c.currency}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span><span className="text-xs text-muted-foreground">{O.goLive} </span><span className="font-mono text-xl font-semibold" data-testid="text-go-live">{c.goLiveDate ? date(c.goLiveDate) : O.notSet}</span></span>
          <span className="text-xs"><span className="text-muted-foreground">{O.booksOpened} </span><span className="font-mono">{c.booksOpenedAt ? dateTime(c.booksOpenedAt) : "—"}</span></span>
          <span className="text-xs"><span className="text-muted-foreground">{O.lockDate} </span><span className="font-mono">{c.lockDate ? date(c.lockDate) : "—"}</span></span>
          {dateLocked && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />{O.dateLocked}</span>}
        </div>
      </div>
      {!dateLocked && (
        <div className="space-y-1">
          <div className="flex items-end gap-2">
            <PickSelect value={goLive} onChange={setGoLive} placeholder={O.period} className="h-9 w-64" testId="select-go-live" options={periods.map((p) => ({ value: String(p.startDate).slice(0, 10), label: `${p.name} · ${date(p.startDate)}` }))} />
            <Button size="sm" disabled={!goLive || busy || goLive === String(c.goLiveDate ?? "").slice(0, 10)} onClick={save} data-testid="button-set-go-live">{busy && <Loader2 className="animate-spin" />}{O.saveDate}</Button>
          </div>
          <p className="max-w-sm text-[11px] text-muted-foreground">{O.configureHint}</p>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
      )}
    </div>
  );
}

/* ---------- current stage: capture + review ---------- */
function StagePanel({ data, stage, reload }: { data: Data; stage: string; reload: () => void }) {
  const body: ReactNode =
    stage === "CASH" || stage === "BANK" ? <AccountCapture data={data} stage={stage} reload={reload} />
    : stage === "RECEIVABLES" || stage === "PAYABLES" ? <PartyCapture data={data} stage={stage} reload={reload} />
    : stage === "STOCK" ? (isRetail(data) ? <StockCapture data={data} reload={reload} /> : <p className="px-3 py-3 text-sm text-muted-foreground" data-testid="text-stock-not-applicable">{O.stockNA}</p>)
    : stage === "JOURNAL" ? <JournalCapture data={data} reload={reload} />
    : <p className="px-3 py-3 text-sm text-muted-foreground">{O.empty}</p>;
  const st = (data.stages ?? []).find((s: RecordData) => s.key === stage);
  return (
    <Section title={<span>{O.current}: {stageName(stage, st?.label)}</span>} right={st?.reason ? <span className="text-[11px] text-muted-foreground">{st.reason}</span> : undefined}>
      {body}
      <Review data={data} stage={stage} reload={reload} />
    </Section>
  );
}

function useSubmit(reload: () => void) {
  const op = useOp();
  const key = useRequestKey();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true); setErr(null);
    try { await op("opening", { operation: "post", requestKey: key.get(), ...body }); key.renew(); after?.(); reload(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return { run, busy, err, setErr };
}

function AccountCapture({ data, stage, reload }: { data: Data; stage: "CASH" | "BANK"; reload: () => void }) {
  const bank = stage === "BANK";
  const rows: RecordData[] = (bank ? data.accounts?.bank : data.accounts?.cash) ?? [];
  const outlets: RecordData[] = data.outlets ?? [];
  return (
    <div>
      <p className="px-3 py-2 text-xs text-muted-foreground">{bank ? O.bankHint : O.cashHint}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`table-opening-${stage.toLowerCase()}`}>
          <thead><tr className="border-b text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"><th className="px-3 py-1.5">{A.f.account}</th><th className="px-3 py-1.5">{A.f.outlet}</th><th className="px-3 py-1.5">{O.captured}</th><th className="px-3 py-1.5 text-right">{O.enterAmount}</th>{bank && <th className="px-3 py-1.5">{O.statementRef}</th>}<th className="px-3 py-1.5" /></tr></thead>
          <tbody>{rows.map((a) => <AccountRow key={a.id} a={a} bank={bank} stage={stage} outlet={outlets.find((o) => o.id === a.outletId)} reload={reload} />)}</tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">{O.empty}</p>}
    </div>
  );
}
function AccountRow({ a, bank, stage, outlet, reload }: { a: RecordData; bank: boolean; stage: string; outlet?: RecordData; reload: () => void }) {
  const [amount, setAmount] = useState("");
  const [ref, setRef] = useState("");
  const s = useSubmit(reload);
  const okAmt = (bank ? SIGNED_RE : AMOUNT_RE).test(amount.trim());
  const okRef = !bank || ref.trim().length >= 3;
  return (
    <tr className="border-b last:border-0 align-top" data-testid={`row-opening-account-${a.id}`}>
      <td className="px-3 py-1.5"><span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}</td>
      <td className="px-3 py-1.5 text-xs">{outlet ? label(outlet) : "—"}</td>
      <td className="px-3 py-1.5">{a.captured ? <Tag tone="ok">{O.captured}</Tag> : <Tag>{O.notCaptured}</Tag>}</td>
      {a.captured ? (
        <><td className="px-3 py-1.5 text-right"><Money v={a.openingBalance} /></td>{bank && <td />}<td /></>
      ) : (
        <>
          <td className="px-3 py-1.5"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`h-8 w-36 text-right font-mono ${amount && !okAmt ? "border-destructive" : ""}`} data-testid={`input-opening-amount-${a.id}`} /></td>
          {bank && <td className="px-3 py-1.5"><Input value={ref} onChange={(e) => setRef(e.target.value)} className="h-8 w-40" data-testid={`input-opening-ref-${a.id}`} /></td>}
          <td className="px-3 py-1.5 text-right">
            <Button size="sm" variant="outline" disabled={!okAmt || !okRef || s.busy} onClick={() => s.run({ stage, accountId: a.id, amount: amount.trim(), ...(bank ? { statementReference: ref.trim() } : {}) })} data-testid={`button-opening-record-${a.id}`}>{s.busy && <Loader2 className="animate-spin" />}{O.record}</Button>
            {s.err && <p className="mt-1 max-w-xs text-left text-xs text-destructive">{s.err}</p>}
          </td>
        </>
      )}
    </tr>
  );
}

function PartyCapture({ data, stage, reload }: { data: Data; stage: "RECEIVABLES" | "PAYABLES"; reload: () => void }) {
  const side = stage === "RECEIVABLES" ? "RECEIVABLE" : "PAYABLE";
  const parties: RecordData[] = (data.parties ?? []).filter((p: RecordData) => (side === "RECEIVABLE" ? p.isCustomer : p.isSupplier));
  const queue: RecordData[] = (data.stagedImports ?? []).filter((q: RecordData) => q.side === side && dec(q.remaining).gt(0) && q.status !== "CANCELLED");
  const goLive = String(data.company?.goLiveDate ?? "").slice(0, 10);
  const blank = { stagedImportId: null as string | null, partyId: null as string | null, amount: "", originalReference: "", originalDate: "", dueDate: "" };
  const [f, setF] = useState(blank);
  const s = useSubmit(reload);
  const q = queue.find((x) => x.id === f.stagedImportId);
  const problems = [
    !f.partyId && A.f.party,
    !(AMOUNT_RE.test(f.amount) && dec(f.amount).gt(0)) && O.amount,
    q && AMOUNT_RE.test(f.amount) && dec(f.amount).gt(dec(q.remaining)) && `${O.amount} > ${O.queueRemaining}`,
    !f.originalReference.trim() && O.origRef,
    !DAY_RE.test(f.originalDate) && O.origDate,
    DAY_RE.test(f.originalDate) && goLive && f.originalDate > goLive && `${O.origDate} > ${O.goLive}`,
    !DAY_RE.test(f.dueDate) && O.dueDate,
    DAY_RE.test(f.dueDate) && DAY_RE.test(f.originalDate) && f.dueDate < f.originalDate && `${O.dueDate} < ${O.origDate}`,
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-2 px-3 py-3">
      <p className="text-xs text-muted-foreground">{O.partyHint}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <LineField label={O.useQueue} className="col-span-2 sm:col-span-4">
          <PickSelect value={f.stagedImportId} allowNone className="w-full" testId="select-opening-queue" placeholder={queue.length ? O.useQueue : "—"} disabled={!queue.length}
            options={queue.map((x) => ({ value: x.id, label: `${x.partyName} · ${x.remaining} ${O.queueRemaining}` }))}
            onChange={(v) => { const x = queue.find((y) => y.id === v); setF((p) => ({ ...p, stagedImportId: v, ...(x ? { partyId: x.partyId, amount: String(x.remaining) } : {}) })); }} />
        </LineField>
        <LineField label={A.f.party} className="col-span-2 sm:col-span-5"><PickSelect value={f.partyId} onChange={(v) => setF((p) => ({ ...p, partyId: v }))} disabled={!!q} className="w-full" testId="select-opening-party" options={parties.map((p) => ({ value: p.id, label: label(p) }))} /></LineField>
        <LineField label={O.amount} className="sm:col-span-3"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} className="h-8 text-right font-mono" data-testid="input-opening-party-amount" /></LineField>
        <LineField label={O.origRef} className="col-span-2 sm:col-span-4"><Input value={f.originalReference} onChange={(e) => setF((p) => ({ ...p, originalReference: e.target.value }))} className="h-8" data-testid="input-opening-orig-ref" /></LineField>
        <LineField label={O.origDate} className="sm:col-span-4"><Input type="date" value={f.originalDate} max={goLive || undefined} onChange={(e) => setF((p) => ({ ...p, originalDate: e.target.value }))} className="h-8" data-testid="input-opening-orig-date" /></LineField>
        <LineField label={O.dueDate} className="sm:col-span-4"><Input type="date" value={f.dueDate} min={f.originalDate || undefined} onChange={(e) => setF((p) => ({ ...p, dueDate: e.target.value }))} className="h-8" data-testid="input-opening-due-date" /></LineField>
      </div>
      {f.amount && problems.length > 0 && <p className="text-xs text-muted-foreground">{L.common.required}: {problems.join(" · ")}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={problems.length > 0 || s.busy} onClick={() => s.run({ stage, partyId: f.partyId, amount: f.amount, originalReference: f.originalReference.trim(), originalDate: f.originalDate, dueDate: f.dueDate, ...(f.stagedImportId ? { stagedImportId: f.stagedImportId } : {}) }, () => setF(blank))} data-testid="button-opening-party-post">{s.busy && <Loader2 className="animate-spin" />}{O.record}</Button>
        {s.err && <p className="text-xs text-destructive">{s.err}</p>}
      </div>
    </div>
  );
}

function StockCapture({ data, reload }: { data: Data; reload: () => void }) {
  const outlets: RecordData[] = data.outlets ?? [];
  const blank = { outletId: null as string | null, stockCode: "", description: "", quantity: "", unitCost: "" };
  const [f, setF] = useState(blank);
  const s = useSubmit(reload);
  const ok = !!f.outletId && f.stockCode.trim() && f.description.trim() && AMOUNT_RE.test(f.quantity) && AMOUNT_RE.test(f.unitCost);
  return (
    <div className="space-y-2 px-3 py-3">
      <p className="text-xs text-muted-foreground">{O.stockHint}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
        <LineField label={A.f.outlet} className="col-span-2 sm:col-span-3"><PickSelect value={f.outletId} onChange={(v) => setF((p) => ({ ...p, outletId: v }))} className="w-full" testId="select-opening-stock-outlet" options={outlets.map((o) => ({ value: o.id, label: label(o) }))} /></LineField>
        <LineField label={O.stockCode} className="sm:col-span-2"><Input value={f.stockCode} onChange={(e) => setF((p) => ({ ...p, stockCode: e.target.value }))} className="h-8 font-mono" data-testid="input-opening-stock-code" /></LineField>
        <LineField label={O.description} className="sm:col-span-3"><Input value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} className="h-8" data-testid="input-opening-stock-desc" /></LineField>
        <LineField label={O.qty} className="sm:col-span-2"><Input inputMode="decimal" value={f.quantity} onChange={(e) => setF((p) => ({ ...p, quantity: e.target.value }))} className="h-8 text-right font-mono" data-testid="input-opening-stock-qty" /></LineField>
        <LineField label={O.unitCost} className="sm:col-span-2"><Input inputMode="decimal" value={f.unitCost} onChange={(e) => setF((p) => ({ ...p, unitCost: e.target.value }))} className="h-8 text-right font-mono" data-testid="input-opening-stock-cost" /></LineField>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!ok || s.busy} onClick={() => s.run({ stage: "STOCK", outletId: f.outletId, stockCode: f.stockCode.trim(), description: f.description.trim(), quantity: f.quantity, unitCost: f.unitCost }, () => setF(blank))} data-testid="button-opening-stock-post">{s.busy && <Loader2 className="animate-spin" />}{O.record}</Button>
        {s.err && <p className="text-xs text-destructive">{s.err}</p>}
      </div>
    </div>
  );
}

type JLine = { accountId: string | null; debit: string; credit: string; memo: string };
function JournalCapture({ data, reload }: { data: Data; reload: () => void }) {
  const accts: RecordData[] = data.accounts?.journal ?? [];
  const blank = (): JLine => ({ accountId: null, debit: "", credit: "", memo: "" });
  const [lines, setLines] = useState<JLine[]>([blank()]);
  const s = useSubmit(reload);
  const set = (i: number, p: Partial<JLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const lineOk = (l: JLine) => !!l.accountId && ((AMOUNT_RE.test(l.debit) && dec(l.debit).gt(0) && !l.credit) || (AMOUNT_RE.test(l.credit) && dec(l.credit).gt(0) && !l.debit));
  const ok = lines.length >= 1 && lines.length <= 100 && lines.every(lineOk);
  // Exact decimal (decimal.js on validated strings); never Number/parseFloat.
  const zero = dec("0.0000");
  const net = lines.reduce((t, l) => t.plus(AMOUNT_RE.test(l.debit) ? dec(l.debit) : zero).minus(AMOUNT_RE.test(l.credit) ? dec(l.credit) : zero), zero);
  return (
    <div className="space-y-2 px-3 py-3">
      <p className="text-xs text-muted-foreground">{O.journalHint}</p>
      <ol className="divide-y rounded-md border">
        {lines.map((l, i) => (
          <li key={i} className="grid grid-cols-2 gap-2 px-2 py-2 sm:grid-cols-12" data-testid={`opening-jline-${i}`}>
            <LineField label={A.f.account} className="col-span-2 sm:col-span-5"><PickSelect value={l.accountId} onChange={(v) => set(i, { accountId: v })} className="w-full" testId={`select-opening-jline-account-${i}`} options={accts.map((a) => ({ value: a.id, label: `${label(a)} · ${A.types?.[a.type] ?? a.type}` }))} /></LineField>
            <LineField label={A.f.debit} className="sm:col-span-2"><Input inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value })} className="h-8 text-right font-mono" data-testid={`input-opening-jline-debit-${i}`} /></LineField>
            <LineField label={A.f.credit} className="sm:col-span-2"><Input inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value })} className="h-8 text-right font-mono" data-testid={`input-opening-jline-credit-${i}`} /></LineField>
            <LineField label={A.f.memo} className="sm:col-span-2"><Input value={l.memo} onChange={(e) => set(i, { memo: e.target.value })} className="h-8" /></LineField>
            <div className="flex items-end justify-end sm:col-span-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} title={A.a.removeLine}><Trash2 className="h-3.5 w-3.5" /></Button></div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={lines.length >= 100} onClick={() => setLines((ls) => [...ls, blank()])}><Plus />{O.addLine}</Button>
        <span className="text-xs text-muted-foreground">{O.openingEquity}: <Money v={net.negated().toFixed(4)} /></span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!ok || s.busy} onClick={() => s.run({ stage: "JOURNAL", lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit || "0.0000", credit: l.credit || "0.0000", ...(l.memo.trim() ? { memo: l.memo.trim() } : {}) })) }, () => setLines([blank()]))} data-testid="button-opening-journal-post">{s.busy && <Loader2 className="animate-spin" />}{O.postJournal}</Button>
        {s.err && <p className="text-xs text-destructive">{s.err}</p>}
      </div>
    </div>
  );
}

function Review({ data, stage, reload }: { data: Data; stage: string; reload: () => void }) {
  const op = useOp();
  const [reason, setReason] = useState("");
  const [locs, setLocs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const outlets: RecordData[] = data.outlets ?? [];
  const stock = stage === "STOCK" && isRetail(data); // non-retail: review with no locationIds
  const accts: RecordData[] = stage === "CASH" ? data.accounts?.cash ?? [] : stage === "BANK" ? data.accounts?.bank ?? [] : [];
  const uncaptured = accts.filter((a) => !a.captured).length;
  const ok = reason.trim().length >= 10 && uncaptured === 0 && (!stock || outlets.every((o) => locs.includes(o.id)));
  const go = async () => {
    setBusy(true); setErr(null);
    try { await op("opening", { operation: "review", stage, reason: reason.trim(), ...(stock ? { locationIds: locs } : {}) }); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 border-t bg-muted/30 px-3 py-3" data-testid="panel-opening-review">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{O.review}</div>
      {uncaptured > 0 && <p className="text-xs text-destructive">{O.notCaptured}: {uncaptured}</p>}
      {stock && (
        <fieldset className="space-y-1">
          <legend className="text-xs">{O.reviewLocations}</legend>
          <div className="grid gap-1 sm:grid-cols-3">{outlets.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm"><Checkbox checked={locs.includes(o.id)} onCheckedChange={(c) => setLocs((l) => (c === true ? [...l, o.id] : l.filter((x) => x !== o.id)))} data-testid={`check-opening-location-${o.id}`} />{label(o)}</label>
          ))}</div>
        </fieldset>
      )}
      <Label htmlFor="opening-review-reason" className="text-xs">{O.reviewReason}</Label>
      <Textarea id="opening-review-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-opening-review-reason" />
      <p className={`text-[11px] ${reason && reason.trim().length < 10 ? "text-destructive" : "text-muted-foreground"}`}>{O.reviewHint}</p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={!ok || busy} onClick={go} data-testid="button-opening-review">{busy && <Loader2 className="animate-spin" />}{O.review}</Button>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    </div>
  );
}

/* ---------- reconciliation, declare ---------- */
function Reconciliation({ data }: { data: Data }) {
  const r = data.reconciliation ?? {};
  const rows: RecordData[] = r.accounts ?? [];
  const unmatched: RecordData[] = r.unmatched ?? [];
  const zero = r.openingEquityBalance !== undefined && r.openingEquityBalance !== null && dec(r.openingEquityBalance).isZero();
  return (
    <Section title={O.reconciliation} right={<span className="text-xs">{O.openingEquity}: <Money v={r.openingEquityBalance} strong className={zero ? "" : "text-destructive"} /></span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-opening-reconciliation">
          <thead><tr className="border-b text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"><th className="px-3 py-1.5">{A.f.account}</th><th className="px-3 py-1.5 text-right">{A.f.debit}</th><th className="px-3 py-1.5 text-right">{A.f.credit}</th><th className="px-3 py-1.5 text-right">{A.f.balance}</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.accountId} className="border-b last:border-0"><td className="px-3 py-1.5"><span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}</td><td className="px-3 py-1.5 text-right"><Amt v={a.debit} /></td><td className="px-3 py-1.5 text-right"><Amt v={a.credit} /></td><td className="px-3 py-1.5 text-right"><Amt v={a.balance} className="font-semibold" /></td></tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-sm text-muted-foreground">{O.noRecords}</td></tr>}
          </tbody>
        </table>
      </div>
      {unmatched.length > 0 && (
        <div className="border-t px-3 py-2 text-xs" data-testid="list-opening-unmatched">
          <span className="font-medium text-destructive">{O.unmatched}: </span>
          {unmatched.map((u) => <span key={u.accountId} className="mr-3 font-mono">{u.code} {u.name} <Money v={u.balance} /></span>)}
        </div>
      )}
    </Section>
  );
}

function Declare({ data, reload }: { data: Data; reload: () => void }) {
  const op = useOp();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const eq = data.reconciliation?.openingEquityBalance;
  const ready = data.nextStage === "READY" && eq !== undefined && eq !== null && dec(eq).isZero();
  const go = async () => {
    setBusy(true); setErr(null);
    try { await op("opening", { operation: "declare", confirmed: true }); reload(); } catch (e: any) { setErr(e.message); setChecked(false); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-md border bg-card px-3 py-3" data-testid="panel-opening-declare">
      <label className={`flex items-start gap-2 text-sm ${ready ? "" : "opacity-60"}`}><Checkbox disabled={!ready} checked={checked} onCheckedChange={(c) => setChecked(c === true)} className="mt-0.5" data-testid="check-opening-declare" />{O.declareConfirm}</label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!ready || !checked || busy} onClick={go} data-testid="button-opening-declare">{busy && <Loader2 className="animate-spin" />}{O.declare}</Button>
        {!ready && <span className="text-xs text-muted-foreground">{O.declareBlocked}</span>}
        {err && <span className="text-xs text-destructive">{err}</span>}
      </div>
    </div>
  );
}

/* ---------- staged import queue (before open only) ---------- */
function StagedQueue({ data, reload }: { data: Data; reload: () => void }) {
  const rows: RecordData[] = data.stagedImports ?? [];
  const [target, setTarget] = useState<RecordData | null>(null);
  if (!rows.length) return null;
  return (
    <Section title={O.staged}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-opening-staged">
          <thead><tr className="border-b text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"><th className="px-3 py-1.5">{A.f.party}</th><th className="px-3 py-1.5">{A.ag.side}</th><th className="px-3 py-1.5 text-right">{O.amount}</th><th className="px-3 py-1.5 text-right">{O.queueRemaining}</th><th className="px-3 py-1.5">{L.common.status}</th><th /></tr></thead>
          <tbody>{rows.map((q) => (
            <tr key={q.id} className="border-b last:border-0">
              <td className="px-3 py-1.5">{q.partyName}</td><td className="px-3 py-1.5 text-xs">{q.side === "RECEIVABLE" ? A.ag.receivables : A.ag.payables}</td>
              <td className="px-3 py-1.5 text-right"><Amt v={q.amount} /></td><td className="px-3 py-1.5 text-right"><Amt v={q.remaining} className="font-semibold" /></td>
              <td className="px-3 py-1.5 text-xs">{q.status}</td>
              <td className="px-3 py-1.5 text-right">{q.status !== "CANCELLED" && dec(q.amount).eq(dec(q.remaining)) && <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setTarget(q)} data-testid={`button-cancel-staged-${q.id}`}>{O.cancelStaged}</Button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {target && <NoteDialog title={O.cancelStaged} body={`${target.partyName} · ${target.remaining}. ${O.cancelStagedBody}`} confirmLabel={O.cancelStaged}
        onClose={() => setTarget(null)} submit={async (op, note) => { await op("opening", { operation: "cancel-staged", id: target.id, reason: note }); reload(); }} />}
    </Section>
  );
}

/* ---------- history + controlled reversal (outside guided input) ---------- */
function History({ data, reload }: { data: Data; reload: () => void }) {
  const { company, can } = useAdmin();
  const rows: RecordData[] = data.records ?? [];
  const [target, setTarget] = useState<RecordData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mayCancel = can("accounts.opening.manage");
  const src = (r: RecordData) => r.invoiceId ? `/${company}/accounts/invoices?id=${r.invoiceId}` : r.billId ? `/${company}/accounts/bills?id=${r.billId}` : r.entryId ? `/${company}/accounts/vouchers?id=${r.entryId}` : null;
  return (
    <Section title={`${O.history} (${rows.length})`}>
      {notice && <p className="border-b px-3 py-2 text-xs">{notice}</p>}
      {rows.length === 0 ? <p className="px-3 py-3 text-sm text-muted-foreground">{O.noRecords}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-opening-history">
            <thead><tr className="border-b text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <th className="px-3 py-1.5">{A.f.number}</th><th className="px-3 py-1.5">{O.stage}</th><th className="px-3 py-1.5">{O.ledgerDate}</th><th className="px-3 py-1.5">{A.f.account} / {A.f.party} / {A.f.outlet}</th><th className="px-3 py-1.5">{O.origRef}</th><th className="px-3 py-1.5">{O.origDate}</th><th className="px-3 py-1.5">{O.dueDate}</th><th className="px-3 py-1.5 text-right">{O.amount}</th><th className="px-3 py-1.5">{L.common.status}</th><th />
            </tr></thead>
            <tbody>{rows.map((r) => {
              const href = src(r);
              return (
                <tr key={r.id} className="border-b last:border-0 align-top" data-testid={`row-opening-record-${r.id}`}>
                  <td className="px-3 py-1.5 font-mono text-xs">{href ? <Link href={href} className="text-primary hover:underline">{r.number}</Link> : r.number}</td>
                  <td className="px-3 py-1.5 text-xs">{stageName(r.stage)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(r.date)}</td>
                  <td className="px-3 py-1.5 text-xs">{r.account ? label(r.account) : r.party ? label(r.party) : r.outlet ? label(r.outlet) : "—"}{r.stockCode && <span className="block font-mono text-muted-foreground">{r.stockCode} · {r.description} · {r.quantity} × {r.unitCost}</span>}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.originalReference ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.originalDate ? date(r.originalDate) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.dueDate ? date(r.dueDate) : "—"}</td>
                  <td className="px-3 py-1.5 text-right"><Amt v={r.amount} /></td>
                  <td className="px-3 py-1.5 text-xs">{A.status[r.status] ?? r.status}{r.cancelReason && <span className="block text-muted-foreground">{r.cancelReason}</span>}</td>
                  <td className="px-3 py-1.5 text-right">{mayCancel && r.status === "POSTED" && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTarget(r)} data-testid={`button-opening-reversal-${r.id}`}>{O.reversal}</Button>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {target && <NoteDialog title={`${O.reversal} · ${target.number}`} body={O.reversalHint} confirmLabel={O.reversal} onClose={() => setTarget(null)}
        submit={async (op, note) => { const r = await op("opening-documents", { id: target.id, operation: "cancel", note }); if (r?.approvalRequested) setNotice(r.message || A.a.approvalSent); reload(); }} />}
    </Section>
  );
}

function NoteDialog({ title, body, confirmLabel, onClose, submit }: { title: string; body: string; confirmLabel: string; onClose: () => void; submit: (op: ReturnType<typeof useOp>, note: string) => Promise<void> }) {
  const op = useOp();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = note.trim().length >= 10;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card sm:max-w-lg">
        <DialogHeader><DialogTitle className="text-lg">{title}</DialogTitle><DialogDescription>{body}</DialogDescription></DialogHeader>
        <Label htmlFor="opening-note">{O.reversalNote}</Label>
        <Textarea id="opening-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-opening-note" />
        <p className={`text-[11px] ${note && !ok ? "text-destructive" : "text-muted-foreground"}`}>{O.reviewHint}</p>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{L.common.cancel}</Button>
          <Button variant="destructive" disabled={!ok || busy} onClick={async () => { setBusy(true); setErr(null); try { await submit(op, note.trim()); onClose(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }} data-testid="button-opening-note-confirm">{busy && <Loader2 className="animate-spin" />}{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
