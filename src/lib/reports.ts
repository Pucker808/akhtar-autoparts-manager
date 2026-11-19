import { db, type PayMethod } from "./db";
import { inRange, type Range, pkDayStart, DAY, msToPkDate } from "./dates";
import type { Paisa } from "./money";

export interface Summary {
  grossSales: Paisa; returns: Paisa; netSales: Paisa; tax: Paisa; cogs: Paisa; grossProfit: Paisa;
  expenses: Paisa; netProfit: Paisa; cashCollected: Paisa; purchases: Paisa; supplierPaid: Paisa;
  unitsSold: number; invoices: number; byMethod: Record<string, Paisa>;
}

/**
 * Formulas (single source of truth):
 *  netSales      = Σ invoice totals (excl. tax) − Σ return values (excl. tax)
 *  COGS          = Σ FIFO batch cost of sold lines − Σ cost restored by returns
 *  grossProfit   = netSales − COGS
 *  netProfit     = grossProfit − expenses
 *  cashCollected = Σ paid at sale + Σ customer receipts − Σ cash refunds
 */
export async function summarize(r: Range): Promise<Summary> {
  const [sales, rets, pays, exps, purs] = await Promise.all([
    db.sales.where("date").between(r.from, r.to, true, false).toArray(),
    db.saleReturns.where("date").between(r.from, r.to, true, false).toArray(),
    db.payments.where("date").between(r.from, r.to, true, false).toArray(),
    db.expenses.where("date").between(r.from, r.to, true, false).toArray(),
    db.purchases.where("date").between(r.from, r.to, true, false).toArray(),
  ]);
  const posted = sales.filter((s) => s.status === "posted");
  const grossSales = posted.reduce((a, s) => a + s.total - s.tax, 0);
  const tax = posted.reduce((a, s) => a + s.tax, 0);
  const saleOf = new Map(posted.map((s) => [s.id!, s]));
  let returns = 0, retCogs = 0, refunds = 0;
  for (const rt of rets) {
    const s = saleOf.get(rt.saleId) ?? (await db.sales.get(rt.saleId));
    const taxPart = s && s.taxPct ? Math.round((rt.amount * s.taxPct) / (100 + s.taxPct)) : 0;
    returns += rt.amount - taxPart;
    retCogs += rt.lines.reduce((a, l) => a + l.cogs, 0);
    refunds += rt.refundCash;
  }
  const cogs = posted.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.cogs, 0), 0) - retCogs;
  const netSales = grossSales - returns;
  const expenses = exps.filter((e) => !e.voided).reduce((a, e) => a + e.amount, 0);
  const custPays = pays.filter((p) => p.partyType === "customer");
  const cashCollected = posted.reduce((a, s) => a + s.paid, 0) + custPays.reduce((a, p) => a + p.amount, 0) - refunds;
  const byMethod: Record<string, Paisa> = {};
  for (const s of posted) if (s.paid) byMethod[s.method] = (byMethod[s.method] ?? 0) + s.paid;
  for (const p of custPays) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
  const credit = posted.reduce((a, s) => a + s.total - s.paid, 0);
  if (credit) byMethod["credit (unpaid)"] = credit;
  return {
    grossSales, returns, netSales, tax, cogs, grossProfit: netSales - cogs, expenses, netProfit: netSales - cogs - expenses,
    cashCollected, purchases: purs.reduce((a, p) => a + p.total, 0),
    supplierPaid: purs.reduce((a, p) => a + p.paid, 0) + pays.filter((p) => p.partyType === "supplier").reduce((a, p) => a + p.amount, 0),
    unitsSold: posted.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.qty, 0), 0) - rets.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.qty, 0), 0),
    invoices: posted.length, byMethod,
  };
}

export async function stockSnapshot() {
  const [items, batches, ledger] = await Promise.all([db.items.toArray(), db.batches.toArray(), db.ledger.toArray()]);
  const qty = new Map<number, number>();
  for (const l of ledger) qty.set(l.itemId, (qty.get(l.itemId) ?? 0) + l.qty);
  const value = new Map<number, number>();
  for (const b of batches) value.set(b.itemId, (value.get(b.itemId) ?? 0) + b.remaining * b.unitCost);
  const rows = items.filter((i) => !i.archived).map((i) => ({ item: i, qty: qty.get(i.id!) ?? 0, value: value.get(i.id!) ?? 0 }));
  return {
    rows,
    totalValue: rows.reduce((a, r) => a + r.value, 0),
    low: rows.filter((r) => r.qty > 0 && r.qty <= r.item.reorderLevel),
    out: rows.filter((r) => r.qty <= 0),
  };
}

export async function receivablesTotal() {
  const [sales, rets, pays] = await Promise.all([db.sales.toArray(), db.saleReturns.toArray(), db.payments.where("partyType").equals("customer").toArray()]);
  return sales.filter((s) => s.status === "posted").reduce((a, s) => a + s.total - s.paid, 0) - rets.reduce((a, r) => a + r.creditAmount, 0) - pays.reduce((a, p) => a + p.amount, 0);
}
export async function payablesTotal() {
  const [p, rets, pays] = await Promise.all([db.purchases.toArray(), db.purchaseReturns.toArray(), db.payments.where("partyType").equals("supplier").toArray()]);
  return p.reduce((a, s) => a + s.total - s.paid, 0) - rets.reduce((a, r) => a + r.creditAmount, 0) - pays.reduce((a, x) => a + x.amount, 0);
}

export async function itemPerformance(r: Range) {
  const sales = (await db.sales.where("date").between(r.from, r.to, true, false).toArray()).filter((s) => s.status === "posted");
  const rets = await db.saleReturns.where("date").between(r.from, r.to, true, false).toArray();
  const m = new Map<number, { itemId: number; name: string; qty: number; revenue: number; cogs: number }>();
  const get = (id: number, name: string) => m.get(id) ?? (m.set(id, { itemId: id, name, qty: 0, revenue: 0, cogs: 0 }), m.get(id)!);
  for (const s of sales) {
    const ratio = s.subtotal ? (s.subtotal - s.discount) / s.subtotal : 0;
    for (const l of s.lines) { const e = get(l.itemId, l.name); e.qty += l.qty; e.revenue += Math.round((l.qty * l.price - l.discount) * ratio); e.cogs += l.cogs; }
  }
  for (const rt of rets) for (const l of rt.lines) { const e = get(l.itemId, l.name); e.qty -= l.qty; e.revenue -= l.amount; e.cogs -= l.cogs; }
  return [...m.values()].map((e) => ({ ...e, profit: e.revenue - e.cogs }));
}

export async function dailyTrend(r: Range) {
  const sales = (await db.sales.where("date").between(r.from, r.to, true, false).toArray()).filter((s) => s.status === "posted");
  const days: { day: string; sales: number }[] = [];
  const span = Math.min(62, Math.ceil((r.to - r.from) / DAY));
  const start = pkDayStart(r.to - 1) - (span - 1) * DAY;
  for (let i = 0; i < span; i++) {
    const f = start + i * DAY;
    days.push({ day: msToPkDate(f).slice(5), sales: sales.filter((s) => inRange(s.date, { from: f, to: f + DAY })).reduce((a, s) => a + s.total, 0) });
  }
  return days;
}

export const METHOD_LABEL: Record<PayMethod, string> = { cash: "Cash", bank: "Bank transfer", easypaisa: "Easypaisa", jazzcash: "JazzCash", credit: "Credit (due)" };
