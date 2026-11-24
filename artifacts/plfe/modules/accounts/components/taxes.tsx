"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Lock, Play, Plus, RotateCw } from "lucide-react";
import { API, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable } from "@/modules/core/components/data-table";
import { ActiveTag, Tag, useAdmin } from "@/modules/core/components/shared";
import { date, isoDay } from "@/modules/core/components/format";
import { accountReport, type AccountsPage } from "../client";
import { taxSchema } from "../schema";
import { A, Amt, EmptyBox, ErrorBox, Money, PROVINCE_OF, PickSelect, col, dec, fix4, label, pct, perm, useAll, useDeepId, useOp } from "./util";
import { DetailDialog, Facts, useRecord } from "./detail";

const T = A.t;
const KINDS = ["FEDERAL_SALES", "PROVINCIAL_SERVICES", "WITHHOLDING"] as const;
const PROV_AUTH = ["PRA", "SRB", "KPRA", "BRA"] as const;
const APPLIES = ["SALES", "PURCHASES", "BOTH"] as const;
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const isUsed = (r?: RecordData | null) => r?.used === true;

type Mode = { kind: "new" } | { kind: "edit"; rec: RecordData } | { kind: "version"; rec: RecordData };

/* ---------------- Tax master ---------------- */
export function TaxesSection() {
  const { company, can } = useAdmin();
  const [id, setId] = useDeepId();
  const [key, setKey] = useState(0);
  const [mode, setMode] = useState<Mode | null>(null);
  const { rec, error, retry } = useRecord("taxes", id, key);
  const mayCreate = can(perm("taxes", "create"));
  const mayUpdate = can(perm("taxes", "update"));
  return (
    <>
      <DataTable
        company={company} resource="accounts/taxes" refreshKey={key} onRowClick={(r) => setId(r.id)}
        toolbar={<Button size="sm" disabled={!mayCreate} title={mayCreate ? A.a.newShortcut : L.common.denied} onClick={() => setMode({ kind: "new" })} data-testid="button-new-taxes" data-new-doc aria-keyshortcuts="Control+Alt+N">{mayCreate ? <Plus /> : <Lock />}{T.newTax}</Button>}
        columns={[
          col("code", (r) => <span className="font-mono text-xs font-semibold">{r.code}</span>, true),
          { ...col("version", (r) => <span className="font-mono text-xs">v{r.version ?? 1}</span>), header: T.version },
          col("name", (r) => <span className="font-medium">{r.name}</span>, true),
          { ...col("kind", (r) => <span className="text-xs">{A.taxKinds[r.kind] ?? r.kind}</span>, true), header: T.kind },
          { ...col("authority", (r) => <span className="font-mono text-xs">{r.authority}</span>, true), header: T.authority },
          { ...col("province", (r) => <span className="text-xs">{r.province === "ALL" ? "All provinces" : r.province}</span>), header: T.province },
          { ...col("percentage", (r) => <span className="font-mono text-xs tabular-nums">{pct(r.percentage)}</span>), header: T.percentage, meta: { align: "right" } },
          { ...col("applicability", (r) => <span className="text-xs">{A.taxApplies[r.applicability] ?? r.applicability}</span>), header: T.applicability },
          { ...col("effectiveFrom", (r) => <span className="whitespace-nowrap font-mono text-xs">{date(r.effectiveFrom)} – {r.effectiveTo ? date(r.effectiveTo) : "open"}</span>, true), header: T.effective },
          col("active", (r) => <span className="flex gap-1"><ActiveTag v={r.active} />{r.isDefault && <Tag tone="brand">{"Default"}</Tag>}</span>),
        ]}
      />
      <DetailDialog open={!!id} onClose={() => setId(null)} error={error} retry={retry} loading={!rec}
        title={rec ? <span><span className="mr-2 font-mono text-base text-muted-foreground">{rec.code} v{rec.version ?? 1}</span>{rec.name}</span> : L.common.loading}
        meta={rec && <><ActiveTag v={rec.active} />{rec.isDefault && <Tag tone="brand">{T.isDefault}</Tag>}{isUsed(rec) && <span className="text-muted-foreground">{T.usedLocked}</span>}</>}
        actions={rec && <>
          {mayUpdate && <Button size="sm" variant="outline" onClick={() => setMode({ kind: "edit", rec })} data-testid="button-edit-tax">{L.common.edit}</Button>}
          {mayCreate && <Button size="sm" variant="outline" onClick={() => setMode({ kind: "version", rec })} data-testid="button-new-tax-version">{T.newVersion}</Button>}
        </>}>
        {rec && <Facts items={[
          [T.kind, A.taxKinds[rec.kind] ?? rec.kind], [T.authority, rec.authority], [T.province, rec.province], [T.percentage, <span key="p" className="font-mono">{pct(rec.percentage)}</span>],
          [T.applicability, A.taxApplies[rec.applicability] ?? rec.applicability],
          [rec.kind === "WITHHOLDING" ? T.outputAccWht : T.outputAcc, label(rec.outputAccount)], [rec.kind === "WITHHOLDING" ? T.inputAccWht : T.inputAcc, label(rec.inputAccount)],
          [T.effective, <span key="e" className="font-mono">{date(rec.effectiveFrom)} – {rec.effectiveTo ? date(rec.effectiveTo) : "open"}</span>],
          [T.version, `v${rec.version ?? 1}${rec.previousVersion?.code ? ` (replaces ${rec.previousVersion.code} v${rec.previousVersion.version})` : ""}`],
        ]} />}
      </DetailDialog>
      {mode && <TaxForm mode={mode} onClose={() => setMode(null)} onSaved={(r) => { setKey((k) => k + 1); if (r?.id) setId(r.id); }} />}
    </>
  );
}

function TaxForm({ mode, onClose, onSaved }: { mode: Mode; onClose: () => void; onSaved: (r: RecordData) => void }) {
  const { can } = useAdmin();
  const op = useOp();
  const chart = useAll("chart", can(perm("chart", "read")));
  const [error, setError] = useState<string | null>(null);
  const src = mode.kind === "new" ? null : mode.rec;
  const isVersion = mode.kind === "version";
  const locked = mode.kind === "edit" && isUsed(src);
  const identityLocked = isVersion || mode.kind === "edit";
  const defaults = src ? {
    code: src.code, name: src.name, kind: src.kind, authority: src.authority, percentage: isVersion ? "" : String(src.percentage ?? ""), applicability: src.applicability, province: src.province,
    outputAccountId: src.outputAccountId ?? "", inputAccountId: src.inputAccountId ?? "", isDefault: src.kind === "WITHHOLDING" ? false : !!src.isDefault,
    effectiveFrom: isVersion ? "" : isoDay(src.effectiveFrom), effectiveTo: isVersion ? "" : isoDay(src.effectiveTo), active: isVersion ? true : !!src.active, previousVersionId: isVersion ? src.id : src.previousVersionId ?? null,
  } : { code: "", name: "", kind: "FEDERAL_SALES", authority: "FBR", percentage: "", applicability: "SALES", province: "ALL", outputAccountId: "", inputAccountId: "", isDefault: true, effectiveFrom: today(), effectiveTo: "", active: true, previousVersionId: null };
  const form = useForm<any>({ resolver: zodResolver(taxSchema as any) as any, defaultValues: defaults });
  const kind = useWatch({ control: form.control, name: "kind" });
  const authority = useWatch({ control: form.control, name: "authority" });
  const wht = kind === "WITHHOLDING";
  // Authority/province follow the kind. Federal and withholding are FBR + ALL; provincial maps one-to-one.
  useEffect(() => {
    if (identityLocked) return;
    if (kind !== "PROVINCIAL_SERVICES") { form.setValue("authority", "FBR"); form.setValue("province", "ALL"); }
    else if (!PROV_AUTH.includes(authority)) { form.setValue("authority", "PRA"); form.setValue("province", PROVINCE_OF.PRA); }
    if (kind === "WITHHOLDING") form.setValue("isDefault", false);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!identityLocked && kind === "PROVINCIAL_SERVICES" && PROVINCE_OF[authority]) form.setValue("province", PROVINCE_OF[authority]); }, [authority]); // eslint-disable-line react-hooks/exhaustive-deps

  const usable = chart.rows.filter((a) => !a.isGroup && !a.isCash && !a.isBank && a.active !== false);
  const outType = wht ? "ASSET" : "LIABILITY";
  const inType = wht ? "LIABILITY" : "ASSET";
  const opts = (type: string, keep: string) => usable.filter((a) => a.type === type || a.id === keep).map((a) => ({ value: a.id, label: label(a) }));
  const errs: any = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body: Record<string, unknown> = { operation: "save", ...v, effectiveTo: v.effectiveTo || null };
      if (mode.kind === "edit") body.id = mode.rec.id;
      if (isVersion) body.previousVersionId = mode.rec.id;
      const r = await op("taxes", body);
      onSaved(r as RecordData); onClose();
    } catch (e: any) { setError(e.message); }
  });
  const F = ({ name, label: l, children, wide, hint }: { name: string; label: string; children: ReactNode; wide?: boolean; hint?: string }) => (
    // plain function (called, not rendered as a component) so inputs keep focus across renders
    <div className={`space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={`tax-${name}`}>{l}</Label>{children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {errs[name] && <p className="text-xs text-destructive" role="alert">{String(errs[name].message || L.common.required)}</p>}
    </div>
  );
  const sel = (name: string, options: { value: string; label: string }[], disabled = false) => (
    <Controller control={form.control} name={name} render={({ field }) => <PickSelect value={field.value} onChange={(x) => field.onChange(x ?? "")} options={options} disabled={disabled} className="h-9 w-full" testId={`select-tax-${name}`} />} />
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">{isVersion ? `${T.versionTitle} ${src?.code} v${src?.version ?? 1}` : mode.kind === "edit" ? `${L.common.edit} · ${src?.code} v${src?.version ?? 1}` : T.newTax}</DialogTitle>
          <DialogDescription>{isVersion ? T.versionHint : locked ? T.usedLocked : kind === "PROVINCIAL_SERVICES" ? "" : T.fbrOnly}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          {F({ name: "code", label: L.f.code ?? "Code", children: <><Input id="tax-code" disabled={identityLocked} className="font-mono uppercase" {...form.register("code")} data-testid="input-tax-code" /></> })}
          {F({ name: "name", label: L.f.name ?? "Name", children: <><Input id="tax-name" {...form.register("name")} data-testid="input-tax-name" /></> })}
          {F({ name: "kind", label: T.kind, children: <>{sel("kind", KINDS.map((k) => ({ value: k, label: A.taxKinds[k] })), identityLocked)}</> })}
          {F({ name: "authority", label: T.authority, children: <>{kind === "PROVINCIAL_SERVICES" ? sel("authority", PROV_AUTH.map((k) => ({ value: k, label: `${k} · ${PROVINCE_OF[k]}` })), identityLocked) : <Input value="FBR · All provinces" disabled readOnly />}</> })}
          {F({ name: "applicability", label: T.applicability, children: <>{sel("applicability", APPLIES.map((k) => ({ value: k, label: A.taxApplies[k] })), identityLocked)}</> })}
          {F({ name: "percentage", label: T.percentage, hint: T.percentHint, children: <><Input id="tax-percentage" inputMode="decimal" placeholder="e.g. 18" disabled={locked} className="text-right font-mono" {...form.register("percentage")} data-testid="input-tax-percentage" /></> })}
          {F({ name: "outputAccountId", label: wht ? T.outputAccWht : T.outputAcc, hint: wht ? undefined : T.outputAccHint, children: <>{sel("outputAccountId", opts(outType, form.getValues("outputAccountId")), locked)}</> })}
          {F({ name: "inputAccountId", label: wht ? T.inputAccWht : T.inputAcc, hint: wht ? undefined : T.inputAccHint, children: <>{sel("inputAccountId", opts(inType, form.getValues("inputAccountId")), locked)}</> })}
          {F({ name: "effectiveFrom", label: `${T.effective} ${A.f.from.toLowerCase()}`, children: <><Input id="tax-effectiveFrom" type="date" disabled={locked} {...form.register("effectiveFrom")} data-testid="input-tax-from" /></> })}
          {F({ name: "effectiveTo", label: `${T.effective} ${A.f.to.toLowerCase()}`, children: <><Input id="tax-effectiveTo" type="date" {...form.register("effectiveTo")} data-testid="input-tax-to" /></> })}
          <Controller control={form.control} name="isDefault" render={({ field }) => (
            <label className="flex h-9 items-center gap-3 rounded-md border px-3 text-sm"><Switch checked={!!field.value} disabled={wht} onCheckedChange={field.onChange} data-testid="switch-tax-default" />{T.isDefault}</label>
          )} />
          <Controller control={form.control} name="active" render={({ field }) => (
            <label className="flex h-9 items-center gap-3 rounded-md border px-3 text-sm" title={T.deactivate}><Switch checked={!!field.value} onCheckedChange={field.onChange} data-testid="switch-tax-active" />{L.common.active}</label>
          )} />
          {!chart.loading && usable.length === 0 && <p className="text-xs text-destructive sm:col-span-2">{A.a.noAccess}: {A.nav.chart}</p>}
          {error && <p className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive sm:col-span-2" data-testid="text-form-error">{error}</p>}
          <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 border-t bg-card px-6 py-3 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>{L.common.cancel}</Button>
            <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-save-tax">{form.formState.isSubmitting && <Loader2 className="animate-spin" />}{isVersion ? T.newVersion : L.common.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Tax summary report ---------------- */
/** Same rule as reports.tsx: the company fiscal year starts on the 1st of fyStartMonth (PKT). */
const fyStart = (month: number) => { const d = new Date(Date.now() + 5 * 3600000); const y = d.getUTCMonth() + 1 >= month ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${y}-${String(month).padStart(2, "0")}-01`; };
export function TaxSummarySection() {
  const { company, overview } = useAdmin();
  const month = overview?.company?.fyStartMonth;
  const [f, setF] = useState({ from: fyStart(month ?? 1), to: today() });
  const [applied, setApplied] = useState(f);
  const editedFrom = useRef(false);
  // The company record may arrive after mount or change with the switcher; follow its fiscal year until the user edits From.
  useEffect(() => {
    if (!month || editedFrom.current) return;
    const from = fyStart(month);
    setF((p) => ({ ...p, from })); setApplied((p) => ({ ...p, from }));
  }, [company, month]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AccountsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const pageSize = 500;
  const params = useMemo(() => new URLSearchParams({ from: applied.from, to: applied.to, page: String(page), pageSize: String(pageSize) }), [applied, page]);
  useEffect(() => {
    let live = true;
    setLoading(true); setError(null);
    accountReport(company, "tax-summary", params).then((d) => live && setData(d)).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [company, params, tick]);
  const exportHref = (() => { const p = new URLSearchParams(params); p.delete("page"); p.set("export", "xlsx"); return `${API}/${company}/accounts/reports/tax-summary?${p}`; })();
  const s = data?.summary ?? {};
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const salesRows = rows.filter((r) => r.component !== "WITHHOLDING");
  const whtRows = rows.filter((r) => r.component === "WITHHOLDING");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card px-3 py-2.5">
        <label className="space-y-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{A.f.from}</span><Input type="date" value={f.from} onChange={(e) => { editedFrom.current = true; setF({ ...f, from: e.target.value }); }} className="h-8 w-40" data-testid="input-tax-report-from" /></label>
        <label className="space-y-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{A.f.to}</span><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="h-8 w-40" data-testid="input-tax-report-to" /></label>
        <Button size="sm" onClick={() => { setApplied(f); setPage(1); setTick((t) => t + 1); }} data-testid="button-run-tax-report"><Play />{A.a.run}</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)} title={L.common.retry}><RotateCw className={loading ? "animate-spin" : ""} /></Button>
          <Button variant="outline" size="sm" asChild><a href={exportHref} data-testid="button-export-tax-report"><FileSpreadsheet />{L.common.export}</a></Button>
        </div>
      </div>
      {error ? <ErrorBox error={error} retry={() => setTick((t) => t + 1)} /> : !data ? <Skeleton className="h-72" /> : (
        <>
          <table className="w-full max-w-3xl rounded-md border bg-card text-sm" data-testid="table-tax-totals">
            <tbody>
              <tr className="border-b"><td className="px-3 py-2">{T.outputTax}</td><td className="px-3 py-2 text-right"><Money v={s.outputTax} /></td></tr>
              <tr className="border-b"><td className="px-3 py-2">{T.inputTax}</td><td className="px-3 py-2 text-right"><Money v={s.inputTax} /></td></tr>
              <tr className="border-b-2 font-semibold"><td className="px-3 py-2">{T.net}</td><td className="px-3 py-2 text-right"><Money v={s.outputTax !== undefined && s.inputTax !== undefined ? fix4(dec(s.outputTax).minus(dec(s.inputTax))) : null} strong /></td></tr>
              <tr className="border-b"><td className="px-3 py-2 text-muted-foreground">{T.customerWht}</td><td className="px-3 py-2 text-right"><Money v={s.customerWithholding} /></td></tr>
              <tr><td className="px-3 py-2 text-muted-foreground">{T.supplierWht}</td><td className="px-3 py-2 text-right"><Money v={s.supplierWithholding} /></td></tr>
            </tbody>
          </table>
          <TaxRows title={T.salesTax} rows={salesRows} loading={loading} />
          <TaxRows title={T.withholding} rows={whtRows} loading={loading} />
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
function TaxRows({ title, rows, loading }: { title: string; rows: RecordData[]; loading: boolean }) {
  const th = "h-8 whitespace-nowrap border-b bg-card px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  return (
    <section className={`rounded-md border bg-card ${loading ? "opacity-60" : ""}`}>
      <div className="border-b px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</div>
      {rows.length === 0 ? <EmptyBox title={T.noTaxRows} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className={`${th} text-left`}>{L.f.code ?? "Code"}</th><th className={`${th} text-left`}>{T.authority}</th><th className={`${th} text-left`}>{T.direction}</th>
              <th className={`${th} text-right`}>{T.percentage}</th><th className={`${th} text-right`}>{T.taxable}</th><th className={`${th} text-right`}>{T.exempt}</th><th className={`${th} text-right`}>{T.taxAmount}</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.taxCode}-${r.version}-${r.direction}-${i}`} className="border-b last:border-0" data-testid={`row-tax-${i}`}>
                  <td className="px-3 py-2"><span className="font-mono text-xs font-semibold">{r.taxCode} v{r.version}</span> <span className="text-xs text-muted-foreground">{r.taxName}</span></td>
                  <td className="px-3 py-2 font-mono text-xs">{r.authority}</td>
                  <td className="px-3 py-2 text-xs">{r.component === "WITHHOLDING" ? (r.direction === "OUTPUT" ? T.customerWht : T.supplierWht) : A.taxDirections[r.direction] ?? r.direction}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{pct(r.percentage)}</td>
                  <td className="px-3 py-2 text-right"><Amt v={r.taxableBasis} /></td>
                  <td className="px-3 py-2 text-right"><Amt v={r.exemptBasis} /></td>
                  <td className="px-3 py-2 text-right"><Amt v={r.taxAmount} className="font-semibold" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
