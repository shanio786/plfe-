"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ImageUp, Loader2, Lock, Plus, Upload } from "lucide-react";
import { API, api, list, save, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { approvalRuleSchema, branchSchema, companySchema, fiscalYearSchema, numberingSchema, roleSchema, userSchema } from "@/modules/core/schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable } from "./data-table";
import { RecordForm, type Field } from "./record-form";
import { ActiveTag, RowMenu, StatusTag, Tag, useAction, useAdmin, type RowAction } from "./shared";
import { bytes, date, dateTime, isoDay, money } from "./format";

type Col = ColumnDef<RecordData, any>;
const col = (key: string, cell?: (r: RecordData) => ReactNode, sortable = true): Col => ({
  id: key, accessorKey: key, header: L.f[key] ?? key, enableSorting: sortable,
  cell: (c) => (cell ? cell(c.row.original) : (c.row.original[key] ?? "—")),
});
const mono = (key: string) => col(key, (r) => <span className="font-mono text-xs">{r[key] ?? "—"}</span>);
const strong = (key: string) => col(key, (r) => <span className="font-medium">{r[key]}</span>);
const actionsCol = (fn: (r: RecordData) => RowAction[]): Col => ({ id: "actions", header: "", enableSorting: false, cell: (c) => <RowMenu id={c.row.original.id} actions={fn(c.row.original)} /> });

export async function listAll(company: string, resource: string, extra: Record<string, string> = {}) {
  const rows: RecordData[] = [];
  for (let page = 1; page < 1000; page++) {
    const p = new URLSearchParams({ page: String(page), pageSize: "100", sort: "createdAt", direction: "asc", ...extra });
    const d = await list(company, resource, p);
    rows.push(...d.rows);
    if (!d.rows.length || rows.length >= d.total) break;
  }
  return rows;
}

function useOptions(resource: string, map: (r: RecordData) => { value: string; label: string; hint?: string }, enabled = true) {
  const { company } = useAdmin();
  const [opts, setOpts] = useState<{ value: string; label: string; hint?: string }[]>([]);
  const mapRef = useRef(map);
  mapRef.current = map;
  useEffect(() => {
    if (!enabled) return;
    listAll(company, resource)
      .then((rows) => setOpts(rows.map((r) => mapRef.current(r))))
      .catch(() => setOpts([]));
  }, [company, resource, enabled]);
  return opts;
}

/** Generic list + create/edit/delete for one resource. */
function Crud({
  resource, codes, columns, fields, schema, toForm, toPayload, extraActions, canDelete = () => true, statusOptions, onRowClick, refreshExtra = 0, toolbar,
}: {
  resource: string;
  codes: { create?: string; update?: string; delete?: string };
  columns: Col[];
  fields?: Field[];
  schema?: any;
  toForm?: (r: RecordData | null) => Record<string, any>;
  toPayload?: (v: Record<string, any>, r: RecordData | null) => Record<string, any>;
  extraActions?: (r: RecordData, reload: () => void) => RowAction[];
  canDelete?: (r: RecordData) => boolean;
  statusOptions?: { value: string; label: string }[];
  onRowClick?: (r: RecordData) => void;
  refreshExtra?: number;
  toolbar?: ReactNode;
}) {
  const { company, can, notify, reloadOverview } = useAdmin();
  const [key, setKey] = useState(0);
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const { ask, dialog } = useAction();
  const mayCreate = !!codes.create && can(codes.create);
  const mayUpdate = !!codes.update && can(codes.update);
  const mayDelete = !!codes.delete && can(codes.delete);
  const reload = () => { setKey((k) => k + 1); reloadOverview(); };
  const all: Col[] = [
    ...columns,
    actionsCol((r) => [
      ...(fields ? [{ label: L.common.edit, onClick: () => setEditing(r), hidden: !mayUpdate }] : []),
      ...(extraActions ? extraActions(r, reload) : []),
      ...(fields ? [{
        label: L.common.delete, danger: true, hidden: !mayDelete || !canDelete(r),
        onClick: () => ask({ title: L.common.confirmDelete, description: L.common.confirmDeleteBody, confirmLabel: L.common.delete, danger: true,
          onConfirm: async () => { await save(company, resource, { id: r.id, operation: "delete" }); notify(L.common.deleted); reload(); } }),
      }] : []),
    ]),
  ];
  return (
    <>
      <DataTable
        company={company}
        resource={resource}
        columns={all}
        refreshKey={key + refreshExtra}
        statusOptions={statusOptions}
        onRowClick={onRowClick ?? (fields && mayUpdate ? (r) => setEditing(r) : undefined)}
        toolbar={<>
          {toolbar}
          {fields && (
            <Button size="sm" disabled={!mayCreate} title={mayCreate ? undefined : L.common.denied} onClick={() => setEditing(null)} data-testid={`button-create-${resource}`}>
              {mayCreate ? <Plus /> : <Lock />}{L.common.create}
            </Button>
          )}
        </>}
      />
      {fields && (
        <RecordForm
          open={editing !== undefined}
          onOpenChange={(o) => !o && setEditing(undefined)}
          title={`${editing ? L.common.edit : L.common.create} · ${L.nav[resource]}`}
          fields={fields}
          schema={schema}
          isEdit={!!editing}
          defaults={toForm ? toForm(editing ?? null) : (editing ?? {})}
          onSubmit={async (v) => {
            const body = toPayload ? toPayload(v, editing ?? null) : v;
            await save(company, resource, editing ? { ...body, id: editing.id } : body);
            notify(L.common.saved);
            reload();
          }}
        />
      )}
      {dialog}
    </>
  );
}

const pick = (r: RecordData | null, keys: string[], fallback: Record<string, any> = {}) =>
  Object.fromEntries(keys.map((k) => [k, r?.[k] ?? fallback[k] ?? ""]));

/* ---------------- Companies ---------------- */
export function CompaniesSection() {
  const { company, can, notify } = useAdmin();
  const [logoFor, setLogoFor] = useState<RecordData | null>(null);
  const [tick, setTick] = useState(0);
  const [types,setTypes]=useState<{value:string;label:string}[]>([]);
  useEffect(()=>{api<RecordData[]>("/business-types").then(rows=>setTypes(rows.map(r=>({value:r.code,label:r.name})))).catch(e=>notify(e.message));},[]); // eslint-disable-line react-hooks/exhaustive-deps
  // Label the financial year END; submit the existing start-month convention.
  const months = L.months.map((m, i) => ({ value: String((i+1)%12+1), label: m }));
  const fields: Field[] = [
    { name: "code", kind: "text" }, { name: "name", kind: "text" }, { name: "legalName", kind: "text", wide: true },
    { name: "ntn", kind: "text" }, { name: "strn", kind: "text" }, { name: "phone", kind: "text" }, { name: "email", kind: "email" },
    { name: "currency", kind: "text" }, { name: "fyStartMonth", kind: "select", options: months },
    { name: "businessType", kind: "select", options: types },
    { name: "active", kind: "switch" }, { name: "address", kind: "textarea" },
  ];
  return (
    <>
      <Crud
        resource="companies" codes={{ create: "core.company.create", update: "core.company.update" }} schema={companySchema} fields={fields} refreshExtra={tick}
        columns={[
          col("logo", (r) => r.logoAttachmentId
            ? <img src={`${API}/${company}/files/${r.logoAttachmentId}`} alt="" className="h-7 w-7 rounded border object-contain bg-card" />
            : <div className="grid h-7 w-7 place-items-center rounded border border-dashed text-[10px] text-muted-foreground font-mono">{String(r.code ?? "").slice(0, 2)}</div>, false),
          mono("code"), strong("name"), col("businessType"), col("ntn"), col("strn"), mono("currency"),
          col("fyStartMonth", (r) => L.months[(Number(r.fyStartMonth)+10)%12] ?? "—"), col("lockDate", (r) => date(r.lockDate)), col("active", (r) => <ActiveTag v={r.active} />),
        ]}
        toForm={(r) => ({ ...pick(r, ["code", "name", "legalName", "ntn", "strn", "address", "phone", "email"]), businessType:r?.businessType??"EVENTS",currency: r?.currency ?? "PKR", fyStartMonth: String(r?.fyStartMonth ?? 7), active: r?.active ?? true })}
        toPayload={(v) => ({ ...v, fyStartMonth: parseInt(String(v.fyStartMonth), 10) })}
        extraActions={(r) => [{ label: L.actions.uploadLogo, onClick: () => setLogoFor(r), hidden: !(can("core.company.update") && can("core.attachment.create")) }]}
      />
      <UploadDialog
        open={!!logoFor} onOpenChange={(o) => !o && setLogoFor(null)} title={L.actions.uploadLogo} accept="image/*" fixed={{ docType: "COMPANY", docId: logoFor?.id ?? "" }}
        onUploaded={async (att) => {
          await save(company, "companies", { id: logoFor!.id, logoAttachmentId: att.id });
          notify(L.actions.logoSaved);
          setTick((t) => t + 1);
        }}
      />
    </>
  );
}

/* ---------------- Branches ---------------- */
export function BranchesSection() {
  const { company, can, notify, reloadOverview } = useAdmin();
  const { ask, dialog } = useAction();
  const types = Object.entries(L.branchTypes).map(([value, label]) => ({ value, label }));
  return (
    <>
      <Crud
        resource="branches" codes={{ create: "core.branch.create", update: "core.branch.update", delete: "core.branch.delete" }} schema={branchSchema}
        fields={[{ name: "code", kind: "text" }, { name: "name", kind: "text" }, { name: "type", kind: "select", options: types }, { name: "phone", kind: "text" }, { name: "active", kind: "switch", createOnly: true }, { name: "address", kind: "textarea" }]}
        columns={[mono("code"), strong("name"), col("type", (r) => <Tag tone="teal">{L.branchTypes[r.type] ?? r.type}</Tag>), col("phone"), col("address", (r) => <span className="block max-w-[280px] truncate text-muted-foreground">{r.address || "—"}</span>, false), col("active", (r) => <ActiveTag v={r.active} />)]}
        statusOptions={[{ value: "active", label: L.common.active }, { value: "inactive", label: L.common.inactive }]}
        toForm={(r) => ({ ...pick(r, ["code", "name", "address", "phone"]), type: r?.type ?? "SHOWROOM", active: r?.active ?? true })}
        extraActions={(r, reload) => [{
          label: L.actions.requestDeactivate, hidden: !r.active || !can("core.approval.create"),
          onClick: () => ask({ title: L.actions.requestDeactivate, description: `${r.code} · ${r.name}`, input: { label: L.actions.requestNote, type: "note", required: true }, confirmLabel: L.actions.requestDeactivate,
            onConfirm: async (note) => { await save(company, "approvals", { docType: "BRANCH", docId: r.id, action: "deactivate", requestNote: note }); notify(L.actions.requested); reload(); reloadOverview(); } }),
        }, {
          label: L.actions.activate, hidden: !!r.active || !can("core.branch.update"),
          onClick: async () => { await save(company, "branches", { ...r, active: true }); notify(L.common.saved); reload(); reloadOverview(); },
        }]}
      />
      {dialog}
    </>
  );
}

/* ---------------- Users ---------------- */
export function UsersSection() {
  const { company, identity, can, notify } = useAdmin();
  const { ask, dialog } = useAction();
  const [photoFor, setPhotoFor] = useState<RecordData | null>(null);
  const roles = useOptions("roles", (r) => ({ value: r.id, label: r.name, hint: r.description }));
  const canGrant = can("core.membership.create") && can("core.membership.delete");
  const fields: Field[] = [
    { name: "name", kind: "text" }, { name: "email", kind: "email" }, { name: "phone", kind: "text" },
    { name: "password", kind: "password", createOnly: true, hint: L.pw.rule },
    { name: "active", kind: "switch" },
    { name: "isOwner", kind: "switch", hidden: !identity.user.isOwner },
    { name: "roleIds", kind: "multi", options: roles, hidden: !canGrant },
  ];
  return (
    <>
      <Crud
        resource="users" codes={{ create: "core.user.create", update: "core.user.update" }} schema={userSchema} fields={fields}
        canDelete={(r) => r.id !== identity.user.id && (!r.isOwner || identity.user.isOwner)}
        columns={[
          strong("name"), col("email", (r) => <span className="text-muted-foreground">{r.email}</span>), col("phone"),
          col("roles", (r) => <div className="flex flex-wrap gap-1">{r.isOwner && <Tag tone="brand">{L.common.owner}</Tag>}{(r.roles ?? []).map((x: string) => <Tag key={x} tone="teal">{x}</Tag>)}</div>, false),
          col("active", (r) => <ActiveTag v={r.active} />),
        ]}
        toForm={(r) => ({
          ...pick(r, ["name", "email", "phone"]), password: "", active: r?.active ?? true, isOwner: r?.isOwner ?? false,
          roleIds: r ? roles.filter((o) => (r.roles ?? []).includes(o.label) || (r.roles ?? []).includes(o.value)).map((o) => o.value) : [],
        })}
        toPayload={(v, r) => {
          const out: Record<string, any> = { ...v };
          if (r) delete out.password;
          if (!identity.user.isOwner) delete out.isOwner;
          if (!canGrant || (r && r.id === identity.user.id && !identity.user.isOwner)) delete out.roleIds;
          return out;
        }}
        extraActions={(r) => [{
          label: L.actions.uploadPhoto, hidden: !(can("core.user.update") && can("core.attachment.create")), onClick: () => setPhotoFor(r),
        }, {
          label: L.actions.resetPassword, hidden: !can("core.user.reset") || (r.isOwner && !identity.user.isOwner),
          onClick: () => ask({ title: L.actions.resetPassword, description: `${r.name} · ${r.email}`, input: { label: L.actions.newPassword, type: "password", required: true }, confirmLabel: L.actions.resetPassword,
            onConfirm: async (pw) => { await save(company, "users", { id: r.id, operation: "reset-password", password: pw }); notify(L.actions.reset); } }),
        }]}
      />
      {dialog}
      <UploadDialog
        open={!!photoFor} onOpenChange={(o) => !o && setPhotoFor(null)} title={`${L.actions.uploadPhoto}${photoFor ? " · " + photoFor.name : ""}`} accept="image/*" fixed={{ docType: "USER", docId: photoFor?.id ?? "" }}
        onUploaded={async (att) => { await save(company, "users", { id: photoFor!.id, photoAttachmentId: att.id }); notify(L.actions.photoSaved); }}
      />
      {can("core.membership.read") && <MembershipsPanel />}
    </>
  );
}

function MembershipsPanel() {
  const { company, identity, can, notify, reloadOverview } = useAdmin();
  const { ask, dialog } = useAction();
  const [key, setKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  const roles = useOptions("roles", (r) => ({ value: r.id, label: r.name }));
  const mayCreate = can("core.membership.create");
  const mayDelete = can("core.membership.delete");
  const isOwner = identity.user.isOwner;
  useEffect(() => {
    if (!open) return;
    setError(null);
    listAll(company, "users", isOwner ? { scope: "all" } : {})
      .then((rows) => setPeople(rows.filter((u) => isOwner || u.id !== identity.user.id).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))))
      .catch((e) => setError(e.message));
  }, [open, isOwner, company, identity]);
  const grant = async () => {
    setBusy(true); setError(null);
    try { await save(company, "memberships", { userId, roleId }); notify(L.actions.accessGranted); setOpen(false); setUserId(""); setRoleId(""); setKey((k) => k + 1); reloadOverview(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-8">
      <h2 className="font-display text-lg font-semibold">{L.actions.memberships}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{L.actions.membershipsSub}</p>
      <DataTable
        company={company} resource="memberships" refreshKey={key}
        toolbar={<Button size="sm" disabled={!mayCreate} title={mayCreate ? undefined : L.common.denied} onClick={() => setOpen(true)} data-testid="button-grant-access">{mayCreate ? <Plus /> : <Lock />}{L.actions.addAccess}</Button>}
        columns={[
          col("userName", (r) => <span className="font-medium">{r.userName}</span>), col("roleName", (r) => <Tag tone="teal">{r.roleName}</Tag>),
          actionsCol((r) => [{
            label: L.actions.removeAccess, danger: true, hidden: !mayDelete || (r.userId === identity.user.id && !isOwner),
            onClick: () => ask({ title: L.actions.removeAccess, description: `${r.userName} · ${r.roleName}`, confirmLabel: L.actions.removeAccess, danger: true,
              onConfirm: async () => { await save(company, "memberships", { id: r.id, operation: "delete" }); notify(L.common.deleted); setKey((k) => k + 1); reloadOverview(); } }),
          }]),
        ]}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader><DialogTitle className="font-display text-xl">{L.actions.addAccess}</DialogTitle><DialogDescription>{L.actions.membershipsSub}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>{L.actions.user}</Label>
              <Select value={userId || undefined} onValueChange={setUserId}><SelectTrigger data-testid="select-membership-user"><SelectValue placeholder={L.common.none} /></SelectTrigger>
                <SelectContent>{people.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>{L.actions.role}</Label>
              <Select value={roleId || undefined} onValueChange={setRoleId}><SelectTrigger data-testid="select-membership-role"><SelectValue placeholder={L.common.none} /></SelectTrigger>
                <SelectContent>{roles.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>
            {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>{L.common.cancel}</Button>
              <Button disabled={busy || !userId || !roleId} onClick={grant} data-testid="button-save-membership">{busy && <Loader2 className="animate-spin" />}{L.actions.addAccess}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}

/* ---------------- Roles ---------------- */
export function RolesSection() {
  const perms = useOptions("permissions", (r) => ({ value: r.code, label: r.code, hint: r.description }));
  return (
    <Crud
      resource="roles" codes={{ create: "core.role.create", update: "core.role.update", delete: "core.role.delete" }} schema={roleSchema}
      fields={[{ name: "name", kind: "text" }, { name: "description", kind: "text" }, { name: "permissionCodes", kind: "multi", options: perms }]}
      canDelete={(r) => !r.isSystem}
      columns={[
        strong("name"), col("description", (r) => <span className="text-muted-foreground">{r.description || "—"}</span>),
        col("permissionCodes", (r) => <span className="font-mono text-xs">{(r.permissionCodes ?? []).length} / {perms.length || "—"}</span>, false),
        col("isSystem", (r) => (r.isSystem ? <Tag tone="brand">{L.common.system}</Tag> : <Tag>{L.common.custom}</Tag>)),
      ]}
      toForm={(r) => ({ ...pick(r, ["name", "description"]), permissionCodes: r?.permissionCodes ?? [] })}
    />
  );
}

/* ---------------- Numbering ---------------- */
export function NumberingSection() {
  const [detail, setDetail] = useState<RecordData | null>(null);
  return (
    <>
      <Crud
        resource="numbering" codes={{ create: "core.numbering.create", update: "core.numbering.update", delete: "core.numbering.delete" }} schema={numberingSchema}
        fields={[{ name: "docType", kind: "text" }, { name: "prefix", kind: "text" }, { name: "format", kind: "text", wide: true, hint: L.actions.formatHint }, { name: "padding", kind: "number" }]}
        columns={[mono("docType"), mono("prefix"), mono("format"), col("padding"), col("sequences", (r) => <span className="font-mono text-xs">{(r.sequences ?? []).length}</span>, false)]}
        toForm={(r) => ({ ...pick(r, ["docType", "prefix"]), format: r?.format ?? "{PREFIX}/{TYPE}/{FY}/{NUMBER}", padding: r?.padding ?? 5 })}
        extraActions={(r) => [{ label: L.f.sequences, onClick: () => setDetail(r) }]}
      />
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="bg-card sm:max-w-lg">
          <DialogHeader><DialogTitle className="font-display">{L.f.sequences} · {detail?.docType}</DialogTitle><DialogDescription className="font-mono">{detail?.format}</DialogDescription></DialogHeader>
          <KeyTable rows={detail?.sequences ?? []} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function KeyTable({ rows }: { rows: RecordData[] }) {
  if (!rows.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{L.common.empty}</p>;
  const keys = Object.keys(rows[0]).filter((k) => k !== "id" && !k.endsWith("Id"));
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/40">{keys.map((k) => <th key={k} className="px-3 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">{L.f[k] ?? k}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id ?? i} className="border-b last:border-0">{keys.map((k) => <td key={k} className="px-3 py-2 font-mono text-xs">{/Date|At$/.test(k) ? date(r[k]) : String(r[k] ?? "—")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/* ---------------- Fiscal years ---------------- */
export function FiscalYearsSection() {
  const { company } = useAdmin();
  const [fy, setFy] = useState<RecordData | null>(null);
  return (
    <div className="space-y-6">
      <Crud
        resource="fiscal-years" codes={{ create: "core.fiscal.create" }} schema={fiscalYearSchema}
        fields={[{ name: "name", kind: "text", wide: true, hint: L.actions.fyHint }, { name: "startDate", kind: "date" }, { name: "endDate", kind: "date" }]}
        columns={[strong("name"), col("startDate", (r) => <span className="font-mono text-xs">{date(r.startDate)}</span>), col("endDate", (r) => <span className="font-mono text-xs">{date(r.endDate)}</span>), col("isClosed", (r) => (r.isClosed ? <Tag>{L.overview.closed}</Tag> : <Tag tone="ok">{L.overview.open}</Tag>))]}
        toForm={(r) => ({ name: r?.name ?? "", startDate: isoDay(r?.startDate), endDate: isoDay(r?.endDate) })}
        extraActions={(r) => [{ label: L.actions.viewPeriods, onClick: () => setFy(r) }]}
      />
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">{L.actions.periods}{fy ? ` · ${fy.name}` : ""}</h2>
          {fy && <Button variant="link" size="sm" onClick={() => setFy(null)}>{L.common.allStatuses}</Button>}
        </div>
        <DataTable
          company={company} resource="periods" pageSize={12} extra={fy ? { fiscalYearId: fy.id } : undefined}
          columns={[col("name", (r) => <span className="font-medium">{r.name ?? r.label ?? "—"}</span>), col("startDate", (r) => <span className="font-mono text-xs">{date(r.startDate)}</span>), col("endDate", (r) => <span className="font-mono text-xs">{date(r.endDate)}</span>), col("isClosed", (r) => (r.isClosed ? <Tag>{L.overview.closed}</Tag> : <Tag tone="ok">{L.overview.open}</Tag>))]}
        />
      </div>
    </div>
  );
}

/* ---------------- Approval rules ---------------- */
export function ApprovalRulesSection() {
  const perms = useOptions("permissions", (r) => ({ value: r.code, label: r.code }));
  return (
    <Crud
      resource="approval-rules" codes={{ create: "core.approvalRule.create", update: "core.approvalRule.update" }} schema={approvalRuleSchema}
      fields={[{ name: "docType", kind: "text" }, { name: "action", kind: "text" }, { name: "approverPermissionCode", kind: "select", options: perms, wide: true }, { name: "thresholdAmount", kind: "money", hint: L.actions.thresholdHint }, { name: "active", kind: "switch" }]}
      columns={[mono("docType"), mono("action"), mono("approverPermissionCode"), col("thresholdAmount", (r) => <span className="font-mono text-xs">{money(r.thresholdAmount)}</span>), col("active", (r) => <ActiveTag v={r.active} />)]}
      toForm={(r) => ({ ...pick(r, ["docType", "action", "approverPermissionCode"]), thresholdAmount: r?.thresholdAmount != null ? String(r.thresholdAmount) : "", active: r?.active ?? true })}
      toPayload={(v) => ({ ...v, thresholdAmount: String(v.thresholdAmount ?? "").trim() || null })}
    />
  );
}

/* ---------------- Approvals ---------------- */
export function ApprovalsSection() {
  const { company, identity, notify, reloadOverview, can } = useAdmin();
  const { ask, dialog } = useAction();
  const [key, setKey] = useState(0);
  const decide = (r: RecordData, op: "approve" | "reject" | "withdraw") =>
    ask({
      title: `${L.actions[op]} · ${r.docType} ${r.action}`, description: r.requestNote, input: { label: L.actions.note, type: "note", required: op === "reject" },
      confirmLabel: L.actions[op], danger: op !== "approve",
      onConfirm: async (note) => { await save(company, "approvals", { id: r.id, operation: op, note }); notify(L.common.saved); setKey((k) => k + 1); reloadOverview(); },
    });
  return (
    <>
      <DataTable
        company={company} resource="approvals" refreshKey={key}
        statusOptions={Object.entries(L.approvalStatus).map(([value, label]) => ({ value, label }))}
        columns={[
          col("docType", (r) => <span className="font-mono text-xs">{r.docType} / {r.action}</span>), col("requesterName"),
          col("requestNote", (r) => <span className="block max-w-[260px] truncate text-muted-foreground">{r.requestNote || "—"}</span>, false),
          col("requestedAt", (r) => <span className="font-mono text-xs">{dateTime(r.requestedAt)}</span>), col("status", (r) => <StatusTag s={r.status} />),
          col("decisionNote", (r) => <span className="block max-w-[200px] truncate text-muted-foreground">{r.decisionNote || "—"}</span>, false),
          actionsCol((r) => {
            const pending = r.status === "PENDING";
            const mine = r.requestedBy === identity.user.id;
            return [
              { label: L.actions.approve, hidden: !pending || mine || !can(r.ruleSnapshot?.approverPermissionCode || "core.approval.approve"), onClick: () => decide(r, "approve") },
              { label: L.actions.reject, hidden: !pending || mine || !can(r.ruleSnapshot?.approverPermissionCode || "core.approval.approve"), danger: true, onClick: () => decide(r, "reject") },
              { label: L.actions.withdraw, hidden: !pending || !mine, onClick: () => decide(r, "withdraw") },
            ];
          }),
        ]}
      />
      {dialog}
    </>
  );
}

/* ---------------- Attachments ---------------- */
function UploadDialog({
  open, onOpenChange, title, accept, fixed, onUploaded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  accept?: string;
  fixed?: { docType: string; docId: string };
  onUploaded: (att: RecordData) => Promise<void> | void;
}) {
  const { company } = useAdmin();
  const [docType, setDocType] = useState("BRANCH");
  const [docId, setDocId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branches = useOptions("branches", (r) => ({ value: r.id, label: `${r.code} · ${r.name}` }), open && !fixed);
  const companies = useOptions("companies", (r) => ({ value: r.id, label: `${r.code} · ${r.name}` }), open && !fixed);
  const targets = docType === "BRANCH" ? branches : companies;
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("docType", fixed?.docType ?? docType);
      fd.append("docId", fixed?.docId ?? docId);
      const att = await api<RecordData>(`/${company}/attachments`, { method: "POST", body: fd });
      await onUploaded(att);
      setFile(null);
      onOpenChange(false);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader><DialogTitle className="font-display text-xl">{title}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          {!fixed && (
            <>
              <div className="space-y-1.5">
                <Label>{L.f.docType}</Label>
                <Select value={docType} onValueChange={(v) => { setDocType(v); setDocId(""); }}>
                  <SelectTrigger data-testid="select-attach-doctype"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="BRANCH">{L.nav.branches}</SelectItem><SelectItem value="COMPANY">{L.nav.companies}</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{L.f.docId}</Label>
                <Select value={docId || undefined} onValueChange={setDocId}>
                  <SelectTrigger data-testid="select-attach-docid"><SelectValue placeholder={L.common.none} /></SelectTrigger>
                  <SelectContent>{targets.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors hover:border-primary/40 hover:bg-primary/[0.03]">
            <Upload className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{file ? file.name : L.actions.chooseFile}</span>
            {file && <span className="font-mono text-xs text-muted-foreground">{bytes(file.size)}</span>}
            <Input type="file" accept={accept} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-file" />
          </label>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{L.common.cancel}</Button>
            <Button disabled={busy || !file || (!fixed && !docId)} onClick={submit} data-testid="button-upload">
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}{busy ? L.actions.uploading : L.actions.upload}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AttachmentsSection() {
  const { company, can, notify, reloadOverview } = useAdmin();
  const { ask, dialog } = useAction();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const allowed = can("core.attachment.create");
  const mayDelete = can("core.attachment.delete");
  return (
    <>
      <DataTable
        company={company} resource="attachments" refreshKey={key}
        toolbar={<Button size="sm" disabled={!allowed} title={allowed ? undefined : L.common.denied} onClick={() => setOpen(true)} data-testid="button-open-upload">{allowed ? <ImageUp /> : <Lock />}{L.actions.upload}</Button>}
        columns={[
          col("fileName", (r) => <span className="font-medium">{r.fileName ?? r.originalName ?? r.name ?? r.id}</span>),
          col("docType", (r) => <Tag tone="teal">{r.docType}</Tag>), mono("docId"),
          col("size", (r) => <span className="font-mono text-xs">{bytes(r.size ?? r.sizeBytes)}</span>),
          col("createdAt", (r) => <span className="font-mono text-xs">{dateTime(r.createdAt)}</span>),
          actionsCol((r) => [
            { label: L.common.download, onClick: () => window.open(`${API}/${company}/files/${r.id}`, "_blank") },
            { label: L.common.delete, danger: true, hidden: !mayDelete, onClick: () => ask({ title: L.common.confirmDelete, description: L.common.confirmDeleteBody, confirmLabel: L.common.delete, danger: true,
              onConfirm: async () => { await save(company, "attachments", { id: r.id, operation: "delete" }); notify(L.common.deleted); setKey((k) => k + 1); reloadOverview(); } }) },
          ]),
        ]}
      />
      <UploadDialog open={open} onOpenChange={setOpen} title={L.actions.upload} onUploaded={() => { notify(L.actions.uploaded); setKey((k) => k + 1); reloadOverview(); }} />
      {dialog}
    </>
  );
}

/* ---------------- Audit ---------------- */
export function AuditSection() {
  const { company, identity } = useAdmin();
  const [row, setRow] = useState<RecordData | null>(null);
  const [scope, setScope] = useState<"company" | "system">("company");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState("");
  const [tableName, setTableName] = useState("");
  const [tableQ, setTableQ] = useState("");
  const users = useOptions("users", (r) => ({ value: r.id, label: r.name }));
  const tTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extra: Record<string, string> = {};
  if (scope === "system") extra.scope = "system";
  if (from) extra.from = from;
  if (to) extra.to = to;
  if (userId) extra.userId = userId;
  if (tableQ) extra.tableName = tableQ;
  const pretty = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    try { return JSON.stringify(typeof v === "string" ? JSON.parse(v) : v, null, 2); } catch { return String(v); }
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        {identity.user.isOwner && (
          <div className="flex rounded-md border p-0.5" role="tablist">
            {(["company", "system"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} data-testid={`button-audit-scope-${s}`}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${scope === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {s === "company" ? L.actions.scopeCompany : L.actions.scopeSystem}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-1"><Label className="text-xs">{L.actions.from}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40" data-testid="input-audit-from" /></div>
        <div className="space-y-1"><Label className="text-xs">{L.actions.to}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40" data-testid="input-audit-to" /></div>
        <div className="space-y-1"><Label className="text-xs">{L.f.userName}</Label>
          <Select value={userId || "__any"} onValueChange={(v) => setUserId(v === "__any" ? "" : v)}>
            <SelectTrigger className="h-8 w-48" data-testid="select-audit-user"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__any">{L.actions.anyUser}</SelectItem>{users.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="space-y-1"><Label className="text-xs">{L.actions.tableFilter}</Label>
          <Input value={tableName} className="h-8 w-44 font-mono" data-testid="input-audit-table" onChange={(e) => { const v = e.target.value; setTableName(v); if (tTimer.current) clearTimeout(tTimer.current); tTimer.current = setTimeout(() => setTableQ(v.trim()), 300); }} /></div>
        {(from || to || userId || tableName) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setUserId(""); setTableName(""); setTableQ(""); }} data-testid="button-audit-clear">{L.actions.clearFilters}</Button>}
      </div>
      <DataTable
        company={company} resource="audit" onRowClick={setRow} extra={extra}
        columns={[col("createdAt", (r) => <span className="font-mono text-xs">{dateTime(r.createdAt)}</span>), col("actorName", (r) => <span className="font-medium">{r.actorName ?? "—"}</span>), col("action", (r) => <Tag tone="brand">{r.action}</Tag>), mono("tableName"), mono("recordId"), mono("ip")]}
      />
      <Dialog open={!!row} onOpenChange={(o) => !o && setRow(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto bg-card sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{L.actions.auditDetail}</DialogTitle>
            <DialogDescription className="font-mono text-xs">{row?.action} · {row?.tableName} · {row?.recordId} · {row?.actorName} · {dateTime(row?.createdAt)} · {row?.ip ?? "—"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            {(["beforeJson", "afterJson"] as const).map((k) => (
              <div key={k}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k === "beforeJson" ? L.f.before : L.f.after}</div>
                <pre className={`max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed ${k === "beforeJson" ? "bg-destructive/[0.04]" : "bg-success/[0.05]"}`}>{pretty(row?.[k])}</pre>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------- Sessions ---------------- */
export function SessionsSection() {
  const { company, notify, can, identity } = useAdmin();
  const { ask, dialog } = useAction();
  const [key, setKey] = useState(0);
  return (
    <>
      <DataTable
        company={company} resource="sessions" refreshKey={key}
        columns={[
          col("userName", (r) => <span className="font-medium">{r.userName}{r.isCurrent && <span className="ml-2"><Tag tone="ok">{L.actions.current}</Tag></span>}</span>),
          col("device", (r) => <span className="block max-w-[260px] truncate text-muted-foreground">{r.device || "—"}</span>, false), mono("ip"),
          col("createdAt", (r) => <span className="font-mono text-xs">{dateTime(r.createdAt)}</span>), col("lastSeenAt", (r) => <span className="font-mono text-xs">{dateTime(r.lastSeenAt)}</span>),
          col("expiresAt", (r) => <span className="font-mono text-xs">{dateTime(r.expiresAt)}</span>),
          actionsCol((r) => [{ label: L.actions.revoke, danger: true, hidden: r.isCurrent || !(r.userId === identity.user.id || can("core.session.revoke")), onClick: () => ask({ title: L.actions.revoke, description: `${r.userName} · ${r.device ?? ""}`, confirmLabel: L.actions.revoke, danger: true,
            onConfirm: async () => { await save(company, "sessions", { id: r.id, operation: "revoke" }); notify(L.actions.revoked); setKey((k) => k + 1); } }) }]),
        ]}
      />
      {dialog}
    </>
  );
}
