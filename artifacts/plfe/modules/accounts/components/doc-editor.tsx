"use client";
import { useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdmin } from "@/modules/core/components/shared";
import { date, isoDay, money } from "@/modules/core/components/format";
import { billSchema, invoiceSchema } from "../schema";
import { A, AMOUNT_RE, Money, PickSelect, outletFor, outletOpts, dec, fix4, label, perm, sum, useAll, useLookups, useOp , LineField } from "./util";

export type DocRes = "invoices" | "bills";
type Line = { accountId: string; description: string; qty: string; rate: string; departmentId: string | null; eventId: null; outletId: string | null };
const blank = (): Line => ({ accountId: "", description: "", qty: "1.0000", rate: "", departmentId: null, eventId: null, outletId: null as string | null });
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export function docDefaults(res: DocRes, src?: RecordData | null, note?: RecordData | null) {
  const base = res === "invoices" ? "INVOICE" : "BILL";
  if (note) {
    return { kind: res === "invoices" ? "CREDIT_NOTE" : "DEBIT_NOTE", partyId: note.partyId, date: today(), dueDate: today(), originalId: note.id, narration: "",
      lines: (note.lines ?? []).map((l: RecordData) => ({ accountId: l.accountId, description: l.description, qty: l.qty, rate: l.rate, departmentId: l.departmentId ?? null, eventId: null, outletId: l.outletId ?? null })) };
  }
  if (src) {
    return { kind: src.kind ?? base, partyId: src.partyId, date: isoDay(src.date), dueDate: isoDay(src.dueDate), originalId: src.originalId ?? null, narration: src.narration ?? "",
      lines: (src.lines ?? []).map((l: RecordData) => ({ accountId: l.accountId, description: l.description, qty: String(l.qty), rate: String(l.rate), departmentId: l.departmentId ?? null, eventId: null, outletId: l.outletId ?? null })) };
  }
  return { kind: base, partyId: "", date: today(), dueDate: today(), originalId: null, narration: "", lines: [blank()] };
}

export function DocEditor({ res, open, onClose, editId, defaults, onSaved }: {
  res: DocRes; open: boolean; onClose: () => void; editId?: string | null; defaults: Record<string, any>; onSaved: (r: RecordData) => void;
}) {
  const { can } = useAdmin();
  const op = useOp();
  const [error, setError] = useState<string | null>(null);
  const { chart, parties, departments, outlets } = useLookups(open);
  const [outletWarn, setOutletWarn] = useState<Record<number, string>>({});
  const form = useForm<any>({ resolver: zodResolver((res === "invoices" ? invoiceSchema : billSchema) as any) as any, defaultValues: defaults });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  useEffect(() => { if (open) { form.reset(defaults); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = useWatch({ control: form.control, name: "kind" });
  const partyId = useWatch({ control: form.control, name: "partyId" });
  const date = useWatch({ control: form.control, name: "date" });
  const watched: Line[] = useWatch({ control: form.control, name: "lines" }) ?? [];
  const isNote = kind === "CREDIT_NOTE" || kind === "DEBIT_NOTE";
  const origKind = res === "invoices" ? "INVOICE" : "BILL";
  const originals = useAll(res, open && isNote && !!partyId, { partyId: partyId || "", status: "POSTED", kind: origKind });

  const partyOpts = useMemo(() => parties.rows.filter((p) => p.active !== false && (res === "invoices" ? p.isCustomer || p.isExhibitor || p.isSponsor : p.isSupplier || p.isStaff) || p.id === partyId)
    .map((p) => ({ value: p.id, label: label(p) })), [parties.rows, res, partyId]);
  const allParty = partyOpts.length ? partyOpts : parties.rows.map((p) => ({ value: p.id, label: label(p) }));
  const acctOpts = chart.rows.filter((a) => !a.isGroup && a.active !== false).map((a) => ({ value: a.id, label: label(a) }));
  const deptOpts = departments.rows.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: label(d) }));
  const lineTotals = watched.map((l) => (AMOUNT_RE.test(l?.qty ?? "") && AMOUNT_RE.test(l?.rate ?? "") ? dec(l.qty).times(dec(l.rate)) : null));
  const total = sum(lineTotals.filter(Boolean).map((d) => d!.toString()));

  useEffect(() => {
    const p = parties.rows.find((x) => x.id === partyId);
    if (p && date && !editId && !isNote) form.setValue("dueDate", addDays(date, Number(p.creditDays ?? 0)));
  }, [partyId, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = { operation: "save", ...(editId ? { id: editId } : {}), ...v, originalId: isNote ? v.originalId || null : null,
        lines: v.lines.map((l: Line) => ({ ...l, departmentId: l.departmentId || null, eventId: null, outletId: l.outletId || null })) };
      const r = await op(res, body);
      onSaved(r as RecordData);
      onClose();
    } catch (e: any) { setError(e.message); }
  });
  const errs: any = form.formState.errors;
  const kinds = res === "invoices" ? ["INVOICE", "CREDIT_NOTE"] : ["BILL", "DEBIT_NOTE"];
  const noLookups = !can(perm("chart", "read")) || !can(perm("parties", "read"));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto bg-card sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{editId ? A.a.editDraft : res === "invoices" ? A.a.newInvoice : A.a.newBill}</DialogTitle>
          <DialogDescription>{isNote ? A.a.noteOnly : A.sub[res]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          {noLookups && <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm">{A.a.noAccess}: {A.nav.chart} / {A.nav.parties}</p>}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>{A.f.kind}</Label>
              <div className="flex rounded-md border p-0.5">
                {kinds.map((k) => (
                  <button key={k} type="button" disabled={!!editId} onClick={() => { form.setValue("kind", k); form.setValue("originalId", null); }} data-testid={`button-kind-${k}`}
                    className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{A.kinds[k]}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label>{A.f.party}</Label>
              <Controller control={form.control} name="partyId" render={({ field }) => (
                <PickSelect value={field.value} onChange={(v) => { field.onChange(v ?? ""); form.setValue("originalId", null); }} options={allParty} placeholder={parties.loading ? L.common.loading : A.f.party} className="h-9" testId="select-party" />
              )} />
              {errs.partyId && <p className="text-xs text-destructive">{L.common.required}</p>}
            </div>
            <div className="space-y-1.5"><Label>{A.f.date}</Label><Input type="date" {...form.register("date")} data-testid="input-date" /></div>
            <div className="space-y-1.5"><Label>{A.f.dueDate}</Label><Input type="date" {...form.register("dueDate")} data-testid="input-due-date" /></div>
            {isNote && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{A.f.original}</Label>
                <Controller control={form.control} name="originalId" render={({ field }) => (
                  <PickSelect value={field.value} onChange={field.onChange} className="h-9" testId="select-original" placeholder={partyId ? (originals.loading ? L.common.loading : A.f.original) : A.a.pickParty}
                    options={originals.rows.filter((o) => o.kind === origKind || !o.kind).map((o) => ({ value: o.id, label: `${o.number ?? o.id.slice(0, 8)} · ${date(o.date)} · ${money(o.total)}` }))} />
                )} />
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border">
            <ol className="divide-y" data-testid="list-doc-lines">
              {lines.fields.map((f, i) => {
                const le = errs.lines?.[i];
                return (
                  <li key={f.id} className="px-3 py-2" data-testid={`line-${i}`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[11px] text-muted-foreground">{A.a.line} {i + 1}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" disabled={lines.fields.length <= 1} onClick={() => lines.remove(i)} data-testid={`button-remove-line-${i}`}><Trash2 className="h-3 w-3" />{A.a.removeLine}</Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                      <LineField label={A.f.account} className="col-span-2 sm:col-span-5" error={le?.accountId && A.a.pickAccount}><Controller control={form.control} name={`lines.${i}.accountId`} render={({ field }) => <PickSelect value={field.value} onChange={(v) => { field.onChange(v ?? ""); const o = outletFor(chart.rows, v, form.getValues(`lines.${i}.outletId`)); if (o.set) form.setValue(`lines.${i}.outletId`, o.set); setOutletWarn((w) => ({ ...w, [i]: o.warn ?? "" })); }} options={acctOpts} placeholder={A.f.account} className={`w-full ${le?.accountId ? "border-destructive" : ""}`} testId={`select-line-account-${i}`} />} /></LineField>
                      <LineField label={L.f.description} className="col-span-2 sm:col-span-7" error={le?.description && A.a.enterDescription}><Input className={`h-8 ${le?.description ? "border-destructive" : ""}`} {...form.register(`lines.${i}.description`)} data-testid={`input-line-desc-${i}`} /></LineField>
                      <LineField label={A.f.department} className="sm:col-span-3"><Controller control={form.control} name={`lines.${i}.departmentId`} render={({ field }) => <PickSelect value={field.value} onChange={field.onChange} allowNone options={deptOpts} className="w-full" testId={`select-line-dept-${i}`} />} /></LineField>
                      <LineField label={A.f.outlet} className="sm:col-span-3" error={outletWarn[i]}><Controller control={form.control} name={`lines.${i}.outletId`} render={({ field }) => <PickSelect value={field.value} onChange={(v) => { field.onChange(v); setOutletWarn((w) => ({ ...w, [i]: "" })); }} allowNone options={outletOpts(outlets.rows, field.value)} className="w-full" testId={`select-line-outlet-${i}`} />} /></LineField>
                      <LineField label={A.f.qty} className="sm:col-span-2" error={le?.qty && A.a.enterAmount}><Input inputMode="decimal" className={`h-8 text-right font-mono ${le?.qty ? "border-destructive" : ""}`} {...form.register(`lines.${i}.qty`)} data-testid={`input-line-qty-${i}`} /></LineField>
                      <LineField label={A.f.rate} className="sm:col-span-2" error={le?.rate && A.a.enterAmount}><Input inputMode="decimal" className={`h-8 text-right font-mono ${le?.rate ? "border-destructive" : ""}`} {...form.register(`lines.${i}.rate`)} data-testid={`input-line-rate-${i}`} /></LineField>
                      <LineField label={A.f.amount} className="col-span-2 text-right sm:col-span-2"><div className="flex h-8 items-center justify-end font-mono text-sm tabular-nums" data-testid={`text-line-amount-${i}`}>{lineTotals[i] ? <Money v={fix4(lineTotals[i]!)} /> : "—"}</div></LineField>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => lines.append(blank())} data-testid="button-add-line"><Plus />{A.a.addLine}</Button>
              <div className="flex items-baseline gap-3"><span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{A.f.total}</span><Money v={fix4(total)} strong className="text-lg" /></div>
            </div>
          </div>
          {errs.lines && !Array.isArray(errs.lines) && <p className="text-xs text-destructive">{String(errs.lines.message ?? errs.lines.root?.message ?? "")}</p>}
          {Array.isArray(errs.lines) && <p className="text-xs text-destructive">{errs.lines.find(Boolean)?.qty?.message || errs.lines.find(Boolean)?.rate?.message || L.common.required}</p>}
          <div className="space-y-1.5"><Label>{A.f.narration}</Label><Textarea rows={2} {...form.register("narration")} data-testid="input-narration" /></div>
          <p className="text-xs text-muted-foreground">{A.a.future}</p>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-form-error">{error}</p>}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t bg-card px-6 py-3">
            <Button type="button" variant="outline" onClick={onClose}>{L.common.cancel}</Button>
            <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-save-doc">{form.formState.isSubmitting && <Loader2 className="animate-spin" />}{L.common.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
