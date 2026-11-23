"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Download, FileUp, Loader2, Paperclip, Upload } from "lucide-react";
import { API, api, list, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdmin } from "@/modules/core/components/shared";
import { bytes, dateTime } from "@/modules/core/components/format";
import { accountGet } from "../client";
import { A, ErrorBox, Section } from "./util";

/** Loads a record by id and re-fetches whenever `version` changes. */
export function useRecord(resource: string, id: string | null, version = 0) {
  const { company } = useAdmin();
  const [rec, setRec] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!id) { setRec(null); return; }
    let live = true;
    setError(null);
    accountGet(company, resource, id).then((r) => live && setRec(r)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, resource, id, version, tick]);
  return { rec: rec && rec.id === id ? rec : null, error, retry: () => setTick((t) => t + 1) };
}

export function DetailDialog({ open, onClose, title, meta, actions, error, retry, loading, children }: {
  open: boolean; onClose: () => void; title: ReactNode; meta?: ReactNode; actions?: ReactNode; error?: string | null; retry?: () => void; loading?: boolean; children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto bg-background p-0 sm:max-w-4xl">
        <DialogHeader className="sticky top-0 z-10 border-b bg-card/95 px-5 py-4 text-left backdrop-blur">
          <DialogTitle className="font-display text-xl" data-testid="text-detail-title">{title}</DialogTitle>
          <DialogDescription asChild><div className="flex flex-wrap items-center gap-2 text-xs">{meta}</div></DialogDescription>
          {actions && <div className="flex flex-wrap gap-2 pt-2">{actions}</div>}
        </DialogHeader>
        <div className="space-y-4 px-5 pb-5 pt-1">
          {error ? <ErrorBox error={error} retry={retry} /> : loading ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-40" /></div> : children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="bg-card px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 truncate text-sm">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Files linked to an accounting document via the foundation attachment API. */
export function Attachments({ docType, docId, canUpload, onCount }: { docType: string; docId: string; canUpload: boolean; onCount?: (n: number) => void }) {
  const { company, can, notify } = useAdmin();
  const [rows, setRows] = useState<RecordData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const readable = can("core.attachment.read");
  useEffect(() => {
    if (!readable) { setRows([]); return; }
    let live = true;
    (async () => {
      const out: RecordData[] = [];
      for (let page = 1; page < 50; page++) {
        const d = await list(company, "attachments", new URLSearchParams({ page: String(page), pageSize: "100", docType, docId, sort: "createdAt", direction: "desc" }));
        out.push(...d.rows);
        if (!d.rows.length || page * 100 >= d.total) break;
      }
      return out;
    })().then((r) => { if (live) { setRows(r); onCount?.(r.length); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, docType, docId, tick, readable]); // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file); fd.append("docType", docType); fd.append("docId", docId);
      await api(`/${company}/attachments`, { method: "POST", body: fd });
      notify(L.actions.uploaded); setFile(null); setTick((t) => t + 1);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const allowUpload = canUpload && can("core.attachment.create");
  return (
    <Section title={<span className="inline-flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" />{A.a.attachments}{rows ? ` (${rows.length})` : ""}</span>}
      right={allowUpload && (
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted" data-testid="label-choose-file">
            <FileUp className="h-3.5 w-3.5" /><span className="max-w-40 truncate">{file ? file.name : L.actions.chooseFile}</span>
            <Input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-attach-file" />
          </label>
          <Button size="sm" className="h-7" disabled={!file || busy} onClick={upload} data-testid="button-attach-upload">{busy ? <Loader2 className="animate-spin" /> : <Upload />}{A.a.attach}</Button>
        </div>
      )}>
      {error && <p className="m-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      {!readable ? <p className="px-4 py-4 text-sm text-muted-foreground">{L.actions.noAccessRead}</p>
        : rows === null ? <div className="p-3"><Skeleton className="h-8" /></div>
        : rows.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">{A.a.noAttachments}</p>
        : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate font-medium">{r.fileName ?? r.originalName ?? r.name ?? r.id}</span>
                <span className="font-mono text-xs text-muted-foreground">{bytes(r.size ?? r.sizeBytes)}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{dateTime(r.createdAt)}</span>
                <a href={`${API}/${company}/files/${r.id}`} target="_blank" rel="noreferrer" className="rounded p-1 text-primary hover:bg-muted" title={A.a.download} data-testid={`link-download-${r.id}`}><Download className="h-3.5 w-3.5" /></a>
              </li>
            ))}
          </ul>
        )}
    </Section>
  );
}
