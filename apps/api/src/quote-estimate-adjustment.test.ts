import test from "node:test";
import assert from "node:assert/strict";
import { applyAdjustment, validateAdjustment } from "./quote-estimate-adjustment.js";
import { estimateFromCustomerQuote } from "./quote-from-customer.js";
import type { Quote } from "./types.js";

const now = new Date("2026-10-23T00:00:00Z");
const source: Quote = {
  companyId: "company-a", kind: "customer", quoteNumber: "BG-001", requestId: "",
  customerName: "Khách A", customerEmail: "", lines: [{ catalogItemId: "item-1", sku: "BAN", name: "Bàn", description: "Gỗ", quantity: 2, unit: "cái", unitPrice: 1_500_000, currency: "VND", attributes: {}, lineTotal: 3_000_000 }],
  subtotal: 3_000_000, taxRate: 0, taxAmount: 0, total: 3_000_000, currency: "VND", informationNeeded: [], informationConfirmed: true,
  status: "approved", createdBy: "owner", createdAt: now, updatedAt: now,
};
const base = () => estimateFromCustomerQuote(source, "source-id", { id: "template-id", originalFilename: "mau.xlsx" }, "BG-002", "key", "sales", now);

test("AI đổi số lượng thì tính lại tiền theo đơn giá gốc", () => {
  const adjusted = applyAdjustment(base(), validateAdjustment({ changes: [{ index: 0, quantity: 4 }], additions: [], questions: [] }, 1));
  assert.equal(adjusted.lines[0]?.unitPrice, 1_500_000);
  assert.equal(adjusted.total, 6_000_000);
  assert.equal(adjusted.status, "draft");
});

test("thay quy cách và thêm sản phẩm thì yêu cầu nhập giá mới", () => {
  const adjusted = applyAdjustment(base(), validateAdjustment({ changes: [{ index: 0, description: "Gỗ óc chó" }], additions: [{ name: "Ghế", quantity: 2, unit: "cái" }], questions: ["Xác nhận kích thước ghế?"] }, 1));
  assert.equal(adjusted.lines.length, 2);
  assert.ok(adjusted.lines.every((line) => line.priceUnavailable && line.unitPrice === 0));
  assert.equal(adjusted.status, "needs_info");
  assert.equal(adjusted.informationNeeded.length, 3);
  assert.match(adjusted.lines[1]!.supplementalFor!, /#2:/);
});

test("từ chối chỉ số dòng không hợp lệ và phương án xóa hết", () => {
  assert.throws(() => validateAdjustment({ changes: [{ index: 2, quantity: 3 }], additions: [], questions: [] }, 1));
  assert.throws(() => applyAdjustment(base(), validateAdjustment({ changes: [{ index: 0, remove: true }], additions: [], questions: [] }, 1)));
});
