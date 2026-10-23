import test from "node:test";
import assert from "node:assert/strict";
import { estimateFromCustomerQuote } from "./quote-from-customer.js";
import type { Quote } from "./types.js";

test("tạo dự toán mới từ báo giá khách giữ đơn giá và tính lại thành tiền", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  const source: Quote = {
    companyId: "company-a", kind: "customer", quoteNumber: "BG-001", requestId: "",
    customerName: "Khách A", customerEmail: "a@example.com", customerPhone: "0123456789",
    lines: [{ catalogItemId: "item-1", sku: "SP-01", name: "Bàn", quantity: 2, unit: "cái", unitPrice: 1500000, currency: "VND", attributes: {}, lineTotal: 0 }],
    subtotal: 0, taxRate: 0, taxAmount: 0, total: 0, currency: "VND", informationNeeded: [], informationConfirmed: true,
    status: "approved", createdBy: "owner", createdAt: now, updatedAt: now,
  };
  const estimate = estimateFromCustomerQuote(source, "source-id", { id: "template-id", originalFilename: "mau.xlsx" }, "BG-002", "request-key", "sales", now);
  assert.equal(estimate.kind, "estimate");
  assert.equal(estimate.sourceQuote?.id, "source-id");
  assert.equal(estimate.quoteNumber, "BG-002");
  assert.equal(estimate.status, "draft");
  assert.equal(estimate.customerName, "Khách A");
  assert.equal(estimate.lines[0]?.unitPrice, 1500000);
  assert.equal(estimate.lines[0]?.lineTotal, 3000000);
  assert.equal(estimate.subtotal, 3000000);
  assert.equal(estimate.total, 3000000);
  assert.equal(source.lines[0]?.lineTotal, 0);
});

test("sản phẩm chưa có trong danh mục vẫn được đưa vào dự toán để bổ sung giá", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  const source: Quote = {
    companyId: "company-a", kind: "customer", quoteNumber: "BG-001", requestId: "",
    customerName: "Khách A", customerEmail: "", lines: [], missingProducts: ["Tủ theo yêu cầu"],
    subtotal: 0, taxRate: 0, taxAmount: 0, total: 0, currency: "VND", informationNeeded: [], informationConfirmed: true,
    status: "draft", createdBy: "owner", createdAt: now, updatedAt: now,
  };
  const estimate = estimateFromCustomerQuote(source, "source-id", { id: "template-id", originalFilename: "mau.xlsx" }, "BG-002", "request-key", "sales", now);
  assert.equal(estimate.lines.length, 1);
  assert.equal(estimate.lines[0]?.name, "Tủ theo yêu cầu");
  assert.equal(estimate.lines[0]?.source, "supplemental");
  assert.equal(estimate.lines[0]?.priceUnavailable, true);
  assert.equal(estimate.status, "needs_info");
  assert.equal(estimate.informationNeeded.length, 1);
  assert.equal(estimate.lines[0]?.supplementalFor, estimate.informationNeeded[0]);
});

test("sản phẩm báo giá khách chưa có giá chuyển thành dòng có thể nhập giá", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  const source: Quote = {
    companyId: "company-a", kind: "customer", quoteNumber: "BG-001", requestId: "",
    customerName: "Khách A", customerEmail: "",
    lines: [{ catalogItemId: "item-1", sku: "SP-01", name: "Tủ", quantity: 1, unit: "cái", unitPrice: 0, priceUnavailable: true, currency: "VND", attributes: {}, lineTotal: 0 }],
    subtotal: 0, taxRate: 0, taxAmount: 0, total: 0, currency: "VND", informationNeeded: [], informationConfirmed: true,
    status: "draft", createdBy: "owner", createdAt: now, updatedAt: now,
  };
  const estimate = estimateFromCustomerQuote(source, "source-id", { id: "template-id", originalFilename: "mau.xlsx" }, "BG-002", "request-key", "sales", now);
  assert.equal(estimate.lines[0]?.source, "supplemental");
  assert.equal(estimate.lines[0]?.supplementalFor, estimate.informationNeeded[0]);
  assert.equal(estimate.status, "needs_info");
});
