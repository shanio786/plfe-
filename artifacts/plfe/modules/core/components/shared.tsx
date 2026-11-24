"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Loader2, MoreHorizontal } from "lucide-react";
import type { Identity, RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type Overview = {
  company: RecordData;
  stats: Record<string, number>;
  recentActivity: RecordData[];
  permissions: string[];
  fiscalYear: RecordData | null;
};
export type AdminCtx = {
  company: string;
  identity: Identity;
  overview: Overview | null;
  can: (area: string) => boolean;
  notify: (msg: string, kind?: "ok" | "err") => void;
  reloadOverview: () => void;
};
export const Ctx = createContext<AdminCtx | null>(null);
export function useAdmin() {
  const c = useContext(Ctx);
  if (!c) throw new Error("Admin context missing");
  return c;
}

export function Tag({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn" | "bad" | "brand" | "teal"; children: ReactNode }) {
  const map = {
    muted: "text-muted-foreground border-border",
    ok: "text-success border-success/35",
    warn: "text-[hsl(30_70%_30%)] border-[hsl(30_70%_30%)]/35",
    bad: "text-destructive border-destructive/35",
    brand: "text-primary border-primary/35",
    teal: "text-secondary-foreground border-border",
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1 py-px text-[10.5px] font-medium leading-4 ${map[tone]}`}>{children}</span>;
}
export function ActiveTag({ v }: { v: unknown }) {
  return v ? <Tag tone="ok">{L.common.active}</Tag> : <Tag>{L.common.inactive}</Tag>;
}
export function StatusTag({ s }: { s: string }) {
  const tone = s === "APPROVED" ? "ok" : s === "PENDING" ? "warn" : s === "REJECTED" ? "bad" : "muted";
  return <Tag tone={tone}>{L.approvalStatus[s] ?? s}</Tag>;
}

export type RowAction = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; hidden?: boolean };
export function RowMenu({ id, actions }: { id: string; actions: RowAction[] }) {
  const shown = actions.filter((a) => !a.hidden);
  if (!shown.length) return null;
  return (
    <div className="text-right" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${id}`}><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {shown.map((a) => (
            <DropdownMenuItem key={a.label} disabled={a.disabled} onSelect={a.onClick} className={a.danger ? "text-destructive focus:text-destructive" : ""}>
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Generic prompt for confirm / note / password operations. */
export function ActionDialog({
  open, onOpenChange, title, description, input, confirmLabel, danger, onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  input?: { label: string; type: "note" | "password"; required?: boolean };
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try { await onConfirm(value); setValue(""); onOpenChange(false); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setValue(""); setError(null); } onOpenChange(o); }}>
      <DialogContent className="bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {input && (
          <div className="space-y-1.5">
            <Label>{input.label}</Label>
            {input.type === "note"
              ? <Textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} data-testid="input-action-note" />
              : <Input type="password" value={value} onChange={(e) => setValue(e.target.value)} data-testid="input-action-password" />}
            {input.type === "password" && <p className="text-xs text-muted-foreground">{L.pw.rule}</p>}
          </div>
        )}
        {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-action-error">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{L.common.cancel}</Button>
          <Button variant={danger ? "destructive" : "default"} disabled={busy || (!!input?.required && !value.trim())} onClick={run} data-testid="button-confirm-action">
            {busy && <Loader2 className="animate-spin" />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type Pending = Omit<Parameters<typeof ActionDialog>[0], "open" | "onOpenChange"> | null;
export function useAction() {
  const [pending, setPending] = useState<Pending>(null);
  const dialog = pending ? <ActionDialog {...pending} open onOpenChange={(o) => !o && setPending(null)} /> : null;
  return { ask: setPending, dialog };
}
