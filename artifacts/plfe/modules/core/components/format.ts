const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", day: "2-digit", month: "2-digit", year: "numeric" });
const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false });

export function date(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return fmt.format(d).replace(/\//g, "-");
}
export function dateTime(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  return `${date(v)} ${fmtTime.format(d)}`;
}
export function isoDay(v: unknown): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}
/** Money stays a string end to end. Groups digits without converting to Number. */
export function money(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  const neg = s.startsWith("-");
  const [i, d] = s.replace("-", "").split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}PKR ${grouped}${d ? "." + d.slice(0, 2).padEnd(2, "0") : ".00"}`;
}
export function initials(name?: string) {
  return (name || "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
export function bytes(n: unknown) {
  const v = Number(n);
  if (!v) return "—";
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
}
export function companySlug(c: { id: string; code?: string }) {
  return c.code || c.id;
}
