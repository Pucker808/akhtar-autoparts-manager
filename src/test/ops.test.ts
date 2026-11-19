import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adjustStock, computeInvoice, customerBalance, ensureDefaults, postPurchase, postSale, recordPayment, returnSale, saveItem, saveParty, stockQty, transferStock } from "@/lib/ops";
import { saveSettings } from "@/lib/settings";
import { summarize } from "@/lib/reports";
import { periodRange, pkDateToMs, DAY } from "@/lib/dates";
import { toPaisa, formatPKR } from "@/lib/money";

let shop = 0, wh = 0, sup = 0, item = 0;
const T0 = pkDateToMs("2026-03-10");

beforeEach(async () => {
  await db.delete(); await db.open();
  await ensureDefaults();
  shop = (await db.locations.toArray())[0]!.id!;
  wh = await db.locations.add({ name: "Warehouse", type: "warehouse", createdAt: 0, updatedAt: 0, deviceId: "t" });
  sup = await saveParty("suppliers", { name: "Sup" });
  item = await saveItem({ sku: "BP-1", name: "Brake pad", unit: "pc", reorderLevel: 2, cost: 0, price: 2000_00 });
  await postPurchase({ billNo: "B1", supplierId: sup, date: T0, locationId: shop, lines: [{ itemId: item, qty: 10, unitCost: 1000_00, discount: 0 }], discount: 0, paid: 0, method: "cash" });
  await postPurchase({ billNo: "B2", supplierId: sup, date: T0 + 1000, locationId: shop, lines: [{ itemId: item, qty: 10, unitCost: 1200_00, discount: 0 }], discount: 0, paid: 0, method: "cash" });
});

describe("money", () => {
  it("parses rupees into integer paisa", () => {
    expect(toPaisa("1,250.5")).toBe(125050);
    expect(formatPKR(125050)).toBe("Rs 1,250.50");
  });
});

describe("FIFO COGS", () => {
  it("costs a sale spanning two batches oldest first", async () => {
    const id = await postSale({ lines: [{ itemId: item, qty: 12, price: 2000_00, discount: 0 }], discount: 0, paid: 24000_00, method: "cash", locationId: shop, date: T0 + 5000 });
    const s = await db.sales.get(id);
    expect(s!.lines[0]!.cogs).toBe(10 * 1000_00 + 2 * 1200_00);
    expect(await stockQty(item)).toBe(8);
  });
  it("blocks overselling when negative stock is off", async () => {
    await expect(postSale({ lines: [{ itemId: item, qty: 21, price: 1, discount: 0 }], discount: 0, paid: 21, method: "cash", locationId: shop })).rejects.toThrow(/Not enough stock/);
    expect(await stockQty(item)).toBe(20);
  });
  it("allows 1000+ quantity with negative stock enabled", async () => {
    await saveSettings({ allowNegativeStock: true });
    const id = await postSale({ lines: [{ itemId: item, qty: 1500, price: 100, discount: 0 }], discount: 0, paid: 150000, method: "cash", locationId: shop });
    expect((await db.sales.get(id))!.total).toBe(150000);
    expect(await stockQty(item)).toBe(-1480);
  });
});

describe("invoice totals", () => {
  it("applies line discount, invoice discount and tax", () => {
    const r = computeInvoice([{ qty: 3, price: 1000_00, discount: 100_00 }, { qty: 1, price: 500_00, discount: 0 }], 400_00, 10);
    expect(r.subtotal).toBe(3400_00);
    expect(r.tax).toBe(300_00);
    expect(r.total).toBe(3300_00);
  });
});

describe("partial payments and credit", () => {
  it("tracks customer due and receipts", async () => {
    const c = await saveParty("customers", { name: "Ali" });
    await postSale({ lines: [{ itemId: item, qty: 2, price: 2000_00, discount: 0 }], discount: 0, paid: 1500_00, method: "cash", customerId: c, locationId: shop, date: T0 + 5000 });
    expect(await customerBalance(c)).toBe(2500_00);
    await recordPayment({ partyType: "customer", partyId: c, amount: 1000_00, method: "easypaisa", date: T0 + 6000 });
    expect(await customerBalance(c)).toBe(1500_00);
    const sm = await summarize({ from: T0, to: T0 + DAY });
    expect(sm.netSales).toBe(4000_00);
    expect(sm.cashCollected).toBe(2500_00);
  });
  it("requires a customer for credit", async () => {
    await expect(postSale({ lines: [{ itemId: item, qty: 1, price: 100, discount: 0 }], discount: 0, paid: 0, method: "cash", locationId: shop })).rejects.toThrow(/customer/);
  });
});

describe("returns", () => {
  it("restores stock and reverses revenue and COGS", async () => {
    const id = await postSale({ lines: [{ itemId: item, qty: 4, price: 2000_00, discount: 0 }], discount: 0, paid: 8000_00, method: "cash", locationId: shop, date: T0 + 5000 });
    await returnSale({ saleId: id, lines: [{ itemId: item, qty: 1 }], refundCash: 2000_00, method: "cash", date: T0 + 6000 });
    expect(await stockQty(item)).toBe(17);
    const sm = await summarize({ from: T0, to: T0 + DAY });
    expect(sm.netSales).toBe(6000_00);
    expect(sm.cogs).toBe(3000_00);
    expect(sm.grossProfit).toBe(3000_00);
    expect(sm.cashCollected).toBe(6000_00);
    await expect(returnSale({ saleId: id, lines: [{ itemId: item, qty: 4 }], refundCash: 0, method: "cash" })).rejects.toThrow();
  });
});

describe("transfers and adjustments", () => {
  it("moves stock between locations keeping cost", async () => {
    await transferStock({ itemId: item, fromId: shop, toId: wh, qty: 12 });
    expect(await stockQty(item, shop)).toBe(8);
    expect(await stockQty(item, wh)).toBe(12);
    const whBatches = await db.batches.where("locationId").equals(wh).toArray();
    expect(whBatches.reduce((a, b) => a + b.remaining * b.unitCost, 0)).toBe(10 * 1000_00 + 2 * 1200_00);
    await expect(transferStock({ itemId: item, fromId: shop, toId: wh, qty: 9 })).rejects.toThrow();
  });
  it("adjusts stock down using FIFO cost and blocks going negative", async () => {
    await adjustStock({ itemId: item, locationId: shop, qty: -3, reason: "Damaged" });
    expect(await stockQty(item)).toBe(17);
    const l = (await db.ledger.where("type").equals("adjust").toArray())[0];
    expect(l!.cost).toBe(3000_00);
    await expect(adjustStock({ itemId: item, locationId: shop, qty: -50, reason: "x" })).rejects.toThrow();
  });
});

describe("report date boundaries (Asia/Karachi)", () => {
  it("a sale at 11:59pm PKT counts for that day, 12:00am the next", async () => {
    const day = pkDateToMs("2026-03-11");
    await postSale({ lines: [{ itemId: item, qty: 1, price: 100_00, discount: 0 }], discount: 0, paid: 100_00, method: "cash", locationId: shop, date: day + DAY - 60_000 });
    await postSale({ lines: [{ itemId: item, qty: 1, price: 300_00, discount: 0 }], discount: 0, paid: 300_00, method: "cash", locationId: shop, date: day + DAY });
    const r = periodRange("custom", 0, { from: "2026-03-11", to: "2026-03-11" });
    expect((await summarize(r)).netSales).toBe(100_00);
    const today = periodRange("today", day + DAY + 1000);
    expect((await summarize(today)).netSales).toBe(300_00);
  });
});
