"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RotateCw, Wallet, X } from "lucide-react";
import { api, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { A, AMOUNT_RE, Amt, ApprovalNotice, EmptyBox, ErrorBox, Money, PickSelect, Section, dec, fix4, sum, useOp } from "./util";

const C = A.cc;
const TH = "h-8 whitespace-nowrap border-b bg-card px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
type Drawer = { accountId: string; code: string; name: string; outlet: string | null; bookBalance: string; lastCountDate: string | null; lastCountDifference: string | null; daysSinceCount: number | null; neverCounted: boolean };
type View = { accounts: Drawer[]; rows: RecordData[] };

const today = () => new Date().toISOString().slice(0, 10);
const since = (d: number | null) => (d === null ? C.never : d === 0 ? C.today : d === 1 ? C.yesterday : `${d} ${C.daysAgo}`);

/** A drawer that nobody counts cannot be trusted, so the drawers come first and
 * the ones never counted are stated plainly rather than left to be noticed. */
export function CashCountsSection() {
  const { company, can } = useAdmin();
  const run = useOp();
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mayCount = can("accounts.cashcount.create");
  const mayPost = can("accounts.cashcount.post");

  useEffect(() => {
    let live = true;
    setError(null);
    api<View>(`/${company}/accounts/cash-counts`).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, tick]);

  const reload = () => setTick((t) => t + 1);
  const drawers = data?.accounts ?? [];
  const uncounted = drawers.filter((d) => d.neverCounted).length;

  async function post(id: string) {
    const r = await run("cash-counts", { id, operation: "post" }, A.a.posted);
    if (r?.approvalRequested) setNotice(r.message ?? A.a.approvalSent);
    reload();
  }

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-80" />;

  return (
    <div className="space-y-4">
      {notice && <ApprovalNotice message={notice} onClose={() => setNotice(null)} />}

      <Section
        title={<>{C.drawers}{uncounted > 0 && <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-destructive">{uncounted} {C.never.toLowerCase()}</span>}</>}
        right={
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={reload} title={L.common.retry}><RotateCw /></Button>
            {mayCount && drawers.length > 0 && (
              <Button size="sm" onClick={() => setOpen(open ? null : drawers[0].accountId)} data-testid="button-new-count">
                {open ? <X /> : <Plus />}{open ? L.common.close : C.newCount}
              </Button>
            )}
          </div>
        }
      >
        {drawers.length === 0 ? (
          <EmptyBox icon={<Wallet className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />} title={C.noDrawers} body={C.noDrawersBody} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-drawers">
              <thead><tr>
                <th className={`${TH} text-left`}>{A.f.account}</th>
                <th className={`${TH} text-left`}>{A.f.outlet}</th>
                <th className={`${TH} text-right`}>{C.book}</th>
                <th className={`${TH} text-left`}>{C.lastCount}</th>
                <th className={`${TH} text-right`}>{A.f.difference}</th>
              </tr></thead>
              <tbody>
                {drawers.map((d) => (
                  <tr key={d.accountId} className="border-b last:border-0" data-testid={`row-drawer-${d.accountId}`}>
                    <td className="px-3 py-1.5"><span className="font-mono text-xs text-muted-foreground">{d.code}</span> {d.name}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{d.outlet ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right"><Money v={d.bookBalance} /></td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                      {d.neverCounted ? <Tag tone="bad">{C.never}</Tag> : <><span className="font-mono">{date(d.lastCountDate)}</span> <span className="text-muted-foreground">· {since(d.daysSinceCount)}</span></>}
                    </td>
                    <td className="px-3 py-1.5 text-right">{d.neverCounted ? <Amt v={null} /> : <Amt v={d.lastCountDifference} className={dec(d.lastCountDifference).isZero() ? "text-muted-foreground" : "font-semibold text-destructive"} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {open && mayCount && <CountForm drawers={drawers} accountId={open} onAccount={setOpen} onSaved={(id) => { reload(); if (mayPost) void post(id); else setOpen(null); }} onCancel={() => setOpen(null)} />}

      <Section title={C.recent}>
        {data.rows.length === 0 ? <EmptyBox title={C.noCounts} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-cash-counts">
              <thead><tr>
                <th className={`${TH} text-left`}>{A.f.number}</th><th className={`${TH} text-left`}>{A.f.date}</th>
                <th className={`${TH} text-left`}>{A.f.account}</th>
                <th className={`${TH} text-right`}>{C.counted}</th><th className={`${TH} text-right`}>{C.book}</th>
                <th className={`${TH} text-right`}>{A.f.difference}</th><th className={`${TH} text-left`}>{A.f.narration}</th>
                <th className={`${TH} text-left`}>{L.f.status ?? "Status"}</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const diff = dec(r.difference);
                  return (
                    <tr key={r.id} className="border-b last:border-0" data-testid={`row-count-${r.id}`}>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.number ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(r.date)}</td>
                      <td className="px-3 py-1.5"><span className="font-mono text-xs text-muted-foreground">{r.accountCode}</span> {r.accountName}</td>
                      <td className="px-3 py-1.5 text-right"><Amt v={r.countedAmount} /></td>
                      <td className="px-3 py-1.5 text-right"><Amt v={r.bookAmount} /></td>
                      <td className="px-3 py-1.5 text-right">
                        {diff.isZero() ? <span className="text-xs text-muted-foreground">{C.agrees}</span>
                          : <span className="whitespace-nowrap"><Amt v={r.difference} className="font-semibold" /> <span className="text-[10px] uppercase text-muted-foreground">{diff.isNegative() ? C.short : C.over}</span></span>}
                      </td>
                      <td className="max-w-[22rem] truncate px-3 py-1.5 text-xs text-muted-foreground" title={r.explanation ?? ""}>{r.explanation ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        {r.status === "POSTED"
                          ? (r.entryId ? <Link href={`/${company}/accounts/vouchers?id=${r.entryId}`} className="text-xs font-medium text-primary hover:underline">{A.status.POSTED}</Link> : <Tag tone="ok">{A.status.POSTED}</Tag>)
                          : <span className="flex items-center gap-2"><Tag tone="muted">{A.status.DRAFT}</Tag>{mayPost && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => void post(r.id)} data-testid={`button-post-count-${r.id}`}>{A.a.post}</button>}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/** Counting is a two-minute job at a counter, so the form is one screen: pick
 * the drawer, type what is there, and say why if it does not agree. */
function CountForm({ drawers, accountId, onAccount, onSaved, onCancel }: {
  drawers: Drawer[]; accountId: string; onAccount: (id: string) => void; onSaved: (id: string) => void; onCancel: () => void;
}) {
  const run = useOp();
  const [day, setDay] = useState(today());
  const [counted, setCounted] = useState("");
  const [explanation, setExplanation] = useState("");
  const [rows, setRows] = useState<{ value: string; count: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawer = drawers.find((d) => d.accountId === accountId);
  const book = dec(drawer?.bookBalance);
  const denomTotal = useMemo(() => sum(rows.map((r) => (AMOUNT_RE.test(r.value.trim()) && /^\d+$/.test(r.count.trim()) ? dec(r.value).mul(r.count) : 0))), [rows]);
  const amount = counted.trim();
  const valid = AMOUNT_RE.test(amount);
  const difference = valid ? dec(amount).minus(book) : null;
  const needsReason = difference !== null && !difference.isZero();
  const ready = valid && (!needsReason || explanation.trim().length >= 10);

  async function save() {
    setBusy(true); setError(null);
    try {
      const denominations = rows.filter((r) => AMOUNT_RE.test(r.value.trim()) && /^\d+$/.test(r.count.trim()) && Number(r.count) > 0)
        .map((r) => ({ value: r.value.trim(), count: Number(r.count) }));
      const saved = await run("cash-counts", { accountId, date: day, countedAmount: fix4(dec(amount)), denominations, explanation: explanation.trim() || null });
      onSaved(String(saved.id));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Section title={`${C.countFor} · ${drawer?.name ?? ""}`} right={<Button variant="ghost" size="sm" onClick={onCancel}><X />{L.common.cancel}</Button>}>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={C.pickDrawer}>
              <PickSelect value={accountId} onChange={(v) => v && onAccount(v)} className="w-full" testId="select-count-drawer"
                options={drawers.map((d) => ({ value: d.accountId, label: `${d.code} · ${d.name}` }))} />
            </Field>
            <Field label={A.f.date}>
              <Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} className="h-8" data-testid="input-count-date" />
            </Field>
            <Field label={C.counted}>
              <Input value={counted} inputMode="decimal" placeholder="0.00" onChange={(e) => setCounted(e.target.value)}
                className={`h-8 text-right font-mono tabular-nums ${amount && !valid ? "border-destructive" : ""}`} data-testid="input-counted-amount" />
            </Field>
          </div>

          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{C.denominations}</span>
              <button className="text-xs font-semibold text-primary hover:underline" onClick={() => setRows((r) => [...r, { value: "", count: "" }])} data-testid="button-add-denomination">{C.addRow}</button>
            </div>
            {rows.length === 0 ? <p className="px-3 py-2 text-xs text-muted-foreground">{C.denominations} — {L.common.none.toLowerCase()}</p> : (
              <table className="w-full text-sm">
                <thead><tr><th className={`${TH} text-right`}>{C.note}</th><th className={`${TH} text-right`}>{C.pieces}</th><th className={`${TH} text-right`}>{A.f.total}</th><th className={TH} /></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1"><Input value={r.value} inputMode="decimal" className="h-7 text-right font-mono text-xs" onChange={(e) => setRows((x) => x.map((v, j) => (j === i ? { ...v, value: e.target.value } : v)))} data-testid={`input-denom-value-${i}`} /></td>
                      <td className="px-3 py-1"><Input value={r.count} inputMode="numeric" className="h-7 text-right font-mono text-xs" onChange={(e) => setRows((x) => x.map((v, j) => (j === i ? { ...v, count: e.target.value } : v)))} data-testid={`input-denom-count-${i}`} /></td>
                      <td className="px-3 py-1 text-right"><Amt v={AMOUNT_RE.test(r.value.trim()) && /^\d+$/.test(r.count.trim()) ? fix4(dec(r.value).mul(r.count)) : null} /></td>
                      <td className="px-2 py-1 text-right"><button className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>&times;</button></td>
                    </tr>
                  ))}
                  <tr><td className="px-3 py-1.5 text-xs text-muted-foreground" colSpan={2}>{C.denomTotal}</td><td className="px-3 py-1.5 text-right"><Amt v={fix4(denomTotal)} className="font-semibold" /></td><td /></tr>
                </tbody>
              </table>
            )}
          </div>

          {needsReason && (
            <Field label={C.explain} hint={C.explainHint}>
              <Textarea value={explanation} rows={2} onChange={(e) => setExplanation(e.target.value)}
                className={explanation.trim().length > 0 && explanation.trim().length < 10 ? "border-destructive" : ""} data-testid="input-count-explanation" />
            </Field>
          )}
          {error && <p className="text-sm text-destructive" data-testid="text-count-error">{error}</p>}
        </div>

        <aside className="space-y-2 self-start rounded-md border bg-muted/30 p-3">
          <Row label={C.book}><Money v={fix4(book)} /></Row>
          <Row label={C.counted}><Money v={valid ? fix4(dec(amount)) : null} /></Row>
          <div className="border-t pt-2">
            <Row label={A.f.difference}>
              {difference === null ? <Amt v={null} />
                : difference.isZero() ? <span className="text-xs font-medium text-muted-foreground">{C.agrees}</span>
                : <span className="whitespace-nowrap"><Money v={fix4(difference)} strong /> <span className="text-[10px] uppercase text-muted-foreground">{difference.isNegative() ? C.short : C.over}</span></span>}
            </Row>
          </div>
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{C.postNote}</p>
          <Button className="w-full" disabled={!ready || busy} onClick={() => void save()} data-testid="button-save-count">{A.a.post}</Button>
        </aside>
      </div>
    </Section>
  );
}

function Field({ label: l, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{l}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
function Row({ label: l, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-muted-foreground">{l}</span>{children}</div>;
}
