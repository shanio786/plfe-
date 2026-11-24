"use client";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {recordFormSchema} from "../form-schema";

export type Field = {
  name: string;
  kind: "text" | "email" | "number" | "date" | "textarea" | "select" | "switch" | "password" | "multi" | "money";
  options?: { value: string; label: string; hint?: string }[];
  hint?: string;
  createOnly?: boolean;
  hidden?: boolean;
  wide?: boolean;
  label?: string;
  allowNone?: boolean;
  readOnly?: boolean;
};

export function RecordForm({
  open, onOpenChange, title, description, fields, schema, defaults, isEdit, onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  fields: Field[];
  schema?: any;
  defaults: Record<string, any>;
  isEdit: boolean;
  onSubmit: (v: Record<string, any>) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const resolverSchema=recordFormSchema(schema,isEdit);
  const form = useForm<Record<string, any>>({ resolver: resolverSchema ? (zodResolver(resolverSchema as any) as any) : undefined, defaultValues: defaults });
  useEffect(() => {
    if (open) { form.reset(defaults); setError(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try { await onSubmit(v); onOpenChange(false); } catch (e: any) { setError(e.message); }
  });
  const visible = fields.filter((f) => !f.hidden && !(isEdit && f.createOnly));
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl bg-card" onOpenAutoFocus={(e) => { e.preventDefault(); const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("form input:not([type=hidden]), form textarea, form button[role=combobox]"); el?.focus(); }}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          {visible.map((f) => {
            const label = f.label ?? L.f[f.name] ?? L.acc.f[f.name] ?? f.name;
            const msg = errors[f.name]?.message as string | undefined;
            const wide = f.wide || f.kind === "textarea" || f.kind === "multi";
            return (
              <fieldset key={f.name} disabled={f.readOnly} className={`min-w-0 space-y-1.5 ${wide ? "sm:col-span-2" : ""} ${f.readOnly ? "opacity-70" : ""}`}>
                {f.kind !== "switch" && <Label htmlFor={f.name}>{label}</Label>}
                {f.kind === "textarea" ? (
                  <Textarea id={f.name} rows={3} {...form.register(f.name)} data-testid={`input-${f.name}`} />
                ) : f.kind === "switch" ? (
                  <Controller control={form.control} name={f.name} render={({ field }) => (
                    <label className="flex h-9 cursor-pointer items-center gap-3 rounded-md border px-3 hover:bg-muted/60 sm:mt-6">
                      <Switch checked={!!field.value} onCheckedChange={field.onChange} data-testid={`switch-${f.name}`} />
                      <span className="text-sm">{label}</span>
                    </label>
                  )} />
                ) : f.kind === "select" ? (
                  <Controller control={form.control} name={f.name} render={({ field }) => (
                    <Select value={field.value ? String(field.value) : (f.allowNone||f.name==="province")?"__none__":undefined} onValueChange={v=>field.onChange(v==="__none__"?"":v)}>
                      <SelectTrigger id={f.name} data-testid={`select-${f.name}`}><SelectValue placeholder={L.common.none} /></SelectTrigger>
                      <SelectContent>{(f.allowNone||f.name==="province")&&<SelectItem value="__none__">{L.common.none}</SelectItem>}{(f.options ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )} />
                ) : f.kind === "multi" ? (
                  <Controller control={form.control} name={f.name} render={({ field }) => {
                    const val: string[] = field.value ?? [];
                    return (
                      <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border bg-background/50 p-2 sm:grid-cols-2">
                        {(f.options ?? []).map((o) => (
                          <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted">
                            <Checkbox className="mt-0.5" checked={val.includes(o.value)} onCheckedChange={(c) => field.onChange(c ? [...val, o.value] : val.filter((x) => x !== o.value))} data-testid={`check-${f.name}-${o.value}`} />
                            <span className="min-w-0">
                              <span className="block text-sm font-mono">{o.label}</span>
                              {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    );
                  }} />
                ) : (
                  <Input
                    id={f.name}
                    type={f.kind === "money" ? "text" : f.kind}
                    inputMode={f.kind === "money" ? "decimal" : undefined}
                    data-testid={`input-${f.name}`}
                    aria-invalid={!!msg}
                    className={`${f.kind === "money" || f.kind === "number" ? "text-right font-mono tabular-nums" : ""} ${msg ? "border-destructive" : ""}`}
                    {...form.register(f.name, f.kind === "number" ? { setValueAs: (v) => (v === "" || v === null ? undefined : parseInt(String(v), 10)) } : undefined)}
                  />
                )}
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                {msg && <p className="text-xs text-destructive" role="alert" data-testid={`error-${f.name}`}>{msg}</p>}
              </fieldset>
            );
          })}
          {error && <p className="sm:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-form-error">{error}</p>}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{L.common.cancel}</Button>
            <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-save">
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />}{L.common.save}<kbd className="ml-1 hidden rounded border border-current/30 px-1 font-mono text-[10px] opacity-70 sm:inline">Enter</kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
