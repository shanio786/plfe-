"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, FolderTree, Lock, Plus, Table2 } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/modules/core/components/data-table";
import { RecordForm, type Field } from "@/modules/core/components/record-form";
import { ActiveTag, Tag, useAction, useAdmin } from "@/modules/core/components/shared";
import { dateTime } from "@/modules/core/components/format";
import { accountSchema, departmentSchema, journalSchema, outletSchema, partySchema, provinces } from "../schema";
import { A, OUTLET_TYPES, taxLabel, EmptyBox, ErrorBox, Money, col, perm, useAll, useDeepId, useOp, type Col } from "./util";
import { DetailDialog, Facts, useRecord } from "./detail";

type MasterCfg = {
  resource: "chart" | "parties" | "departments" | "journals" | "outlets";
  noDelete?: boolean;
  schema: any;
  fields: Field[];
  columns: Col[];
  newLabel: string;
  defaults: Record<string, any>;
  toForm: (r: RecordData) => Record<string, any>;
  facts: (r: RecordData) => [string, ReactNode][];
  extraView?: (r: RecordData) => ReactNode;
  alt?: (open: (id: string) => void, refresh: number) => ReactNode;
  statusOptions?: { value: string; label: string }[];
  /** When true for a record, only these fields stay editable; everything else is shown read-only and delete is hidden. */
  restrictEdit?: (r: RecordData) => string[] | null;
  /** Fields shown read-only when editing this record (e.g. an identity locked by posted history). */
  lockFields?: (r: RecordData) => string[];
};

function Master(cfg: MasterCfg) {
  const { company, can } = useAdmin();
  const op = useOp();
  const { ask, dialog } = useAction();
  const [id, setId] = useDeepId();
  const [form, setForm] = useState<{ edit: RecordData | null } | null>(null);
  const [key, setKey] = useState(0);
  const [view, setView] = useState<"alt" | "table">("table");
  const { rec, error, retry } = useRecord(cfg.resource, id, key);
  const mayCreate = can(perm(cfg.resource, "create"));
  const mayUpdate = can(perm(cfg.resource, "update"));
  const mayDelete = !cfg.noDelete && can(perm(cfg.resource, "delete")) && !(rec && cfg.restrictEdit?.(rec));
  const editable = form?.edit ? cfg.restrictEdit?.(form.edit) ?? null : null;

  const submit = async (v: Record<string, any>) => {
    const data = { ...v };
    if (form?.edit) cfg.fields.filter((f) => f.createOnly).forEach((f) => delete data[f.name]);
    await op(cfg.resource, { operation: "save", ...(form?.edit ? { id: form.edit.id } : {}), ...data });
    setKey((k) => k + 1);
  };
  const toolbar = (
    <>
      {cfg.alt && (
        <div className="flex rounded-md border bg-card p-0.5">
          <button className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${view === "alt" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} onClick={() => setView("alt")} data-testid="button-view-tree"><FolderTree className="h-3.5 w-3.5" />{A.a.tree}</button>
          <button className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} onClick={() => setView("table")} data-testid="button-view-table"><Table2 className="h-3.5 w-3.5" />{A.a.table}</button>
        </div>
      )}
      <Button size="sm" disabled={!mayCreate} title={mayCreate ? A.a.newShortcut : L.common.denied} onClick={() => setForm({ edit: null })} data-testid={`button-new-${cfg.resource}`} data-new-doc aria-keyshortcuts="Control+Alt+N">{mayCreate ? <Plus /> : <Lock />}{cfg.newLabel}</Button>
    </>
  );
  return (
    <>
      {cfg.alt && view === "alt" ? (
        <div className="space-y-3">
          <div className="flex justify-end gap-2">{toolbar}</div>
          {cfg.alt((x) => setId(x), key)}
        </div>
      ) : (
        <DataTable company={company} resource={`accounts/${cfg.resource}`} refreshKey={key} columns={cfg.columns} onRowClick={(r) => setId(r.id)} toolbar={toolbar} statusOptions={cfg.statusOptions} />
      )}
      <DetailDialog
        open={!!id} onClose={() => setId(null)} error={error} retry={retry} loading={!rec}
        title={rec ? <span><span className="mr-2 font-mono text-base text-muted-foreground">{rec.code}</span>{rec.name}</span> : L.common.loading}
        meta={rec && <><ActiveTag v={rec.active} /><span className="font-mono text-muted-foreground">{dateTime(rec.updatedAt ?? rec.createdAt)}</span></>}
        actions={rec && (
          <>
            {mayUpdate && <Button size="sm" variant="outline" onClick={() => setForm({ edit: rec })} data-testid="button-edit-master">{L.common.edit}</Button>}
            {mayDelete && <Button size="sm" variant="outline" className="text-destructive" data-testid="button-delete-master" onClick={() => ask({
              title: L.common.confirmDelete, description: L.common.confirmDeleteBody, confirmLabel: L.common.delete, danger: true,
              onConfirm: async () => { await op(cfg.resource, { operation: "delete", id: rec.id }, L.common.deleted); setId(null); setKey((k) => k + 1); },
            })}>{L.common.delete}</Button>}
          </>
        )}
      >
        {rec && <><Facts items={cfg.facts(rec)} />{cfg.extraView?.(rec)}</>}
      </DetailDialog>
      <RecordForm
        open={!!form} onOpenChange={(o) => !o && setForm(null)} title={form?.edit ? `${L.common.edit} · ${form.edit.code}` : cfg.newLabel}
        description={editable ? A.a.outletAccountTaxOnly : undefined}
        fields={cfg.fields.map((f) => (editable && !editable.includes(f.name)) || (form?.edit && cfg.lockFields?.(form.edit).includes(f.name)) ? { ...f, readOnly: true } : f)} schema={cfg.schema} isEdit={!!form?.edit} defaults={form?.edit ? cfg.toForm(form.edit) : cfg.defaults} onSubmit={submit}
      />
      {dialog}
    </>
  );
}

const typeOpts = Object.entries(A.types).map(([value, label]) => ({ value, label }));
const activeCol = col("active", (r) => <ActiveTag v={r.active} />);
const codeCol = col("code", (r) => <span className="font-mono text-xs font-semibold">{r.code}</span>, true);
const nameCol = col("name", (r) => <span className="block max-w-[220px] whitespace-normal font-medium">{r.name}</span>, true);

/* ---------------- Chart of accounts ---------------- */
function Flags({ r }: { r: RecordData }) {
  return <span className="flex gap-1">{r.isGroup && <Tag tone="brand">{A.a.group}</Tag>}{r.isBank && <Tag tone="teal">{A.kinds.BANK}</Tag>}{r.isCash && <Tag tone="teal">{A.kinds.CASH}</Tag>}</span>;
}
function ChartTree({ open, refresh }: { open: (id: string) => void; refresh: number }) {
  const { company } = useAdmin();
  const extra = useMemo(() => ({ v: String(refresh) }), [refresh]);
  const { rows, loading, error, reload } = useAll("chart", true, extra);
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const byParent = useMemo(() => {
    const m = new Map<string, RecordData[]>();
    const ids = new Set(rows.map((r) => r.id));
    rows.forEach((r) => { const k = r.parentId && ids.has(r.parentId) ? r.parentId : "root"; m.set(k, [...(m.get(k) ?? []), r]); });
    m.forEach((v) => v.sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })));
    return m;
  }, [rows]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading) return <div className="h-64 animate-pulse rounded-lg border bg-card" />;
  if (!rows.length) return <div className="rounded-lg border bg-card"><EmptyBox title={L.common.empty} body={A.sub.chart} /></div>;
  const render = (pid: string, depth: number): ReactNode => (byParent.get(pid) ?? []).map((r) => {
    const kids = byParent.get(r.id)?.length ?? 0;
    const closed = shut[r.id];
    return (
      <div key={r.id}>
        <div className="group flex items-center gap-2 border-b px-3 py-1.5 text-sm transition-colors last:border-0 hover:bg-accent/[0.07]" style={{ paddingLeft: 12 + depth * 20 }} data-testid={`row-tree-${r.id}`}>
          <button className={`grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-muted ${kids ? "" : "invisible"}`} onClick={() => setShut((s) => ({ ...s, [r.id]: !closed }))}>
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${closed ? "" : "rotate-90"}`} />
          </button>
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => open(r.id)}>
            <span className={`font-mono text-xs ${r.isGroup ? "font-bold text-primary" : "text-muted-foreground"}`}>{r.code}</span>
            <span className={`truncate ${r.isGroup ? "font-semibold" : ""} ${r.active ? "" : "text-muted-foreground line-through"}`}>{r.name}</span>
            <Flags r={r} />
          </button>
          <span className="hidden text-[11px] uppercase tracking-wide text-muted-foreground sm:block">{A.types[r.type] ?? r.type}</span>
          {!r.isGroup && <Link href={`/${company}/accounts/ledger?accountId=${r.id}`} className="text-[11px] text-primary opacity-0 transition-opacity hover:underline group-hover:opacity-100">{A.a.ledgerOf}</Link>}
        </div>
        {!closed && render(r.id, depth + 1)}
      </div>
    );
  });
  return <div className="overflow-hidden rounded-lg border bg-card">{render("root", 0)}</div>;
}
export function ChartSection() {
  const { can } = useAdmin();
  const groups = useAll("chart", can(perm("chart", "read")));
  const parentOpts = groups.rows.filter((r) => r.isGroup).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }));
  const taxes = useAll("taxes", can(perm("taxes", "read")));
  const taxOpts = [...taxes.rows.filter((t) => t.kind !== "WITHHOLDING" && t.active !== false).map((t) => ({ value: t.id, label: `${taxLabel(t)} · ${A.taxApplies[t.applicability] ?? ""}` }))];
  const { company } = useAdmin();
  return (
    <Master
      resource="chart" schema={accountSchema} newLabel={A.a.newAccount}
      defaults={{ code: "", name: "", type: "ASSET", parentId: null, defaultTaxId: "", isGroup: false, isBank: false, isCash: false, active: true }}
      toForm={(r) => ({ code: r.code, name: r.name, type: r.type, parentId: r.parentId ?? null, defaultTaxId: r.defaultTaxId ?? "", isGroup: !!r.isGroup, isBank: !!r.isBank, isCash: !!r.isCash, active: !!r.active })}
      fields={[
        { name: "code", kind: "text" }, { name: "name", kind: "text" }, { name: "type", kind: "select", options: typeOpts }, { name: "parentId", kind: "select", options: parentOpts }, { name: "defaultTaxId", kind: "select", allowNone: true, options: taxOpts, hint: A.a.defaultTaxHint, wide: true },
        { name: "isGroup", kind: "switch" }, { name: "active", kind: "switch" }, { name: "isBank", kind: "switch" }, { name: "isCash", kind: "switch" },
      ]}
      columns={[codeCol, nameCol, col("type", (r) => <span className="text-xs">{A.types[r.type] ?? r.type}</span>, true), col("parent", (r) => <span className="text-xs text-muted-foreground">{r.parent ? `${r.parent.code} · ${r.parent.name}` : "—"}</span>), col("flags", (r) => <Flags r={r} />), activeCol]}
      facts={(r) => [[A.f.type, A.types[r.type] ?? r.type], [A.f.parent, r.parent ? `${r.parent.code} · ${r.parent.name}` : "—"], [A.f.flags, <Flags key="f" r={r} />], [A.f.defaultTaxId, r.defaultTax ? <span key="dt" className="font-mono text-xs">{taxLabel(r.defaultTax)}</span> : "—"], [A.f.balance, r.balance !== undefined ? <Money key="b" v={r.balance} /> : "—"]]}
      extraView={(r) => !r.isGroup && <Link href={`/${company}/accounts/ledger?accountId=${r.id}`} className="inline-block text-sm font-medium text-primary hover:underline" data-testid="link-account-ledger">{A.a.ledgerOf}</Link>}
      restrictEdit={(r) => (r.outletId || r.outlet ? ["defaultTaxId"] : null)}
      alt={(open, refresh) => <ChartTree open={open} refresh={refresh} />}
    />
  );
}

/* ---------------- Parties ---------------- */
const ROLE_KEYS = ["isCustomer", "isSupplier", "isExhibitor", "isSponsor", "isStaff"] as const;
function Roles({ r }: { r: RecordData }) {
  return <span className="flex flex-wrap gap-1">{ROLE_KEYS.filter((k) => r[k]).map((k) => <Tag key={k} tone={k === "isCustomer" ? "ok" : k === "isSupplier" ? "brand" : "teal"}>{L.f[k]}</Tag>)}</span>;
}
export function PartiesSection() {
  const { company, identity, overview } = useAdmin();
  const selfId = overview?.company?.id;
  // Identity is chosen explicitly from companies in this session; never inferred from names.
  const coOpts = (identity?.companies ?? []).map((c: RecordData) => ({ value: c.id, label: `${c.code} · ${c.name}${c.id === selfId ? " (this company)" : ""}` }));
  const coLabel = (r: RecordData) => r.linkedCompany ? `${r.linkedCompany.code} · ${r.linkedCompany.name}` : r.linkedCompanyId ? String(r.linkedCompanyId).slice(0, 8) : "—";
  return (
    <Master
      resource="parties" schema={partySchema} newLabel={A.a.newParty}
      defaults={{ code: "", name: "", companyName: "", phone: "", email: "", city: "", province: "", ntn: "", strn: "", taxTreatment: "STANDARD", taxExemptionReason: "", taxCertificateRef: "", address: "", linkedCompanyId: "", creditDays: 0, isCustomer: true, isSupplier: false, isExhibitor: false, isSponsor: false, isStaff: false, active: true, openingBalance: "0.0000", openingSide: "RECEIVABLE" }}
      toForm={(r) => ({ code: r.code, name: r.name, companyName: r.companyName ?? "", phone: r.phone ?? "", email: r.email ?? "", city: r.city ?? "", province: r.province ?? "", ntn: r.ntn ?? "", strn: r.strn ?? "", taxTreatment: r.taxTreatment ?? "STANDARD", taxExemptionReason: r.taxExemptionReason ?? "", taxCertificateRef: r.taxCertificateRef ?? "", address: r.address ?? "", linkedCompanyId: r.linkedCompanyId ?? "", creditDays: r.creditDays ?? 0, isCustomer: !!r.isCustomer, isSupplier: !!r.isSupplier, isExhibitor: !!r.isExhibitor, isSponsor: !!r.isSponsor, isStaff: !!r.isStaff, active: !!r.active })}
      fields={[
        { name: "code", kind: "text" }, { name: "name", kind: "text" }, { name: "companyName", kind: "text" }, { name: "ntn", kind: "text" }, { name: "strn", kind: "text", label: A.f.strn }, { name: "taxTreatment", kind: "select", label: A.f.taxTreatment, options: Object.entries(A.taxTreatments).map(([value, label]) => ({ value, label })), hint: A.t.nonStandardHint }, { name: "taxCertificateRef", kind: "text", label: A.f.taxCertificateRef }, { name: "taxExemptionReason", kind: "textarea", label: A.f.taxExemptionReason }, { name: "phone", kind: "text" }, { name: "email", kind: "email" },
        { name: "linkedCompanyId", kind: "select", allowNone: true, wide: true, label: A.co.linked, options: coOpts, hint: `${A.co.linkedHint} ${A.co.selfWarn}` },
        { name: "city", kind: "text" }, { name: "province", kind: "select", options: provinces.map(value=>({value,label:value})) }, { name: "creditDays", kind: "number" }, { name: "address", kind: "textarea" },
        ...ROLE_KEYS.map((k) => ({ name: k, kind: "switch" as const })), { name: "active", kind: "switch" },
        { name: "openingBalance", kind: "money", createOnly: true, hint: A.a.openingHint },
        { name: "openingSide", kind: "select", createOnly: true, options: Object.entries(A.sides).map(([value, label]) => ({ value, label })) },
      ]}
      columns={[codeCol, nameCol, col("companyName", (r) => <span className="text-xs">{r.companyName ?? "—"}</span>), col("roles", (r) => <Roles r={r} />), { ...col("linkedCompany", (r) => <span className="font-mono text-xs">{r.linkedCompany?.code ?? "—"}</span>), header: A.co.linked }, col("city"), col("province"), col("creditDays", (r) => <span className="font-mono text-xs">{r.creditDays ?? 0}</span>), activeCol]}
      facts={(r) => [[L.f.companyName, r.companyName || "—"], [A.f.roles, <Roles key="r" r={r} />], [A.co.linked, <span key="lc">{coLabel(r)}{r.linkedCompanyId && r.linkedCompanyId === selfId && <span className="block text-xs text-destructive">{A.co.selfWarn}</span>}{r.companyIdentityLocked && <span className="block text-xs text-muted-foreground">{A.co.locked}</span>}</span>], [L.f.phone, r.phone || "—"], [L.f.email, r.email || "—"], [L.f.city, r.city || "—"], [L.f.province, r.province || "—"], [L.f.ntn, r.ntn || "—"], [A.f.strn, r.strn || "—"], [A.f.taxTreatment, A.taxTreatments[r.taxTreatment] ?? r.taxTreatment ?? "—"], [A.f.taxExemptionReason, r.taxExemptionReason || "—"], [A.f.taxCertificateRef, r.taxCertificateRef || "—"], [L.f.creditDays, String(r.creditDays ?? 0)], [L.f.address, r.address || "—"]]}
      lockFields={(r) => (r.companyIdentityLocked ? ["linkedCompanyId"] : [])}
      extraView={(r) => <Link href={`/${company}/accounts/party-ledger?partyId=${r.id}`} className="inline-block text-sm font-medium text-primary hover:underline" data-testid="link-party-ledger">{A.nav["party-ledger"]}</Link>}
    />
  );
}

/* ---------------- Departments & journals ---------------- */
export function DepartmentsSection() {
  return (
    <Master resource="departments" schema={departmentSchema} newLabel={A.a.newDepartment} defaults={{ code: "", name: "", active: true }}
      toForm={(r) => ({ code: r.code, name: r.name, active: !!r.active })}
      fields={[{ name: "code", kind: "text" }, { name: "name", kind: "text" }, { name: "active", kind: "switch" }]}
      columns={[codeCol, nameCol, activeCol, col("createdAt", (r) => <span className="font-mono text-xs text-muted-foreground">{dateTime(r.createdAt)}</span>, true)]}
      facts={(r) => [[L.f.code, r.code], [L.f.name, r.name], [L.common.status, r.active ? L.common.active : L.common.inactive], [L.f.createdAt, dateTime(r.createdAt)]]}
    />
  );
}
export function JournalsSection() {
  const opts = ["SALES", "PURCHASE", "BANK", "CASH", "GENERAL"].map((value) => ({ value, label: A.kinds[value] }));
  return (
    <Master resource="journals" schema={journalSchema} newLabel={A.a.newJournal} defaults={{ code: "", name: "", type: "GENERAL", active: true }}
      toForm={(r) => ({ code: r.code, name: r.name, type: r.type, active: !!r.active })}
      fields={[{ name: "code", kind: "text" }, { name: "name", kind: "text" }, { name: "type", kind: "select", options: opts }, { name: "active", kind: "switch" }]}
      columns={[codeCol, nameCol, col("type", (r) => <Tag tone="teal">{A.kinds[r.type] ?? r.type}</Tag>, true), activeCol]}
      facts={(r) => [[L.f.code, r.code], [L.f.type, A.kinds[r.type] ?? r.type], [L.common.status, r.active ? L.common.active : L.common.inactive], [L.f.createdAt, dateTime(r.createdAt)]]}
    />
  );
}

/* ---------------- Outlets ---------------- */
function OutletAccounts({ r }: { r: RecordData }) {
  const { company } = useAdmin();
  const rows: RecordData[] = Array.isArray(r.accounts) ? r.accounts : [];
  return (
    <div className="mt-4 border-t pt-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{A.a.outletAccounts}</div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{A.a.noOutletAccounts}</p> : (
        <table className="w-full text-sm" data-testid="table-outlet-accounts">
          <thead><tr className="border-b text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground"><th className="py-1.5 pr-3 font-semibold">{A.f.code}</th><th className="py-1.5 pr-3 font-semibold">{A.f.name}</th><th className="py-1.5 pr-3 font-semibold">{A.f.parent}</th><th className="py-1.5 font-semibold" /></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b last:border-0" data-testid={`row-outlet-account-${a.id}`}>
                <td className="py-1.5 pr-3 font-mono text-xs">{a.code}</td>
                <td className="py-1.5 pr-3">{a.name} <span className="text-[11px] text-muted-foreground">{a.isCash ? A.a.cashTag : a.parent?.code === "1700" ? A.a.inventoryTag : ""}</span></td>
                <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{a.parent?.code ?? "—"}</td>
                <td className="py-1.5 text-right"><Link href={`/${company}/accounts/ledger?accountId=${a.id}`} className="text-xs text-primary hover:underline">{A.a.ledgerOf}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
export function OutletsSection() {
  const opts = OUTLET_TYPES.map((value) => ({ value, label: A.outletTypes[value] }));
  return (
    <Master resource="outlets" schema={outletSchema} newLabel={A.a.newOutlet} noDelete defaults={{ code: "", name: "", type: "SHOWROOM", address: "", active: true }}
      toForm={(r) => ({ code: r.code, name: r.name, type: r.type, address: r.address ?? "", active: !!r.active })}
      fields={[{ name: "code", kind: "text" }, { name: "name", kind: "text" }, { name: "type", kind: "select", options: opts }, { name: "active", kind: "switch", hint: A.a.outletDeactivate }, { name: "address", kind: "textarea" }]}
      columns={[codeCol, nameCol, col("type", (r) => <span className="text-xs">{A.outletTypes[r.type] ?? r.type}</span>, true), col("address", (r) => <span className="block max-w-[28ch] truncate text-xs text-muted-foreground">{r.address || "—"}</span>), col("accounts", (r) => <span className="font-mono text-xs">{Array.isArray(r.accounts) ? r.accounts.map((a: RecordData) => a.code).join(", ") || "—" : "—"}</span>), activeCol]}
      facts={(r) => [[L.f.code, r.code], [A.f.type, A.outletTypes[r.type] ?? r.type], [L.f.address, r.address || "—"], [L.common.status, r.active ? L.common.active : L.common.inactive], [L.f.createdAt, dateTime(r.createdAt)]]}
      extraView={(r) => <OutletAccounts r={r} />}
    />
  );
}
