import type { Sale } from "./db";
import { db } from "./db";
import { formatPKR } from "./money";

export type ReceiptTemplate = "compact" | "standard" | "detailed";
export type Align = "left" | "center" | "right";
export type FontSize = "small" | "medium" | "large";
export type Spacing = "tight" | "normal" | "relaxed";
export type TableStyle = "plain" | "lines" | "boxed";
export type Separator = "none" | "solid" | "dashed";
export type Paper = "thermal" | "a4";
export type SectionId = "header" | "meta" | "items" | "totals" | "footer";

export interface ReceiptDesign {
  template: ReceiptTemplate;
  paper: Paper;
  align: Align;
  fontSize: FontSize;
  boldHeader: boolean;
  boldTotals: boolean;
  spacing: Spacing;
  tableStyle: TableStyle;
  separator: Separator;
  showLogo: boolean;
  logoSize: FontSize;
  logoAlign: Align;
  logoDataUrl: string;
  showShopName: boolean;
  showPhone: boolean;
  showAddress: boolean;
  showInvoiceMeta: boolean;
  showCustomer: boolean;
  showSku: boolean;
  showPayment: boolean;
  showFooter: boolean;
  headerExtra: string;
  footerText: string;
  sections: SectionId[];
}

export interface ReceiptBusiness {
  shopName: string;
  phone?: string;
  address?: string;
}

const ALL_SECTIONS: SectionId[] = ["header", "meta", "items", "totals", "footer"];

export const TEMPLATE_LABELS: Record<ReceiptTemplate, { title: string; blurb: string }> = {
  compact: { title: "Compact POS", blurb: "Narrow thermal slip. Name, items, total." },
  standard: { title: "Standard", blurb: "Everyday counter receipt with shop details." },
  detailed: { title: "Detailed Invoice", blurb: "A4 invoice with SKU, tax and payment lines." },
};

function base(partial: Partial<ReceiptDesign> & Pick<ReceiptDesign, "template">): ReceiptDesign {
  return {
    paper: "thermal",
    align: "center",
    fontSize: "medium",
    boldHeader: true,
    boldTotals: true,
    spacing: "normal",
    tableStyle: "lines",
    separator: "dashed",
    showLogo: false,
    logoSize: "medium",
    logoAlign: "center",
    logoDataUrl: "",
    showShopName: true,
    showPhone: true,
    showAddress: true,
    showInvoiceMeta: true,
    showCustomer: true,
    showSku: false,
    showPayment: true,
    showFooter: true,
    headerExtra: "",
    footerText: "Thank you for shopping at Akhtar Autos.",
    sections: [...ALL_SECTIONS],
    ...partial,
  };
}

export const RECEIPT_PRESETS: Record<ReceiptTemplate, ReceiptDesign> = {
  compact: base({
    template: "compact",
    paper: "thermal",
    fontSize: "small",
    spacing: "tight",
    tableStyle: "plain",
    separator: "dashed",
    showAddress: false,
    showSku: false,
    showPayment: false,
    headerExtra: "",
    footerText: "Thank you.",
  }),
  standard: base({
    template: "standard",
    paper: "thermal",
    fontSize: "medium",
    spacing: "normal",
    tableStyle: "lines",
    separator: "solid",
    showAddress: true,
    showPayment: true,
    footerText: "Thank you for shopping at Akhtar Autos. Returns accepted within 7 days with this receipt.",
  }),
  detailed: base({
    template: "detailed",
    paper: "a4",
    align: "left",
    fontSize: "medium",
    spacing: "relaxed",
    tableStyle: "boxed",
    separator: "solid",
    showLogo: true,
    showSku: true,
    showPayment: true,
    showAddress: true,
    headerExtra: "Sales invoice",
    footerText: "Thank you for your business. Please keep this invoice for warranty and returns.",
  }),
};

export const DEFAULT_RECEIPT_DESIGN: ReceiptDesign = RECEIPT_PRESETS.standard;

function asAlign(v: unknown, fallback: Align): Align {
  return v === "left" || v === "center" || v === "right" ? v : fallback;
}
function asSize(v: unknown, fallback: FontSize): FontSize {
  return v === "small" || v === "medium" || v === "large" ? v : fallback;
}

export function normalizeReceiptDesign(raw: unknown): ReceiptDesign {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ReceiptDesign>;
  const template: ReceiptTemplate = r.template === "compact" || r.template === "detailed" || r.template === "standard" ? r.template : "standard";
  const preset = RECEIPT_PRESETS[template];
  const sections = Array.isArray(r.sections)
    ? r.sections.filter((s): s is SectionId => ALL_SECTIONS.includes(s as SectionId))
    : preset.sections;
  const unique = [...new Set(sections)];
  for (const s of ALL_SECTIONS) if (!unique.includes(s)) unique.push(s);
  return {
    ...preset,
    ...r,
    template,
    paper: r.paper === "a4" || r.paper === "thermal" ? r.paper : preset.paper,
    align: asAlign(r.align, preset.align),
    fontSize: asSize(r.fontSize, preset.fontSize),
    logoSize: asSize(r.logoSize, preset.logoSize),
    logoAlign: asAlign(r.logoAlign, preset.logoAlign),
    spacing: r.spacing === "tight" || r.spacing === "relaxed" || r.spacing === "normal" ? r.spacing : preset.spacing,
    tableStyle: r.tableStyle === "plain" || r.tableStyle === "boxed" || r.tableStyle === "lines" ? r.tableStyle : preset.tableStyle,
    separator: r.separator === "none" || r.separator === "solid" || r.separator === "dashed" ? r.separator : preset.separator,
    logoDataUrl: typeof r.logoDataUrl === "string" && r.logoDataUrl.startsWith("data:image/") ? r.logoDataUrl : "",
    headerExtra: typeof r.headerExtra === "string" ? r.headerExtra.slice(0, 120) : preset.headerExtra,
    footerText: typeof r.footerText === "string" ? r.footerText.slice(0, 400) : preset.footerText,
    sections: unique,
    showLogo: Boolean(r.showLogo ?? preset.showLogo),
    boldHeader: r.boldHeader !== false,
    boldTotals: r.boldTotals !== false,
    showShopName: r.showShopName !== false,
    showPhone: r.showPhone !== false,
    showAddress: Boolean(r.showAddress ?? preset.showAddress),
    showInvoiceMeta: r.showInvoiceMeta !== false,
    showCustomer: r.showCustomer !== false,
    showSku: Boolean(r.showSku ?? preset.showSku),
    showPayment: Boolean(r.showPayment ?? preset.showPayment),
    showFooter: r.showFooter !== false,
  };
}

export function applyTemplate(current: ReceiptDesign, template: ReceiptTemplate): ReceiptDesign {
  const next = RECEIPT_PRESETS[template];
  return { ...next, logoDataUrl: current.logoDataUrl, sections: [...next.sections] };
}

export async function getReceiptDesign(): Promise<ReceiptDesign> {
  const m = await db.meta.get("receiptDesign");
  return normalizeReceiptDesign(m?.value);
}
export async function saveReceiptDesign(design: ReceiptDesign) {
  await db.meta.put({ key: "receiptDesign", value: normalizeReceiptDesign(design) });
}

export type AppTheme = "light" | "dark";
export async function getAppTheme(): Promise<AppTheme> {
  const m = await db.meta.get("appTheme");
  return m?.value === "dark" ? "dark" : "light";
}
export async function saveAppTheme(theme: AppTheme) {
  await db.meta.put({ key: "appTheme", value: theme });
}

export function sampleSale(): Sale {
  const now = Date.now();
  return {
    id: 0,
    createdAt: now,
    updatedAt: now,
    deviceId: "preview",
    invoiceNo: "SAL-PREVIEW-0001",
    date: now,
    customerName: "Walk-in customer",
    locationId: 1,
    lines: [
      { itemId: 1, name: "Brake pad set", sku: "BP-104", qty: 2, price: 185000, discount: 0, cogs: 0, allocs: [], returnedQty: 0 },
      { itemId: 2, name: "Oil filter", sku: "OF-22", qty: 1, price: 95000, discount: 5000, cogs: 0, allocs: [], returnedQty: 0 },
    ],
    subtotal: 460000,
    discount: 10000,
    taxPct: 0,
    tax: 0,
    total: 450000,
    paid: 400000,
    method: "cash",
    notes: "Counter sale",
    status: "posted",
  };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" })[c] ?? c);
}

const FONT: Record<FontSize, number> = { small: 11, medium: 13, large: 16 };
const LOGO: Record<FontSize, number> = { small: 48, medium: 76, large: 110 };
const GAP: Record<Spacing, number> = { tight: 4, normal: 8, relaxed: 14 };

export function renderReceiptHtml(sale: Sale, design: ReceiptDesign, biz: ReceiptBusiness): string {
  const d = normalizeReceiptDesign(design);
  const fs = FONT[d.fontSize];
  const gap = GAP[d.spacing];
  const width = d.paper === "a4" ? "190mm" : "72mm";
  const page = d.paper === "a4" ? "A4" : "80mm auto";
  const border = d.separator === "none" ? "none" : `1px ${d.separator} #000`;
  const cell = d.tableStyle === "boxed" ? "border:1px solid #000;padding:6px;" : d.tableStyle === "lines" ? "border-bottom:1px solid #000;padding:5px 2px;" : "padding:3px 0;";
  const logo = d.showLogo && d.logoDataUrl
    ? `<div style="text-align:${d.logoAlign};margin-bottom:${gap}px"><img alt="" src="${d.logoDataUrl}" style="width:${LOGO[d.logoSize]}px;height:auto;max-height:${LOGO[d.logoSize]}px;object-fit:contain"/></div>`
    : "";
  const headerBits = [
    d.showShopName ? `<div style="font-size:${fs + 4}px;${d.boldHeader ? "font-weight:700;" : ""}letter-spacing:.04em">${esc(biz.shopName || "Shop")}</div>` : "",
    d.headerExtra ? `<div>${esc(d.headerExtra)}</div>` : "",
    d.showPhone && biz.phone ? `<div>${esc(biz.phone)}</div>` : "",
    d.showAddress && biz.address ? `<div>${esc(biz.address)}</div>` : "",
  ].filter(Boolean).join("");
  const meta = [
    d.showInvoiceMeta ? `<div>${esc(sale.invoiceNo)} · ${esc(new Date(sale.date).toLocaleString())}</div>` : "",
    d.showCustomer ? `<div>Customer: ${esc(sale.customerName || "Walk-in")}</div>` : "",
    sale.notes && d.template === "detailed" ? `<div>Note: ${esc(sale.notes)}</div>` : "",
  ].filter(Boolean).join("");
  const headSku = d.showSku ? "<th style=\"" + cell + "text-align:left\">SKU</th>" : "";
  const rows = sale.lines.map((l) => {
    const amt = l.qty * l.price - l.discount;
    return `<tr><td style="${cell}text-align:left">${esc(l.name)}</td>${d.showSku ? `<td style="${cell}text-align:left">${esc(l.sku || "")}</td>` : ""}<td style="${cell}">${l.qty}</td><td style="${cell}">${esc(formatPKR(l.price))}</td><td style="${cell}">${esc(formatPKR(amt))}</td></tr>`;
  }).join("");
  const items = `<table style="width:100%;border-collapse:collapse;margin-top:${gap}px"><thead><tr><th style="${cell}text-align:left">Item</th>${headSku}<th style="${cell}">Qty</th><th style="${cell}">Rate</th><th style="${cell}">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
  const weight = d.boldTotals ? "font-weight:700;" : "";
  const totals = `<div style="margin-top:${gap}px;line-height:1.6">Subtotal: ${esc(formatPKR(sale.subtotal))}<br>Discount: ${esc(formatPKR(sale.discount))}${sale.tax ? `<br>Tax: ${esc(formatPKR(sale.tax))}` : ""}<br><span style="${weight}">Total: ${esc(formatPKR(sale.total))}</span>${d.showPayment ? `<br>Paid (${esc(sale.method)}): ${esc(formatPKR(sale.paid))}<br>Due: ${esc(formatPKR(sale.total - sale.paid))}` : ""}</div>`;
  const footer = d.showFooter ? `<div style="margin-top:${gap}px">${esc(d.footerText)}</div>` : "";
  const blocks: Record<SectionId, string> = {
    header: `<div style="margin-bottom:${gap}px">${logo}${headerBits}</div>`,
    meta: meta ? `<div style="margin:${gap}px 0;padding-top:${gap}px;border-top:${border}">${meta}</div>` : "",
    items,
    totals: `<div style="padding-top:${gap}px;border-top:${border}">${totals}</div>`,
    footer: footer ? `<div style="padding-top:${gap}px;border-top:${border}">${footer}</div>` : "",
  };
  const body = d.sections.map((s) => blocks[s]).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(sale.invoiceNo)}</title><style>
    html,body{background:#fff !important;color:#000 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    body{font-family:Arial,Helvetica,sans-serif;font-size:${fs}px;margin:0;padding:12px;}
    .sheet{width:${width};max-width:100%;margin:0 auto;background:#fff;color:#000;text-align:${d.align};}
    table,th,td{color:#000;background:#fff;}
    img{background:#fff;}
    @page{size:${page};margin:8mm;}
    @media print{html,body{background:#fff !important;color:#000 !important;}}
  </style></head><body><div class="sheet">${body}</div></body></html>`;
}

export function previewSaleFrom(design: ReceiptDesign, biz: ReceiptBusiness) {
  return renderReceiptHtml(sampleSale(), design, biz);
}
