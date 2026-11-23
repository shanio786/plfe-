"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownLeft, ArrowUpRight, Layers, Loader2, Lock, Plus } from "lucide-react";
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
import { paymentSchema } from "../schema";
import { A, Amt, ApprovalNotice, DocStatus, KindTag, Money, PickSelect, Section, col, dec, fix4, label, perm, sum, useDeepId, useLookups, useOp } from "./util";
import { Attachments, DetailDialog, Facts, useRecord } from "./detail";
import { EntryLinks, useLifecycle } from "./lifecycle";
import { AllocationPicker, type Alloc } from "./allocations";

const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const cleanAllocs = (a: Alloc[]) => a.filter((x) => x.amount && !dec(x.amount).isZero()).map((x) => ({ invoiceId: x.invoiceId || null, billId: x.billId || null, amount: x.amount }));
const mineOf = (rec?: RecordData | null) => Object.fromEntries((rec?.allocations ?? []).map((a: RecordData) => [a.invoiceId ?? a.billId, String(a.amount)]));
const allocsOf = (rec?: RecordData | null): Alloc[] => (rec?.allocations ?? []).map((a: RecordData) => ({ invoiceId: a.invoiceId ?? null, billId: a.billId ?? null, amount: String(a.amount) }));

export function PaymentsSection() {
  const { company, can } = useAdmin();
  const [id, setId] = useDeepId();
  const [key, setKey] = useState(0);
  const [dir, setDir] = useState("");
  const [editor, setEditor] = useState<{ rec: RecordData | null } | null>(null);
  const [allocFor, setAllocFor] = useState<RecordData | null>(null);
  const mayCreate = can(perm("payments", "create"));
  const { rec, error, retry } = useRecord("payments", id, key);
  const changed = () => setKey((k) => k + 1);
  const life = useLifecycle("payments", rec, { onEdit: () => setEditor({ rec }), onChanged: changed, onDeleted: () => { setId(null); changed(); } });
  const advance = rec ? dec(rec.amount).minus(sum((rec.allocations ?? []).map((a: RecordData) => a.amount))) : null;
  return (
    <>
      <div className="mb-3 flex rounded-md border bg-card p-0.5 w-fit">
        {["", "RECEIPT", "PAYMENT"].map((k) => (
          <button key={k || "all"} onClick={() => setDir(k)} data-testid={`button-filter-direction-${k || "all"}`} className={`rounded px-2.5 py-1 text-xs font-medium ${dir === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{k ? A.kinds[k] : A.a.allKinds}</button>
        ))}
      </div>
      <DataTable company={company} resource="accounts/payments" refreshKey={key} extra={dir ? { direction: dir } : undefined} onRowClick={(r) => setId(r.id)}
        statusOptions={["DRAFT", "POSTED", "CANCELLED"].map((value) => ({ value, label: A.status[value] }))}
        toolbar={<Button size="sm" disabled={!mayCreate} onClick={() => setEditor({ rec: null })} data-testid="button-new-payment">{mayCreate ? <Plus /> : <Lock />}{A.a.newPayment}</Button>}
        columns={[
          col("number", (r) => <span className="font-mono text-xs font-semibold">{r.number ?? <span className="text-muted-foreground">{A.status.DRAFT}</span>}</span>, true),
          col("date", (r) => <span className="font-mono text-xs">{date(r.date)}</span>, true),
          col("direction", (r) => <span className="inline-flex items-center gap-1">{r.direction === "RECEIPT" ? <ArrowDownLeft className="h-3.5 w-3.5 text-success" /> : <ArrowUpRight className="h-3.5 w-3.5 text-primary" />}<KindTag k={r.direction} /></span>),
          col("method", (r) => <span className="text-xs">{A.kinds[r.method] ?? r.method}</span>),
          col("party", (r) => <span className="font-medium">{r.party?.name ?? "—"}</span>),
          col("settlementAccountId", (r) => <span className="text-xs text-muted-foreground">{r.settlementAccount?.name ?? r.account?.name ?? "—"}</span>),
          col("amount", (r) => <Amt v={r.amount} className="font-semibold" />, true),
          col("status", (r) => <DocStatus s={r.status} />),
        ]} />
      <DetailDialog open={!!id} onClose={() => setId(null)} error={error} retry={retry} loading={!rec}
        title={rec ? <span className="flex items-center gap-2"><span className="font-mono">{rec.number ?? A.status.DRAFT}</span><span className="text-muted-foreground">·</span>{rec.party?.name}</span> : L.common.loading}
        meta={rec && <><KindTag k={rec.direction} /><KindTag k={rec.method} /><DocStatus s={rec.status} /></>}
        actions={rec && <>{life.buttons}{rec.status === "POSTED" && can(perm("payments", "allocate")) && <Button size="sm" variant="outline" onClick={() => setAllocFor(rec)} data-testid="button-allocate"><Layers />{A.a.allocate}</Button>}</>}>
        {rec && (
          <>
            {life.notice}
            <Facts items={[
              [A.f.date, <span key="d" className="font-mono">{date(rec.date)}</span>], [A.f.amount, <Money key="a" v={rec.amount} strong />],
              [A.f.allocated, <Money key="al" v={fix4(sum((rec.allocations ?? []).map((a: RecordData) => a.amount)))} />], [A.f.advance, <Money key="ad" v={advance ? fix4(advance) : "0"} strong className="text-primary" />],
              [A.f.party, rec.party ? <Link key="p" href={`/${company}/accounts/party-ledger?partyId=${rec.partyId}`} className="text-primary hover:underline">{label(rec.party)}</Link> : "—"],
              [A.f.settlementAccountId, label(rec.settlementAccount ?? rec.account)], [A.f.department, rec.department?.name ?? "—"], [A.f.narration, rec.narration || "—"],
            ]} />
            <EntryLinks rec={rec} />
            <Section title={A.a.allocations}>
              {(rec.allocations ?? []).length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">{A.f.advance}: <Money v={rec.amount} /></p> : (
                <ul className="divide-y">
                  {rec.allocations.map((a: RecordData) => {
                    const doc = a.invoice ?? a.bill;
                    const res = a.invoiceId ? "invoices" : "bills";
                    return (
                      <li key={a.id ?? (a.invoiceId ?? a.billId)} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <Link href={`/${company}/accounts/${res}?id=${a.invoiceId ?? a.billId}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc?.number ?? String(a.invoiceId ?? a.billId).slice(0, 8)}</Link>
                        <span className="font-mono text-xs text-muted-foreground">{date(doc?.date)}</span>
                        <Money v={a.amount} className="ml-auto" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
            <Attachments docType="PAYMENT" docId={rec.id} canUpload={can(perm("payments", rec.status === "DRAFT" ? "update" : "read"))} />
          </>
        )}
      </DetailDialog>
      {life.dialog}
      {editor && <PaymentEditor rec={editor.rec} onClose={() => setEditor(null)} onSaved={(r) => { changed(); if (r?.id) setId(r.id); }} />}
      {allocFor && <AllocateDialog rec={allocFor} onClose={() => setAllocFor(null)} onSaved={changed} />}
    </>
  );
}

function PaymentEditor({ rec, onClose, onSaved }: { rec: RecordData | null; onClose: () => void; onSaved: (r: RecordData) => void }) {
  const op = useOp();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { chart, parties, departments } = useLookups(true);
  const form = useForm<any>({
    resolver: zodResolver(paymentSchema as any) as any,
    defaultValues: rec ? { direction: rec.direction, method: rec.method, partyId: rec.partyId, date: isoDay(rec.date), settlementAccountId: rec.settlementAccountId, amount: String(rec.amount), narration: rec.narration ?? "", departmentId: rec.departmentId ?? null, allocations: allocsOf(rec) }
      : { direction: "RECEIPT", method: "BANK", partyId: "", date: today(), settlementAccountId: "", amount: "", narration: "", departmentId: null, allocations: [] },
  });
  const [direction, method, partyId, amount] = useWatch({ control: form.control, name: ["direction", "method", "partyId", "amount"] });
  const prevKey = `${direction}:${partyId}`;
  const [lastKey, setLastKey] = useState(prevKey);
  useEffect(() => { if (prevKey !== lastKey) { form.setValue("allocations", []); setLastKey(prevKey); } }, [prevKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const settleOpts = chart.rows.filter((a) => !a.isGroup && a.active !== false && (method === "BANK" ? a.isBank : a.isCash)).map((a) => ({ value: a.id, label: label(a) }));
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await op("payments", { operation: "save", ...(rec ? { id: rec.id } : {}), ...v, departmentId: v.departmentId || null, allocations: cleanAllocs(v.allocations ?? []) });
      if (r?.approvalRequested) setNotice(r.message || A.a.approvalSent);
      onSaved(r as RecordData);
      if (!r?.approvalRequested) onClose();
    } catch (e: any) { setError(e.message); }
  });
  const errs: any = form.formState.errors;
  const seg = (name: "direction" | "method", values: string[]) => (
    <div className="flex rounded-md border p-0.5">
      {values.map((k) => <button key={k} type="button" onClick={() => { form.setValue(name, k); if (name === "method") form.setValue("settlementAccountId", ""); }} data-testid={`button-${name}-${k}`}
        className={`flex-1 rounded px-2 py-1.5 text-xs font-medium ${form.getValues(name) === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{A.kinds[k]}</button>)}
    </div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94dvh] overflow-y-auto bg-card sm:max-w-3xl">
        <DialogHeader><DialogTitle className="font-display text-xl">{rec ? A.a.editDraft : A.a.newPayment}</DialogTitle><DialogDescription>{A.sub.payments}</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>{A.f.direction}</Label>{seg("direction", ["RECEIPT", "PAYMENT"])}</div>
            <div className="space-y-1.5"><Label>{A.f.method}</Label>{seg("method", ["BANK", "CASH"])}</div>
            <div className="space-y-1.5"><Label>{A.f.party}</Label><Controller control={form.control} name="partyId" render={({ field }) => <PickSelect value={field.value} onChange={(v) => field.onChange(v ?? "")} className="h-9" testId="select-payment-party" placeholder={parties.loading ? L.common.loading : A.f.party} options={parties.rows.filter((p) => p.active !== false || p.id === field.value).map((p) => ({ value: p.id, label: label(p) }))} />} />{errs.partyId && <p className="text-xs text-destructive">{L.common.required}</p>}</div>
            <div className="space-y-1.5"><Label>{A.f.settlementAccountId}</Label><Controller control={form.control} name="settlementAccountId" render={({ field }) => <PickSelect value={field.value} onChange={(v) => field.onChange(v ?? "")} className="h-9" testId="select-settlement" placeholder={A.kinds[method]} options={settleOpts} />} />{errs.settlementAccountId && <p className="text-xs text-destructive">{L.common.required}</p>}</div>
            <div className="space-y-1.5"><Label>{A.f.date}</Label><Input type="date" {...form.register("date")} data-testid="input-payment-date" /></div>
            <div className="space-y-1.5"><Label>{A.f.amount}</Label><Input inputMode="decimal" className="font-mono" placeholder="0.0000" {...form.register("amount")} data-testid="input-payment-amount" />{errs.amount && <p className="text-xs text-destructive">{String(errs.amount.message)}</p>}</div>
            <div className="space-y-1.5"><Label>{A.f.department}</Label><Controller control={form.control} name="departmentId" render={({ field }) => <PickSelect value={field.value} onChange={field.onChange} allowNone className="h-9" testId="select-payment-dept" options={departments.rows.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: label(d) }))} />} /></div>
            <div className="space-y-1.5"><Label>{A.f.narration}</Label><Textarea rows={1} {...form.register("narration")} data-testid="input-payment-narration" /></div>
          </div>
          <Controller control={form.control} name="allocations" render={({ field }) => (
            <AllocationPicker direction={direction} partyId={partyId || null} amount={amount ?? ""} value={field.value ?? []} onChange={field.onChange} mine={rec && rec.status === "DRAFT" ? {} : mineOf(rec)} />
          )} />
          {notice && <ApprovalNotice message={notice} />}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-form-error">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{notice ? L.common.close : L.common.cancel}</Button>
            {!notice && <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-save-payment">{form.formState.isSubmitting && <Loader2 className="animate-spin" />}{L.common.save}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AllocateDialog({ rec, onClose, onSaved }: { rec: RecordData; onClose: () => void; onSaved: () => void }) {
  const op = useOp();
  const [value, setValue] = useState<Alloc[]>(allocsOf(rec));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await op("payments", { operation: "allocate", id: rec.id, allocations: cleanAllocs(value) }); onSaved(); onClose(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card sm:max-w-3xl">
        <DialogHeader><DialogTitle className="font-display text-xl">{A.a.allocateTitle} <span className="font-mono text-base text-muted-foreground">{rec.number}</span></DialogTitle><DialogDescription>{A.a.allocateBody}</DialogDescription></DialogHeader>
        <AllocationPicker direction={rec.direction} partyId={rec.partyId} amount={String(rec.amount)} value={value} onChange={setValue} mine={mineOf(rec)} />
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-allocate-error">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{L.common.cancel}</Button>
          <Button disabled={busy} onClick={save} data-testid="button-save-allocation">{busy && <Loader2 className="animate-spin" />}{L.common.save}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
