import { db } from "./db";

export interface Settings {
  shopName: string; phone?: string; address?: string; receiptFooter: string;
  taxEnabled: boolean; taxPct: number; allowNegativeStock: boolean; costing: "FIFO";
  defaultLocationId?: number; receiptFormat: "thermal" | "a4"; setupDone: boolean;
  lowStockDefault: number; demoData?: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  shopName: "Akhtar Autos", receiptFooter: "Thank you for shopping at Akhtar Autos. Returns accepted within 7 days with receipt.",
  taxEnabled: false, taxPct: 0, allowNegativeStock: false, costing: "FIFO", receiptFormat: "thermal",
  setupDone: false, lowStockDefault: 5,
};
export async function getSettings(): Promise<Settings> {
  const m = await db.meta.get("settings");
  return { ...DEFAULT_SETTINGS, ...((m?.value as Partial<Settings>) ?? {}) };
}
export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  await db.meta.put({ key: "settings", value: { ...cur, ...patch } });
}

let cachedDevice: string | null = null;
export async function getDeviceId(): Promise<string> {
  if (cachedDevice) return cachedDevice;
  const m = await db.meta.get("deviceId");
  if (m?.value) return (cachedDevice = m.value as string);
  const id = "dev-" + (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(36).slice(2));
  await db.meta.put({ key: "deviceId", value: id });
  return (cachedDevice = id);
}
export function deviceIdSync() { return cachedDevice ?? "unknown"; }
