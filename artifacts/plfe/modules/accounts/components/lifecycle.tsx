"use client";
import { useState } from "react";
import Link from "next/link";
import { Ban, Pencil, Send, Trash2 } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { useAction, useAdmin } from "@/modules/core/components/shared";
import { A, ApprovalNotice, RESOURCE_OF, perm, useOp } from "./util";

/** Draft: edit / post / delete. Posted: request cancellation. Every op refreshes the record. */
export function useLifecycle(resource: string, rec: RecordData | null, opts: { onEdit?: () => void; onChanged: () => void; onDeleted: () => void; canPost?: boolean; postBlock?: string | null; editable?: boolean }) {
  const { can } = useAdmin();
  const op = useOp();
  const { ask, dialog } = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  if (!rec) return { buttons: null, dialog, notice: null };
  const draft = rec.status === "DRAFT";
  const posted = rec.status === "POSTED";
  const run = async (body: Record<string, unknown>, ok: string) => {
    const r = await op(resource, body, ok);
    if (r?.approvalRequested) setNotice(r.message || A.a.approvalSent);
    opts.onChanged();
  };
  const buttons = (
    <>
      {draft && opts.editable !== false && opts.onEdit && can(perm(resource, "update")) && <Button size="sm" variant="outline" onClick={opts.onEdit} data-testid="button-edit-doc"><Pencil />{A.a.editDraft}</Button>}
      {draft && opts.canPost !== false && can(perm(resource, "post")) && (
        <Button size="sm" disabled={!!opts.postBlock} title={opts.postBlock ?? undefined} data-testid="button-post-doc" onClick={() => ask({
          title: A.a.postTitle, description: A.a.postBody, confirmLabel: A.a.post, onConfirm: (async () => run({ operation: "post", id: rec.id }, A.a.posted)) as any,
        })}><Send />{A.a.post}</Button>
      )}
      {draft && can(perm(resource, "delete")) && (
        <Button size="sm" variant="outline" className="text-destructive" data-testid="button-delete-doc" onClick={() => ask({
          title: A.a.del, description: A.a.deleteBody, confirmLabel: L.common.delete, danger: true,
          onConfirm: async () => { await op(resource, { operation: "delete", id: rec.id }, L.common.deleted); opts.onDeleted(); },
        })}><Trash2 />{A.a.del}</Button>
      )}
      {posted && can(perm(resource, "cancel")) && (
        <Button size="sm" variant="outline" className="text-destructive" data-testid="button-cancel-doc" onClick={() => ask({
          title: A.a.cancel, description: A.a.cancelBody, input: { label: A.a.cancelNote, type: "note", required: true }, confirmLabel: A.a.cancel, danger: true,
          onConfirm: async (note: string) => { if (note.trim().length < 3) throw new Error(A.a.noteMin); await run({ operation: "cancel", id: rec.id, note: note.trim() }, A.a.approvalSent); },
        })}><Ban />{A.a.cancel}</Button>
      )}
    </>
  );
  return { buttons, dialog, notice: notice ? <ApprovalNotice message={notice} onClose={() => setNotice(null)} /> : null };
}

/** Links from a document to its journal entry and reversal. */
export function EntryLinks({ rec }: { rec: RecordData }) {
  const { company } = useAdmin();
  if (!rec.entryId && !rec.reversalEntryId) return null;
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {rec.entryId && <Link href={`/${company}/accounts/vouchers?id=${rec.entryId}`} className="rounded-md border bg-card px-2.5 py-1 font-medium text-primary hover:bg-primary/5" data-testid="link-entry">{A.f.entry} {rec.entry?.number ?? ""}</Link>}
      {rec.reversalEntryId && <Link href={`/${company}/accounts/vouchers?id=${rec.reversalEntryId}`} className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1 font-medium text-destructive hover:bg-destructive/10" data-testid="link-reversal">{A.f.reversal} {rec.reversalEntry?.number ?? ""}</Link>}
    </div>
  );
}
export function sourceHref(company: string, type?: string, id?: string) {
  const res = type ? RESOURCE_OF[String(type).toUpperCase()] : null;
  return res && id ? `/${company}/accounts/${res}?id=${id}` : null;
}
