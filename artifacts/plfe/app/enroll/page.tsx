"use client";
import {useEffect,useState,type FormEvent} from "react";
import Link from "next/link";
import {api} from "@/lib/client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";

export default function EnrollPage() {
  const [status,setStatus]=useState<{available:boolean;configured:boolean}|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  useEffect(()=>{api<any>("/enrollment").then(setStatus).catch(e=>setError(e.message));},[]);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));
    if(values.password!==values.confirm){setError("Passwords must match");return;}
    setBusy(true);setError("");
    try{await api("/enrollment",{method:"POST",body:JSON.stringify(values)});setDone(true);}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  return <main className="min-h-screen grid place-items-center p-6 bg-background"><section className="max-w-md w-full rounded-xl border bg-card p-8 space-y-5">
    <h1 className="font-display text-2xl font-semibold">Initial Owner enrollment</h1>
    {done?<><p>Owner created and six companies provisioned. Use your chosen password to sign in.</p><Link href="/login">Continue to sign in</Link></>:!status?<p>Checking enrollment availability…</p>:!status.available?<p>Enrollment is closed. <Link href="/login">Sign in</Link></p>:!status.configured?<p>The authorized operator must configure the private enrollment credential in secure server settings. No default account or password exists.</p>:<form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-muted-foreground">Enter the private enrollment credential from your server's secure settings. Choose your own name, email and password. The credential is never your login password.</p>
      {[["name","Your name","text"],["email","Your email","email"],["credential","Private enrollment credential","password"],["password","Choose password","password"],["confirm","Confirm password","password"]].map(([name,label,type])=><div key={name} className="space-y-1"><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} required maxLength={name==="credential"?256:200} autoComplete={name==="password"||name==="confirm"?"new-password":"off"}/></div>)}
      <p className="text-xs text-muted-foreground">Password: at least 10 characters, including a letter and a number.</p>
      <Button type="submit" disabled={busy}>{busy?"Creating secure account…":"Create initial Owner"}</Button>
    </form>}
    {error&&<p role="alert" className="text-destructive">{error}</p>}
  </section></main>;
}
