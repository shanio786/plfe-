"use client";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/modules/core/components/shared";
import { accountGet } from "../client";
import { settingsSchema } from "../schema";
import { A, ErrorBox, PickSelect, label, perm, useLookups, useOp } from "./util";

const ACCT = [["receivableAccountId", "ASSET"], ["payableAccountId", "LIABILITY"], ["openingEquityAccountId", "EQUITY"]] as const;
const JRNL = [["salesJournalId", "SALES"], ["purchaseJournalId", "PURCHASE"], ["generalJournalId", "GENERAL"], ["cashJournalId", "CASH"], ["bankJournalId", "BANK"]] as const;
const EMPTY = Object.fromEntries([...ACCT, ...JRNL].map(([k]) => [k, ""]));

export function SettingsSection() {
  const { company, can } = useAdmin();
  const op = useOp();
  const { chart, journals } = useLookups(true);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const form = useForm<any>({ resolver: zodResolver(settingsSchema as any) as any, defaultValues: EMPTY });
  const editable = can(perm("settings", "update"));
  useEffect(() => {
    let live = true;
    setError(null);
    accountGet(company, "settings", "current")
      .then((s) => { if (!live) return; form.reset(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, s?.[k] ?? ""]))); setMissing(!s?.receivableAccountId); setLoaded(true); })
      .catch((e) => { if (!live) return; if (e.status === 404) { setMissing(true); setLoaded(true); form.reset(EMPTY); } else setError(e.message); });
    return () => { live = false; };
  }, [company, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = form.handleSubmit(async (v) => {
    setSaveError(null);
    try { await op("settings", { operation: "save", ...v }); setMissing(false); setTick((t) => t + 1); } catch (e: any) { setSaveError(e.message); }
  });
  if (error) return <ErrorBox error={error} retry={() => setTick((t) => t + 1)} />;
  if (!loaded) return <Skeleton className="h-96" />;
  const errs: any = form.formState.errors;
  const row = (k: string, opts: { value: string; label: string }[], hint: string) => (
    <div key={k} className="grid items-center gap-2 border-b px-4 py-3 last:border-0 sm:grid-cols-[240px_1fr]">
      <div><Label>{L.f[k]}</Label><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{hint}</div></div>
      <div>
        <Controller control={form.control} name={k} render={({ field }) => <PickSelect value={field.value} onChange={(v) => field.onChange(v ?? "")} options={opts} disabled={!editable} className="h-9" testId={`select-${k}`} />} />
        {errs[k] && <p className="mt-1 text-xs text-destructive">{L.common.required}</p>}
      </div>
    </div>
  );
  return (
    <form onSubmit={submit} className="max-w-4xl space-y-4">
      {missing && <p className="rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-sm" data-testid="text-settings-missing">{A.a.settingsMissing}</p>}
      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{A.nav.chart}</div>
        {ACCT.map(([k, type]) => row(k, chart.rows.filter((a) => !a.isGroup && (a.type === type || a.id === form.getValues(k))).map((a) => ({ value: a.id, label: label(a) })), A.types[type]))}
      </section>
      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{A.nav.journals}</div>
        {JRNL.map(([k, type]) => row(k, journals.rows.filter((j) => j.type === type || j.id === form.getValues(k)).map((j) => ({ value: j.id, label: label(j) })), A.kinds[type]))}
      </section>
      {saveError && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-settings-error">{saveError}</p>}
      {editable && <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-save-settings">{form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save />}{A.a.saveSettings}</Button>}
    </form>
  );
}
