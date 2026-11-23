"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Building2, KeyRound, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { api, type Identity } from "@/lib/client";
import { L } from "@/lib/labels";
import { loginSchema, passwordSchema } from "@/modules/core/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { companySlug, initials } from "./format";

export function Monogram({ className = "" }: { className?: string }) {
  return (
    <div className={`grid place-items-center rounded-md bg-accent text-accent-foreground font-display font-extrabold tracking-tight ${className}`}>
      <span className="text-[0.8em] leading-none">PL</span>
    </div>
  );
}

function BrandPanel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % L.login.heroWords.length), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <aside className="relative hidden overflow-hidden bg-sidebar text-primary-foreground lg:flex lg:flex-col lg:justify-between p-12 ledger-lines">
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full border-[56px] border-accent/15" />
      <div className="absolute -bottom-40 left-10 h-80 w-80 rounded-full border border-primary-foreground/10" />
      <div className="relative flex items-center gap-3 rise">
        <Monogram className="h-10 w-10 text-lg" />
        <div>
          <div className="font-display text-lg font-bold leading-none">{L.brand.name}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-primary-foreground/60">{L.brand.group}</div>
        </div>
      </div>
      <div className="relative">
        <p className="font-display text-5xl font-bold leading-[1.02] tracking-tight xl:text-6xl rise rise-1">
          {L.login.heroLead}
          <br />
          <span key={i} className="inline-block text-accent rise">{L.login.heroWords[i]}.</span>
        </p>
        <p className="mt-6 max-w-md text-primary-foreground/70 rise rise-2">{L.brand.tagline}</p>
      </div>
      <div className="relative flex items-center justify-between text-xs text-primary-foreground/50 font-mono">
        <span>{L.brand.footer}</span>
        <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />{L.login.secure}</span>
      </div>
    </aside>
  );
}

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Monogram className="h-9 w-9" />
            <span className="font-display font-bold">{L.brand.name}</span>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

function ErrorLine({ msg }: { msg?: string | null }) {
  if (!msg) return null;
  return <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-error">{msg}</p>;
}

export function LoginForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string; password: string }>({ resolver: zodResolver(loginSchema as any) as any, defaultValues: { email: "", password: "" } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api("/session", { method: "POST", body: JSON.stringify(v) });
      const s = await api<Identity>("/session");
      if (s.user.mustChangePassword) return router.replace("/change-password");
      if (onDone) onDone();
      else router.replace("/");
    } catch (e: any) {
      setError(e.message);
    }
  });
  const err = form.formState.errors;
  return (
    <form onSubmit={submit} className="space-y-5 rise">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{L.login.title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{L.login.subtitle}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{L.login.email}</Label>
        <Input id="email" type="email" autoComplete="username" className="h-11 bg-card" data-testid="input-email" {...form.register("email")} />
        {err.email && <p className="text-xs text-destructive">{String(err.email.message)}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{L.login.password}</Label>
        <Input id="password" type="password" autoComplete="current-password" className="h-11 bg-card" data-testid="input-password" {...form.register("password")} />
        {err.password && <p className="text-xs text-destructive">{String(err.password.message)}</p>}
      </div>
      <ErrorLine msg={error} />
      <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting} data-testid="button-login">
        {form.formState.isSubmitting ? <><Loader2 className="animate-spin" />{L.login.working}</> : <>{L.login.submit}<ArrowRight /></>}
      </Button>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-success" />{L.login.secure}</p>
    </form>
  );
}

export function PasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const form = useForm<{ currentPassword: string; newPassword: string; confirm: string }>({
    resolver: zodResolver(passwordSchema as any) as any,
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    setOk(false);
    if (v.newPassword !== form.getValues("confirm")) return form.setError("confirm", { message: L.pw.mismatch });
    try {
      await api("/password", { method: "POST", body: JSON.stringify({ currentPassword: v.currentPassword, newPassword: v.newPassword }) });
      setOk(true);
      form.reset();
      onDone?.();
    } catch (e: any) {
      setError(e.message);
    }
  });
  const err = form.formState.errors;
  const field = (name: "currentPassword" | "newPassword" | "confirm", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} type="password" className={forced ? "h-11 bg-card" : "bg-card"} data-testid={`input-${name}`} {...form.register(name)} />
      {err[name] && <p className="text-xs text-destructive">{String(err[name]?.message)}</p>}
    </div>
  );
  return (
    <form onSubmit={submit} className="space-y-4">
      {field("currentPassword", L.pw.current)}
      {field("newPassword", L.pw.next)}
      {field("confirm", L.pw.confirm)}
      <p className="text-xs text-muted-foreground">{L.pw.rule}</p>
      <ErrorLine msg={error} />
      {ok && <p className="text-sm text-success" data-testid="text-pw-ok">{L.pw.done}</p>}
      <Button type="submit" className={forced ? "w-full h-11" : ""} disabled={form.formState.isSubmitting} data-testid="button-change-password">
        {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <KeyRound />}
        {L.pw.submit}
      </Button>
    </form>
  );
}

export function ChangePasswordScreen() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api<Identity>("/session").then(() => setReady(true)).catch(() => router.replace("/login"));
  }, [router]);
  return (
    <AuthFrame>
      <div className="rise">
        <div className="mb-6 grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-primary"><KeyRound className="h-5 w-5" /></div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{L.pw.title}</h1>
        <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{L.pw.forced}</p>
        {ready ? <PasswordForm forced onDone={() => router.replace("/")} /> : <div className="space-y-3"><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-11" /></div>}
      </div>
    </AuthFrame>
  );
}

export async function signOut(router: { replace: (p: string) => void }) {
  try { await api("/session", { method: "DELETE" }); } catch { /* already signed out */ }
  router.replace("/login");
}

export function LoginScreen() {
  const router = useRouter();
  useEffect(() => {
    api<Identity>("/session").then((s) => router.replace(s.user.mustChangePassword ? "/change-password" : "/")).catch(() => undefined);
  }, [router]);
  return <AuthFrame><LoginForm /></AuthFrame>;
}

export function HomeScreen() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "anon" | "ready">("loading");
  const [id, setId] = useState<Identity | null>(null);
  const load = () => {
    api<Identity>("/session")
      .then((s) => {
        if (s.user.mustChangePassword) return router.replace("/change-password");
        setId(s);
        setState("ready");
      })
      .catch(() => setState("anon"));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (state === "loading") return <AuthFrame><div className="space-y-4"><Skeleton className="h-9 w-40" /><Skeleton className="h-4 w-64" /><Skeleton className="h-11" /><Skeleton className="h-11" /><Skeleton className="h-11" /></div></AuthFrame>;
  if (state === "anon") return <AuthFrame><LoginForm onDone={() => { setState("loading"); load(); }} /></AuthFrame>;
  return (
    <AuthFrame>
      <div className="rise">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{initials(id?.user.name)}</div>
          <div className="min-w-0">
            <div className="truncate font-medium" data-testid="text-username">{id?.user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{id?.user.email}</div>
          </div>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={() => signOut(router)} title={L.common.signOut} data-testid="button-signout"><LogOut /></Button>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">{L.home.title}</h1>
        <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{L.home.subtitle}</p>
        {id?.companies.length ? (
          <ul className="space-y-2">
            {id.companies.map((c, n) => (
              <li key={c.id} className={`rise rise-${Math.min(n + 1, 4)}`}>
                <Link href={`/${companySlug(c as any)}/admin`} className="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]" data-testid={`link-company-${c.id}`}>
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-secondary-foreground"><Building2 className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{L.home.none}</div>
        )}
      </div>
    </AuthFrame>
  );
}
