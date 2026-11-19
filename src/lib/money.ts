// Money is stored as integer paisa (1 Rs = 100 paisa). Never store floats.
export type Paisa = number;

export function toPaisa(input: string | number): Paisa {
  if (typeof input === "number") return Math.round(input * 100);
  const s = String(input).replace(/[,\s]/g, "").replace(/^rs\.?/i, "");
  if (s === "" || s === "-") return 0;
  if (!/^-?\d*(\.\d{0,2})?\d*$/.test(s)) return NaN;
  const neg = s.startsWith("-");
  const [w, f = ""] = s.replace("-", "").split(".");
  const v = parseInt(w || "0", 10) * 100 + parseInt((f + "00").slice(0, 2), 10);
  return neg ? -v : v;
}

export function fromPaisa(p: Paisa): string {
  const neg = p < 0;
  const a = Math.abs(Math.round(p));
  const r = Math.floor(a / 100);
  const f = a % 100;
  return (neg ? "-" : "") + r + (f ? "." + String(f).padStart(2, "0") : "");
}

export function formatPKR(p: Paisa | undefined | null): string {
  const v = Math.round(p ?? 0);
  const neg = v < 0;
  const a = Math.abs(v);
  const r = Math.floor(a / 100);
  const f = a % 100;
  const rs = r.toLocaleString("en-PK");
  return `${neg ? "-" : ""}Rs ${rs}${f ? "." + String(f).padStart(2, "0") : ""}`;
}

/** Percentage of an amount in paisa, rounded to the nearest paisa. pct may be e.g. 17 or 2.5 */
export function pctOf(amount: Paisa, pct: number): Paisa {
  return Math.round((amount * Math.round(pct * 100)) / 10000);
}
