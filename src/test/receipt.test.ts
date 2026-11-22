import { describe, expect, it } from "vitest";
import { RECEIPT_PRESETS, normalizeReceiptDesign, renderReceiptHtml, sampleSale } from "@/lib/receipt";

describe("receipt design", () => {
  it("prints white paper and black text for every template", () => {
    const sale = sampleSale();
    for (const design of Object.values(RECEIPT_PRESETS)) {
      const html = renderReceiptHtml(sale, design, { shopName: "Akhtar Autos", phone: "0300", address: "Lahore" });
      expect(html).toContain("background:#fff");
      expect(html).toContain("color:#000");
      expect(html.toLowerCase()).not.toContain("#0f172a");
      expect(html).toContain(sale.invoiceNo);
      expect(html).toContain("Brake pad set");
    }
  });

  it("keeps a saved layout when reprinting an older invoice shape", () => {
    const design = normalizeReceiptDesign({ ...RECEIPT_PRESETS.detailed, showSku: true, footerText: "Keep this invoice" });
    const html = renderReceiptHtml(sampleSale(), design, { shopName: "Akhtar Autos" });
    expect(html).toContain("Keep this invoice");
    expect(html).toContain("BP-104");
    expect(html).toContain("@page{size:A4");
  });
});
