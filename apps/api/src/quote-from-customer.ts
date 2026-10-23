import { randomUUID } from "node:crypto";
import { roundMoney } from "./pricing.js";
import type { Quote, QuoteTemplateSnapshot } from "./types.js";

export function estimateFromCustomerQuote(source: Quote, sourceId: string, template: QuoteTemplateSnapshot, quoteNumber: string, idempotencyKey: string, createdBy: string, now: Date): Quote {
  if (source.kind !== "customer" || !source.lines.length && !source.missingProducts?.length) {
    throw new Error("Báo giá khách cần có ít nhất một sản phẩm để tạo dự toán.");
  }
  const informationNeeded: string[] = [];
  const lines: Quote["lines"] = source.lines.map((line) => {
    const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 1;
    if (line.priceUnavailable) {
      const informationField = `Sản phẩm cần bổ sung giá #${informationNeeded.length + 1}: ${line.name}`;
      informationNeeded.push(informationField);
      return { ...line, catalogItemId: `supplemental:${randomUUID()}`, source: "supplemental", supplementalFor: informationField,
        quantity, unitPrice: 0, lineTotal: 0 };
    }
    return { ...line, quantity, lineTotal: roundMoney(quantity * line.unitPrice) };
  });
  for (const name of source.missingProducts ?? []) {
    const informationField = `Sản phẩm cần bổ sung giá #${informationNeeded.length + 1}: ${name}`;
    informationNeeded.push(informationField);
    lines.push({
      catalogItemId: `supplemental:${randomUUID()}`, source: "supplemental", supplementalFor: informationField, sku: "", name,
      description: "Cần bổ sung đơn giá", quantity: 1, unit: "cái", unitPrice: 0,
      priceUnavailable: true, currency: source.currency, catalogAttributes: {}, attributes: {}, lineTotal: 0,
    });
  }
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  return {
    companyId: source.companyId, kind: "estimate", sourceQuote: { id: sourceId, quoteNumber: source.quoteNumber },
    template, idempotencyKey, quoteNumber, requestId: "",
    customerName: source.customerName, customerEmail: source.customerEmail, customerPhone: source.customerPhone ?? "",
    lines, subtotal, taxRate: 0, taxRateConfirmed: true, taxAmount: 0,
    shippingFee: 0, shippingFeeConfirmed: true, total: subtotal, currency: source.currency,
    informationNeeded, additionalInformation: {}, informationConfirmed: informationNeeded.length === 0,
    status: informationNeeded.length ? "needs_info" : "draft", createdBy, createdAt: now, updatedAt: now,
  };
}
