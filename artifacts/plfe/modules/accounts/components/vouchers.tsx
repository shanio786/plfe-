"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CornerDownRight, Loader2, Lock, Plus, Trash2, Undo2 } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/modules/core/components/data-table";
import { useAdmin } from "@/modules/core/components/shared";
import { date, isoDay } from "@/modules/core/components/format";
import { entrySchema } from "../schema";
import { A, AMOUNT_RE, Amt, DocStatus, KindTag, Money, PickSelect, Section, col, dec, fix4, label, perm, sum, useDeepId, useLookups, useOp } from "./util";
import { Attachments, DetailDialog, Facts, useRecord } from "./detail";
import { sourceHref, useLifecycle } from "./lifecycle";

const MANUAL = ["JOURNAL", "CASH", "BANK", "TRANSFER", "EXPENSE"];
const ALL_KINDS = [...MANUAL, "SALES", "PURCHASE", "INVOICE", "CREDIT_NOTE", "BILL", "DEBIT_NOTE", "RECEIPT", "PAYMENT", "REVERSAL"];
const JOURNAL_FOR: Record<string, string> = { JOURNAL: "GENERAL", CASH: "CASH", BANK: "BANK", TRANSFER: "GENERAL", EXPENSE: "GENERAL" };
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
type LLine = { accountId: string; debit: string; credit: string; partyId: string | null; memo: string; departmentId: string | null; eventId: null; outletId: null };
const blank = (): LLine => ({ accountId: "", debit: "", credit: "", partyId: null, memo: "", departmentId: null, eventId: null, outletId: null });

export function VouchersSection() {
  const { company, can } = useAdmin();
  const [id, setId] = useDeepId();
  const [key, setKey] = useState(0);
  const [kind, setKind] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editor, setEditor] = useState<{ rec: RecordData | null } | null>(null);
  const [files, setFiles] = useState(0);
  const { rec, error, retry } = useRecord("entries", id, key);
  const changed = () => setKey((k) => k + 1);
  const manual = rec && MANUAL.includes(rec.kind) && (!rec.sourceType || rec.sourceType === "ENTRY");
  const needsFile = rec?.kind === "EXPENSE" && files === 0;
  const life = useLifecycle("entries", rec, {
    onEdit: () => setEditor({ rec }), editable: !!manual, canPost: !!manual && rec?.kind !== "REVERSAL", postBlock: needsFile ? A.a.expenseNeedsFile : null,
    onChanged: changed, onDeleted: () => { setId(null); changed(); },
  });
  const mayCreate = can(perm("entries", "create"));
  const extra: Record<string, string> = {};
  if (kind) extra.kind = kind;
  if (from) extra.from = from;
  if (to) extra.to = to;
  const src = rec ? sourceHref(company, rec.sourceType, rec.sourceId) : null;
  const reversals: RecordData[] = Array.isArray(rec?.reversals) ? rec!.reversals : [];
  const reversalOf = rec?.reversalOfId ?? rec?.reversedEntryId ?? rec?.reversalOf?.id;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <PickSelect value={kind} onChange={setKind} allowNone className="w-44" testId="select-filter-entry-kind" placeholder={A.a.allKinds} options={ALL_KINDS.map((k) => ({ value: k, label: A.kinds[k] ?? k }))} />
        <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">{A.f.from}</span><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 bg-card" data-testid="input-filter-from" /></div>
        <div className="flex items-center gap-1.5"><span className="text-xs text-muted-foreground">{A.f.to}</span><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 bg-card" data-testid="input-filter-to" /></div>
        {(kind || from || to) && <Button variant="ghost" size="sm" onClick={() => { setKind(null); setFrom(""); setTo(""); }}>{L.actions.clearFilters}</Button>}
      </div>
      <DataTable company={company} resource="accounts/entries" refreshKey={key} extra={extra} onRowClick={(r) => setId(r.id)}
        statusOptions={["DRAFT", "POSTED", "CANCELLED"].map((value) => ({ value, label: A.status[value] }))}
        toolbar={<Button size="sm" disabled={!mayCreate} onClick={() => setEditor({ rec: null })} data-testid="button-new-voucher">{mayCreate ? <Plus /> : <Lock />}{A.a.newVoucher}</Button>}
        columns={[
          col("number", (r) => <span className="font-mono text-xs font-semibold">{r.number ?? <span className="text-muted-foreground">{A.status.DRAFT}</span>}</span>, true),
          col("date", (r) => <span className="font-mono text-xs">{date(r.date)}</span>, true),
          col("kind", (r) => <span className="inline-flex items-center gap-1">{r.kind === "REVERSAL" && <Undo2 className="h-3 w-3 text-destructive" />}<KindTag k={r.kind} /></span>),
          col("journal", (r) => <span className="text-xs">{r.journal?.code ?? "—"}</span>),
          col("narration", (r) => <span className="block max-w-[280px] truncate text-xs text-muted-foreground">{r.narration ?? "—"}</span>),
          col("debit", (r) => <Amt v={r.totalDebit ?? r.total ?? r.debit} className="font-semibold" />),
          col("status", (r) => <span className="inline-flex items-center gap-1"><DocStatus s={r.status} />{Array.isArray(r.reversals) && r.reversals.length > 0 && <span className="text-[10px] font-semibold uppercase text-destructive">{A.a.reversedBy}</span>}</span>),
        ]} />
      <DetailDialog open={!!id} onClose={() => setId(null)} error={error} retry={retry} loading={!rec}
        title={rec ? <span className="flex items-center gap-2"><span className="font-mono">{rec.number ?? A.status.DRAFT}</span><span className="text-muted-foreground">·</span>{rec.journal?.name ?? ""}</span> : L.common.loading}
        meta={rec && <><KindTag k={rec.kind} /><DocStatus s={rec.status} />{reversals.length > 0 && <span className="font-semibold text-destructive">{A.a.reversedBy} {reversals.map((x) => x.number).join(", ")}</span>}</>}
        actions={rec && <>{manual && life.buttons}{src && <Button size="sm" variant="outline" asChild><Link href={src} data-testid="link-source"><CornerDownRight />{A.a.viewSource}</Link></Button>}</>}>
        {rec && (
          <>
            {life.notice}
            {needsFile && rec.status === "DRAFT" && <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm" data-testid="text-expense-needs-file">{A.a.expenseNeedsFile}</p>}
            {(reversals.length > 0 || reversalOf) && (
              <div className="flex flex-wrap gap-2 rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm">
                {reversalOf && <span>{A.a.reversalOf} <Link href={`/${company}/accounts/vouchers?id=${reversalOf}`} className="font-mono font-semibold text-primary hover:underline" data-testid="link-reversal-of">{rec.reversalOf?.number ?? String(reversalOf).slice(0, 8)}</Link></span>}
                {reversals.map((x) => <span key={x.id}>{A.a.reversedBy} <Link href={`/${company}/accounts/vouchers?id=${x.id}`} className="font-mono font-semibold text-destructive hover:underline" data-testid={`link-reversal-${x.id}`}>{x.number ?? x.id.slice(0, 8)}</Link></span>)}
              </div>
            )}
            <Facts items={[
              [A.f.date, <span key="d" className="font-mono">{date(rec.date)}</span>], [A.f.journal, label(rec.journal)], [A.f.source, src ? <Link key="s" href={src} className="text-primary hover:underline">{A.kinds[rec.sourceType] ?? rec.sourceType}</Link> : rec.sourceType ?? "—"], [A.f.narration, rec.narration || "—"],
            ]} />
            <EntryLinesTable lines={rec.lines ?? []} />
            <Attachments docType="ENTRY" docId={rec.id} onCount={setFiles} canUpload={can(perm("entries", rec.status === "DRAFT" ? "update" : "read"))} />
          </>
        )}
      </DetailDialog>
      {life.dialog}
      {editor && <VoucherEditor rec={editor.rec} onClose={() => setEditor(null)} onSaved={(r) => { changed(); if (r?.id) setId(r.id); }} />}
    </>
  );
}

function EntryLinesTable({ lines }: { lines: RecordData[] }) {
  const dr = sum(lines.map((l) => l.debit));
  const cr = sum(lines.map((l) => l.credit));
  return (
    <Section title={A.f.lines}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><th className="px-3 py-2">{A.f.account}</th><th className="px-3 py-2">{A.f.party}</th><th className="px-3 py-2">{A.f.department}</th><th className="px-3 py-2">{A.f.memo}</th><th className="px-3 py-2 text-right">{A.f.debit}</th><th className="px-3 py-2 text-right">{A.f.credit}</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="px-3 py-2"><span className="font-mono text-xs text-muted-foreground">{l.account?.code}</span> {l.account?.name}</td>
                <td className="px-3 py-2 text-xs">{l.party?.name ?? "—"}</td><td className="px-3 py-2 text-xs text-muted-foreground">{l.department?.name ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{l.memo ?? ""}</td>
                <td className="px-3 py-2 text-right"><Amt v={l.debit} /></td><td className="px-3 py-2 text-right"><Amt v={l.credit} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="bg-muted/40 font-semibold"><td colSpan={4} className="px-3 py-2 text-right text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{A.f.total}</td><td className="px-3 py-2 text-right"><Amt v={fix4(dr)} /></td><td className="px-3 py-2 text-right"><Amt v={fix4(cr)} /></td></tr></tfoot>
        </table>
      </div>
    </Section>
  );
}

function VoucherEditor({ rec, onClose, onSaved }: { rec: RecordData | null; onClose: () => void; onSaved: (r: RecordData) => void }) {
  const op = useOp();
  const [error, setError] = useState<string | null>(null);
  const { chart, parties, departments, journals } = useLookups(true);
  const form = useForm<any>({
    resolver: zodResolver(entrySchema as any) as any,
    defaultValues: rec ? { journalId: rec.journalId, kind: rec.kind, date: isoDay(rec.date), narration: rec.narration ?? "", lines: (rec.lines ?? []).map((l: RecordData) => ({ accountId: l.accountId, debit: dec(l.debit).isZero() ? "" : String(l.debit), credit: dec(l.credit).isZero() ? "" : String(l.credit), partyId: l.partyId ?? null, memo: l.memo ?? "", departmentId: l.departmentId ?? null, eventId: null, outletId: null })) }
      : { journalId: "", kind: "JOURNAL", date: today(), narration: "", lines: [blank(), blank()] },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const kind = useWatch({ control: form.control, name: "kind" });
  const watched: LLine[] = useWatch({ control: form.control, name: "lines" }) ?? [];
  const ok = (v: string) => !v || AMOUNT_RE.test(v);
  const dr = sum(watched.filter((l) => ok(l?.debit)).map((l) => l.debit));
  const cr = sum(watched.filter((l) => ok(l?.credit)).map((l) => l.credit));
  const diff = dr.minus(cr);
  const balanced = diff.isZero() && dr.gt(0);
  const acct = (a: RecordData) => kind === "TRANSFER" ? a.isBank || a.isCash : true;
  const acctOpts = chart.rows.filter((a) => !a.isGroup && a.active !== false && acct(a)).map((a) => ({ value: a.id, label: `${label(a)}${a.isBank ? `  [${A.a.bankTag}]` : a.isCash ? `  [${A.a.cashTag}]` : ""}` }));
  const jType = JOURNAL_FOR[kind] ?? "GENERAL";
  const jOpts = journals.rows.filter((j) => j.active !== false).sort((a, b) => Number(b.type === jType) - Number(a.type === jType)).map((j) => ({ value: j.id, label: `${label(j)} (${A.kinds[j.type] ?? j.type})` }));
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = { operation: "save", ...(rec ? { id: rec.id } : {}), ...v, lines: v.lines.map((l: LLine) => ({ accountId: l.accountId, debit: l.debit || "0.0000", credit: l.credit || "0.0000", partyId: l.partyId || null, memo: l.memo || null, departmentId: l.departmentId || null, eventId: null, outletId: null })) };
      const r = await op("entries", body);
      onSaved(r as RecordData); onClose();
    } catch (e: any) { setError(e.message); }
  });
  // empty debit/credit cells are valid: map blanks to zero before zod sees them
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    form.getValues("lines").forEach((l: LLine, i: number) => { if (!l.debit) form.setValue(`lines.${i}.debit`, "0.0000"); if (!l.credit) form.setValue(`lines.${i}.credit`, "0.0000"); });
    return submit(e);
  };
  const errs: any = form.formState.errors;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto bg-card sm:max-w-6xl">
        <DialogHeader><DialogTitle className="font-display text-xl">{rec ? A.a.editDraft : A.a.newVoucher}</DialogTitle><DialogDescription>{kind === "EXPENSE" ? A.a.expenseNeedsFile : A.sub.vouchers}</DialogDescription></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_160px]">
            <div className="space-y-1.5 sm:col-span-3"><Label>{A.f.kind}</Label>
              <div className="flex flex-wrap rounded-md border p-0.5">
                {MANUAL.map((k) => <button key={k} type="button" disabled={!!rec} onClick={() => form.setValue("kind", k)} data-testid={`button-voucher-kind-${k}`} className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{A.kinds[k]}</button>)}
              </div>
            </div>
            <div className="space-y-1.5"><Label>{A.f.journal}</Label><Controller control={form.control} name="journalId" render={({ field }) => <PickSelect value={field.value} onChange={(v) => field.onChange(v ?? "")} className="h-9" testId="select-voucher-journal" options={jOpts} placeholder={journals.loading ? L.common.loading : A.f.journal} />} />{errs.journalId && <p className="text-xs text-destructive">{L.common.required}</p>}</div>
            <div className="space-y-1.5"><Label>{A.f.narration}</Label><Textarea rows={1} {...form.register("narration")} data-testid="input-voucher-narration" /></div>
            <div className="space-y-1.5"><Label>{A.f.date}</Label><Input type="date" {...form.register("date")} data-testid="input-voucher-date" /></div>
          </div>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-muted/50"><tr className="text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><th className="w-8 px-2 py-2">#</th><th className="px-2 py-2">{A.f.account}</th><th className="w-48 px-2 py-2">{A.f.party}</th><th className="w-40 px-2 py-2">{A.f.department}</th><th className="px-2 py-2">{A.f.memo}</th><th className="w-32 px-2 py-2 text-right">{A.f.debit}</th><th className="w-32 px-2 py-2 text-right">{A.f.credit}</th><th className="w-8" /></tr></thead>
                <tbody>
                  {lines.fields.map((f, i) => {
                    const le = errs.lines?.[i];
                    return (
                      <tr key={f.id} className="border-t">
                        <td className="px-2 font-mono text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-1 py-1"><Controller control={form.control} name={`lines.${i}.accountId`} render={({ field }) => <PickSelect value={field.value} onChange={(v) => field.onChange(v ?? "")} options={acctOpts} placeholder={A.f.account} className={le?.accountId ? "border-destructive" : ""} testId={`select-vline-account-${i}`} />} /></td>
                        <td className="px-1 py-1"><Controller control={form.control} name={`lines.${i}.partyId`} render={({ field }) => <PickSelect value={field.value} onChange={field.onChange} allowNone options={parties.rows.map((p) => ({ value: p.id, label: label(p) }))} testId={`select-vline-party-${i}`} />} /></td>
                        <td className="px-1 py-1"><Controller control={form.control} name={`lines.${i}.departmentId`} render={({ field }) => <PickSelect value={field.value} onChange={field.onChange} allowNone options={departments.rows.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: label(d) }))} testId={`select-vline-dept-${i}`} />} /></td>
                        <td className="px-1 py-1"><Input className="h-8" {...form.register(`lines.${i}.memo`)} data-testid={`input-vline-memo-${i}`} /></td>
                        <td className="px-1 py-1"><Input inputMode="decimal" className={`h-8 text-right font-mono ${le?.debit ? "border-destructive" : ""}`} {...form.register(`lines.${i}.debit`)} data-testid={`input-vline-debit-${i}`} /></td>
                        <td className="px-1 py-1"><Input inputMode="decimal" className={`h-8 text-right font-mono ${le?.credit ? "border-destructive" : ""}`} {...form.register(`lines.${i}.credit`)} data-testid={`input-vline-credit-${i}`} /></td>
                        <td className="px-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={lines.fields.length <= 2} onClick={() => lines.remove(i)} title={A.a.removeLine} data-testid={`button-remove-vline-${i}`}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t bg-muted/30 px-3 py-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => lines.append(blank())} data-testid="button-add-vline"><Plus />{A.a.addLine}</Button>
              <span className={`ml-auto rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${balanced ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`} data-testid="status-balance">{balanced ? A.a.balanced : `${A.a.outOfBalance} ${fix4(diff.abs())}`}</span>
              <span className="text-xs text-muted-foreground">{A.f.debit}</span><Money v={fix4(dr)} strong />
              <span className="text-xs text-muted-foreground">{A.f.credit}</span><Money v={fix4(cr)} strong />
            </div>
          </div>
          {Array.isArray(errs.lines) && <p className="text-xs text-destructive">{errs.lines.find(Boolean)?.debit?.message || errs.lines.find(Boolean)?.credit?.message || L.common.required}</p>}
          <p className="text-xs text-muted-foreground">{A.a.future}</p>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-form-error">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{L.common.cancel}</Button>
            <Button type="submit" disabled={form.formState.isSubmitting || !balanced} title={balanced ? undefined : A.a.unbalanced} data-testid="button-save-voucher">{form.formState.isSubmitting && <Loader2 className="animate-spin" />}{L.common.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
