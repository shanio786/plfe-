import { AccountsApp } from "@/modules/accounts/components/accounts-app";

export default async function Page({ params }: { params: Promise<{ company: string; section?: string[] }> }) {
  const { company, section } = await params;
  return <AccountsApp company={company} section={section?.[0] ?? "overview"} />;
}
