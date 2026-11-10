import assert from "node:assert/strict";
import test from "node:test";
import { quoteHasApprovalBlockers } from "./quote-approval.js";
import { isSupplementalQuestion } from "./quote-terms.js";
import type { Quote } from "./types.js";

function estimate(): Quote {
  return {
    companyId: "company", requestId: "request", quoteNumber: "DT-TEST", kind: "estimate", customerName: "Khách thử nghiệm", customerEmail: "",
    lines: [{ catalogItemId: "product", sku: "SP-01", name: "Vật tư", unit: "bao", quantity: 2, unitPrice: 100000, currency: "VND", attributes: {}, lineTotal: 200000 }],
    subtotal: 200000, taxRate: .08, taxRateConfirmed: true, taxAmount: 16000, shippingFee: 0, shippingFeeConfirmed: true, total: 216000, currency: "VND",
    informationNeeded: ["Câu hỏi bổ sung: Chọn màu nào?", "Câu hỏi bổ sung: Giao vào buổi sáng hay chiều?"], additionalInformation: {}, informationConfirmed: false,
    status: "needs_info", createdBy: "user", createdAt: new Date(), updatedAt: new Date(),
  };
}

test("unanswered supplemental questions allow approval and an approved estimate remains eligible for a contract", () => {
  const quote = estimate(); const before = structuredClone(quote);
  assert.equal(quoteHasApprovalBlockers(quote), false);
  assert.deepEqual(quote, before, "approval eligibility must not erase questions or mark them answered");
  quote.status = "approved";
  assert.equal(quoteHasApprovalBlockers(quote), false);
  assert.equal(quote.informationConfirmed, false);
  assert.equal(quote.informationNeeded.length, 2);
});

test("supplemental question classification recognizes accents, case and leading whitespace", () => {
  for (const field of ["Câu hỏi bổ sung: Màu sắc?", " CAU HOI BO SUNG: Điều kiện giao hàng?", "câu hỏi bổ sung: Đơn giá đã gồm VAT?"]) assert.equal(isSupplementalQuestion(field), true);
  for (const field of ["VAT: cần xác nhận thuế suất.", "Phí vận chuyển: cần xác nhận.", "Sản phẩm cần bổ sung giá: Ghế"]) assert.equal(isSupplementalQuestion(field), false);
});

test("unconfirmed VAT and shipping still block approval even when all remaining questions are supplemental", () => {
  assert.equal(quoteHasApprovalBlockers({ ...estimate(), taxRateConfirmed: false }), true);
  assert.equal(quoteHasApprovalBlockers({ ...estimate(), shippingFeeConfirmed: false }), true);
  const legacy = estimate(); delete legacy.taxRateConfirmed; delete legacy.shippingFeeConfirmed;
  assert.equal(quoteHasApprovalBlockers(legacy), false);
  legacy.informationNeeded.push("VAT: cần xác nhận thuế suất.");
  assert.equal(quoteHasApprovalBlockers(legacy), true);
  legacy.informationNeeded = ["Phí vận chuyển: cần xác nhận."]; legacy.shippingFee = null;
  assert.equal(quoteHasApprovalBlockers(legacy), true);
});

test("missing product prices remain blocking, including a missing price without a matching information field", () => {
  const quote = estimate(); const field = "Sản phẩm cần bổ sung giá: Ghế";
  quote.informationNeeded.push(field);
  assert.equal(quoteHasApprovalBlockers(quote), true);
  quote.lines.push({ ...quote.lines[0]!, catalogItemId: "supplemental:chair", source: "supplemental", supplementalFor: field, name: "Ghế", priceUnavailable: true });
  assert.equal(quoteHasApprovalBlockers(quote), true);
  quote.lines[1]!.priceUnavailable = false;
  assert.equal(quoteHasApprovalBlockers(quote), false);
  quote.informationNeeded = [];
  quote.lines[0]!.priceUnavailable = true;
  assert.equal(quoteHasApprovalBlockers(quote), true);
});

test("new clarifications requiring recalculation cannot approve stale values", () => {
  const quote = estimate(); quote.requiresAiRecalculation = true;
  quote.additionalInformation = { [quote.informationNeeded[0]!]: "Màu trắng" };
  assert.equal(quoteHasApprovalBlockers(quote), true);
  quote.requiresAiRecalculation = false;
  assert.equal(quoteHasApprovalBlockers(quote), false);
});

test("other required information must still be supplied", () => {
  const quote = estimate(); const field = "Địa điểm: cần xác nhận";
  quote.informationNeeded.push(field);
  assert.equal(quoteHasApprovalBlockers(quote), true);
  quote.additionalInformation = { [field]: "Hà Nội" };
  assert.equal(quoteHasApprovalBlockers(quote), false);
});
