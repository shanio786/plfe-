"use client";
import { useState } from "react";
import Link from "next/link";
import { FilePlus2, Lock, Plus } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/modules/core/components/data-table";
import { Tag, useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { A, Amt, OutletTag, SelectionNote, SnapEvidence, snapOf, DocStatus, KindTag, Money, PickSelect, Section, SettleTag, col, dec, perm, label, useAll, useDeepId , numCol } from "./util";
import { Attachments, DetailDialog, Facts, useRecord } from "./detail";
import { DocEditor, docDefaults, type DocRes } from "./doc-editor";
import { EntryLinks, useLifecycle } from "./lifecycle";

const statusOpts = ["DRAFT", "POSTED", "CANCELLED"].map((value) => ({ value, label: A.status[value] }));

const isOpening = (r?: RecordData | null) => !!r && !!(r.openingRecordId || r.openingRecord);

export function DocumentsSection({ res }: { res: DocRes }) {
  const { company, can } = useAdmin();
  const [id, setId] = useDeepId();
  const [key, setKey] = useState(0);
  const [kind, setKind] = useState("");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ editId: string | null; defaults: Record<string, any> } | null>(null);
  const parties = useAll("parties", can(perm("parties", "read")));
  const docType = res === "invoices" ? "INVOICE" : "BILL";
  const kinds = res === "invoices" ? ["INVOICE", "CREDIT_NOTE"] : ["BILL", "DEBIT_NOTE"];
  const mayCreate = can(perm(res, "create"));
  const extra: Record<string, string> = {};
  if (kind) extra.kind = kind;
  if (partyId) extra.partyId = partyId;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border bg-card p-0.5">
          {["", ...kinds].map((k) => (
            <button key={k || "all"} onClick={() => setKind(k)} data-testid={`button-filter-kind-${k || "all"}`}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{k ? A.kinds[k] : A.a.allKinds}</button>
          ))}
        </div>
        <PickSelect value={partyId} onChange={setPartyId} allowNone className="w-64" testId="select-filter-party" placeholder={A.f.party}
          options={parties.rows.map((p) => ({ value: p.id, label: label(p) }))} disabled={!parties.rows.length} />
      </div>
      <DataTable
        company={company} resource={`accounts/${res}`} refreshKey={key} extra={extra} statusOptions={statusOpts} onRowClick={(r) => setId(r.id)}
        toolbar={<Button size="sm" disabled={!mayCreate} title={mayCreate ? A.a.newShortcut : L.common.denied} onClick={() => setEditor({ editId: null, defaults: docDefaults(res) })} data-testid={`button-new-${res}`} data-new-doc aria-keyshortcuts="Control+Alt+N">{mayCreate ? <Plus /> : <Lock />}{res === "invoices" ? A.a.newInvoice : A.a.newBill}</Button>}
        columns={[
          col("number", (r) => <span className="font-mono text-xs font-semibold">{r.number ?? <span className="text-muted-foreground">{A.status.DRAFT}</span>}</span>, true),
          col("date", (r) => <span className="font-mono text-xs">{date(r.date)}</span>, true),
          col("kind", (r) => <span className="inline-flex gap-1"><KindTag k={r.kind} />{isOpening(r) && <Tag tone="brand">{A.op.badge}</Tag>}</span>),
          col("party", (r) => <span className="font-medium">{r.party?.name ?? "—"}</span>),
          col("dueDate", (r) => <span className="font-mono text-xs text-muted-foreground">{date(r.dueDate)}</span>),
          numCol("total", (r) => r.total, true),
          { ...numCol("netTotal", (r) => r.netTotal ?? r.total, false, true), header: A.f.netTotal },
          numCol("outstanding", (r) => r.outstanding),
          col("settlement", (r) => r.status === "POSTED" && !String(r.kind).includes("NOTE") ? <SettleTag s={r.settlementStatus} /> : null),
          col("status", (r) => <DocStatus s={r.status} />),
        ]}
      />
      <DocDetail res={res} id={id} version={key} docType={docType} onClose={() => setId(null)}
        onChanged={() => setKey((k) => k + 1)}
        onEdit={(r) => setEditor({ editId: r.id, defaults: docDefaults(res, r) })}
        onNote={(r) => setEditor({ editId: null, defaults: docDefaults(res, null, r) })} />
      {editor && <DocEditor res={res} open onClose={() => setEditor(null)} editId={editor.editId} defaults={editor.defaults} onSaved={(r) => { setKey((k) => k + 1); if (r?.id) setId(r.id); }} />}
    </>
  );
}

function DocDetail({ res, id, version, docType, onClose, onChanged, onEdit, onNote }: {
  res: DocRes; id: string | null; version: number; docType: string; onClose: () => void; onChanged: () => void; onEdit: (r: RecordData) => void; onNote: (r: RecordData) => void;
}) {
  const { company, can } = useAdmin();
  const { rec, error, retry } = useRecord(res, id, version);
  const life = useLifecycle(res, rec, { onEdit: () => rec && onEdit(rec), onChanged, canCancel: !isOpening(rec) || can("accounts.opening.manage"), onDeleted: () => { onClose(); onChanged(); } });
  const isNote = rec && String(rec.kind).includes("NOTE");
  const opening = isOpening(rec);
  // Opening originals: historical tax unknown, so no credit/debit notes; normal cancellation only.
  const canNote = rec && !isNote && !opening && rec.status === "POSTED" && can(perm(res, "create"));
  return (
    <>
      <DetailDialog open={!!id} onClose={onClose} error={error} retry={retry} loading={!rec}
        title={rec ? <span className="flex items-center gap-2"><span className="font-mono">{rec.number ?? A.status.DRAFT}</span><span className="text-muted-foreground">·</span>{rec.party?.name}</span> : L.common.loading}
        meta={rec && <><KindTag k={rec.kind} />{opening && <Tag tone="brand">{A.op.badge}</Tag>}<DocStatus s={rec.status} />{rec.status === "POSTED" && !isNote && <SettleTag s={rec.settlementStatus} />}{rec.status !== "DRAFT" && <span className="text-muted-foreground">{A.a.readOnly}</span>}</>}
        actions={rec && <>{life.buttons}{canNote && <Button size="sm" variant="outline" onClick={() => onNote(rec)} data-testid="button-raise-note"><FilePlus2 />{res === "invoices" ? A.a.creditNote : A.a.debitNote}</Button>}</>}>
        {rec && (
          <>
            {life.notice}
            {opening && (
              <div className="rounded-md border px-3 py-2 text-xs" data-testid="text-opening-document">
                <p className="font-medium">{A.op.docTitle}</p>
                <p className="text-muted-foreground">{A.op.docBody}</p>
                <p className="mt-1 font-mono">{A.op.origRef}: {rec.openingRecord?.originalReference ?? "—"} · {A.op.recordNo}: {rec.openingRecord?.number ?? "—"} · {A.op.ledgerDate}: {date(rec.openingRecord?.date ?? rec.date)}</p>
              </div>
            )}
            <Facts items={[
              [opening ? A.op.originalDate : A.f.date, <span key="d" className="font-mono">{date(rec.date)}</span>], [A.f.dueDate, <span key="dd" className="font-mono">{date(rec.dueDate)}</span>],
              [A.f.party, rec.party ? <Link key="p" href={`/${company}/accounts/party-ledger?partyId=${rec.partyId}`} className="text-primary hover:underline">{label(rec.party)}</Link> : "—"],
              [A.f.original, rec.originalId ? <Link key="o" href={`/${company}/accounts/${res}?id=${rec.originalId}`} className="font-mono text-primary hover:underline">{rec.original?.number ?? rec.originalId.slice(0, 8)}</Link> : "—"],
              [A.t.subtotal, <Money key="st" v={rec.subtotal} />], [A.t.taxTotal, <Money key="tt" v={rec.taxTotal} />], [A.t.gross, <Money key="t" v={rec.total} />],
              [A.t.whtTotal, <Money key="wt" v={rec.withholdingTotal} />], [res === "invoices" ? A.t.netReceivable : A.t.netPayable, <Money key="nt" v={rec.netTotal ?? rec.total} strong />], [A.f.paid, <Money key="pd" v={rec.paid} />], [A.f.outstanding, <Money key="o2" v={rec.outstanding} strong className="text-primary" />],
              [A.f.narration, rec.narration || "—"],
              ...(rec.taxOverrideReason ? [[A.t.overrideEvidence, rec.taxOverrideReason] as [string, string]] : []),
              ...(rec.partyTaxTreatment && rec.partyTaxTreatment !== "STANDARD" ? [[A.t.partyTreatment, `${A.taxTreatments[rec.partyTaxTreatment] ?? rec.partyTaxTreatment}${rec.partyTaxReason ? ` · ${rec.partyTaxReason}` : ""}${rec.partyTaxCertificate ? ` · ${A.t.certificate} ${rec.partyTaxCertificate}` : ""}`] as [string, string]] : []),
            ]} />
            <EntryLinks rec={rec} />
            <Section title={A.f.lines}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><th className="px-3 py-2">{A.f.account}</th><th className="px-3 py-2">{L.f.description}</th><th className="px-3 py-2">{A.f.department}</th><th className="px-3 py-2">{A.f.outlet}</th><th className="px-3 py-2 text-right">{A.f.qty}</th><th className="px-3 py-2 text-right">{A.f.rate}</th><th className="px-3 py-2 text-right">{A.t.subtotal}</th><th className="px-3 py-2 text-right">{A.t.salesTax}</th><th className="px-3 py-2 text-right">{A.t.withholding}</th></tr></thead>
                  <tbody>
                    {(rec.lines ?? []).map((l: RecordData) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="px-3 py-2"><span className="font-mono text-xs text-muted-foreground">{l.account?.code}</span> {l.account?.name}</td>
                        <td className="px-3 py-2">{l.description}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{l.department?.name ?? "—"}</td><td className="px-3 py-2"><OutletTag o={l.outlet} /></td>
                        <td className="px-3 py-2 text-right"><Amt v={l.qty} /></td><td className="px-3 py-2 text-right"><Amt v={l.rate} /></td>
                        <td className="px-3 py-2 text-right"><Amt v={l.amount ?? l.total ?? dec(l.qty).times(dec(l.rate)).toFixed(4)} className="font-semibold" /></td>
                        <td className="px-3 py-2 text-right" data-testid={`text-line-tax-${l.id}`}><SnapEvidence snap={snapOf(l, "tax")} amount={l.taxAmount} /><SelectionNote l={l} /></td>
                        <td className="px-3 py-2 text-right"><SnapEvidence snap={snapOf(l, "withholding")} amount={l.withholdingAmount} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
            {Array.isArray(rec.allocations) && rec.allocations.length > 0 && (
              <Section title={A.a.allocations}>
                <ul className="divide-y">
                  {rec.allocations.map((a: RecordData) => (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <Link href={`/${company}/accounts/payments?id=${a.paymentId}`} className="font-mono text-xs text-primary hover:underline">{a.payment?.number ?? a.paymentId?.slice(0, 8)}</Link>
                      <span className="font-mono text-xs text-muted-foreground">{date(a.payment?.date ?? a.createdAt)}</span>
                      <Money v={a.amount} className="ml-auto" />
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Attachments docType={docType} docId={rec.id} canUpload={can(perm(res, rec.status === "DRAFT" ? "update" : "read"))} />
          </>
        )}
      </DetailDialog>
      {life.dialog}
    </>
  );
}
