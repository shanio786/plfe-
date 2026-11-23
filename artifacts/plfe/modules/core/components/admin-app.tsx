"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2, CalendarRange, Loader2, CheckCheck, ChevronsUpDown, FileStack, Hash, History, LayoutGrid, LogOut, Menu, MonitorSmartphone, Paperclip, Scale, ShieldCheck, Store, UserRound, Users, X,
} from "lucide-react";
import { api, type Identity, type RecordData } from "@/lib/client";
import { profileSchema } from "@/modules/core/schema";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { L } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Monogram, PasswordForm, signOut } from "./auth";
import { Ctx, Tag, useAdmin, type AdminCtx, type Overview } from "./shared";
import { companySlug, date, dateTime, initials } from "./format";
import {
  ApprovalRulesSection, ApprovalsSection, AttachmentsSection, AuditSection, BranchesSection, CompaniesSection, FiscalYearsSection, NumberingSection, RolesSection, SessionsSection, UsersSection,
} from "./sections";

type NavItem = { key: string; icon: ComponentType<{ className?: string }> };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "workspace", items: [{ key: "overview", icon: LayoutGrid }, { key: "approvals", icon: CheckCheck }] },
  { group: "organisation", items: [{ key: "companies", icon: Building2 }, { key: "branches", icon: Store }, { key: "users", icon: Users }, { key: "roles", icon: ShieldCheck }] },
  { group: "controls", items: [{ key: "numbering", icon: Hash }, { key: "fiscal-years", icon: CalendarRange }, { key: "approval-rules", icon: Scale }, { key: "attachments", icon: Paperclip }] },
  { group: "security", items: [{ key: "audit", icon: History }, { key: "sessions", icon: MonitorSmartphone }, { key: "profile", icon: UserRound }] },
];
const SECTIONS: Record<string, ComponentType> = {
  companies: CompaniesSection, branches: BranchesSection, users: UsersSection, roles: RolesSection, numbering: NumberingSection, "fiscal-years": FiscalYearsSection,
  "approval-rules": ApprovalRulesSection, approvals: ApprovalsSection, attachments: AttachmentsSection, audit: AuditSection, sessions: SessionsSection,
};

const READ: Record<string, string> = {
  companies: "core.company.read", branches: "core.branch.read", users: "core.user.read", roles: "core.role.read", numbering: "core.numbering.read",
  "fiscal-years": "core.fiscal.read", "approval-rules": "core.approvalRule.read", approvals: "core.approval.read", attachments: "core.attachment.read", audit: "core.audit.read",
};

export function AdminApp({ company, section }: { company: string; section: string }) {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ovError, setOvError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err"; n: number } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    api<Identity>("/session")
      .then((s) => (s.user.mustChangePassword ? router.replace("/change-password") : setIdentity(s)))
      .catch(() => router.replace("/login"));
  }, [router]);

  const reloadOverview = useCallback(() => {
    api<Overview>(`/${company}/overview`).then((o) => { setOverview(o); setOvError(null); }).catch((e) => {
      if (e.status === 401) router.replace("/login");
      else setOvError(e.message);
    });
  }, [company, router]);
  useEffect(reloadOverview, [reloadOverview]);
  useEffect(() => setMobileNav(false), [section]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const ctx: AdminCtx | null = useMemo(() => {
    if (!identity) return null;
    const perms = overview?.permissions ?? [];
    return {
      company, identity, overview, reloadOverview,
      can: (code: string) => identity.user.isOwner || perms.includes(code),
      notify: (msg, kind = "ok") => setToast({ msg, kind, n: Date.now() }),
    };
  }, [identity, overview, company, reloadOverview]);

  if (!ctx || !identity) {
    return (
      <div className="flex min-h-[100dvh]">
        <div className="hidden w-64 bg-sidebar md:block" />
        <div className="flex-1 space-y-4 p-8"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-80" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-80" /></div>
      </div>
    );
  }

  const current = identity.companies.find((c) => companySlug(c as any) === company || c.id === company) ?? overview?.company;
  const Section = SECTIONS[section];
  const known = section === "overview" || section === "profile" || !!Section;
  const pending = overview?.stats?.pendingApprovals ?? 0;

  const sidebar = (
    <nav className="flex h-full flex-col bg-sidebar text-primary-foreground">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <Monogram className="h-8 w-8 text-sm" />
        <div className="min-w-0 leading-tight">
          <div className="font-display text-sm font-bold">{L.brand.short}</div>
          <div className="truncate text-[10px] uppercase tracking-[0.16em] text-primary-foreground/50">{L.brand.group}</div>
        </div>
        <button className="ml-auto md:hidden" onClick={() => setMobileNav(false)}><X className="h-5 w-5" /></button>
      </div>
      <div className="px-3 pb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md border border-primary-foreground/10 bg-primary-foreground/[0.04] px-2.5 py-2 text-left transition-colors hover:bg-primary-foreground/[0.08]" data-testid="button-company-switcher">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-accent/90 font-mono text-[10px] font-bold text-accent-foreground">{String(current?.code ?? company).slice(0, 3)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" data-testid="text-company-name">{current?.name ?? company}</div>
                <div className="text-[10px] uppercase tracking-wider text-primary-foreground/50">{L.nav.switchCompany}</div>
              </div>
              <ChevronsUpDown className="h-4 w-4 text-primary-foreground/50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-xs text-muted-foreground">{L.nav.switchCompany}</DropdownMenuLabel>
            {identity.companies.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => router.push(`/${companySlug(c as any)}/admin/${section}`)} data-testid={`menu-company-${c.id}`}>
                <span className="font-mono text-xs text-muted-foreground w-10">{c.code}</span><span className="truncate">{c.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((g) => (
          <div key={g.group} className="mt-4">
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/40">{L.nav.groups[g.group]}</div>
            {g.items.filter(({ key }) => !READ[key] || ctx.can(READ[key])).map(({ key, icon: Icon }) => {
              const active = key === section;
              return (
                <Link
                  key={key}
                  href={`/${company}/admin/${key}`}
                  data-testid={`link-nav-${key}`}
                  className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${active ? "bg-primary-foreground/[0.1] text-primary-foreground" : "text-primary-foreground/65 hover:bg-primary-foreground/[0.05] hover:text-primary-foreground"}`}
                >
                  {active && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-accent" />}
                  <Icon className={`h-4 w-4 ${active ? "text-accent" : ""}`} />
                  <span className="truncate">{L.nav[key]}</span>
                  {key === "approvals" && pending > 0 && <span className="ml-auto rounded bg-accent px-1.5 font-mono text-[10px] font-bold text-accent-foreground">{pending}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5 border-t border-primary-foreground/10 px-4 py-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-semibold">{initials(identity.user.name)}</div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm">{identity.user.name}</div>
          <div className="truncate text-[11px] text-primary-foreground/50">{identity.user.email}</div>
        </div>
        <button onClick={() => signOut(router)} title={L.common.signOut} className="rounded p-1.5 text-primary-foreground/60 hover:bg-primary-foreground/10 hover:text-primary-foreground" data-testid="button-signout"><LogOut className="h-4 w-4" /></button>
      </div>
    </nav>
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className="min-h-[100dvh] md:grid md:grid-cols-[248px_1fr]">
        <aside className="sticky top-0 hidden h-[100dvh] md:block">{sidebar}</aside>
        {mobileNav && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-ink/50" onClick={() => setMobileNav(false)} />
            <div className="absolute inset-y-0 left-0 w-72 rise">{sidebar}</div>
          </div>
        )}
        <main className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/85 px-4 py-3 backdrop-blur md:px-8">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileNav(true)} data-testid="button-mobile-nav"><Menu /></Button>
            <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className="truncate">{current?.code ?? company}</span><span>/</span><span className="truncate text-foreground">{L.nav[section] ?? section}</span>
            </div>
            <div className="ml-auto font-mono text-[11px] text-muted-foreground">{overview?.fiscalYear ? `FY ${overview.fiscalYear.name}` : ""}</div>
          </header>
          <div key={section} className="px-4 py-6 md:px-8 md:py-8 rise">
            <div className="mb-6">
              <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight" data-testid="text-section-title">{L.nav[section] ?? section}</h1>
              {L.sub[section] && <p className="mt-1 text-sm text-muted-foreground">{L.sub[section]}</p>}
            </div>
            {!known ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground"><FileStack className="mx-auto mb-3 h-6 w-6" />{L.common.noResults}</div>
            ) : READ[section] && !ctx.can(READ[section]) ? (
              <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground"><ShieldCheck className="mx-auto mb-3 h-6 w-6" />{L.actions.noAccessRead}</div>
            ) : section === "overview" ? (
              <OverviewView overview={overview} error={ovError} retry={reloadOverview} />
            ) : section === "profile" ? (
              <ProfileView identity={identity} />
            ) : (
              <Section />
            )}
          </div>
        </main>
      </div>
      {toast && (
        <div key={toast.n} className={`fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm shadow-lg rise ${toast.kind === "ok" ? "border-success/30 bg-card text-success" : "border-destructive/30 bg-card text-destructive"}`} data-testid="toast">
          <span className={`h-2 w-2 rounded-full ${toast.kind === "ok" ? "bg-success" : "bg-destructive"}`} />{toast.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

function OverviewView({ overview, error, retry }: { overview: Overview | null; error: string | null; retry: () => void }) {
  const { company: co } = useAdmin();
  if (error && !overview) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/[0.03] p-8 text-center">
        <p className="font-medium text-destructive">{L.common.errorTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={retry}>{L.common.retry}</Button>
      </div>
    );
  }
  if (!overview) return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-72" /></div>;
  const keys = ["branches", "users", "roles", "pendingApprovals", "attachments"] as const;
  const hrefs: Record<string, string> = { branches: "branches", users: "users", roles: "roles", pendingApprovals: "approvals", attachments: "attachments" };
  const company = overview.company;
  const fy = overview.fiscalYear;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card sm:grid-cols-3 lg:grid-cols-5">
        {keys.map((k, i) => (
          <Link key={k} href={`/${co}/admin/${hrefs[k]}`} className={`group relative border-b border-r p-4 transition-colors hover:bg-accent/[0.07] rise rise-${Math.min(i + 1, 4)}`} data-testid={`stat-${k}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{L.overview.stats[k]}</div>
            <div className={`mt-2 font-display text-3xl font-bold tabular-nums ${k === "pendingApprovals" && overview.stats[k] > 0 ? "text-primary" : ""}`}>{overview.stats[k] ?? 0}</div>
            {k === "pendingApprovals" && overview.stats[k] > 0 && <span className="absolute right-4 top-4 h-2 w-2 rounded-full bg-accent" />}
          </Link>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-display font-semibold">{L.overview.activity}</h2>
            <Link href={`/${co}/admin/audit`} className="text-xs text-primary hover:underline">{L.nav.audit}</Link>
          </div>
          {overview.recentActivity.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground"><History className="mx-auto mb-2 h-5 w-5" />{L.overview.noActivity}</div>
          ) : (
            <ol className="divide-y">
              {overview.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <span className="font-medium">{a.actorName ?? "—"}</span>
                  <Tag tone="brand">{a.action}</Tag>
                  <span className="truncate font-mono text-xs text-muted-foreground">{a.tableName}</span>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{dateTime(a.createdAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <div className="space-y-6">
          <section className="relative overflow-hidden rounded-lg bg-sidebar p-5 text-primary-foreground ledger-lines">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/50">{L.overview.fy}</div>
            {fy ? (
              <>
                <div className="mt-2 font-display text-2xl font-bold">{fy.name}</div>
                <div className="mt-1 font-mono text-xs text-primary-foreground/70">{date(fy.startDate)} → {date(fy.endDate)}</div>
                <div className="mt-3"><span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-accent-foreground">{fy.isClosed ? L.overview.closed : L.overview.open}</span></div>
              </>
            ) : (
              <div className="mt-2 text-sm text-primary-foreground/70">{L.overview.noFy}<Link href={`/${co}/admin/fiscal-years`} className="mt-2 block text-accent hover:underline">{L.nav["fiscal-years"]}</Link></div>
            )}
          </section>
          <section className="rounded-lg border bg-card p-5">
            <div className="font-display font-semibold">{company?.name}</div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {(["legalName", "ntn", "strn", "currency", "phone", "email"] as const).map((k) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{L.f[k]}</dt><dd className="truncate font-mono text-xs leading-5">{company?.[k] || "—"}</dd></div>
              ))}
            </dl>
          </section>
          <section className="rounded-lg border bg-card p-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{L.overview.permissions}</div>
            <div className="flex flex-wrap gap-1">{overview.permissions.length ? overview.permissions.map((p) => <span key={p} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{p}</span>) : <span className="text-sm text-muted-foreground">—</span>}</div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProfileView({ identity }: { identity: Identity }) {
  const { company, notify } = useAdmin();
  const [profile, setProfile] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ name: string; phone: string }>({ resolver: zodResolver(profileSchema as any) as any, defaultValues: { name: identity.user.name, phone: "" } });
  const resetRef = useRef(form.reset);
  resetRef.current = form.reset;
  useEffect(() => {
    api<RecordData>(`/${company}/profile`).then((p) => { setProfile(p); resetRef.current({ name: p.name ?? "", phone: p.phone ?? "" }); }).catch((e) => setError(e.message));
  }, [company]);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const p = await api<RecordData>(`/${company}/profile`, { method: "POST", body: JSON.stringify({ name: v.name, phone: v.phone }) });
      setProfile((old) => ({ ...(old ?? { id: identity.user.id }), ...(p ?? {}), name: v.name, phone: v.phone }));
      notify(L.actions.profileSaved);
    } catch (e: any) { setError(e.message); }
  });
  const u = { ...identity.user, name: profile?.name ?? identity.user.name };
  const errs = form.formState.errors;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-4">
          {profile?.photoUrl
            ? <img src={profile.photoUrl} alt={L.f.name} className="h-14 w-14 rounded-full border object-cover" data-testid="img-profile-photo" />
            : <div className="grid h-14 w-14 place-items-center rounded-full bg-primary font-display text-lg font-bold text-primary-foreground" title={L.actions.noPhoto}>{initials(u.name)}</div>}
          <div>
            <div className="font-display text-xl font-bold" data-testid="text-profile-name">{u.name}</div>
            <div className="text-sm text-muted-foreground">{u.email}</div>
            {u.isOwner && <div className="mt-1"><Tag tone="brand">{L.common.owner}</Tag></div>}
          </div>
        </div>
        <form onSubmit={submit} className="mt-6 grid gap-3 border-t pt-5 sm:grid-cols-2">
          <div className="sm:col-span-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{L.actions.editProfile}</div>
          <div className="space-y-1.5"><Label htmlFor="pf-name">{L.f.name}</Label><Input id="pf-name" {...form.register("name")} data-testid="input-profile-name" />{errs.name && <p className="text-xs text-destructive">{String(errs.name.message)}</p>}</div>
          <div className="space-y-1.5"><Label htmlFor="pf-phone">{L.f.phone}</Label><Input id="pf-phone" {...form.register("phone")} data-testid="input-profile-phone" />{errs.phone && <p className="text-xs text-destructive">{String(errs.phone.message)}</p>}</div>
          {error && <p className="sm:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={form.formState.isSubmitting} data-testid="button-save-profile">{form.formState.isSubmitting && <Loader2 className="animate-spin" />}{L.common.save}</Button></div>
        </form>
        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{L.profile.companies}</div>
        <ul className="mt-2 divide-y rounded-md border">
          {identity.companies.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm"><span className="w-12 font-mono text-xs text-muted-foreground">{c.code}</span><span>{c.name}</span></li>
          ))}
        </ul>
      </section>
      <section className="rounded-lg border bg-card p-6">
        <h2 className="mb-4 font-display text-lg font-semibold">{L.profile.changePw}</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
