"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Banknote, BookOpen, Landmark, ReceiptText, Wallet } from "lucide-react";
import type { RecordData } from "@/lib/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { accountOverview } from "../client";
import { A, Amt, ErrorBox, KindTag, Money, perm } from "./util";

export function AccountsOverview() {
  const { company, can } = useAdmin();
  const [o, setO] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    accountOverview(company).then((r) => live && setO(r)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [company, tick]);
  if (error && !o) return <ErrorBox error={error} retry={() => setTick((t) => t + 1)} />;
  if (!o) return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /></div>;
  const tiles = [
    { k: "invoiceOutstanding", label: A.a.tiles.invoiceOutstanding, icon: ReceiptText, href: "invoices", tone: "text-primary" },
    { k: "billOutstanding", label: A.a.tiles.billOutstanding, icon: Wallet, href: "bills", tone: "" },
    { k: "cashBalance", label: A.a.tiles.cashBalance, icon: Banknote, href: "trial-balance", tone: "" },
    { k: "bankBalance", label: A.a.tiles.bankBalance, icon: Landmark, href: "trial-balance", tone: "" },
  ];
  const quick = [["invoices", A.a.newInvoice, "invoices.create"], ["bills", A.a.newBill, "bills.create"], ["payments", A.a.newPayment, "payments.create"], ["vouchers", A.a.newVoucher, "entries.create"]] as const;
  const recent: RecordData[] = o.recentEntries ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-xs text-muted-foreground"><span className="font-display text-base font-semibold text-foreground">{o.companyName}</span><span>{A.a.asOf} {date(o.date)}</span></div>
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border bg-card sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <Link key={t.k} href={`/${company}/accounts/${t.href}`} className={`group relative border-b border-r p-5 transition-colors hover:bg-accent/[0.07] rise rise-${i + 1}`} data-testid={`stat-${t.k}`}>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"><t.icon className="h-3.5 w-3.5" />{t.label}</div>
            <Money v={o[t.k]} className={`mt-3 block font-display text-2xl font-bold ${t.tone}`} />
            <ArrowRight className="absolute right-4 top-5 h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-display font-semibold">{A.a.recent}</h2>
            <Link href={`/${company}/accounts/vouchers`} className="text-xs text-primary hover:underline">{A.nav.vouchers}</Link>
          </div>
          {recent.length === 0 ? <div className="px-4 py-12 text-center text-sm text-muted-foreground"><BookOpen className="mx-auto mb-2 h-5 w-5" />{A.a.noRecent}</div> : (
            <ol className="divide-y">
              {recent.map((e) => (
                <li key={e.id}>
                  <Link href={`/${company}/accounts/vouchers?id=${e.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-accent/[0.07]" data-testid={`link-recent-${e.id}`}>
                    <span className="w-24 shrink-0 font-mono text-xs font-semibold">{e.number}</span>
                    <KindTag k={e.kind} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.narration ?? e.journal?.name ?? ""}</span>
                    <Amt v={e.totalDebit ?? e.total ?? e.amount} />
                    <span className="w-24 shrink-0 text-right font-mono text-xs text-muted-foreground">{date(e.date)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
        <div className="space-y-4">
          <section className="relative overflow-hidden rounded-lg bg-sidebar p-5 text-primary-foreground ledger-lines">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/50">{A.a.postedEntries}</div>
            <div className="mt-2 font-display text-4xl font-bold tabular-nums" data-testid="text-posted-entries">{o.postedEntries ?? 0}</div>
            <Link href={`/${company}/accounts/trial-balance`} className="mt-3 inline-flex items-center gap-1 text-xs text-accent hover:underline">{A.nav["trial-balance"]}<ArrowRight className="h-3 w-3" /></Link>
          </section>
          <section className="rounded-lg border bg-card p-2">
            {quick.map(([href, text, code]) => {
              const [res, act] = code.split(".");
              const ok = can(perm(res, act));
              return ok ? (
                <Link key={href} href={`/${company}/accounts/${href}`} className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted" data-testid={`link-quick-${href}`}>{text}<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></Link>
              ) : null;
            })}
            <Link href={`/${company}/accounts/ledger`} className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted">{A.nav.ledger}<ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></Link>
          </section>
        </div>
      </div>
    </div>
  );
}
