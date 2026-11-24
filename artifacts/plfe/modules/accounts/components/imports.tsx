"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileUp, Loader2 } from "lucide-react";
import { api, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/modules/core/components/shared";
import { dateTime } from "@/modules/core/components/format";
import { A, ErrorBox, Section, useOp } from "./util";

const M = A.im;
type Kind = "parties" | "chart";
type Meta = { templates: Record<Kind, string[]>; maxRows: number; maxBytes: number };
type Preview = { valid: false; errors: { row: number; column: string; reason: string }[]; totalRows: number }
  | { valid: true; previewId: string; confirmationToken: string; expiresAt: string; kind: Kind; rows: RecordData[]; totalRows: number; stagedOpeningCount: number };

/** Header-only CSV: no sample identities or amounts. */
function templateHref(cols: string[]) { return `data:text/csv;charset=utf-8,${encodeURIComponent(cols.join(",") + "\r\n")}`; }

export function ImportsSection() {
  const { company } = useAdmin();
  const op = useOp();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("parties");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState<RecordData | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true; setMetaErr(null);
    api<Meta>(`/${company}/accounts/imports`).then((m) => live && setMeta(m)).catch((e) => live && setMetaErr(e.message));
    return () => { live = false; };
  }, [company, tick]);
  // Re-render each 15s so an expired preview is cleared without user action.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const reset = () => { setPreview(null); setChecked(false); setError(null); };
  const expired = preview?.valid && new Date(preview.expiresAt).getTime() <= now;

  const runPreview = async () => {
    if (!file || !meta) return;
    reset(); setDone(null);
    if (file.size > meta.maxBytes) { setError(`${M.limits}: ${Math.floor(meta.maxBytes / 1024)} KB`); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("operation", "preview"); fd.set("kind", kind); fd.set("file", file);
      setPreview(await api<Preview>(`/${company}/accounts/imports`, { method: "POST", body: fd }));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!preview?.valid || !checked || expired) return;
    setBusy(true); setError(null);
    try {
      // Only server-issued identifiers are sent; never the rows.
      const r = await op("imports", { operation: "confirm", previewId: preview.previewId, confirmationToken: preview.confirmationToken, confirmed: true }, M.done);
      setDone(r as RecordData); reset(); setFile(null); if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) { setError(`${e.message} ${M.stale}`); setPreview(null); setChecked(false); } finally { setBusy(false); }
  };

  if (metaErr) return <ErrorBox error={metaErr} retry={() => setTick((t) => t + 1)} />;
  if (!meta) return <Skeleton className="h-64" />;
  const cols = meta.templates[kind] ?? [];
  const rowCols = preview?.valid && preview.rows.length ? Object.keys(preview.rows[0]) : [];
  const th = "h-8 whitespace-nowrap border-b bg-card px-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{M.hint}</p>
      <div className="grid gap-3 rounded-md border bg-card p-3 md:grid-cols-[auto_1fr_auto]">
        <div className="flex rounded-md border p-0.5">
          {(["parties", "chart"] as Kind[]).map((k) => (
            <button key={k} type="button" onClick={() => { setKind(k); reset(); }} data-testid={`button-import-kind-${k}`}
              className={`rounded px-3 py-1.5 text-xs font-medium ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{M[k]}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="h-9 max-w-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }} data-testid="input-import-file" />
          <Button size="sm" onClick={runPreview} disabled={!file || busy} data-testid="button-import-preview">{busy ? <Loader2 className="animate-spin" /> : <FileUp />}{M.preview}</Button>
        </div>
        <Button size="sm" variant="outline" asChild><a href={templateHref(cols)} download={`${kind}-template.csv`} data-testid="button-import-template"><Download />{M.template}</a></Button>
        <p className="text-xs text-muted-foreground md:col-span-3">{M.fileRules} {M.limits}: {meta.maxRows} {M.rows.toLowerCase()}, {Math.floor(meta.maxBytes / 1024)} KB.</p>
        <p className="font-mono text-[11px] text-muted-foreground md:col-span-3 break-all">{cols.join(", ")}</p>
      </div>

      {error && <p className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive" data-testid="text-import-error">{error}</p>}
      {done && <p className="rounded-md border px-3 py-2 text-sm" data-testid="text-import-done">{done.message ?? M.done} · {M.rows}: {done.created ?? "—"} · {M.staged}: {done.stagedOpeningCount ?? 0}</p>}

      {preview && !preview.valid && (
        <Section title={`${M.errors} (${preview.errors.length} / ${preview.totalRows})`}>
          <p className="px-3 py-2 text-xs text-destructive">{M.nothingWritten}</p>
          <div className="max-h-[50dvh] overflow-auto">
            <table className="w-full text-sm" data-testid="table-import-errors">
              <thead className="sticky top-0"><tr><th className={th}>{M.row}</th><th className={th}>{M.column}</th><th className={th}>{M.reason}</th></tr></thead>
              <tbody>{preview.errors.map((e, i) => <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5 font-mono text-xs">{e.row}</td><td className="px-3 py-1.5 font-mono text-xs">{e.column}</td><td className="px-3 py-1.5 text-xs">{e.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>
      )}

      {preview?.valid && (
        <Section title={`${M[preview.kind]} · ${preview.totalRows} ${M.rows.toLowerCase()}`} right={<span className="font-mono text-[11px] text-muted-foreground">{M.expires} {dateTime(preview.expiresAt)}</span>}>
          {expired ? <p className="px-3 py-3 text-sm text-destructive" data-testid="text-import-expired">{M.stale}</p> : (
            <>
              <div className="max-h-[50dvh] overflow-auto">
                <table className="w-full text-sm" data-testid="table-import-preview">
                  <thead className="sticky top-0"><tr><th className={th}>#</th>{rowCols.map((c) => <th key={c} className={th}>{c}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((r, i) => <tr key={i} className="border-b last:border-0"><td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{i + 1}</td>{rowCols.map((c) => <td key={c} className="whitespace-nowrap px-3 py-1.5 text-xs">{r[c] === null || r[c] === undefined || r[c] === "" ? "—" : String(r[c])}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <div className="space-y-2 border-t px-3 py-3">
                {preview.stagedOpeningCount > 0 && <p className="text-xs">{M.staged}: <span className="font-mono">{preview.stagedOpeningCount}</span> · {A.op.partyLink}</p>}
                <label className="flex items-start gap-2 text-sm"><Checkbox checked={checked} onCheckedChange={(c) => setChecked(c === true)} className="mt-0.5" data-testid="check-import-confirm" />{M.confirm}</label>
                <div className="flex gap-2">
                  <Button size="sm" disabled={!checked || busy} onClick={confirm} data-testid="button-import-confirm">{busy && <Loader2 className="animate-spin" />}{M.create}</Button>
                  <Button size="sm" variant="outline" onClick={reset}>{L.common.cancel}</Button>
                </div>
              </div>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
