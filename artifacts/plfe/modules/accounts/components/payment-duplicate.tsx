"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdmin } from "@/modules/core/components/shared";
import { date, dateTime } from "@/modules/core/components/format";
import { L } from "@/lib/labels";
import { Money } from "./util";

const P = L.acc.pd;
export type DuplicateDetails = { code: "PAYMENT_DUPLICATE"; token: string; expiresAt?: string; operation?: "save" | "post"; matches?: RecordData[] };
export type DuplicateAnswer = { confirmed: true; token: string; note: string };
type Ask = (d: DuplicateDetails) => Promise<DuplicateAnswer>;

export const isDuplicateWarning = (e: any): e is Error & { details: DuplicateDetails } =>
  e?.status === 409 && e?.details?.code === "PAYMENT_DUPLICATE" && typeof e.details.token === "string";

const DupCtx = createContext<Ask | null>(null);
export const usePaymentDuplicate = () => useContext(DupCtx);

/** One review dialog per company. Keyed by company so a switch drops any pending review. */
export function PaymentDuplicateProvider({ children }: { children: ReactNode }) {
  const { company } = useAdmin();
  return <Inner key={company}>{children}</Inner>;
}

function Inner({ children }: { children: ReactNode }) {
  const [details, setDetails] = useState<DuplicateDetails | null>(null);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState("");
  const pending = useRef<{ resolve: (a: DuplicateAnswer) => void; reject: (e: Error) => void } | null>(null);

  const settle = (fn: (p: NonNullable<typeof pending.current>) => void) => { const p = pending.current; pending.current = null; setDetails(null); if (p) fn(p); };
  const ask = useCallback<Ask>((d) => new Promise<DuplicateAnswer>((resolve, reject) => {
    pending.current?.reject(new Error(P.closed));
    pending.current = { resolve, reject };
    setChecked(false); setNote(""); setDetails(d);
  }), []);
  useEffect(() => () => { pending.current?.reject(new Error(P.closed)); pending.current = null; }, []);

  const ok = checked && note.trim().length >= 10;
  const cancel = () => settle((p) => p.reject(new Error(P.cancelled)));
  const go = () => { if (!ok || !details) return; const a: DuplicateAnswer = { confirmed: true, token: details.token, note: note.trim() }; settle((p) => p.resolve(a)); };

  return (
    <DupCtx.Provider value={ask}>
      {children}
      <Dialog open={!!details} onOpenChange={(o) => !o && cancel()}>
        <DialogContent className="max-h-[94dvh] overflow-y-auto bg-card sm:max-w-3xl" data-testid="dialog-payment-duplicate">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg"><AlertTriangle className="h-4 w-4 text-destructive" />{P.title}</DialogTitle>
            <DialogDescription>{details?.operation === "post" ? P.post : P.save}: {P.body}</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-md border">
            <DupTable matches={details?.matches ?? []} />
          </div>
          {details?.expiresAt && <p className="text-xs text-muted-foreground">{P.expires} {dateTime(details.expiresAt)}.</p>}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={(c) => setChecked(c === true)} className="mt-0.5" data-testid="check-duplicate-confirm" />
            <span>{P.confirm}</span>
          </label>
          <div className="space-y-1">
            <Label htmlFor="dup-note">{P.note}</Label>
            <Textarea id="dup-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-duplicate-note" />
            <p className={`text-[11px] ${note && note.trim().length < 10 ? "text-destructive" : "text-muted-foreground"}`}>{P.noteHint}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={cancel} data-testid="button-duplicate-cancel">{P.cancel}</Button>
            <Button type="button" disabled={!ok} onClick={go} data-testid="button-duplicate-continue">{P.cont}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DupCtx.Provider>
  );
}

export function DupTable({ matches }: { matches: RecordData[] }) {
  const th = "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  return (
    <table className="w-full text-sm" data-testid="table-duplicate-matches">
      <thead><tr className="border-b text-left"><th className={th}>{P.number}</th><th className={th}>{P.reference}</th><th className={th}>{L.acc.f.date}</th><th className={th}>{P.direction}</th><th className={th}>{P.status}</th><th className={`${th} text-right`}>{L.acc.f.amount}</th></tr></thead>
      <tbody>
        {matches.map((m, i) => (
          <tr key={m.id ?? i} className="border-b last:border-0">
            <td className="px-3 py-1.5 font-mono text-xs">{m.number ?? (m.status === "DRAFT" ? P.draftRef : "—")}{m.version ? ` v${m.version}` : ""}</td>
            <td className="max-w-[22ch] break-all px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{m.reference ?? "—"}</td>
            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(m.date)}</td>
            <td className="px-3 py-1.5 text-xs">{L.acc.kinds?.[m.direction] ?? m.direction}</td>
            <td className="px-3 py-1.5 text-xs">{m.status}</td>
            <td className="px-3 py-1.5 text-right"><Money v={m.amount} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
