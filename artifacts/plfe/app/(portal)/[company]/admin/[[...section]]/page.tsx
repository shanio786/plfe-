import { AdminApp } from "@/modules/core/components/admin-app";

export default async function Page({ params }: { params: Promise<{ company: string; section?: string[] }> }) {
  const { company, section } = await params;
  return <AdminApp company={company} section={section?.[0] ?? "overview"} />;
}
