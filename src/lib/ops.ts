import { db, type Alloc, type Batch, type Item, type Ledger, type PayMethod, type Sale, type SaleLine, type Purchase, type PurchaseLine, type Party, type Expense, type Location } from "./db";
import { getDeviceId, getSettings, deviceIdSync } from "./settings";
import { pctOf, type Paisa } from "./money";
import { msToPkDate } from "./dates";

export class OpError extends Error {}
const now = () => Date.now();
function stamp<T extends object>(o: T): T & { createdAt: number; updatedAt: number; deviceId: string } {
  const t = now();
  return { ...o, createdAt: t, updatedAt: t, deviceId: deviceIdSync() };
}
async function audit(action: string, entity: string, entityId?: number, detail?: string) {
  await db.audit.add({ at: now(), action, entity, entityId, detail, deviceId: deviceIdSync() });
}
const ALL = () => [db.items, db.locations, db.batches, db.ledger, db.customers, db.suppliers, db.sales, db.saleReturns, db.purchases, db.purchaseReturns, db.payments, db.expenses, db.audit, db.meta];

export async function ensureDefaults() {
  await getDeviceId();
  if ((await db.locations.count()) === 0) {
    const id = await db.locations.add(stamp({ name: "Main Shop", type: "shop" as const }));
    const s = await db.meta.get("settings");
    await db.meta.put({ key: "settings", value: { ...((s?.value as object) ?? {}), defaultLocationId: id } });
  }
}

/** Current on-hand quantity from the ledger (optionally per location). */
export async function stockQty(itemId: number, locationId?: number): Promise<number> {
  const rows = await db.ledger.where("itemId").equals(itemId).toArray();
  return rows.filter((r) => locationId == null || r.locationId === locationId).reduce((s, r) => s + r.qty, 0);
}

/** Consume FIFO from batches at a location. Shortfall (if allowed) is costed at fallbackCost with batchId null. */
async function consumeFIFO(itemId: number, locationId: number, qty: number, allowShort: boolean, fallbackCost: Paisa, preferBatchIds: number[] = []): Promise<Alloc[]> {
  const batches = (await db.batches.where("[itemId+locationId]").equals([itemId, locationId]).toArray())
    .filter((b) => b.remaining > 0)
    .sort((a, b) => {
      const pa = preferBatchIds.includes(a.id!) ? 0 : 1, pb = preferBatchIds.includes(b.id!) ? 0 : 1;
      return pa - pb || a.date - b.date || a.id! - b.id!;
    });
  let need = qty;
  const allocs: Alloc[] = [];
  for (const b of batches) {
    if (need <= 0) break;
    const take = Math.min(need, b.remaining);
    await db.batches.update(b.id!, { remaining: b.remaining - take, updatedAt: now() });
    allocs.push({ batchId: b.id!, qty: take, unitCost: b.unitCost });
    need -= take;
  }
  if (need > 0) {
    if (!allowShort) throw new OpError(`Insufficient stock (short by ${need})`);
    allocs.push({ batchId: null, qty: need, unitCost: fallbackCost });
  }
  return allocs;
}
const allocCost = (a: Alloc[]) => a.reduce((s, x) => s + x.qty * x.unitCost, 0);

async function addBatch(b: Omit<Batch, "id" | "createdAt" | "updatedAt" | "deviceId" | "remaining">) {
  return db.batches.add(stamp({ ...b, remaining: b.qty }));
}
async function addLedger(l: Omit<Ledger, "id" | "createdAt" | "updatedAt" | "deviceId">) {
  return db.ledger.add(stamp(l));
}

// ---------- Items ----------
export type ItemInput = Omit<Item, "id" | "createdAt" | "updatedAt" | "deviceId">;
export async function saveItem(input: ItemInput, id?: number, opening?: { qty: number; locationId: number; unitCost: Paisa; date: number }) {
  if (!input.name.trim()) throw new OpError("Part name is required");
  if (!input.sku.trim()) throw new OpError("SKU is required");
  if (input.cost < 0 || input.price < 0) throw new OpError("Prices cannot be negative");
  return db.transaction("rw", ALL(), async () => {
    const dup = await db.items.where("sku").equals(input.sku.trim()).first();
    if (dup && dup.id !== id) throw new OpError(`SKU "${input.sku}" already exists`);
    if (id) {
      await db.items.update(id, { ...input, updatedAt: now() });
      await audit("edit", "item", id, input.name);
      return id;
    }
    const newId = await db.items.add(stamp({ ...input, sku: input.sku.trim() }));
    if (opening && opening.qty > 0) {
      const bid = await addBatch({ itemId: newId, locationId: opening.locationId, qty: opening.qty, unitCost: opening.unitCost, date: opening.date, source: "opening", supplierId: input.supplierId });
      await addLedger({ itemId: newId, locationId: opening.locationId, type: "opening", qty: opening.qty, cost: opening.qty * opening.unitCost, date: opening.date, refType: "batch", refId: bid, note: "Opening balance" });
    }
    await audit("create", "item", newId, input.name);
    return newId;
  });
}
export async function setItemArchived(id: number, archived: boolean) {
  await db.items.update(id, { archived, updatedAt: now() });
  await audit(archived ? "archive" : "restore", "item", id);
}

// ---------- Adjustments & transfers ----------
export async function adjustStock(p: { itemId: number; locationId: number; qty: number; unitCost?: Paisa; reason: string; date?: number }) {
  if (!Number.isInteger(p.qty) || p.qty === 0) throw new OpError("Adjustment quantity must be a non-zero whole number");
  if (!p.reason.trim()) throw new OpError("Reason is required");
  return db.transaction("rw", ALL(), async () => {
    const item = await db.items.get(p.itemId);
    if (!item) throw new OpError("Item not found");
    const date = p.date ?? now();
    if (p.qty > 0) {
      const cost = p.unitCost ?? item.cost;
      const bid = await addBatch({ itemId: p.itemId, locationId: p.locationId, qty: p.qty, unitCost: cost, date, source: "adjust" });
      await addLedger({ itemId: p.itemId, locationId: p.locationId, type: "adjust", qty: p.qty, cost: p.qty * cost, date, refType: "batch", refId: bid, note: p.reason });
    } else {
      const allocs = await consumeFIFO(p.itemId, p.locationId, -p.qty, false, item.cost);
      await addLedger({ itemId: p.itemId, locationId: p.locationId, type: "adjust", qty: p.qty, cost: allocCost(allocs), date, note: p.reason });
    }
    await audit("adjust", "item", p.itemId, `${p.qty > 0 ? "+" : ""}${p.qty} — ${p.reason}`);
  });
}

export async function transferStock(p: { itemId: number; fromId: number; toId: number; qty: number; note?: string; date?: number }) {
  if (p.fromId === p.toId) throw new OpError("Choose two different locations");
  if (!Number.isInteger(p.qty) || p.qty <= 0) throw new OpError("Quantity must be a positive whole number");
  return db.transaction("rw", ALL(), async () => {
    const item = await db.items.get(p.itemId);
    if (!item) throw new OpError("Item not found");
    const date = p.date ?? now();
    const srcBatches = await db.batches.where("[itemId+locationId]").equals([p.itemId, p.fromId]).toArray();
    const allocs = await consumeFIFO(p.itemId, p.fromId, p.qty, false, item.cost);
    for (const a of allocs) {
      const orig = srcBatches.find((b) => b.id === a.batchId);
      await addBatch({ itemId: p.itemId, locationId: p.toId, qty: a.qty, unitCost: a.unitCost, date: orig?.date ?? date, supplierId: orig?.supplierId, source: "transfer", refId: a.batchId ?? undefined });
    }
    const cost = allocCost(allocs);
    await addLedger({ itemId: p.itemId, locationId: p.fromId, type: "transfer_out", qty: -p.qty, cost, date, note: p.note });
    await addLedger({ itemId: p.itemId, locationId: p.toId, type: "transfer_in", qty: p.qty, cost, date, note: p.note });
    await audit("transfer", "item", p.itemId, `${p.qty} units`);
  });
}

// ---------- Sales ----------
export interface CartLine { itemId: number; qty: number; price: Paisa; discount: Paisa }
export function computeInvoice(lines: { qty: number; price: Paisa; discount: Paisa }[], invoiceDiscount: Paisa, taxPct: number) {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price - l.discount, 0);
  const taxable = Math.max(0, subtotal - invoiceDiscount);
  const tax = taxPct > 0 ? pctOf(taxable, taxPct) : 0;
  return { subtotal, taxable, tax, total: taxable + tax };
}

async function nextNumber(prefix: string, date: number) {
  const day = msToPkDate(date).replace(/-/g, "");
  const key = `counter:${prefix}:${day}`;
  const m = await db.meta.get(key);
  const n = ((m?.value as number) ?? 0) + 1;
  await db.meta.put({ key, value: n });
  return `${prefix}-${day}-${String(n).padStart(4, "0")}`;
}

export async function postSale(p: { lines: CartLine[]; discount: Paisa; customerId?: number; paid: Paisa; method: PayMethod; notes?: string; locationId: number; date?: number }) {
  if (p.lines.length === 0) throw new OpError("Cart is empty");
  for (const l of p.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new OpError("Quantities must be positive whole numbers");
    if (l.price < 0 || l.discount < 0 || l.discount > l.qty * l.price) throw new OpError("Invalid price or line discount");
  }
  const settings = await getSettings();
  const taxPct = settings.taxEnabled ? settings.taxPct : 0;
  const { subtotal, tax, total } = computeInvoice(p.lines, p.discount, taxPct);
  if (p.discount < 0 || p.discount > subtotal) throw new OpError("Invalid invoice discount");
  if (p.paid < 0) throw new OpError("Paid amount cannot be negative");
  if (p.paid > total) throw new OpError("Paid amount exceeds total — give change instead");
  if (p.paid < total && !p.customerId) throw new OpError("Select a customer for credit/partial payment");
  return db.transaction("rw", ALL(), async () => {
    const date = p.date ?? now();
    const invoiceNo = await nextNumber("AA", date);
    const cust = p.customerId ? await db.customers.get(p.customerId) : undefined;
    const lines: SaleLine[] = [];
    for (const l of p.lines) {
      const item = await db.items.get(l.itemId);
      if (!item) throw new OpError("Item not found");
      const onHand = await stockQty(l.itemId, p.locationId);
      if (!settings.allowNegativeStock && onHand < l.qty) throw new OpError(`Not enough stock for ${item.name}: ${onHand} available`);
      const allocs = await consumeFIFO(l.itemId, p.locationId, l.qty, settings.allowNegativeStock, item.cost);
      lines.push({ itemId: l.itemId, name: item.name, sku: item.sku, qty: l.qty, price: l.price, discount: l.discount, cogs: allocCost(allocs), allocs, returnedQty: 0 });
    }
    const sale: Sale = stamp({ invoiceNo, date, customerId: p.customerId, customerName: cust?.name ?? "Walk-in customer", locationId: p.locationId, lines, subtotal, discount: p.discount, taxPct, tax, total, paid: p.paid, method: p.paid === 0 ? "credit" : p.method, notes: p.notes, status: "posted" as const });
    const id = await db.sales.add(sale);
    for (const l of lines) await addLedger({ itemId: l.itemId, locationId: p.locationId, type: "sale", qty: -l.qty, cost: l.cogs, date, refType: "sale", refId: id, note: invoiceNo });
    await audit("create", "sale", id, `${invoiceNo} ${total}`);
    return id;
  });
}

/** Return items against an invoice. Refund is split: cash refunded now vs credit reducing customer due. */
export async function returnSale(p: { saleId: number; lines: { itemId: number; qty: number }[]; refundCash: Paisa; method: PayMethod; notes?: string; date?: number }) {
  return db.transaction("rw", ALL(), async () => {
    const sale = await db.sales.get(p.saleId);
    if (!sale || sale.status !== "posted") throw new OpError("Invoice not found");
    const date = p.date ?? now();
    const ratio = sale.subtotal > 0 ? (sale.subtotal - sale.discount) / sale.subtotal : 0;
    const taxRatio = sale.taxPct / 100;
    const rlines = [];
    for (const r of p.lines.filter((x) => x.qty > 0)) {
      const line = sale.lines.find((l) => l.itemId === r.itemId);
      if (!line) throw new OpError("Item not on invoice");
      if (!Number.isInteger(r.qty) || r.qty > line.qty - line.returnedQty) throw new OpError(`Cannot return more than sold for ${line.name}`);
      const lineNet = ((line.qty * line.price - line.discount) * r.qty) / line.qty;
      const amount = Math.round(lineNet * ratio * (1 + taxRatio));
      const cogs = Math.round((line.cogs * r.qty) / line.qty);
      line.returnedQty += r.qty;
      const unitCost = Math.round(cogs / r.qty);
      const bid = await addBatch({ itemId: r.itemId, locationId: sale.locationId, qty: r.qty, unitCost, date, source: "sale_return", refId: sale.id });
      await addLedger({ itemId: r.itemId, locationId: sale.locationId, type: "sale_return", qty: r.qty, cost: unitCost * r.qty, date, refType: "sale", refId: sale.id, note: `Return ${sale.invoiceNo} (batch ${bid})` });
      rlines.push({ itemId: r.itemId, name: line.name, qty: r.qty, amount, cogs: unitCost * r.qty });
    }
    if (rlines.length === 0) throw new OpError("Select at least one item to return");
    const amount = rlines.reduce((s, l) => s + l.amount, 0);
    if (p.refundCash < 0 || p.refundCash > amount) throw new OpError("Refund must be between 0 and the return value");
    const creditAmount = amount - p.refundCash;
    if (creditAmount > 0 && !sale.customerId) throw new OpError("Walk-in returns must be fully refunded");
    await db.sales.update(sale.id!, { lines: sale.lines, updatedAt: now() });
    const id = await db.saleReturns.add(stamp({ saleId: sale.id!, invoiceNo: sale.invoiceNo, customerId: sale.customerId, date, lines: rlines, amount, refundCash: p.refundCash, creditAmount, method: p.method, notes: p.notes }));
    await audit("return", "sale", sale.id, `${sale.invoiceNo} value ${amount}`);
    return id;
  });
}

// ---------- Purchases ----------
export async function postPurchase(p: { billNo: string; supplierId: number; date: number; dueDate?: number; locationId: number; lines: { itemId: number; qty: number; unitCost: Paisa; discount: Paisa }[]; discount: Paisa; paid: Paisa; method: PayMethod; notes?: string }) {
  if (!p.supplierId) throw new OpError("Select a supplier");
  if (p.lines.length === 0) throw new OpError("Add at least one item");
  for (const l of p.lines) if (!Number.isInteger(l.qty) || l.qty <= 0 || l.unitCost < 0 || l.discount < 0 || l.discount > l.qty * l.unitCost) throw new OpError("Invalid line quantity/cost/discount");
  const subtotal = p.lines.reduce((s, l) => s + l.qty * l.unitCost - l.discount, 0);
  if (p.discount < 0 || p.discount > subtotal) throw new OpError("Invalid bill discount");
  const total = subtotal - p.discount;
  if (p.paid < 0 || p.paid > total) throw new OpError("Paid must be between 0 and total");
  return db.transaction("rw", ALL(), async () => {
    const pid = await db.purchases.add(stamp({ billNo: p.billNo, supplierId: p.supplierId, date: p.date, dueDate: p.dueDate, locationId: p.locationId, lines: [] as PurchaseLine[], subtotal, discount: p.discount, total, paid: p.paid, method: p.paid === 0 ? "credit" : p.method, notes: p.notes }));
    const lines: PurchaseLine[] = [];
    for (const l of p.lines) {
      const item = await db.items.get(l.itemId);
      if (!item) throw new OpError("Item not found");
      // Effective unit cost spreads line discount and proportional bill discount.
      const lineNet = l.qty * l.unitCost - l.discount;
      const share = subtotal > 0 ? lineNet - Math.round((p.discount * lineNet) / subtotal) : 0;
      const unitCost = Math.round(share / l.qty);
      const bid = await addBatch({ itemId: l.itemId, locationId: p.locationId, qty: l.qty, unitCost, date: p.date, supplierId: p.supplierId, source: "purchase", refId: pid });
      await addLedger({ itemId: l.itemId, locationId: p.locationId, type: "purchase", qty: l.qty, cost: unitCost * l.qty, date: p.date, refType: "purchase", refId: pid, note: p.billNo });
      await db.items.update(l.itemId, { cost: unitCost, updatedAt: now() });
      lines.push({ itemId: l.itemId, name: item.name, qty: l.qty, unitCost: l.unitCost, discount: l.discount, batchId: bid, returnedQty: 0 });
    }
    await db.purchases.update(pid, { lines });
    await audit("create", "purchase", pid, `${p.billNo} ${total}`);
    return pid;
  });
}

export async function returnPurchase(p: { purchaseId: number; lines: { itemId: number; qty: number }[]; refundCash: Paisa; notes?: string; date?: number }) {
  return db.transaction("rw", ALL(), async () => {
    const pur = await db.purchases.get(p.purchaseId);
    if (!pur) throw new OpError("Purchase not found");
    const date = p.date ?? now();
    const ratio = pur.subtotal > 0 ? pur.total / pur.subtotal : 0;
    const rl = [];
    for (const r of p.lines.filter((x) => x.qty > 0)) {
      const line = pur.lines.find((l) => l.itemId === r.itemId);
      if (!line) throw new OpError("Item not on bill");
      if (!Number.isInteger(r.qty) || r.qty > line.qty - line.returnedQty) throw new OpError(`Cannot return more than purchased for ${line.name}`);
      const item = await db.items.get(r.itemId);
      const allocs = await consumeFIFO(r.itemId, pur.locationId, r.qty, false, item?.cost ?? 0, line.batchId ? [line.batchId] : []);
      const cost = allocCost(allocs);
      const amount = Math.round((((line.qty * line.unitCost - line.discount) * r.qty) / line.qty) * ratio);
      line.returnedQty += r.qty;
      await addLedger({ itemId: r.itemId, locationId: pur.locationId, type: "purchase_return", qty: -r.qty, cost, date, refType: "purchase", refId: pur.id, note: `Return ${pur.billNo}` });
      rl.push({ itemId: r.itemId, name: line.name, qty: r.qty, amount, cost });
    }
    if (rl.length === 0) throw new OpError("Select at least one item");
    const amount = rl.reduce((s, l) => s + l.amount, 0);
    if (p.refundCash < 0 || p.refundCash > amount) throw new OpError("Refund must be between 0 and return value");
    await db.purchases.update(pur.id!, { lines: pur.lines, updatedAt: now() });
    const id = await db.purchaseReturns.add(stamp({ purchaseId: pur.id!, supplierId: pur.supplierId, date, lines: rl, amount, refundCash: p.refundCash, creditAmount: amount - p.refundCash, notes: p.notes }));
    await audit("return", "purchase", pur.id, `${pur.billNo} value ${amount}`);
    return id;
  });
}

// ---------- Parties & payments ----------
export async function saveParty(kind: "customers" | "suppliers", data: Pick<Party, "name" | "phone" | "address" | "notes">, id?: number) {
  if (!data.name.trim()) throw new OpError("Name is required");
  const t = db[kind];
  if (id) { await t.update(id, { ...data, updatedAt: now() }); await audit("edit", kind, id, data.name); return id; }
  const nid = await t.add(stamp({ ...data, name: data.name.trim() }));
  await audit("create", kind, nid, data.name);
  return nid;
}
export async function recordPayment(p: { partyType: "customer" | "supplier"; partyId: number; amount: Paisa; method: PayMethod; date?: number; note?: string }) {
  if (!(p.amount > 0)) throw new OpError("Amount must be greater than zero");
  if (p.method === "credit") throw new OpError("Choose how the money was paid");
  return db.transaction("rw", ALL(), async () => {
    const id = await db.payments.add(stamp({ ...p, date: p.date ?? now() }));
    await audit("payment", p.partyType, p.partyId, String(p.amount));
    return id;
  });
}

export async function customerBalance(id: number): Promise<Paisa> {
  const [sales, rets, pays] = await Promise.all([
    db.sales.where("customerId").equals(id).toArray(),
    db.saleReturns.where("customerId").equals(id).toArray(),
    db.payments.where("[partyType+partyId]").equals(["customer", id]).toArray(),
  ]);
  return sales.filter((s) => s.status === "posted").reduce((a, s) => a + s.total - s.paid, 0) - rets.reduce((a, r) => a + r.creditAmount, 0) - pays.reduce((a, p) => a + p.amount, 0);
}
export async function supplierBalance(id: number): Promise<Paisa> {
  const [pur, rets, pays] = await Promise.all([
    db.purchases.where("supplierId").equals(id).toArray(),
    db.purchaseReturns.where("supplierId").equals(id).toArray(),
    db.payments.where("[partyType+partyId]").equals(["supplier", id]).toArray(),
  ]);
  return pur.reduce((a, s) => a + s.total - s.paid, 0) - rets.reduce((a, r) => a + r.creditAmount, 0) - pays.reduce((a, p) => a + p.amount, 0);
}

// ---------- Expenses & locations ----------
export async function saveExpense(e: Omit<Expense, "id" | "createdAt" | "updatedAt" | "deviceId">, id?: number) {
  if (!(e.amount > 0)) throw new OpError("Amount must be greater than zero");
  if (!e.category.trim()) throw new OpError("Category is required");
  if (id) { await db.expenses.update(id, { ...e, updatedAt: now() }); await audit("edit", "expense", id); return id; }
  const nid = await db.expenses.add(stamp(e));
  await audit("create", "expense", nid, `${e.category} ${e.amount}`);
  return nid;
}
export async function voidExpense(id: number) {
  await db.expenses.update(id, { voided: true, updatedAt: now() });
  await audit("void", "expense", id);
}
export async function saveLocation(l: Pick<Location, "name" | "type" | "parentId">, id?: number) {
  if (!l.name.trim()) throw new OpError("Name is required");
  if (id) { await db.locations.update(id, { ...l, updatedAt: now() }); await audit("edit", "location", id); return id; }
  const nid = await db.locations.add(stamp(l));
  await audit("create", "location", nid, l.name);
  return nid;
}
export async function setLocationArchived(id: number, archived: boolean) {
  if (archived) {
    const rows = await db.ledger.where("locationId").equals(id).toArray();
    if (rows.reduce((s, r) => s + r.qty, 0) !== 0) throw new OpError("Transfer all stock out before archiving this location");
  }
  await db.locations.update(id, { archived, updatedAt: now() });
  await audit(archived ? "archive" : "restore", "location", id);
}

export async function logAudit(action: string, entity: string, detail?: string) { await audit(action, entity, undefined, detail); }
