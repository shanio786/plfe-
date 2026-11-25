"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Plus, RotateCw, Scale, X } from "lucide-react";
import { api, type RecordData } from "@/lib/client";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag, useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { A, AMOUNT_RE, Amt, ApprovalNotice, DocStatus, EmptyBox, ErrorBox, Money, PickSelect, Section, dec, fix4, label, useAll, useOp } from "./util";

const I = A.ic;
const G = A.gb;
const TH = "h-8 whitespace-nowrap border-b bg-card px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
const KINDS = ["PAY_ON_BEHALF", "RECEIVE_ON_BEHALF", "TRANSFER"] as const;
type Company = { id: string; code: string; name: string };
type View = { companies: Company[]; rows: RecordData[] };
const today = () => new Date().toISOString().slice(0, 10);

/** Both companies are written together, so this screen always shows which two
 * companies a movement touched and never pretends one side can stand alone. */
export function IntercompanySection() {
  const { company, can } = useAdmin();
  const run = useOp();
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mayCreate = can("accounts.intercompany.create");
  const mayPost = can("accounts.intercompany.post");
  const mayCancel = can("accounts.intercompany.cancel");

  useEffect(() => {
    let live = true;
    setError(null);
    api<View>(`/${company}/accounts/intercompany`).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, tick]);
  const reload = () => setTick((t) => t + 1);

  async function act(id: string, operation: "post" | "cancel") {
    const note = operation === "cancel" ? window.prompt(I.cancelNote) : "";
    if (operation === "cancel" && (note ?? "").trim().length < 10) return;
    const r = await run("intercompany", { id, operation, note: note ?? "" }, operation === "post" ? A.a.posted : L.common.saved);
    if (r?.approvalRequested) setNotice(r.message ?? A.a.approvalSent);
    reload();
  }

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton className="h-80" />;

  return (
    <div className="space-y-4">
      {notice && <ApprovalNotice message={notice} onClose={() => setNotice(null)} />}
      {data.companies.length === 0 ? (
        <Section title={A.nav.intercompany}><EmptyBox icon={<ArrowLeftRight className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />} title={G.none} body={G.onlyOne} /></Section>
      ) : (
        <>
          <Section
            title={A.nav.intercompany}
            right={
              <div className="flex gap-2">
                <Button variant="ghost" size="icon" onClick={reload} title={L.common.retry}><RotateCw /></Button>
                {mayCreate && <Button size="sm" onClick={() => setOpen((o) => !o)} data-testid="button-new-intercompany">{open ? <X /> : <Plus />}{open ? L.common.close : I.newMovement}</Button>}
              </div>
            }
          >
            {data.rows.length === 0 ? <EmptyBox title={I.none} body={I.noneBody} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-intercompany">
                  <thead><tr>
                    <th className={`${TH} text-left`}>{A.f.number}</th><th className={`${TH} text-left`}>{A.f.date}</th>
                    <th className={`${TH} text-left`}>{A.f.kind}</th><th className={`${TH} text-left`}>{I.other}</th>
                    <th className={`${TH} text-right`}>{A.f.amount}</th><th className={`${TH} text-left`}>{I.reason}</th>
                    <th className={`${TH} text-left`}>{L.f.status ?? "Status"}</th><th className={TH} />
                  </tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-b last:border-0" data-testid={`row-intercompany-${r.id}`}>
                        <td className="px-3 py-1.5 font-mono text-xs">{r.number ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{date(r.date)}</td>
                        <td className="px-3 py-1.5 text-xs">{I.kinds[r.kind] ?? r.kind}</td>
                        <td className="px-3 py-1.5">
                          <span className="block">{r.ours ? r.counterparty : r.initiating}</span>
                          <span className="text-[10px] uppercase text-muted-foreground">{r.ours ? I.ours : I.theirs}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right"><Amt v={r.amount} className="font-semibold" /></td>
                        <td className="max-w-[20rem] truncate px-3 py-1.5 text-xs text-muted-foreground" title={String(r.reason ?? "")}>{r.reason}</td>
                        <td className="px-3 py-1.5">
                          {r.status === "POSTED" && r.entryId
                            ? <Link href={`/${company}/accounts/vouchers?id=${r.entryId}`} className="hover:underline"><DocStatus s={r.status} /></Link>
                            : <DocStatus s={r.status} />}
                          {r.status === "POSTED" && <span className="ml-1 text-[10px] uppercase text-muted-foreground">{I.bothSides}</span>}
                          {r.status === "CANCELLED" && r.cancelReason && <span className="block max-w-[16rem] truncate text-[10px] text-muted-foreground" title={String(r.cancelReason)}>{r.cancelReason}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {r.ours && r.status === "DRAFT" && mayPost && <button className="text-xs font-semibold text-primary hover:underline" onClick={() => void act(r.id, "post")} data-testid={`button-post-ic-${r.id}`}>{A.a.post}</button>}
                          {r.ours && r.status === "POSTED" && mayCancel && <button className="text-xs font-semibold text-destructive hover:underline" onClick={() => void act(r.id, "cancel")} data-testid={`button-cancel-ic-${r.id}`}>{A.a.cancel}</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {open && mayCreate && <MovementForm companies={data.companies} onDone={() => { setOpen(false); reload(); }} onCancel={() => setOpen(false)} />}
        </>
      )}
      <GroupBalancesSection embedded />
    </div>
  );
}

/** Choosing the kind first is what makes the rest of the form make sense, so it
 * leads, and each choice explains in one sentence what it will do to the books. */
function MovementForm({ companies, onDone, onCancel }: { companies: Company[]; onDone: () => void; onCancel: () => void }) {
  const run = useOp();
  const chart = useAll("chart");
  const [kind, setKind] = useState<string>("PAY_ON_BEHALF");
  const [other, setOther] = useState<string | null>(companies[0]?.id ?? null);
  const [day, setDay] = useState(today());
  const [amount, setAmount] = useState("");
  const [ourAccount, setOurAccount] = useState<string | null>(null);
  const [theirAccount, setTheirAccount] = useState<string | null>(null);
  const [theirChart, setTheirChart] = useState<RecordData[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otherCompany = companies.find((c) => c.id === other);

  // The other company's accounts are read with that company's own code, so the
  // list obeys the same company scoping as everything else.
  useEffect(() => {
    let live = true;
    setTheirChart(null); setTheirAccount(null);
    if (!otherCompany) return;
    api<{ rows: RecordData[] }>(`/${otherCompany.code}/accounts/chart?pageSize=500`)
      .then((d) => live && setTheirChart(d.rows)).catch(() => live && setTheirChart([]));
    return () => { live = false; };
  }, [otherCompany?.code]);

  const liquid = (rows: RecordData[]) => rows.filter((a) => a.active !== false && !a.isGroup && (a.isCash || a.isBank));
  const postable = (rows: RecordData[]) => rows.filter((a) => a.active !== false && !a.isGroup && !a.counterpartyCompanyId);
  const theirs = theirChart === null ? [] : kind === "TRANSFER" ? liquid(theirChart) : postable(theirChart);
  const ready = other && ourAccount && theirAccount && AMOUNT_RE.test(amount.trim()) && dec(amount).gt(0) && reason.trim().length >= 10;

  async function save() {
    setBusy(true); setError(null);
    try {
      await run("intercompany", { counterpartyCompanyId: other, kind, date: day, amount: fix4(dec(amount)),
        reason: reason.trim(), settlementAccountId: ourAccount, counterpartyAccountId: theirAccount });
      onDone();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <Section title={I.newMovement} right={<Button variant="ghost" size="sm" onClick={onCancel}><X />{L.common.cancel}</Button>}>
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)} data-testid={`button-kind-${k}`}
              className={`rounded-md border p-3 text-left transition-colors ${kind === k ? "border-primary bg-primary/[0.04]" : "hover:bg-muted/40"}`}>
              <span className="block text-sm font-medium">{I.kinds[k]}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{I.kindHelp[k]}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={I.other}>
            <PickSelect value={other} onChange={setOther} className="w-full" testId="select-other-company"
              options={companies.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
          </Field>
          <Field label={A.f.date}>
            <Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} className="h-8" data-testid="input-ic-date" />
          </Field>
          <Field label={A.f.amount}>
            <Input value={amount} inputMode="decimal" placeholder="0.00" onChange={(e) => setAmount(e.target.value)}
              className={`h-8 text-right font-mono tabular-nums ${amount && !AMOUNT_RE.test(amount.trim()) ? "border-destructive" : ""}`} data-testid="input-ic-amount" />
          </Field>
          <Field label={I.ourAccount}>
            <PickSelect value={ourAccount} onChange={setOurAccount} className="w-full" testId="select-our-account"
              options={liquid(chart.rows).map((a) => ({ value: a.id, label: label(a) }))} />
          </Field>
        </div>

        <Field label={`${I.theirAccount}${otherCompany ? ` — ${otherCompany.name}` : ""}`} hint={kind === "TRANSFER" ? I.transferOnly : undefined}>
          {theirChart === null ? <Skeleton className="h-8 w-full" /> : (
            <PickSelect value={theirAccount} onChange={setTheirAccount} className="w-full max-w-xl" testId="select-their-account"
              options={theirs.map((a) => ({ value: a.id, label: label(a) }))} placeholder={theirs.length ? undefined : L.common.none} />
          )}
        </Field>

        <Field label={I.reason} hint={I.reasonHint}>
          <Textarea value={reason} rows={2} onChange={(e) => setReason(e.target.value)} className="max-w-3xl"
            data-testid="input-ic-reason" />
        </Field>

        {error && <p className="text-sm text-destructive" data-testid="text-ic-error">{error}</p>}
        <div className="flex items-center gap-3">
          <Button disabled={!ready || busy} onClick={() => void save()} data-testid="button-save-intercompany">{L.common.save}</Button>
          <span className="text-xs text-muted-foreground">{I.needBoth}</span>
        </div>
      </div>
    </Section>
  );
}

/** Each pair is computed from both companies' own books; the point of the screen
 * is the column that says whether they agree. */
export function GroupBalancesSection({ embedded = false }: { embedded?: boolean }) {
  const { company } = useAdmin();
  const [data, setData] = useState<{ rows: any[]; balanced: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    api<{ rows: any[]; balanced: boolean }>(`/${company}/accounts/group-balances`).then((d) => live && setData(d)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, tick]);

  if (error) return embedded ? null : <ErrorBox error={error} retry={() => setTick((t) => t + 1)} />;
  if (!data) return <Skeleton className="h-40" />;
  if (!data.rows.length) return embedded ? null : <Section title={A.nav["group-balances"]}><EmptyBox icon={<Scale className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />} title={G.none} body={G.onlyOne} /></Section>;

  return (
    <Section
      title={A.nav["group-balances"]}
      right={<span className="flex items-center gap-2">
        <Tag tone={data.balanced ? "ok" : "bad"}>{data.balanced ? G.allAgree : G.someDisagree}</Tag>
        <Button variant="ghost" size="icon" onClick={() => setTick((t) => t + 1)} title={L.common.retry}><RotateCw /></Button>
      </span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-group-balances">
          <thead><tr>
            <th className={`${TH} text-left`}>{L.f.company ?? "Company"}</th>
            <th className={`${TH} text-left`}>{I.other}</th>
            <th className={`${TH} text-right`}>{G.seenBy} A</th>
            <th className={`${TH} text-right`}>{G.seenBy} B</th>
            <th className={`${TH} text-left`}>{G.agree}</th>
            <th className={`${TH} text-left`}>{A.f.narration}</th>
          </tr></thead>
          <tbody>
            {data.rows.map((r) => {
              const codes = Object.keys(r.seenBy);
              return (
                <tr key={`${r.companyId}-${r.counterpartyCompanyId}`} className="border-b last:border-0" data-testid={`row-pair-${r.companyId}-${r.counterpartyCompanyId}`}>
                  <td className="px-3 py-1.5">{r.company}</td>
                  <td className="px-3 py-1.5">{r.counterparty}</td>
                  <td className="px-3 py-1.5 text-right"><Money v={r.seenBy[codes[0]]} /></td>
                  <td className="px-3 py-1.5 text-right"><Money v={r.seenBy[codes[1]]} /></td>
                  <td className="px-3 py-1.5"><Tag tone={r.agree ? "ok" : "bad"}>{r.agree ? G.agree : G.disagree}</Tag></td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {r.statement}
                    {r.unmatched?.length > 0 && (
                      <span className="mt-0.5 block text-destructive">{G.unmatched}: {r.unmatched.map((u: any) => `${u.number ?? "—"} (${u.date})`).join(", ")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Field({ label: l, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{l}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
