import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Item, Location, Sale, Party, Purchase, Expense, PayMethod } from "../lib/db";
import { db } from "../lib/db";
import { ensureDefaults, saveItem, setItemArchived, postSale, postPurchase, saveParty, saveExpense, recordPayment, returnSale, returnPurchase } from "../lib/ops";
import { formatPKR, toPaisa } from "../lib/money";
import { stockSnapshot, summarize, receivablesTotal, payablesTotal } from "../lib/reports";
import { periodRange, fDate } from "../lib/dates";
import { connectGoogleDrive, disconnectGoogleDrive, driveConfigured, isGoogleDriveConnected, restoreGoogleDriveSession, uploadDriveBackup, restoreDriveBackup } from "../lib/googleDrive";

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
      if (sale) printSale(sale);
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

  return (
    <div className="min-h-screen bg-[#f5f5f2] text-slate-900">
      <aside className="fixed inset-y-0 hidden w-60 flex-col bg-[#202832] text-white lg:flex">
        <div className="p-6"><b className="tracking-widest text-amber-400">AKHTAR AUTOS</b><p className="text-xs text-slate-400">Shop management</p></div>
        <nav className="flex-1 space-y-1 p-3">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={"w-full rounded-lg px-4 py-3 text-left capitalize " + (tab === t ? "bg-amber-500 font-bold text-slate-900" : "text-slate-300 hover:bg-white/10")}>{t}</button>)}</nav>
        <p className="p-4 text-xs text-slate-400">Offline database · This device</p>
      </aside>
      <main className="lg:pl-60">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-white p-4">
          <h1 className="text-xl font-bold capitalize">{tab}</h1>
          <div className="flex gap-2">
            {tab === "sales" && <button className="rounded bg-amber-500 px-3 py-2 font-bold" onClick={() => setSaleOpen(true)}>New sale</button>}
            {tab === "purchases" && <button className="rounded bg-amber-500 px-3 py-2 font-bold" onClick={() => setPurOpen(true)}>Add purchase</button>}
            {tab === "parties" && <><button className="rounded bg-amber-500 px-3 py-2" onClick={() => addParty("customers")}>Add customer</button><button className="rounded bg-amber-500 px-3 py-2" onClick={() => addParty("suppliers")}>Add supplier</button></>}
            {tab === "expenses" && <button className="rounded bg-amber-500 px-3 py-2" onClick={addExpense}>Add expense</button>}
            {tab === "inventory" && <button className="rounded bg-amber-500 px-3 py-2" onClick={() => { const name = ask("Part name"); if (!name) return; const sku = ask("SKU / code"); if (!sku) return; const cost = toPaisa(ask("Purchase cost Rs", "0") || "0"), price = toPaisa(ask("Selling price Rs", "0") || "0"), qty = Number(ask("Opening quantity", "0")), locationId = locs[0]?.id || 1; void act(() => saveItem({ name, sku, cost, price, unit: "pcs", reorderLevel: 5, locationId, archived: false }, undefined, qty > 0 ? { qty, locationId, unitCost: cost, date: Date.now() } : undefined), "Item saved."); }}>Add item</button>}
          </div>
        </header>
        <div className="flex gap-1 overflow-x-auto bg-white p-2 lg:hidden">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={"rounded px-3 py-2 text-xs capitalize " + (tab === t ? "bg-slate-800 text-white" : "bg-slate-100")}>{t}</button>)}</div>
        <div className="mx-auto max-w-7xl space-y-5 p-5">
          {msg && <div className="rounded bg-amber-100 p-3 text-sm">{msg}<button className="float-right" onClick={() => setMsg("")}>×</button></div>}
          {tab === "overview" && <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label={period + " sales"} value={money(summary?.grossSales)} />
              <Metric label="Cash collected" value={money(summary?.cashCollected)} />
              <Metric label="Net profit" value={money(summary?.netProfit)} />
              <Metric label="Stock value" value={money(stock?.totalValue)} />
              <Metric label="Low stock" value={String(stock?.low.length || 0)} />
              <Metric label="Out of stock" value={String(stock?.out.length || 0)} />
              <Metric label="Customer due" value={money(rec)} />
              <Metric label="Supplier due" value={money(pay)} />
            </div>
            <Panel title="Low / out of stock">{[...(stock?.out || []), ...(stock?.low || [])].map((x: any) => <p key={x.item.id} className="border-b py-2 text-sm">{x.item.name}: {x.qty} remaining</p>)}</Panel>
          </>}
          {tab === "inventory" && <Panel title="Inventory catalogue"><input className="mb-3 w-full rounded border p-2" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} /><Table heads={["Part", "SKU", "Cost", "Sale price", "Stock", ""]} >{items.filter((i) => !i.archived && [i.name, i.sku, i.brand || ""].join(" ").toLowerCase().includes(q.toLowerCase())).map((i) => <tr key={i.id}><td>{i.name}</td><td>{i.sku}</td><td>{money(i.cost)}</td><td>{money(i.price)}</td><td>{stock?.rows.find((x: any) => x.item.id === i.id)?.qty || 0}</td><td><button className="text-red-600" onClick={() => i.id && void act(() => setItemArchived(i.id!, true), "Item archived")}>Archive</button></td></tr>)}</Table></Panel>}
          {tab === "sales" && <>
            {saleOpen && <Panel title="Point of sale">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">Search or scan<input className="mt-1 w-full rounded border p-2" value={saleSearch} placeholder="SKU, barcode, or name" onChange={(e) => setSaleSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && saleMatches[0]) { addCart(saleLines, setSaleLines, saleMatches[0], saleMatches[0].price); setSaleSearch(""); } }} /></label>
                <label className="text-sm">Customer (blank = walk-in)<input className="mt-1 w-full rounded border p-2" list="cust-list" value={saleCustomer} onChange={(e) => setSaleCustomer(e.target.value)} /></label>
                <datalist id="cust-list">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </div>
              {saleMatches.length > 0 && <div className="mt-2 divide-y rounded border bg-slate-50">{saleMatches.map((i) => <button key={i.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-amber-50" onClick={() => { addCart(saleLines, setSaleLines, i, i.price); setSaleSearch(""); }}>{i.sku} — {i.name} · {money(i.price)}</button>)}</div>}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>Item</th><th>Qty</th><th>Rate (Rs)</th><th></th></tr></thead><tbody>
                  {saleLines.map((l) => <tr key={l.key} className="border-t"><td className="py-2">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td><td><input className="w-16 rounded border p-1" type="number" min={1} value={l.qty} onChange={(e) => setSaleLines(saleLines.map((x) => x.key === l.key ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} /></td><td><input className="w-28 rounded border p-1" value={l.rateRs} onChange={(e) => setSaleLines(saleLines.map((x) => x.key === l.key ? { ...x, rateRs: e.target.value } : x))} /></td><td><button className="text-red-600" onClick={() => setSaleLines(saleLines.filter((x) => x.key !== l.key))}>Remove</button></td></tr>)}
                </tbody></table>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="text-sm">Discount Rs<input className="mt-1 w-full rounded border p-2" value={saleDiscount} onChange={(e) => setSaleDiscount(e.target.value)} /></label>
                <label className="text-sm">Paid Rs<input className="mt-1 w-full rounded border p-2" value={salePaid} placeholder={String(saleTotal / 100)} onChange={(e) => setSalePaid(e.target.value)} /></label>
                <label className="text-sm">Method<select className="mt-1 w-full rounded border p-2" value={saleMethod} onChange={(e) => setSaleMethod(e.target.value as PayMethod)}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
                <label className="text-sm">Location<select className="mt-1 w-full rounded border p-2" value={saleLoc} onChange={(e) => setSaleLoc(Number(e.target.value))}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              </div>
              <p className="mt-3 text-sm">Total <b>{money(saleTotal)}</b> · Due <b>{money(Math.max(0, saleTotal - toPaisa(salePaid === "" ? (saleTotal / 100).toFixed(2) : salePaid)))}</b></p>
              <div className="mt-3 flex gap-2"><button disabled={busy} className="rounded bg-amber-500 px-4 py-2 font-bold disabled:opacity-40" onClick={saveSale}>Save invoice</button><button className="rounded border px-4 py-2" onClick={() => setSaleOpen(false)}>Cancel</button></div>
            </Panel>}
            <Panel title="Sales register"><Table heads={["Invoice", "Date", "Customer", "Total", "Paid", "Due", "Actions"]}>{sales.map((s) => <tr key={s.id}><td>{s.invoiceNo}</td><td>{fDate(s.date)}</td><td>{s.customerName}</td><td>{money(s.total)}</td><td>{money(s.paid)}</td><td>{money(s.total - s.paid)}</td><td className="space-x-2"><button className="text-amber-700" onClick={() => printSale(s)}>Print</button><button className="text-slate-600" onClick={() => doSaleReturn(s)}>Return</button></td></tr>)}</Table></Panel>
          </>}
          {tab === "purchases" && <>
            {purOpen && <Panel title="Purchase bill">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm">Supplier<input className="mt-1 w-full rounded border p-2" list="sup-list" value={purSupplier} onChange={(e) => setPurSupplier(e.target.value)} /></label>
                <datalist id="sup-list">{suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
                <label className="text-sm">Supplier bill no.<input className="mt-1 w-full rounded border p-2" value={purBill} onChange={(e) => setPurBill(e.target.value)} placeholder="Optional" /></label>
                <label className="text-sm">Search item<input className="mt-1 w-full rounded border p-2" value={purSearch} placeholder="SKU or name" onChange={(e) => setPurSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && purMatches[0]) { addCart(purLines, setPurLines, purMatches[0], purMatches[0].cost); setPurSearch(""); } }} /></label>
              </div>
              {purMatches.length > 0 && <div className="mt-2 divide-y rounded border bg-slate-50">{purMatches.map((i) => <button key={i.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-amber-50" onClick={() => { addCart(purLines, setPurLines, i, i.cost); setPurSearch(""); }}>{i.sku} — {i.name} · cost {money(i.cost)}</button>)}</div>}
              <div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>Item</th><th>Qty</th><th>Cost (Rs)</th><th></th></tr></thead><tbody>
                {purLines.map((l) => <tr key={l.key} className="border-t"><td className="py-2">{l.name}</td><td><input className="w-16 rounded border p-1" type="number" min={1} value={l.qty} onChange={(e) => setPurLines(purLines.map((x) => x.key === l.key ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} /></td><td><input className="w-28 rounded border p-1" value={l.rateRs} onChange={(e) => setPurLines(purLines.map((x) => x.key === l.key ? { ...x, rateRs: e.target.value } : x))} /></td><td><button className="text-red-600" onClick={() => setPurLines(purLines.filter((x) => x.key !== l.key))}>Remove</button></td></tr>)}
              </tbody></table></div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="text-sm">Bill discount Rs<input className="mt-1 w-full rounded border p-2" value={purDiscount} onChange={(e) => setPurDiscount(e.target.value)} /></label>
                <label className="text-sm">Paid Rs<input className="mt-1 w-full rounded border p-2" value={purPaid} onChange={(e) => setPurPaid(e.target.value)} /></label>
                <label className="text-sm">Method<select className="mt-1 w-full rounded border p-2" value={purMethod} onChange={(e) => setPurMethod(e.target.value as PayMethod)}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
                <label className="text-sm">Location<select className="mt-1 w-full rounded border p-2" value={purLoc} onChange={(e) => setPurLoc(Number(e.target.value))}>{locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              </div>
              <p className="mt-3 text-sm">Bill total <b>{money(purTotal)}</b> · Due <b>{money(Math.max(0, purTotal - toPaisa(purPaid || "0")))}</b></p>
              <div className="mt-3 flex gap-2"><button disabled={busy} className="rounded bg-amber-500 px-4 py-2 font-bold disabled:opacity-40" onClick={savePurchase}>Save purchase</button><button className="rounded border px-4 py-2" onClick={() => setPurOpen(false)}>Cancel</button></div>
            </Panel>}
            <Panel title="Purchase bills"><Table heads={["Bill", "Date", "Supplier", "Total", "Paid", "Due", "Actions"]}>{purchases.map((p) => <tr key={p.id}><td>{p.billNo}</td><td>{fDate(p.date)}</td><td>{suppliers.find((s) => s.id === p.supplierId)?.name || "Supplier"}</td><td>{money(p.total)}</td><td>{money(p.paid)}</td><td>{money(p.total - p.paid)}</td><td><button className="text-slate-600" onClick={() => doPurchaseReturn(p)}>Return</button></td></tr>)}</Table></Panel>
          </>}
          {tab === "parties" && <div className="grid gap-5 xl:grid-cols-2"><Panel title="Customers"><PartyRows rows={customers} pay={(p) => payment("customer", p)} /></Panel><Panel title="Suppliers"><PartyRows rows={suppliers} pay={(p) => payment("supplier", p)} /></Panel></div>}
          {tab === "expenses" && <Panel title="Expenses"><Table heads={["Date", "Category", "Payee", "Amount"]}>{expenses.map((e) => <tr key={e.id}><td>{fDate(e.date)}</td><td>{e.category}</td><td>{e.payee || "—"}</td><td>{money(e.amount)}</td></tr>)}</Table></Panel>}
          {tab === "reports" && <div className="space-y-5">
            <div className="flex flex-wrap gap-2"><span className="self-center text-sm text-slate-600">Period:</span>{(["today", "week", "month", "year"] as const).map((p) => <button key={p} onClick={() => { setPeriod(p); void refresh(p); }} className={"rounded px-3 py-1.5 text-sm capitalize " + (period === p ? "bg-slate-800 text-white" : "bg-slate-100")}>{p}</button>)}</div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Gross sales" value={money(summary?.grossSales)} /><Metric label="Returns" value={money(summary?.returns)} /><Metric label="Net sales" value={money(summary?.netSales)} /><Metric label="COGS" value={money(summary?.cogs)} />
              <Metric label="Gross profit" value={money(summary?.grossProfit)} /><Metric label="Expenses" value={money(summary?.expenses)} /><Metric label="Net profit" value={money(summary?.netProfit)} /><Metric label="Cash collected" value={money(summary?.cashCollected)} />
              <Metric label="Purchases" value={money(summary?.purchases)} /><Metric label="Supplier paid" value={money(summary?.supplierPaid)} /><Metric label="Invoices" value={String(summary?.invoices || 0)} /><Metric label="Units sold" value={String(summary?.unitsSold || 0)} />
            </div>
            <Panel title="Payment methods (cash collected)"><div className="flex flex-wrap gap-3 text-sm">{summary?.byMethod && Object.entries(summary.byMethod).map(([m, v]) => <span key={m} className="rounded bg-slate-50 px-3 py-1 capitalize">{m}: {money(v as number)}</span>)}</div></Panel>
          </div>}
          {tab === "settings" && <div className="space-y-5">
            <Panel title="Google Drive">
              <p className="mb-3 text-sm text-slate-600">Connect one Google account. Backup is a snapshot in the Akhtar Autos Data folder — not live multi-device sync.</p>
              {!driveConfigured() && <p className="mb-3 rounded bg-amber-50 p-3 text-sm">Google OAuth Client ID is not configured yet. Connection will work after the client ID is set.</p>}
              <div className="mb-3 flex flex-wrap items-center gap-2"><span className={"rounded px-3 py-1 text-xs " + (driveConnected ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600")}>{driveConnected ? "Connected" : "Not connected"}</span><span className="text-xs text-slate-500">{driveStatus}</span></div>
              <div className="flex flex-wrap gap-2">
                <button disabled={!driveConfigured()} className="rounded bg-amber-500 px-4 py-2 disabled:opacity-40" onClick={() => void (async () => { try { await connectGoogleDrive(); setDriveConnected(true); setDriveStatus("Google Drive connected"); } catch (e) { setDriveStatus(e instanceof Error ? e.message : String(e)); } })()}>Connect Google Drive</button>
                <button disabled={!driveConnected} className="rounded border px-4 py-2 disabled:opacity-40" onClick={() => { disconnectGoogleDrive(); setDriveConnected(false); setDriveStatus("Disconnected"); }}>Disconnect</button>
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={autoDrive} onChange={(e) => { setAutoDrive(e.target.checked); void db.meta.put({ key: "driveAutoUpload", value: e.target.checked }); }} /> Automatically upload after each saved change</label>
              <p className="mt-2 text-xs text-slate-500">Last sync: {lastDriveSync ? new Date(lastDriveSync).toLocaleString() : "Never"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button disabled={!driveConnected} className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-40" onClick={() => void (async () => { try { const t = await uploadDriveBackup(); setLastDriveSync(t); await db.meta.put({ key: "driveLastSync", value: t }); setDriveStatus("Backup uploaded"); } catch (e) { setDriveStatus(e instanceof Error ? e.message : String(e)); } })()}>Upload / Sync Now</button>
                <button disabled={!driveConnected} className="rounded border px-4 py-2 disabled:opacity-40" onClick={() => { if (!window.confirm("Drive backup will replace all records on this device. Download a local backup first. Continue?")) return; void (async () => { try { const t = await restoreDriveBackup(); setLastDriveSync(t); setDriveStatus("Restore complete"); await refresh(); } catch (e) { setDriveStatus(e instanceof Error ? e.message : String(e)); } })(); }}>Import / Restore from Drive</button>
              </div>
            </Panel>
            <Panel title="Local backup"><p className="mb-3 text-sm">Download a JSON copy of this device's database.</p><button className="rounded bg-amber-500 px-4 py-2" onClick={() => void (async () => { const names = ["items", "locations", "batches", "ledger", "customers", "suppliers", "sales", "saleReturns", "purchases", "purchaseReturns", "payments", "expenses", "audit", "meta"]; const data: any = { app: "Akhtar Autos", version: 1 }; for (const n of names) data[n] = await db.table(n).toArray(); const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "akhtar-autos-backup.json"; a.click(); URL.revokeObjectURL(url); })()}>Download backup</button></Panel>
          </div>}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">{label}</div><div className="mt-2 text-2xl font-bold">{value}</div></div>; }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 font-bold">{title}</h2>{children}</section>; }
function Table({ heads, children }: { heads: string[]; children: React.ReactNode }) { return <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-sm"><thead><tr className="bg-slate-50 text-xs text-slate-500">{heads.map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y">{children}</tbody></table></div>; }
function PartyRows({ rows, pay }: { rows: Party[]; pay: (p: Party) => void }) { return <div className="divide-y">{rows.map((p) => <div key={p.id} className="flex items-center justify-between py-3"><div><b>{p.name}</b><p className="text-xs text-slate-500">{p.phone || "No phone"}</p></div><button className="text-amber-700" onClick={() => pay(p)}>Record payment</button></div>)}</div>; }
function printSale(s: Sale) {
  const w = window.open("", "_blank", "width=420,height=700");
  if (!w) return;
  const rows = s.lines.map((l) => "<tr><td>" + l.name + "</td><td>" + l.qty + "</td><td>" + formatPKR(l.price) + "</td><td>" + formatPKR(l.qty * l.price - l.discount) + "</td></tr>").join("");
  w.document.write("<html><head><title>" + s.invoiceNo + "</title><style>body{font:13px Arial;margin:20px}h2,p{text-align:center}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:7px;text-align:right}td:first-child,th:first-child{text-align:left}.sum{text-align:right;line-height:2}</style></head><body><h2>AKHTAR AUTOS</h2><p>Sales Receipt</p><p>" + s.invoiceNo + " | " + new Date(s.date).toLocaleString() + "</p><p>Customer: " + s.customerName + "</p><table><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>" + rows + "</table><div class='sum'>Subtotal: " + formatPKR(s.subtotal) + "<br>Discount: " + formatPKR(s.discount) + "<br><b>Total: " + formatPKR(s.total) + "</b><br>Paid: " + formatPKR(s.paid) + "<br>Due: " + formatPKR(s.total - s.paid) + "</div><p>Thank you!</p><script>window.onload=function(){window.print()}<\\/script></body></html>");
  w.document.close();
}
