"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecordData } from "@/lib/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdmin } from "@/modules/core/components/shared";
import { date } from "@/modules/core/components/format";
import { accountOverview } from "../client";
import { A, Amt, ErrorBox, KindTag, Money, perm } from "./util";

/** Dense position summary: every figure comes straight from the overview API (posted entries only). */
export function AccountsOverview() {
  const { company, can } = useAdmin();
  const router = useRouter();
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
   if (!o) return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]"><Skeleton className="h-56" /><Skeleton className="h-72" /></div>;
  const rows = [
    { k: "invoiceOutstanding", label: A.a.tiles.invoiceOutstanding, href: "invoices", link: A.nav.invoices },
    { k: "billOutstanding", label: A.a.tiles.billOutstanding, href: "bills", link: A.nav.bills },
    { k: "cashBalance", label: A.a.tiles.cashBalance, href: "trial-balance", link: A.nav["trial-balance"] },
    { k: "bankBalance", label: A.a.tiles.bankBalance, href: "trial-balance", link: A.nav["trial-balance"] },
  ];
  const quick = [["invoices", A.a.newInvoice, "invoices.create"], ["bills", A.a.newBill, "bills.create"], ["payments", A.a.newPayment, "payments.create"], ["vouchers", A.a.newVoucher, "entries.create"]] as const;
  const recent: RecordData[] = o.recentEntries ?? [];
  const head = "h-8 border-b px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  return (
     <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="space-y-4">
        <section className="rounded-md border bg-card" data-testid="table-position">
          <table className="w-full text-sm">
            <thead><tr><th className={`${head} text-left`}>{A.a.summary} · {A.a.asOf} {date(o.date)}</th><th className={`${head} text-right`}>{A.f.amount}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k} className="border-b last:border-0" data-testid={`stat-${r.k}`}>
                  <td className="px-3 py-2"><Link href={`/${company}/accounts/${r.href}`} className="hover:text-primary hover:underline">{r.label}</Link></td>
                  <td className="px-3 py-2 text-right"><Money v={o[r.k]} /></td>
                </tr>
              ))}
              <tr className="border-t-2">
                <td className="px-3 py-2 text-muted-foreground"><Link href={`/${company}/accounts/vouchers`} className="hover:text-primary hover:underline">{A.a.postedEntries}</Link></td>
                <td className="px-3 py-2 text-right font-mono tabular-nums" data-testid="text-posted-entries">{o.postedEntries ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="rounded-md border bg-card px-3 py-2 text-sm">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{A.a.quick}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {quick.map(([href, text, code]) => {
              const [res, act] = code.split(".");
              return can(perm(res, act)) ? <Link key={href} href={`/${company}/accounts/${href}`} className="text-primary hover:underline" data-testid={`link-quick-${href}`}>{text}</Link> : null;
            })}
            <Link href={`/${company}/accounts/ledger`} className="text-primary hover:underline">{A.nav.ledger}</Link>
          </div>
        </section>
      </div>
      <section className="rounded-md border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={`${head} text-left`}>{A.f.date}</th><th className={`${head} text-left`}>{A.f.number}</th><th className={`${head} text-left`}>{A.f.kind}</th>
              <th className={`${head} hidden text-left sm:table-cell`}>{A.f.narration}</th><th className={`${head} text-right`}>{A.f.amount}</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">{A.a.noRecent}</td></tr>
            ) : recent.map((e) => (
              <tr key={e.id} tabIndex={0} className="cursor-pointer border-b last:border-0 hover:bg-muted/60 focus-visible:bg-muted" onClick={() => router.push(`/${company}/accounts/vouchers?id=${e.id}`)} onKeyDown={(k) => k.key === "Enter" && router.push(`/${company}/accounts/vouchers?id=${e.id}`)} data-testid={`link-recent-${e.id}`}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{date(e.date)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold">{e.number}</td>
                <td className="px-3 py-2"><KindTag k={e.kind} /></td>
                <td className="hidden max-w-[280px] truncate px-3 py-2 text-muted-foreground sm:table-cell">{e.narration ?? e.journal?.name ?? ""}</td>
                <td className="px-3 py-2 text-right"><Amt v={e.totalDebit ?? e.total ?? e.amount} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">{A.a.recent}</div>
      </section>
    </div>
  );
}
