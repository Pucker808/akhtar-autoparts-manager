import Dexie, { type Table } from "dexie";
import type { Paisa } from "./money";

export interface Base { id?: number | undefined; createdAt: number; updatedAt: number; deviceId: string }

export interface Item extends Base {
  sku: string; barcode?: string | undefined; name: string; category?: string | undefined; brand?: string | undefined;
  compat?: string | undefined; oem?: string | undefined; unit: string; reorderLevel: number;
  cost: Paisa; price: Paisa; supplierId?: number | undefined; locationId?: number | undefined;
  notes?: string | undefined; image?: string | undefined; archived?: boolean | undefined;
}
export type LocationType = "shop" | "market" | "warehouse" | "rack" | "shelf" | "bin";
export interface Location extends Base { name: string; type: LocationType; parentId?: number | undefined; archived?: boolean }

export interface Batch extends Base {
  itemId: number; locationId: number; qty: number; remaining: number; unitCost: Paisa;
  date: number; supplierId?: number | undefined; source: "opening" | "purchase" | "sale_return" | "adjust" | "transfer";
  refId?: number | undefined;
}
export type LedgerType = "opening" | "purchase" | "sale" | "sale_return" | "purchase_return" | "adjust" | "transfer_in" | "transfer_out";
export interface Ledger extends Base {
  itemId: number; locationId: number; type: LedgerType; qty: number; // signed
  cost: Paisa; // total cost value of movement (positive)
  date: number; refType?: string | undefined; refId?: number | undefined; note?: string | undefined;
}
export interface Party extends Base { name: string; phone?: string | undefined; address?: string | undefined; notes?: string | undefined; archived?: boolean }
export type PayMethod = "cash" | "bank" | "easypaisa" | "jazzcash" | "credit";
export interface Alloc { batchId: number | null; qty: number; unitCost: Paisa }
export interface SaleLine { itemId: number; name: string; sku: string; qty: number; price: Paisa; discount: Paisa; cogs: Paisa; allocs: Alloc[]; returnedQty: number }
export interface Sale extends Base {
  invoiceNo: string; date: number; customerId?: number | undefined; customerName: string; locationId: number;
  lines: SaleLine[]; subtotal: Paisa; discount: Paisa; taxPct: number; tax: Paisa; total: Paisa;
  paid: Paisa; method: PayMethod; notes?: string | undefined; status: "posted" | "void";
}
export interface SaleReturn extends Base {
  saleId: number; invoiceNo: string; customerId?: number | undefined; date: number;
  lines: { itemId: number; name: string; qty: number; amount: Paisa; cogs: Paisa }[];
  amount: Paisa; refundCash: Paisa; creditAmount: Paisa; method: PayMethod; notes?: string | undefined;
}
export interface PurchaseLine { itemId: number; name: string; qty: number; unitCost: Paisa; discount: Paisa; batchId?: number | undefined; returnedQty: number }
export interface Purchase extends Base {
  billNo: string; supplierId: number; date: number; dueDate?: number | undefined; locationId: number;
  lines: PurchaseLine[]; subtotal: Paisa; discount: Paisa; total: Paisa; paid: Paisa; method: PayMethod; notes?: string | undefined;
}
export interface PurchaseReturn extends Base {
  purchaseId: number; supplierId: number; date: number;
  lines: { itemId: number; name: string; qty: number; amount: Paisa; cost: Paisa }[];
  amount: Paisa; refundCash: Paisa; creditAmount: Paisa; notes?: string | undefined;
}
export interface Payment extends Base {
  partyType: "customer" | "supplier"; partyId: number; amount: Paisa; method: PayMethod; date: number; note?: string | undefined;
}
export interface Expense extends Base {
  date: number; category: string; amount: Paisa; payee?: string | undefined; method: PayMethod; reference?: string | undefined; notes?: string | undefined;
  recurring?: "none" | "monthly" | "weekly" | undefined; voided?: boolean | undefined;
}
export interface Audit { id?: number | undefined; at: number; action: string; entity: string; entityId?: number | undefined; detail?: string | undefined; deviceId: string }
export interface Meta { key: string; value: unknown }

export class AkhtarDB extends Dexie {
  items!: Table<Item, number>;
  locations!: Table<Location, number>;
  batches!: Table<Batch, number>;
  ledger!: Table<Ledger, number>;
  customers!: Table<Party, number>;
  suppliers!: Table<Party, number>;
  sales!: Table<Sale, number>;
  saleReturns!: Table<SaleReturn, number>;
  purchases!: Table<Purchase, number>;
  purchaseReturns!: Table<PurchaseReturn, number>;
  payments!: Table<Payment, number>;
  expenses!: Table<Expense, number>;
  audit!: Table<Audit, number>;
  meta!: Table<Meta, string>;

  constructor(name = "akhtar-autos") {
    super(name);
    // Schema v1. Add new versions below for migrations; never edit a shipped version.
    this.version(1).stores({
      items: "++id, &sku, barcode, name, category, brand, supplierId, updatedAt",
      locations: "++id, name, type, parentId, updatedAt",
      batches: "++id, itemId, locationId, [itemId+locationId], date, refId, updatedAt",
      ledger: "++id, itemId, locationId, type, date, refId, updatedAt",
      customers: "++id, name, phone, updatedAt",
      suppliers: "++id, name, phone, updatedAt",
      sales: "++id, &invoiceNo, date, customerId, status, updatedAt",
      saleReturns: "++id, saleId, date, customerId, updatedAt",
      purchases: "++id, billNo, supplierId, date, updatedAt",
      purchaseReturns: "++id, purchaseId, supplierId, date, updatedAt",
      payments: "++id, partyType, partyId, [partyType+partyId], date, updatedAt",
      expenses: "++id, date, category, updatedAt",
      audit: "++id, at, entity",
      meta: "key",
    });
  }
}

export const db = new AkhtarDB();

export const DATA_TABLES = ["items", "locations", "batches", "ledger", "customers", "suppliers", "sales", "saleReturns", "purchases", "purchaseReturns", "payments", "expenses", "audit", "meta"] as const;
