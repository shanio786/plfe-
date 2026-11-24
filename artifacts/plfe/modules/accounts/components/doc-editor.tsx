"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { date as fmtDate, isoDay, money } from "@/modules/core/components/format";
import { accountGet, accountSave } from "../client";
import { billSchema, invoiceSchema } from "../schema";
import { A, AMOUNT_RE, Money, PickSelect, SelectionNote, SnapEvidence, belowDefault, effectiveTaxes, snapOf, outletFor, outletOpts, dec, fix4, label, perm, sum, taxLabel, useAll, useLookups, useOp, LineField } from "./util";

export type DocRes = "invoices" | "bills";
type TaxSel = "AUTO" | "SELECTED" | "CLEARED";
type Line = { accountId: string; description: string; qty: string; rate: string; departmentId: string | null; eventId: null; outletId: string | null;
  taxSelection: TaxSel; taxId: string | null; withholdingTaxId: string | null; originalLineId: string | null };
const blank = (): Line => ({ accountId: "", description: "", qty: "1.0000", rate: "", departmentId: null, eventId: null, outletId: null, taxSelection: "AUTO", taxId: null, withholdingTaxId: null, originalLineId: null });
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const T = A.t;

/** Line copied from a posted original: carries account, rate, tags and the original's tax selection; server uses its snapshot via originalLineId. */
const fromOriginal = (l: RecordData): Line => ({
  accountId: l.accountId, description: l.description ?? "", qty: String(l.qty), rate: String(l.rate), departmentId: l.departmentId ?? null, eventId: null, outletId: l.outletId ?? null,
  taxSelection: (l.taxSelection as TaxSel) ?? "AUTO", taxId: l.taxId ?? null, withholdingTaxId: l.withholdingTaxId ?? null, originalLineId: l.id,
});
/** Draft line being re-edited: keep everything, including its link to an original line. */
const fromDraft = (l: RecordData): Line => ({
  accountId: l.accountId, description: l.description ?? "", qty: String(l.qty), rate: String(l.rate), departmentId: l.departmentId ?? null, eventId: null, outletId: l.outletId ?? null,
  taxSelection: (l.taxSelection as TaxSel) ?? "AUTO", taxId: l.taxId ?? null, withholdingTaxId: l.withholdingTaxId ?? null, originalLineId: l.originalLineId ?? null,
});

export function docDefaults(res: DocRes, src?: RecordData | null, note?: RecordData | null) {
  const base = res === "invoices" ? "INVOICE" : "BILL";
  if (note) {
    return { kind: res === "invoices" ? "CREDIT_NOTE" : "DEBIT_NOTE", partyId: note.partyId, date: today(), dueDate: today(), originalId: note.id, narration: "", taxOverrideReason: "",
      lines: (note.lines ?? []).map(fromOriginal) };
  }
  if (src) {
    return { kind: src.kind ?? base, partyId: src.partyId, date: isoDay(src.date), dueDate: isoDay(src.dueDate), originalId: src.originalId ?? null, narration: src.narration ?? "", taxOverrideReason: src.taxOverrideReason ?? "",
      lines: (src.lines ?? []).map(fromDraft) };
  }
  return { kind: base, partyId: "", date: today(), dueDate: today(), originalId: null, narration: "", taxOverrideReason: "", lines: [blank()] };
}

const cleanLine = (l: Line) => ({
  ...l, departmentId: l.departmentId || null, eventId: null, outletId: l.outletId || null, withholdingTaxId: l.withholdingTaxId || null, originalLineId: l.originalLineId || null,
  taxSelection: l.taxSelection || "AUTO", taxId: l.taxSelection === "SELECTED" ? l.taxId || null : null,
});

export function DocEditor({ res, open, onClose, editId, defaults, onSaved }: {
  res: DocRes; open: boolean; onClose: () => void; editId?: string | null; defaults: Record<string, any>; onSaved: (r: RecordData) => void;
}) {
  const { company, can } = useAdmin();
  const op = useOp();
  const [error, setError] = useState<string | null>(null);
  const { chart, parties, departments, outlets } = useLookups(open);
  const canTaxes = can(perm("taxes", "read"));
  const taxes = useAll("taxes", open && canTaxes);
  const [outletWarn, setOutletWarn] = useState<Record<number, string>>({});
  const form = useForm<any>({ resolver: zodResolver((res === "invoices" ? invoiceSchema : billSchema) as any) as any, defaultValues: defaults });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const loadedOrig = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    form.reset(defaults); setError(null);
    loadedOrig.current = defaults.originalId && (defaults.lines ?? []).some((l: Line) => l.originalLineId) ? defaults.originalId : null;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const kind = useWatch({ control: form.control, name: "kind" });
  const partyId = useWatch({ control: form.control, name: "partyId" });
  const docDate = useWatch({ control: form.control, name: "date" });
  const originalId = useWatch({ control: form.control, name: "originalId" });
  const reason = useWatch({ control: form.control, name: "taxOverrideReason" });
  const watched: Line[] = useWatch({ control: form.control, name: "lines" }) ?? [];
  const isNote = kind === "CREDIT_NOTE" || kind === "DEBIT_NOTE";
  const origKind = res === "invoices" ? "INVOICE" : "BILL";
  const side = res === "invoices" ? "SALES" : "PURCHASES";
  const originals = useAll(res, open && isNote && !!partyId, { partyId: partyId || "", status: "POSTED", kind: origKind });

  /* Notes: choosing an original fetches its full record (list rows carry no lines) and inherits its lines. */
  const [origState, setOrigState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  useEffect(() => {
    if (!open || !isNote || !originalId || loadedOrig.current === originalId) return;
    let live = true;
    setOrigState({ loading: true, error: null });
    accountGet(company, res, originalId).then((o) => {
      if (!live) return;
      loadedOrig.current = originalId;
      form.setValue("lines", (o.lines ?? []).map(fromOriginal));
      setOutletWarn({});
      setOrigState({ loading: false, error: null });
    }).catch((e) => live && setOrigState({ loading: false, error: e.message }));
    return () => { live = false; };
  }, [open, isNote, originalId, company, res]); // eslint-disable-line react-hooks/exhaustive-deps

  const partyOpts = useMemo(() => parties.rows.filter((p) => p.active !== false && (res === "invoices" ? p.isCustomer || p.isExhibitor || p.isSponsor : p.isSupplier || p.isStaff) || p.id === partyId)
    .map((p) => ({ value: p.id, label: label(p) })), [parties.rows, res, partyId]);
  const allParty = partyOpts.length ? partyOpts : parties.rows.map((p) => ({ value: p.id, label: label(p) }));
  const acctOpts = chart.rows.filter((a) => !a.isGroup && a.active !== false).map((a) => ({ value: a.id, label: label(a) }));
  const deptOpts = departments.rows.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: label(d) }));
  const salesTaxes = effectiveTaxes(taxes.rows, docDate, side, false);
  const whtTaxes = effectiveTaxes(taxes.rows, docDate, side, true);
  const taxOpts = (keep: string | null) => [
    { value: "AUTO", label: T.auto }, { value: "CLEARED", label: T.cleared },
    ...salesTaxes.map((t) => ({ value: t.id, label: taxLabel(t) })),
    ...(keep && !salesTaxes.some((t) => t.id === keep) ? [{ value: keep, label: taxLabel(taxes.rows.find((t) => t.id === keep)) }] : []),
  ];
  const whtOpts = (keep: string | null) => [
    ...whtTaxes.map((t) => ({ value: t.id, label: taxLabel(t) })),
    ...(keep && !whtTaxes.some((t) => t.id === keep) ? [{ value: keep, label: taxLabel(taxes.rows.find((t) => t.id === keep)) }] : []),
  ];
  const lineTotals = watched.map((l) => (AMOUNT_RE.test(l?.qty ?? "") && AMOUNT_RE.test(l?.rate ?? "") ? dec(l.qty).times(dec(l.rate)) : null));
  const subtotal = sum(lineTotals.filter(Boolean).map((d) => d!.toString()));
  const overridden = watched.some((l) => l && !l.originalLineId && l.taxSelection && l.taxSelection !== "AUTO");
  const noTaxSetup = canTaxes && !taxes.loading && !taxes.error && taxes.rows.length === 0;

  useEffect(() => {
    const p = parties.rows.find((x) => x.id === partyId);
    if (p && docDate && !editId && !isNote) form.setValue("dueDate", addDays(docDate, Number(p.creditDays ?? 0)));
  }, [partyId, docDate]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Server tax preview: debounced, only when every required value is valid. Never writes back into the form. */
  const [preview, setPreview] = useState<RecordData | null>(null);
  const [pv, setPv] = useState<{ state: "idle" | "waiting" | "ok" | "error"; error?: string }>({ state: "idle" });
  const complete = !!partyId && /^\d{4}-\d{2}-\d{2}$/.test(docDate ?? "") && (!isNote || !!originalId) && watched.length > 0
    && watched.every((l) => l?.accountId && String(l.description ?? "").trim() && AMOUNT_RE.test(l.qty ?? "") && AMOUNT_RE.test(l.rate ?? "") && (l.taxSelection !== "SELECTED" || l.taxId));
  const pvKey = complete ? JSON.stringify({ kind, partyId, docDate, dueDate: form.getValues("dueDate"), originalId, reason, lines: watched.map(cleanLine) }) : "";
  const seq = useRef(0);
  useEffect(() => {
    if (!open || !pvKey) { setPreview(null); setPv({ state: "idle" }); return; }
    const n = ++seq.current;
    setPv({ state: "waiting" });
    const t = setTimeout(() => {
      const v = form.getValues();
      accountSave(company, res, { operation: "preview", kind: v.kind, partyId: v.partyId, date: v.date, dueDate: v.dueDate, originalId: isNote ? v.originalId || null : null,
        narration: v.narration || null, taxOverrideReason: v.taxOverrideReason || null, lines: (v.lines ?? []).map(cleanLine) })
        .then((r) => { if (n === seq.current) { setPreview(r); setPv({ state: "ok" }); } })
        .catch((e) => { if (n === seq.current) { setPreview(null); setPv({ state: "error", error: e.message }); } });
    }, 450);
    return () => clearTimeout(t);
  }, [pvKey, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = { operation: "save", ...(editId ? { id: editId } : {}), ...v, originalId: isNote ? v.originalId || null : null, taxOverrideReason: v.taxOverrideReason || null,
        lines: v.lines.map(cleanLine) };
      const r = await op(res, body);
      onSaved(r as RecordData);
      onClose();
    } catch (e: any) { setError(e.message); }
  });
  const errs: any = form.formState.errors;
  const kinds = res === "invoices" ? ["INVOICE", "CREDIT_NOTE"] : ["BILL", "DEBIT_NOTE"];
  const noLookups = !can(perm("chart", "read")) || !can(perm("parties", "read"));
  const pl = (i: number): RecordData | undefined => (pv.state === "ok" ? preview?.lines?.[i] : undefined);
  const taxed = pv.state === "ok" && preview;
  // Reason is required when any line charges below its account default (judged from preview snapshots); the server stays authoritative.
  const lowered = pv.state === "ok" && (preview?.lines ?? []).some((l: RecordData, i: number) => belowDefault({ ...l, taxSelection: l.taxSelection ?? watched[i]?.taxSelection, originalLineId: watched[i]?.originalLineId }));
  const needReason = lowered || (pv.state !== "ok" && watched.some((l) => l && !l.originalLineId && l.taxSelection === "CLEARED"));
  const reasonMissing = needReason && !String(reason ?? "").trim();
  const treatment = preview?.partyTaxTreatment;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto bg-card sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{editId ? A.a.editDraft : isNote ? (res === "invoices" ? A.a.creditNote : A.a.debitNote) : res === "invoices" ? A.a.newInvoice : A.a.newBill}</DialogTitle>
          <DialogDescription>{isNote ? A.a.noteOnly : A.sub[res]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {noLookups && <p className="rounded-md border px-3 py-2 text-sm">{A.a.noAccess}: {A.nav.chart} / {A.nav.parties}</p>}
          {noTaxSetup && <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm" data-testid="text-no-taxes">{T.noTaxes} {can(perm("taxes", "create")) && <Link href={`/${company}/accounts/taxes`} className="font-medium text-primary hover:underline">{T.configure}</Link>}</p>}
          {taxes.error && <p className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">{taxes.error}</p>}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>{A.f.kind}</Label>
              <div className="flex rounded-md border p-0.5">
                {kinds.map((k) => (
                  <button key={k} type="button" disabled={!!editId} onClick={() => { form.setValue("kind", k); form.setValue("originalId", null); loadedOrig.current = null; if (!k.includes("NOTE")) form.setValue("lines", [blank()]); }} data-testid={`button-kind-${k}`}
                    className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{A.kinds[k]}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label>{A.f.party}</Label>
              <Controller control={form.control} name="partyId" render={({ field }) => (
                <PickSelect value={field.value} onChange={(v) => { field.onChange(v ?? ""); form.setValue("originalId", null); }} options={allParty} placeholder={parties.loading ? L.common.loading : A.f.party} className="h-9" testId="select-party" />
              )} />
              {errs.partyId && <p className="text-xs text-destructive">{A.a.pickParty}</p>}
              {treatment && treatment !== "STANDARD" && (
                <p className="text-xs" data-testid="text-party-tax-treatment">{T.partyTreatment}: <span className="font-medium">{A.taxTreatments[treatment] ?? treatment}</span>{preview?.partyTaxReason ? ` · ${preview.partyTaxReason}` : ""}{preview?.partyTaxCertificate ? ` · ${T.certificate} ${preview.partyTaxCertificate}` : ""}</p>
              )}
            </div>
            <div className="space-y-1.5"><Label>{A.f.date}</Label><Input type="date" {...form.register("date")} data-testid="input-date" /></div>
            <div className="space-y-1.5"><Label>{A.f.dueDate}</Label><Input type="date" {...form.register("dueDate")} data-testid="input-due-date" /></div>
            {isNote && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{A.f.original}</Label>
                <Controller control={form.control} name="originalId" render={({ field }) => (
                  <PickSelect value={field.value} onChange={field.onChange} className="h-9" testId="select-original" placeholder={partyId ? (originals.loading ? L.common.loading : A.f.original) : A.a.pickParty}
                    options={originals.rows.filter((o) => !o.openingRecordId && (o.kind === origKind || !o.kind)).map((o) => ({ value: o.id, label: `${o.number ?? o.id.slice(0, 8)} · ${fmtDate(o.date)} · ${money(o.netTotal ?? o.total)}` }))} />
                )} />
                {origState.loading && <p className="text-xs text-muted-foreground">{T.loadingOriginal}</p>}
                {origState.error && <p className="text-xs text-destructive">{origState.error}</p>}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-md border">
            <ol className="divide-y" data-testid="list-doc-lines">
              {lines.fields.map((f, i) => {
                const le = errs.lines?.[i];
                const w = watched[i];
                const linked = !!w?.originalLineId;
                const sel = w?.taxSelection === "SELECTED" ? w.taxId ?? "AUTO" : w?.taxSelection ?? "AUTO";
                const p = pl(i);
                return (
                  <li key={f.id} className="px-3 py-2" data-testid={`line-${i}`}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-mono text-[11px] text-muted-foreground">{A.a.line} {i + 1}{linked && <span className="ml-2 font-sans">{T.fromOriginal}</span>}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground" disabled={lines.fields.length <= 1} onClick={() => lines.remove(i)} data-testid={`button-remove-line-${i}`}><Trash2 className="h-3 w-3" />{A.a.removeLine}</Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                      <LineField label={A.f.account} className="col-span-2 sm:col-span-5" error={le?.accountId && A.a.pickAccount}><Controller control={form.control} name={`lines.${i}.accountId`} render={({ field }) => <PickSelect value={field.value} disabled={linked} onChange={(v) => { field.onChange(v ?? ""); const o = outletFor(chart.rows, v, form.getValues(`lines.${i}.outletId`)); if (o.set) form.setValue(`lines.${i}.outletId`, o.set); setOutletWarn((x) => ({ ...x, [i]: o.warn ?? "" })); }} options={acctOpts} placeholder={A.f.account} className={`w-full ${le?.accountId ? "border-destructive" : ""}`} testId={`select-line-account-${i}`} />} /></LineField>
                      <LineField label={L.f.description} className="col-span-2 sm:col-span-7" error={le?.description && A.a.enterDescription}><Input className={`h-8 ${le?.description ? "border-destructive" : ""}`} {...form.register(`lines.${i}.description`)} data-testid={`input-line-desc-${i}`} /></LineField>
                      <LineField label={A.f.department} className="sm:col-span-3"><Controller control={form.control} name={`lines.${i}.departmentId`} render={({ field }) => <PickSelect value={field.value} disabled={linked} onChange={field.onChange} allowNone options={deptOpts} className="w-full" testId={`select-line-dept-${i}`} />} /></LineField>
                      <LineField label={A.f.outlet} className="sm:col-span-3" error={outletWarn[i]}><Controller control={form.control} name={`lines.${i}.outletId`} render={({ field }) => <PickSelect value={field.value} disabled={linked} onChange={(v) => { field.onChange(v); setOutletWarn((x) => ({ ...x, [i]: "" })); }} allowNone options={outletOpts(outlets.rows, field.value)} className="w-full" testId={`select-line-outlet-${i}`} />} /></LineField>
                      <LineField label={A.f.qty} className="sm:col-span-2" error={le?.qty && A.a.enterAmount}><Input inputMode="decimal" className={`h-8 text-right font-mono ${le?.qty ? "border-destructive" : ""}`} {...form.register(`lines.${i}.qty`)} data-testid={`input-line-qty-${i}`} /></LineField>
                      <LineField label={A.f.rate} className="sm:col-span-2" error={le?.rate && A.a.enterAmount}><Input inputMode="decimal" readOnly={linked} className={`h-8 text-right font-mono ${linked ? "bg-muted" : ""} ${le?.rate ? "border-destructive" : ""}`} {...form.register(`lines.${i}.rate`)} data-testid={`input-line-rate-${i}`} /></LineField>
                      <LineField label={T.subtotal} className="col-span-2 text-right sm:col-span-2"><div className="flex h-8 items-center justify-end text-sm" data-testid={`text-line-amount-${i}`}>{lineTotals[i] ? <Money v={fix4(lineTotals[i]!)} /> : "—"}</div></LineField>
                      <LineField label={T.salesTax} className="col-span-2 sm:col-span-4" error={le?.taxId && T.pickTax}>
                        <PickSelect value={sel} disabled={linked} className="w-full" testId={`select-line-tax-${i}`} options={taxOpts(w?.taxSelection === "SELECTED" ? w.taxId : null)}
                          onChange={(v) => {
                            const x = v ?? "AUTO";
                            if (x === "AUTO" || x === "CLEARED") { form.setValue(`lines.${i}.taxSelection`, x); form.setValue(`lines.${i}.taxId`, null); }
                            else { form.setValue(`lines.${i}.taxSelection`, "SELECTED"); form.setValue(`lines.${i}.taxId`, x); }
                          }} />
                      </LineField>
                      <LineField label={T.withholding} className="col-span-2 sm:col-span-4"><Controller control={form.control} name={`lines.${i}.withholdingTaxId`} render={({ field }) => <PickSelect value={field.value} disabled={linked} onChange={field.onChange} allowNone placeholder={T.none} options={whtOpts(field.value)} className="w-full" testId={`select-line-wht-${i}`} />} /></LineField>
                      <LineField label={T.evidence} className="col-span-2 sm:col-span-4">
                        <div className="flex min-h-8 flex-col justify-center gap-0.5 text-right" data-testid={`text-line-tax-${i}`}>
                          {p ? <>
                            <span><span className="text-[10px] uppercase text-muted-foreground">{T.salesTax} </span><SnapEvidence snap={snapOf(p, "tax")} amount={p.taxAmount} /></span>
                            <SelectionNote l={{ ...p, taxSelection: p.taxSelection ?? w?.taxSelection, originalLineId: w?.originalLineId }} />
                            {snapOf(p, "withholding")?.code || (p.withholdingAmount !== undefined && p.withholdingAmount !== null && !dec(p.withholdingAmount).isZero()) ? <span><span className="text-[10px] uppercase text-muted-foreground">{T.withholding} </span><SnapEvidence snap={snapOf(p, "withholding")} amount={p.withholdingAmount} /></span> : null}
                          </> : <span className="text-xs text-muted-foreground">{pv.state === "waiting" ? T.previewing : "—"}</span>}
                        </div>
                      </LineField>
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-start justify-between gap-3 border-t bg-muted/30 px-3 py-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => lines.append(blank())} disabled={isNote && !!originalId} data-testid="button-add-line"><Plus />{A.a.addLine}</Button>
              <table className="text-sm" data-testid="table-doc-totals">
                <tbody>
                  <tr><td className="pr-4 text-muted-foreground">{T.subtotal}</td><td className="text-right"><Money v={taxed ? preview!.subtotal : fix4(subtotal)} /></td></tr>
                  <tr><td className="pr-4 text-muted-foreground">{T.taxTotal}</td><td className="text-right">{taxed ? <Money v={preview!.taxTotal} /> : <span className="text-xs text-muted-foreground">{T.notCalculated}</span>}</td></tr>
                  <tr className="border-t"><td className="pr-4 font-medium">{T.gross}</td><td className="text-right">{taxed ? <Money v={preview!.total} strong /> : "—"}</td></tr>
                  <tr><td className="pr-4 text-muted-foreground">{T.whtTotal}</td><td className="text-right">{taxed ? <Money v={preview!.withholdingTotal} /> : "—"}</td></tr>
                  <tr className="border-t-2"><td className="pr-4 font-semibold">{res === "invoices" ? T.netReceivable : T.netPayable}</td><td className="text-right" data-testid="text-doc-net">{taxed ? <Money v={preview!.netTotal} strong /> : "—"}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="border-t px-3 py-1.5 text-xs" data-testid="status-tax-preview">
              {pv.state === "error" ? <span className="text-destructive">{T.previewFailed} {pv.error}</span>
                : pv.state === "waiting" ? <span className="text-muted-foreground">{T.previewing}</span>
                : pv.state === "idle" ? <span className="text-muted-foreground">{T.previewIncomplete}</span> : null}
            </div>
          </div>
          {errs.lines && !Array.isArray(errs.lines) && <p className="text-xs text-destructive">{String(errs.lines.message ?? errs.lines.root?.message ?? "")}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>{A.f.narration}</Label><Textarea rows={2} {...form.register("narration")} data-testid="input-narration" /></div>
            {(overridden || (treatment && treatment !== "STANDARD") || !!defaults.taxOverrideReason) && (
              <div className="space-y-1.5">
                <Label htmlFor="taxOverrideReason">{T.overrideReason}{needReason ? " *" : ""}</Label>
                <Textarea id="taxOverrideReason" rows={2} className={reasonMissing ? "border-destructive" : ""} {...form.register("taxOverrideReason")} data-testid="input-tax-override-reason" />
                <p className={`text-[11px] ${reasonMissing ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-reason-hint">{needReason ? T.lowerThanDefault : T.overrideHint}</p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{A.a.future}</p>
          {error && <p className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive" data-testid="text-form-error">{error}</p>}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t bg-card px-6 py-3">
            <Button type="button" variant="outline" onClick={onClose}>{L.common.cancel}</Button>
            <Button type="submit" disabled={form.formState.isSubmitting || origState.loading} data-testid="button-save-doc">{form.formState.isSubmitting && <Loader2 className="animate-spin" />}{L.common.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
