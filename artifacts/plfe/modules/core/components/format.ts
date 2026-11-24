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
/** Money stays a string end to end. Rounds half-up to 2dp on the digit string (no JS Number),
 * groups thousands, prefixes "Rs", and shows negatives in brackets: (Rs 1,234.50). */
export function amount(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  let s = String(v).trim();
  const neg = s.startsWith("-");
  s = s.replace(/^[-+]/, "");
  if (!/^\d*(\.\d*)?$/.test(s)) return String(v);
  let [i, d = ""] = s.split(".");
  i = i.replace(/^0+(?=\d)/, "") || "0";
  const round = (d[2] ?? "0") >= "5";
  let cents = (i + (d + "00").slice(0, 2)).split("").map(Number);
  if (round) { let k = cents.length - 1; while (k >= 0) { if (cents[k] === 9) { cents[k] = 0; k--; } else { cents[k]++; break; } } if (k < 0) cents = [1, ...cents]; }
  const all = cents.join("");
  const ip = all.slice(0, -2).replace(/^0+(?=\d)/, "") || "0";
  const out = `${ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${all.slice(-2)}`;
  const zero = /^[0,.]+$/.test(out);
  return neg && !zero ? `(${out})` : out;
}
export function money(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const a = amount(v);
  return a.startsWith("(") ? `(Rs ${a.slice(1)}` : `Rs ${a}`;
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
