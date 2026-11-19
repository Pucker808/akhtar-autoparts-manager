// Asia/Karachi is UTC+5 year-round (no DST).
export const PK_OFFSET = 5 * 60 * 60 * 1000;
export const DAY = 24 * 60 * 60 * 1000;

export function pkDayStart(t: number): number {
  return Math.floor((t + PK_OFFSET) / DAY) * DAY - PK_OFFSET;
}

/** Parse "YYYY-MM-DD" as a Karachi calendar day; returns its start in UTC ms. */
export function pkDateToMs(d: string): number {
  const [y = 1970, m = 1, day = 1] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day) - PK_OFFSET;
}

export function msToPkDate(t: number): string {
  const d = new Date(t + PK_OFFSET);
  return d.toISOString().slice(0, 10);
}

/** For datetime-local inputs */
export function msToPkDateTime(t: number): string {
  return new Date(t + PK_OFFSET).toISOString().slice(0, 16);
}
export function pkDateTimeToMs(s: string): number {
  return Date.parse(s + ":00Z") - PK_OFFSET;
}

const fmtDate = new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric" });
const fmtDT = new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
export const fDate = (t?: number) => (t ? fmtDate.format(t) : "—");
export const fDateTime = (t?: number) => (t ? fmtDT.format(t) : "—");

export type Period = "today" | "yesterday" | "week" | "month" | "year" | "custom";
export interface Range { from: number; to: number } // [from, to)

export function periodRange(p: Period, now: number, custom?: { from: string; to: string }): Range {
  const today = pkDayStart(now);
  const d = new Date(today + PK_OFFSET); // Karachi wall-clock midnight as UTC
  switch (p) {
    case "today": return { from: today, to: today + DAY };
    case "yesterday": return { from: today - DAY, to: today };
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // Monday start
      return { from: today - dow * DAY, to: today + DAY };
    }
    case "month": return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - PK_OFFSET, to: today + DAY };
    case "year": return { from: Date.UTC(d.getUTCFullYear(), 0, 1) - PK_OFFSET, to: today + DAY };
    case "custom": {
      const f = custom?.from ? pkDateToMs(custom.from) : today;
      const t = custom?.to ? pkDateToMs(custom.to) + DAY : today + DAY;
      return { from: f, to: t };
    }
  }
}

export const inRange = (t: number, r: Range) => t >= r.from && t < r.to;
