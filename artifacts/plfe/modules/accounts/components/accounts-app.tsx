"use client";
import { Suspense, type ReactNode } from "react";
import { BookCopy, Building, FileInput, FileOutput, Gauge, HandCoins, Layers3, ListTree, NotebookTabs, Percent, Receipt, Hourglass, DoorOpen, Upload, Scale, ScrollText, Settings2, Store, UsersRound } from "lucide-react";
import { L } from "@/lib/labels";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminApp, type ShellNav } from "@/modules/core/components/admin-app";
import { AccountsOverview } from "./overview";
import { ChartSection, DepartmentsSection, JournalsSection, OutletsSection, PartiesSection } from "./masters";
import { DocumentsSection } from "./documents";
import { PaymentsSection } from "./payments";
import { VouchersSection } from "./vouchers";
import { ReportSection } from "./reports";
import { SettingsSection } from "./settings";
import { OpeningSection } from "./opening";
import { ImportsSection } from "./imports";
import { PartyAgeingSection } from "./ageing";
import { PaymentDuplicateProvider } from "./payment-duplicate";
import { TaxSummarySection, TaxesSection } from "./taxes";

const NAV: ShellNav = [
  { group: "books", items: [{ key: "overview", icon: Gauge }, { key: "vouchers", icon: NotebookTabs }] },
  { group: "documents", items: [{ key: "invoices", icon: FileOutput }, { key: "bills", icon: FileInput }, { key: "payments", icon: HandCoins }] },
  { group: "reports", items: [{ key: "trial-balance", icon: Scale }, { key: "ledger", icon: ScrollText }, { key: "party-ledger", icon: BookCopy }, { key: "tax-summary", icon: Percent }, { key: "party-ageing", icon: Hourglass }] },
  { group: "masters", items: [{ key: "chart", icon: ListTree }, { key: "parties", icon: UsersRound }, { key: "departments", icon: Building }, { key: "journals", icon: Layers3 }, { key: "outlets", icon: Store }] },
  { group: "setup", items: [{ key: "settings", icon: Settings2 }, { key: "taxes", icon: Receipt }, { key: "opening", icon: DoorOpen }, { key: "imports", icon: Upload }] },
];
const READ: Record<string, string> = {
  overview: "accounts.report.read", chart: "accounts.chart.read", parties: "accounts.party.read", departments: "accounts.department.read", journals: "accounts.journal.read", outlets: "accounts.outlet.read",
  invoices: "accounts.invoice.read", bills: "accounts.bill.read", payments: "accounts.payment.read", vouchers: "accounts.entry.read",
  "trial-balance": "accounts.report.read", ledger: "accounts.report.read", "party-ledger": "accounts.report.read", settings: "accounts.settings.read", taxes: "accounts.tax.read", "tax-summary": "accounts.report.read", opening: "accounts.opening.manage", imports: "accounts.import.create", "party-ageing": "accounts.report.read",
};

function render(section: string): ReactNode {
  const body = (() => {
    switch (section) {
      case "overview": return <AccountsOverview />;
      case "chart": return <ChartSection />;
      case "parties": return <PartiesSection />;
      case "departments": return <DepartmentsSection />;
      case "journals": return <JournalsSection />;
      case "outlets": return <OutletsSection />;
      case "invoices": return <DocumentsSection res="invoices" />;
      case "bills": return <DocumentsSection res="bills" />;
      case "payments": return <PaymentsSection />;
      case "vouchers": return <VouchersSection />;
      case "trial-balance": case "ledger": case "party-ledger": return <ReportSection report={section} />;
      case "settings": return <SettingsSection />;
      case "taxes": return <TaxesSection />;
      case "tax-summary": return <TaxSummarySection />;
      case "opening": return <OpeningSection />;
      case "imports": return <ImportsSection />;
      case "party-ageing": return <PartyAgeingSection />;
      default: return null;
    }
  })();
  return <PaymentDuplicateProvider><Suspense fallback={<Skeleton className="h-80" />}>{body}</Suspense></PaymentDuplicateProvider>;
}

export function AccountsApp({ company, section }: { company: string; section: string }) {
  return <AdminApp company={company} section={section} module="accounts" nav={NAV} read={READ} labels={L.acc} render={render} />;
}
