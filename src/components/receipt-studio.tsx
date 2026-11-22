import { useEffect, useState } from "react";
import type { ReceiptDesign, SectionId, ReceiptTemplate, Align, FontSize, Spacing, TableStyle, Separator, Paper } from "../lib/receipt";
import { TEMPLATE_LABELS, applyTemplate, getReceiptDesign, previewSaleFrom, saveReceiptDesign } from "../lib/receipt";
import { getSettings, saveSettings } from "../lib/settings";

export function ReceiptStudio({ onSaved }: { onSaved?: (msg: string) => void }) {
  const [design, setDesign] = useState<ReceiptDesign | null>(null);
  const [shopName, setShopName] = useState("Akhtar Autos");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    void (async () => {
      const [d, s] = await Promise.all([getReceiptDesign(), getSettings()]);
      setDesign(d);
      setShopName(s.shopName);
      setPhone(s.phone ?? "");
      setAddress(s.address ?? "");
    })();
  }, []);

  if (!design) return <p className="text-sm text-slate-500">Loading receipt design…</p>;

  const patch = (p: Partial<ReceiptDesign>) => setDesign({ ...design, ...p });
  const html = previewSaleFrom(design, { shopName, phone, address });

  function move(id: SectionId, dir: -1 | 1) {
    const list = [...design!.sections];
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]!;
    list[i] = list[j]!;
    list[j] = tmp;
    patch({ sections: list });
  }

  async function save() {
    await saveReceiptDesign(design);
    await saveSettings({ shopName: shopName.trim() || "Akhtar Autos", phone, address, receiptFooter: design.footerText, receiptFormat: design.paper });
    setSavedMsg("Default receipt saved. New and old invoices both use this design.");
    onSaved?.("Receipt design saved.");
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">This is only the printed receipt. The application light/dark theme does not change it. Print is always white paper and black text.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(TEMPLATE_LABELS) as ReceiptTemplate[]).map((id) => (
            <button key={id} type="button" onClick={() => setDesign(applyTemplate(design, id))} className={"rounded border p-3 text-left " + (design.template === id ? "border-amber-500 bg-amber-50" : "bg-white")}>
              <b>{TEMPLATE_LABELS[id].title}</b>
              <p className="mt-1 text-xs text-slate-500">{TEMPLATE_LABELS[id].blurb}</p>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>Shop name<input className="mt-1 w-full rounded border bg-white p-2 text-black" value={shopName} onChange={(e) => setShopName(e.target.value)} /></label>
          <label>Phone<input className="mt-1 w-full rounded border bg-white p-2 text-black" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label className="sm:col-span-2">Address<input className="mt-1 w-full rounded border bg-white p-2 text-black" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          <label className="sm:col-span-2">Header line<input className="mt-1 w-full rounded border bg-white p-2 text-black" value={design.headerExtra} onChange={(e) => patch({ headerExtra: e.target.value })} /></label>
          <label className="sm:col-span-2">Footer<input className="mt-1 w-full rounded border bg-white p-2 text-black" value={design.footerText} onChange={(e) => patch({ footerText: e.target.value })} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Paper" value={design.paper} options={[["thermal", "Thermal 80mm"], ["a4", "A4"]]} onChange={(v) => patch({ paper: v as Paper })} />
          <Select label="Alignment" value={design.align} options={[["left", "Left"], ["center", "Center"], ["right", "Right"]]} onChange={(v) => patch({ align: v as Align })} />
          <Select label="Font size" value={design.fontSize} options={[["small", "Small"], ["medium", "Medium"], ["large", "Large"]]} onChange={(v) => patch({ fontSize: v as FontSize })} />
          <Select label="Spacing" value={design.spacing} options={[["tight", "Tight"], ["normal", "Normal"], ["relaxed", "Relaxed"]]} onChange={(v) => patch({ spacing: v as Spacing })} />
          <Select label="Table" value={design.tableStyle} options={[["plain", "No borders"], ["lines", "Row lines"], ["boxed", "Full grid"]]} onChange={(v) => patch({ tableStyle: v as TableStyle })} />
          <Select label="Separators" value={design.separator} options={[["none", "None"], ["solid", "Solid"], ["dashed", "Dashed"]]} onChange={(v) => patch({ separator: v as Separator })} />
          <Select label="Logo size" value={design.logoSize} options={[["small", "Small"], ["medium", "Medium"], ["large", "Large"]]} onChange={(v) => patch({ logoSize: v as FontSize })} />
          <Select label="Logo place" value={design.logoAlign} options={[["left", "Left"], ["center", "Center"], ["right", "Right"]]} onChange={(v) => patch({ logoAlign: v as Align })} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Check label="Bold shop name" checked={design.boldHeader} onChange={(v) => patch({ boldHeader: v })} />
          <Check label="Bold total" checked={design.boldTotals} onChange={(v) => patch({ boldTotals: v })} />
          <Check label="Shop name" checked={design.showShopName} onChange={(v) => patch({ showShopName: v })} />
          <Check label="Phone" checked={design.showPhone} onChange={(v) => patch({ showPhone: v })} />
          <Check label="Address" checked={design.showAddress} onChange={(v) => patch({ showAddress: v })} />
          <Check label="Invoice no. & date" checked={design.showInvoiceMeta} onChange={(v) => patch({ showInvoiceMeta: v })} />
          <Check label="Customer" checked={design.showCustomer} onChange={(v) => patch({ showCustomer: v })} />
          <Check label="SKU column" checked={design.showSku} onChange={(v) => patch({ showSku: v })} />
          <Check label="Paid / due" checked={design.showPayment} onChange={(v) => patch({ showPayment: v })} />
          <Check label="Footer" checked={design.showFooter} onChange={(v) => patch({ showFooter: v })} />
          <Check label="Logo" checked={design.showLogo} onChange={(v) => patch({ showLogo: v })} />
        </div>
        <label className="block">Logo image
          <input className="mt-1 block text-xs" type="file" accept="image/*" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 400_000) { setSavedMsg("Logo must be under 400 KB."); return; }
            const reader = new FileReader();
            reader.onload = () => { if (typeof reader.result === "string") patch({ logoDataUrl: reader.result, showLogo: true }); };
            reader.readAsDataURL(file);
          }} />
        </label>
        <div>
          <p className="mb-2 font-medium">Section order</p>
          <ul className="space-y-1">
            {design.sections.map((id) => (
              <li key={id} className="flex items-center justify-between rounded border bg-white px-3 py-1 text-black">
                <span className="capitalize">{id}</span>
                <span className="space-x-2">
                  <button type="button" className="text-xs" onClick={() => move(id, -1)}>Up</button>
                  <button type="button" className="text-xs" onClick={() => move(id, 1)}>Down</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="rounded bg-amber-500 px-4 py-2 font-bold text-slate-900" onClick={() => void save()}>Save as default receipt</button>
        {savedMsg && <p className="text-xs text-slate-600">{savedMsg}</p>}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Live preview (printer colours)</p>
        <div className="overflow-hidden rounded border bg-white" style={{ background: "#fff" }}>
          <iframe title="Receipt preview" sandbox="" srcDoc={html} className="h-[640px] w-full bg-white" style={{ background: "#ffffff" }} />
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return <label>{label}<select className="mt-1 w-full rounded border bg-white p-2 text-black" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>;
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}
