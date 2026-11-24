import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Item, Location, Sale, Party, Purchase, Expense, PayMethod } from "../lib/db";
import { db } from "../lib/db";
import { ensureDefaults, saveItem, setItemArchived, postSale, postPurchase, saveParty, saveExpense, recordPayment, returnSale, returnPurchase } from "../lib/ops";
import { formatPKR, toPaisa } from "../lib/money";
import { stockSnapshot, summarize, receivablesTotal, payablesTotal } from "../lib/reports";
import { periodRange, fDate } from "../lib/dates";
import { connectGoogleDrive, disconnectGoogleDrive, driveConfigured, isGoogleDriveConnected, restoreGoogleDriveSession, uploadDriveBackup, restoreDriveBackup } from "../lib/googleDrive";
import { ReceiptStudio } from "../components/receipt-studio";
import { getAppTheme, saveAppTheme, getReceiptDesign, renderReceiptHtml, type AppTheme } from "../lib/receipt";
import { getSettings } from "../lib/settings";

export const Route = createFileRoute("/")({ component: Index });
type Tab = "overview" | "inventory" | "sales" | "purchases" | "parties" | "expenses" | "reports" | "settings";
const tabs: Tab[] = ["overview", "inventory", "sales", "purchases", "parties", "expenses", "reports", "settings"];
const METHODS: PayMethod[] = ["cash", "bank", "easypaisa", "jazzcash", "credit"];
const money = (n?: number) => formatPKR(n || 0);

type CartLine = { key: string; itemId: number; name: string; sku: string; qty: number; rateRs: string };

function Index() {
  const [tab, setTab] = useState<Tab>("overview");
  const [items, setItems] = useState<Item[]>([]);
  const [locs, setLocs] = useState<Location[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [suppliers, setSuppliers] = useState<Party[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stock, setStock] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [rec, setRec] = useState(0);
  const [pay, setPay] = useState(0);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [driveConnected, setDriveConnected] = useState(false);
  const [autoDrive, setAutoDrive] = useState(false);
  const [driveStatus, setDriveStatus] = useState("Not connected");
  const [lastDriveSync, setLastDriveSync] = useState("");
  const [period, setPeriod] = useState<"today" | "week" | "month" | "year">("month");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("light");

  const [saleOpen, setSaleOpen] = useState(false);
  const [saleSearch, setSaleSearch] = useState("");
  const [saleLines, setSaleLines] = useState<CartLine[]>([]);
  const [saleCustomer, setSaleCustomer] = useState("");
  const [salePaid, setSalePaid] = useState("");
  const [saleMethod, setSaleMethod] = useState<PayMethod>("cash");
  const [saleDiscount, setSaleDiscount] = useState("0");
  const [saleLoc, setSaleLoc] = useState<number>(0);

  const [purOpen, setPurOpen] = useState(false);
  const [purSearch, setPurSearch] = useState("");
  const [purLines, setPurLines] = useState<CartLine[]>([]);
  const [purSupplier, setPurSupplier] = useState("");
  const [purBill, setPurBill] = useState("");
  const [purPaid, setPurPaid] = useState("0");
  const [purMethod, setPurMethod] = useState<PayMethod>("cash");
  const [purDiscount, setPurDiscount] = useState("0");
  const [purLoc, setPurLoc] = useState<number>(0);

  async function refresh(p?: typeof period) {
    const per = p ?? period;
    await ensureDefaults();
    const a = await Promise.all([
      db.items.toArray(),
      db.locations.toArray(),
      db.customers.toArray(),
      db.suppliers.toArray(),
      db.sales.orderBy("date").reverse().toArray(),
      db.purchases.orderBy("date").reverse().toArray(),
      db.expenses.orderBy("date").reverse().toArray(),
      stockSnapshot(),
      summarize(periodRange(per, Date.now())),
      receivablesTotal(),
      payablesTotal(),
    ]);
    setItems(a[0]);
    const locations = a[1].filter((x: Location) => !x.archived);
    setLocs(locations);
    setCustomers(a[2]);
    setSuppliers(a[3]);
    setSales(a[4]);
    setPurchases(a[5]);
    setExpenses(a[6]);
    setStock(a[7]);
    setSummary(a[8]);
    setRec(a[9]);
    setPay(a[10]);
    if (!saleLoc && locations[0]?.id) setSaleLoc(locations[0].id);
    if (!purLoc && locations[0]?.id) setPurLoc(locations[0].id);
  }
  useEffect(() => {
    void refresh().catch((e) => setMsg(String(e)));
    void db.meta.get("driveAutoUpload").then((x) => setAutoDrive(Boolean(x?.value)));
    void db.meta.get("driveLastSync").then((x) => setLastDriveSync(String(x?.value || "")));
    if (driveConfigured()) {
      void restoreGoogleDriveSession().then((ok) => {
        if (ok) {
          setDriveConnected(true);
          setDriveStatus("Google Drive session restored automatically");
        }
      });
    }
    void getAppTheme().then(setTheme);
  }, []);

  async function act(fn: () => Promise<any>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setMsg(ok);
      await refresh();
      if (autoDrive && isGoogleDriveConnected()) {
        try {
          const t = await uploadDriveBackup();
          setLastDriveSync(t);
          await db.meta.put({ key: "driveLastSync", value: t });
          setDriveStatus("Synced");
        } catch (e) {
          setDriveStatus("Upload pending: " + (e instanceof Error ? e.message : String(e)));
          setMsg(ok + " (Drive upload pending)");
        }
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ask = (s: string, d = "") => window.prompt(s, d);

  function addCart(lines: CartLine[], setLines: (v: CartLine[]) => void, item: Item, ratePaisa: number) {
    const hit = lines.find((l) => l.itemId === item.id);
    if (hit) setLines(lines.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l)));
    else setLines([...lines, { key: String(item.id) + "-" + Date.now(), itemId: item.id!, name: item.name, sku: item.sku, qty: 1, rateRs: String(ratePaisa / 100) }]);
  }

  const saleSub = saleLines.reduce((s, l) => s + l.qty * toPaisa(l.rateRs || "0"), 0);
  const saleDisc = Math.min(saleSub, Math.max(0, toPaisa(saleDiscount || "0")));
  const saleTotal = saleSub - saleDisc;
  const purSub = purLines.reduce((s, l) => s + l.qty * toPaisa(l.rateRs || "0"), 0);
  const purDisc = Math.min(purSub, Math.max(0, toPaisa(purDiscount || "0")));
  const purTotal = purSub - purDisc;

  const saleMatches = useMemo(() => {
    const t = saleSearch.trim().toLowerCase();
    if (!t) return [];
    return items.filter((i) => !i.archived && [i.name, i.sku, i.barcode || ""].join(" ").toLowerCase().includes(t)).slice(0, 8);
  }, [saleSearch, items]);
  const purMatches = useMemo(() => {
    const t = purSearch.trim().toLowerCase();
    if (!t) return [];
    return items.filter((i) => !i.archived && [i.name, i.sku, i.barcode || ""].join(" ").toLowerCase().includes(t)).slice(0, 8);
  }, [purSearch, items]);

  function saveSale() {
    if (!saleLines.length) { setMsg("Add at least one item."); return; }
    const customerName = saleCustomer.trim();
    const customer = customerName ? customers.find((c) => c.name.toLowerCase() === customerName.toLowerCase()) : undefined;
    if (customerName && !customer) { setMsg("Customer not found. Add them in Parties first, or leave blank for walk-in."); return; }
    const paid = toPaisa(salePaid === "" ? String(saleTotal / 100) : salePaid);
    const method = paid < saleTotal ? (saleMethod === "credit" ? "credit" : saleMethod) : saleMethod;
    if (paid < saleTotal && !customer) { setMsg("Credit or partial payment needs a saved customer."); return; }
    void act(async () => {
      const id = await postSale({
        lines: saleLines.map((l) => ({ itemId: l.itemId, qty: l.qty, price: toPaisa(l.rateRs || "0"), discount: 0 })),
        discount: saleDisc,
        customerId: customer?.id,
        paid,
        method: paid === 0 ? "credit" : method,
        locationId: saleLoc || locs[0]?.id || 1,
      });
      const sale = await db.sales.get(id);
      if (sale) void openReceipt(sale);
      setSaleLines([]); setSaleCustomer(""); setSalePaid(""); setSaleDiscount("0"); setSaleSearch(""); setSaleOpen(false);
    }, "Sale saved. Receipt opened.");
  }

  function savePurchase() {
    const sup = suppliers.find((s) => s.name.toLowerCase() === purSupplier.trim().toLowerCase());
    if (!sup) { setMsg("Select an existing supplier."); return; }
    if (!purLines.length) { setMsg("Add at least one item."); return; }
    const paid = toPaisa(purPaid || "0");
    void act(async () => {
      await postPurchase({
        billNo: purBill.trim() || "PUR-" + Date.now(),
        supplierId: sup.id!,
        date: Date.now(),
        locationId: purLoc || locs[0]?.id || 1,
        lines: purLines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: toPaisa(l.rateRs || "0"), discount: 0 })),
        discount: purDisc,
        paid,
        method: paid === 0 ? "credit" : purMethod,
      });
      setPurLines([]); setPurBill(""); setPurPaid("0"); setPurDiscount("0"); setPurSearch(""); setPurOpen(false);
    }, "Purchase saved and stock updated.");
  }

  function doSaleReturn(s: Sale) {
    if (!s.lines?.length) { setMsg("No lines on this invoice"); return; }
    const sku = ask("Return item SKU / name (from invoice)");
    if (!sku) return;
    const line = s.lines.find((l) => l.name.toLowerCase().includes(sku.toLowerCase()) || l.sku.toLowerCase() === sku.toLowerCase());
    if (!line) { setMsg("Item not found on this invoice"); return; }
    const max = line.qty - (line.returnedQty || 0);
    if (max <= 0) { setMsg("Nothing left to return for this item"); return; }
    const qty = Number(ask(`Qty to return (max ${max})`, "1"));
    if (!Number.isInteger(qty) || qty < 1 || qty > max) { setMsg("Invalid quantity"); return; }
    const refund = toPaisa(ask("Cash refund amount Rs (0 = full credit)", String(Math.round((line.price * qty) / 100))) || "0");
    const method = (ask("Refund method: cash / bank / easypaisa / jazzcash", "cash") || "cash") as PayMethod;
    void act(() => returnSale({ saleId: s.id!, lines: [{ itemId: line.itemId, qty }], refundCash: refund, method }), "Sale return recorded.");
  }
  function doPurchaseReturn(p: Purchase) {
    if (!p.lines?.length) { setMsg("No lines on this bill"); return; }
    const sku = ask("Return item SKU / name (from bill)");
    if (!sku) return;
    const line = p.lines.find((l) => l.name.toLowerCase().includes(sku.toLowerCase()));
    if (!line) { setMsg("Item not found on this bill"); return; }
    const max = line.qty - (line.returnedQty || 0);
    if (max <= 0) { setMsg("Nothing left to return for this item"); return; }
    const qty = Number(ask(`Qty to return (max ${max})`, "1"));
    if (!Number.isInteger(qty) || qty < 1 || qty > max) { setMsg("Invalid quantity"); return; }
    const refund = toPaisa(ask("Cash refund received from supplier Rs (0 = credit note)", "0") || "0");
    void act(() => returnPurchase({ purchaseId: p.id!, lines: [{ itemId: line.itemId, qty }], refundCash: refund }), "Purchase return recorded. Stock reduced.");
  }

  function addParty(kind: "customers" | "suppliers") {
    const name = ask("Name");
    if (!name) return;
    const phone = ask("Phone", "") || "";
    const address = ask("Address", "") || "";
    void act(() => saveParty(kind, { name, phone, address }), "Party saved.");
  }
  function addExpense() {
    const category = ask("Expense category", "Shop expense");
    if (!category) return;
    const amount = toPaisa(ask("Amount in Rs", "0") || "0");
    const method = (ask("Payment method: cash / bank / easypaisa / jazzcash", "cash") || "cash") as PayMethod;
    void act(() => saveExpense({ date: Date.now(), category, amount, method, payee: ask("Paid to", "") || "" }), "Expense saved.");
  }
  function payment(kind: "customer" | "supplier", party: Party) {
    const amount = toPaisa(ask("Amount in Rs", "0") || "0");
    if (amount <= 0) return;
    const method = (ask("Method: cash / bank / easypaisa / jazzcash", "cash") || "cash") as PayMethod;
    void act(() => recordPayment({ partyType: kind, partyId: party.id!, amount, method }), "Payment recorded.");
  }

  async function openReceipt(s: Sale) {
    const [design, settings] = await Promise.all([getReceiptDesign(), getSettings()]);
    const html = renderReceiptHtml(s, design, { shopName: settings.shopName, phone: settings.phone, address: settings.address });
    const w = window.open("", "_blank", "width=480,height=760");
    if (!w) { setMsg("Allow pop-ups to print the receipt."); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  }

  return (
    <div className={"app-shell min-h-screen bg-background text-foreground " + (theme === "dark" ? "dark" : "")} data-app-theme={theme}>
      <aside className="fixed inset-y-0 hidden w-60 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="p-6"><b className="tracking-widest text-sidebar-primary">AKHTAR AUTOS</b><p className="text-xs text-sidebar-foreground/60">Shop management</p></div>
        <nav className="flex-1 space-y-1 p-3">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={"w-full rounded-lg px-4 py-3 text-left capitalize " + (tab === t ? "bg-sidebar-primary font-bold text-sidebar-primary-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent")}>{t}</button>)}</nav>
        <p className="p-4 text-xs text-sidebar-foreground/55">Offline database · This device</p>
      </aside>
      <main className="lg:pl-60">
        <header className="app-card sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card text-card-foreground p-4">
          <h1 className="text-xl font-bold capitalize">{tab}</h1>
          <div className="flex gap-2">
            {tab === "sales" && <button className="rounded bg-primary px-3 py-2 font-bold text-primary-foreground" onClick={() => setSaleOpen(true)}>New sale</button>}
            {tab === "purchases" && <button className="rounded bg-primary px-3 py-2 font-bold text-primary-foreground" onClick={() => setPurOpen(true)}>Add purchase</button>}
            {tab === "parties" && <><button className="rounded bg-primary px-3 py-2 font-medium text-primary-foreground" onClick={() => addParty("customers")}>Add customer</button><button className="rounded bg-primary px-3 py-2 font-medium text-primary-foreground" onClick={() => addParty("suppliers")}>Add supplier</button></>}
            {tab === "expenses" && <button className="rounded bg-primary px-3 py-2 font-medium text-primary-foreground" onClick={addExpense}>Add expense</button>}
            {tab === "inventory" && <button className="rounded bg-primary px-3 py-2 font-medium text-primary-foreground" onClick={() => { const name = ask("Part name"); if (!name) return; const sku = ask("SKU / code"); if (!sku) return; const cost = toPaisa(ask("Purchase cost Rs", "0") || "0"), price = toPaisa(ask("Selling price Rs", "0") || "0"), qty = Number(ask("Opening quantity", "0")), locationId = locs[0]?.id || 1; void act(() => saveItem({ name, sku, cost, price, unit: "pcs", reorderLevel: 5, locationId, archived: false }, undefined, qty > 0 ? { qty, locationId, unitCost: cost, date: Date.now() } : undefined), "Item saved."); }}>Add item</button>}
          </div>
        </header>
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-card p-2 lg:hidden">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={"rounded px-3 py-2 text-xs capitalize " + (tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{t}</button>)}</div>
        <div className="mx-auto max-w-7xl space-y-5 p-5">
          {msg && <div className="rounded border border-border bg-warning/25 p-3 text-sm text-foreground">{msg}<button className="float-right" onClick={() => setMsg("")}>×</button></div>}
          {/* APP_BODY_PLACEHOLDER */}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="app-card rounded-xl border border-border bg-card p-5 text-card-foreground"><div className="text-xs uppercase text-muted-foreground">{label}</div><div className="mt-2 text-2xl font-bold text-foreground">{value}</div></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="app-card rounded-xl border border-border bg-card p-5 text-card-foreground"><h2 className="mb-4 font-bold text-foreground">{title}</h2>{children}</section>; }
function Table({ heads, children }: { heads: string[]; children: React.ReactNode }) { return <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm text-foreground"><thead><tr className="bg-muted text-xs text-muted-foreground">{heads.map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{children}</tbody></table></div>; }
function PartyRows({ rows, pay }: { rows: Party[]; pay: (p: Party) => void }) { return <div className="divide-y divide-border">{rows.map((p) => <div key={p.id} className="flex items-center justify-between py-3"><div><b className="text-foreground">{p.name}</b><p className="text-xs text-muted-foreground">{p.phone || "No phone"}</p></div><button className="text-primary" onClick={() => pay(p)}>Record payment</button></div>)}</div>; }
