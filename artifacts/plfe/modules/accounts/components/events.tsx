"use client";
import { useEffect, useState } from "react";
import { CalendarRange, Plus, RotateCw, X } from "lucide-react";
import { API, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { accountList, accountReport, type AccountsPage } from "../client";
import { A, AMOUNT_RE, Amt, EmptyBox, ErrorBox, Money, PickSelect, Section, dec, fix4, useOp } from "./util";

const E = A.ev;
const TH = "h-8 whitespace-nowrap border-b bg-card px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
const STATUSES = ["PLANNED", "OPEN", "RUNNING", "CLOSED", "CANCELLED"] as const;
const TONE: Record<string, "ok" | "muted" | "bad" | "warn" | "brand" | "teal"> = {
  PLANNED: "muted", OPEN: "brand", RUNNING: "ok", CLOSED: "teal", CANCELLED: "bad",
};
const today = () => new Date().toISOString().slice(0, 10);

function StatusTag({ s }: { s: string }) {
  return <Tag tone={TONE[s] ?? "muted"}>{E.statuses[s] ?? s}</Tag>;
}

/** The expo register. Every expo listed here is a tag that income and costs can
 * carry, which is the whole reason the module exists. */
export function EventsSection() {
  const { company, can } = useAdmin();
  const [data, setData] = useState<AccountsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const mayWrite = can("accounts.event.create") || can("accounts.event.update");

  useEffect(() => {
    let live = true;
    setError(null);
    accountList(company, "events", new URLSearchParams({ page: "1", pageSize: "100" }))
      .then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, tick]);
  const reload = () => { setTick((t) => t + 1); setEditing(undefined); };

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-80" />;

  return (
    <div className="space-y-4">
      <Section
        title={A.nav.events}
        right={
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)} title={L.common.retry}><RotateCw /></Button>
            {mayWrite && <Button size="sm" onClick={() => setEditing(editing === null ? undefined : null)} data-testid="button-new-event">
              {editing === null ? <X /> : <Plus />}{editing === null ? L.common.close : E.newEvent}
            </Button>}
          </div>
        }
      >
        {data.rows.length === 0 ? (
          <EmptyBox icon={<CalendarRange className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />} title={E.none} body={E.noneBody} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-events">
              <thead><tr>
                <th className={`${TH} text-left`}>{A.f.code}</th><th className={`${TH} text-left`}>{A.f.name}</th>
                <th className={`${TH} text-left`}>{E.where}</th><th className={`${TH} text-left`}>{E.when}</th>
                <th className={`${TH} text-right`}>{E.budgetIncome}</th><th className={`${TH} text-right`}>{E.budgetCost}</th>
                <th className={`${TH} text-left`}>{L.f.status ?? "Status"}</th><th className={TH} />
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0" data-testid={`row-event-${r.id}`}>
                    <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-1.5">{r.name}{r.edition ? <span className="ml-1 text-xs text-muted-foreground">#{r.edition}</span> : null}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{[r.city, r.venue].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(r.startDate)}{String(r.startDate).slice(0, 10) !== String(r.endDate).slice(0, 10) && <> – {date(r.endDate)}</>}</td>
                    <td className="px-3 py-1.5 text-right"><Amt v={r.budgetIncome} /></td>
                    <td className="px-3 py-1.5 text-right"><Amt v={r.budgetCost} /></td>
                    <td className="px-3 py-1.5"><StatusTag s={String(r.status)} /></td>
                    <td className="px-3 py-1.5 text-right">
                      {mayWrite && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => setEditing(r)} data-testid={`button-edit-event-${r.id}`}>{L.common.edit ?? "Edit"}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {editing !== undefined && mayWrite && <EventForm event={editing} onDone={reload} onCancel={() => setEditing(undefined)} />}
    </div>
  );
}

function EventForm({ event, onDone, onCancel }: { event: RecordData | null; onDone: () => void; onCancel: () => void }) {
  const run = useOp();
  const [f, setF] = useState(() => ({
    code: String(event?.code ?? ""), name: String(event?.name ?? ""),
    city: String(event?.city ?? ""), venue: String(event?.venue ?? ""),
    edition: event?.edition ? String(event.edition) : "",
    startDate: String(event?.startDate ?? today()).slice(0, 10),
    endDate: String(event?.endDate ?? today()).slice(0, 10),
    status: String(event?.status ?? "PLANNED"),
    budgetIncome: event ? fix4(dec(event.budgetIncome)) : "0.0000",
    budgetCost: event ? fix4(dec(event.budgetCost)) : "0.0000",
    notes: String(event?.notes ?? ""),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const amounts = AMOUNT_RE.test(f.budgetIncome.trim()) && AMOUNT_RE.test(f.budgetCost.trim());
  const ready = /^[A-Za-z0-9-]{1,30}$/.test(f.code.trim()) && f.name.trim() && f.endDate >= f.startDate && amounts;
  const budgeted = amounts ? dec(f.budgetIncome).minus(dec(f.budgetCost)) : null;

  async function save() {
    setBusy(true); setError(null);
    try {
      await run("events", { ...(event ? { id: event.id } : {}), ...f,
        city: f.city.trim() || null, venue: f.venue.trim() || null, notes: f.notes.trim() || null,
        edition: f.edition.trim() || null, budgetIncome: fix4(dec(f.budgetIncome)), budgetCost: fix4(dec(f.budgetCost)) });
      onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Section title={event ? `${A.nav.events} · ${event.code}` : E.newEvent}
      right={<Button variant="ghost" size="sm" onClick={onCancel}><X />{L.common.cancel}</Button>}>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={A.f.code} hint={event ? E.codeFixed : undefined}>
              <Input value={f.code} disabled={!!event} onChange={(e) => set("code")(e.target.value)} className="h-8 font-mono" data-testid="input-event-code" />
            </Field>
            <Field label={A.f.name} className="sm:col-span-2">
              <Input value={f.name} onChange={(e) => set("name")(e.target.value)} className="h-8" data-testid="input-event-name" />
            </Field>
            <Field label={E.edition}>
              <Input value={f.edition} inputMode="numeric" onChange={(e) => set("edition")(e.target.value)} className="h-8" data-testid="input-event-edition" />
            </Field>
            <Field label={E.city}>
              <Input value={f.city} onChange={(e) => set("city")(e.target.value)} className="h-8" data-testid="input-event-city" />
            </Field>
            <Field label={E.venue}>
              <Input value={f.venue} onChange={(e) => set("venue")(e.target.value)} className="h-8" data-testid="input-event-venue" />
            </Field>
            <Field label={E.from}>
              <Input type="date" value={f.startDate} onChange={(e) => set("startDate")(e.target.value)} className="h-8" data-testid="input-event-start" />
            </Field>
            <Field label={E.to}>
              <Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set("endDate")(e.target.value)}
                className={`h-8 ${f.endDate < f.startDate ? "border-destructive" : ""}`} data-testid="input-event-end" />
            </Field>
            <Field label={L.f.status ?? "Status"}>
              <PickSelect value={f.status} onChange={(v) => v && set("status")(v)} className="w-full" testId="select-event-status"
                options={STATUSES.map((s) => ({ value: s, label: E.statuses[s] }))} />
            </Field>
            <Field label={E.budgetIncome}>
              <Input value={f.budgetIncome} inputMode="decimal" onChange={(e) => set("budgetIncome")(e.target.value)}
                className="h-8 text-right font-mono tabular-nums" data-testid="input-event-budget-income" />
            </Field>
            <Field label={E.budgetCost}>
              <Input value={f.budgetCost} inputMode="decimal" onChange={(e) => set("budgetCost")(e.target.value)}
                className="h-8 text-right font-mono tabular-nums" data-testid="input-event-budget-cost" />
            </Field>
          </div>
          <Field label={E.notes}>
            <Textarea value={f.notes} rows={2} onChange={(e) => set("notes")(e.target.value)} className="max-w-3xl" data-testid="input-event-notes" />
          </Field>
          {error && <p className="text-sm text-destructive" data-testid="text-event-error">{error}</p>}
        </div>
        <aside className="space-y-2 self-start rounded-md border bg-muted/30 p-3">
          <Row label={E.budgetIncome}><Money v={amounts ? f.budgetIncome : null} /></Row>
          <Row label={E.budgetCost}><Money v={amounts ? f.budgetCost : null} /></Row>
          <div className="border-t pt-2"><Row label={E.budgetedProfit}><Money v={budgeted ? fix4(budgeted) : null} strong /></Row></div>
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{E.tagNote}</p>
          <Button className="w-full" disabled={!ready || busy} onClick={() => void save()} data-testid="button-save-event">{L.common.save}</Button>
        </aside>
      </div>
    </Section>
  );
}

/** Income less direct costs, per expo, against what was budgeted for it. */
export function EventProfitSection() {
  const { company } = useAdmin();
  const [status, setStatus] = useState<string | null>(null);
  const [data, setData] = useState<AccountsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    accountReport(company, "event-profit", p).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, status, tick]);

  if (error) return <ErrorBox error={error} retry={() => setTick((t) => t + 1)} />;
  if (!data) return <Skeleton className="h-80" />;
  const s = data.summary ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card px-3 py-2.5">
        <PickSelect value={status} onChange={setStatus} allowNone placeholder={L.f.status ?? "Status"} className="h-8 w-48"
          testId="select-event-profit-status" options={STATUSES.map((v) => ({ value: v, label: E.statuses[v] }))} />
        <span className="text-xs text-muted-foreground">{E.profitNote}</span>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setTick((t) => t + 1)} title={L.common.retry}><RotateCw /></Button>
      </div>
      {data.rows.length === 0 ? (
        <Section title={A.nav["event-profit"]}><EmptyBox title={E.noneToReport} body={E.noneBody} /></Section>
      ) : (
        <Section title={A.nav["event-profit"]}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-event-profit">
              <thead><tr>
                <th className={`${TH} text-left`}>{A.f.code}</th><th className={`${TH} text-left`}>{A.f.name}</th>
                <th className={`${TH} text-left`}>{E.when}</th>
                <th className={`${TH} text-right`}>{E.income}</th><th className={`${TH} text-right`}>{E.directCost}</th>
                <th className={`${TH} text-right`}>{E.profit}</th><th className={`${TH} text-right`}>{E.margin}</th>
                <th className={`${TH} text-right`}>{E.vsBudget}</th><th className={`${TH} text-right`}>{E.otherCost}</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r: any) => {
                  const against = dec(r.profit).minus(dec(r.budgetedProfit));
                  return (
                    <tr key={r.id} className="border-b last:border-0" data-testid={`row-event-profit-${r.id}`}>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
                      <td className="px-3 py-1.5">{r.name} <StatusTag s={r.status} /></td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(r.startDate)}</td>
                      <td className="px-3 py-1.5 text-right"><Amt v={r.income} /></td>
                      <td className="px-3 py-1.5 text-right"><Amt v={r.directCost} /></td>
                      <td className="px-3 py-1.5 text-right"><Money v={r.profit} strong /></td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">{r.margin === null ? "—" : `${r.margin}%`}</td>
                      <td className="px-3 py-1.5 text-right"><Money v={fix4(against)} /></td>
                      <td className="px-3 py-1.5 text-right"><Amt v={r.otherCost} className="text-muted-foreground" /></td>
                    </tr>
                  );
                })}
                <tr className="border-t bg-muted/30">
                  <td className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground" colSpan={3}>{A.f.total}</td>
                  <td className="px-3 py-2 text-right"><Amt v={s.income} className="font-semibold" /></td>
                  <td className="px-3 py-2 text-right"><Amt v={s.directCost} className="font-semibold" /></td>
                  <td className="px-3 py-2 text-right"><Money v={s.profit} strong /></td>
                  <td /><td /><td className="px-3 py-2 text-right"><Amt v={s.otherCost} className="font-semibold text-muted-foreground" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <p className="px-1 text-xs text-muted-foreground">{E.officeNote}</p>
      <a className="hidden" href={`${API}/${company}/accounts/reports/event-profit`} aria-hidden />
    </div>
  );
}

function Field({ label: l, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{l}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
function Row({ label: l, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-xs text-muted-foreground">{l}</span>{children}</div>;
}
