import test from "node:test";
import assert from "node:assert/strict";
import { applyAdjustment, recalculateEstimateWithClarifications, validateAdjustment } from "./quote-estimate-adjustment.js";
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

test("quy đổi yêu cầu diện tích thành số bao tối thiểu bằng quy cách gốc", () => {
  const estimate = base();
  estimate.lines = [{ ...estimate.lines[0]!, name: "Vữa chống thấm", unit: "bao", description: "Bao 25kg", catalogAttributes: { "Mật độ phủ": "2.5-3.5 m²", "Độ dày": "5-7mm" }, unitPrice: 100_000 }];
  const adjusted = applyAdjustment(estimate, validateAdjustment({ changes: [{ index: 0, quantity: 100 }], additions: [], questions: [] }, 1), "Vữa chống thấm dùng cho 100 m²");
  assert.equal(adjusted.lines[0]?.quantity, 29);
  assert.equal(adjusted.total, 2_900_000);
  assert.match(adjusted.lines[0]?.attributes["Cách tính số lượng"] ?? "", /không cộng hao hụt/);
});

test("không dùng số lượng AI đoán nếu định mức chưa đủ để quy đổi", () => {
  const estimate = base();
  estimate.lines = [{ ...estimate.lines[0]!, name: "Vữa chống thấm", unit: "bao", description: "Bao 25kg", catalogAttributes: { "Định mức": "Độ dày 5-7mm" } }];
  const adjusted = applyAdjustment(estimate, validateAdjustment({ changes: [{ index: 0, quantity: 100 }], additions: [], questions: [] }, 1), "Vữa chống thấm dùng cho 100 m²");
  assert.equal(adjusted.lines[0]?.quantity, estimate.lines[0]?.quantity);
  assert.equal(adjusted.status, "needs_info");
  assert.match(adjusted.informationNeeded.join(" "), /định mức/);
});

test("chỉ quy đổi dòng đang được yêu cầu thay đổi", () => {
  const estimate = base();
  estimate.lines = [
    { ...estimate.lines[0]!, name: "Vữa chống thấm", unit: "bao", catalogAttributes: { "Độ phủ": "3.5 m²/bao" } },
    { ...estimate.lines[0]!, catalogItemId: "item-2", name: "Sơn", unit: "thùng", quantity: 4, catalogAttributes: { "Độ phủ": "100 m²/thùng" } },
  ];
  const adjusted = applyAdjustment(estimate, validateAdjustment({ changes: [{ index: 0, quantity: 100 }], additions: [], questions: [] }, 2), "Chỉ sửa Vữa chống thấm cho 100 m², giữ nguyên Sơn");
  assert.equal(adjusted.lines[0]?.quantity, 29);
  assert.equal(adjusted.lines[1]?.quantity, 4);
});

test("điều chỉnh dự toán áp dụng VAT và phí vận chuyển đã nêu rõ, cùng thời hạn", () => {
  const adjusted = applyAdjustment(base(), validateAdjustment({ changes: [{ index: 0, quantity: 4 }], additions: [], questions: [] }, 1), "Lấy 4 cái. VAT 8%, phí vận chuyển cố định 350.000 VND; hiệu lực 15 ngày, hoàn thành trước 20/11/2026.");
  assert.equal(adjusted.subtotal, 6_000_000);
  assert.equal(adjusted.taxRate, 0.08);
  assert.equal(adjusted.taxAmount, 480_000);
  assert.equal(adjusted.shippingFee, 350_000);
  assert.equal(adjusted.total, 6_830_000);
  assert.equal(adjusted.validityDays, 15);
  assert.equal(adjusted.completionDate, "2026-11-20");
  assert.equal(adjusted.informationConfirmed, true);
});

test("giữ thuế suất và vận chuyển khi chỉ đổi số lượng, rồi tính lại tiền thuế", () => {
  const estimate = { ...base(), taxRate: 0.08, taxAmount: 240_000, shippingFee: 350_000, total: 3_590_000 };
  const adjusted = applyAdjustment(estimate, validateAdjustment({ changes: [{ index: 0, quantity: 5 }], additions: [], questions: [] }, 1));
  assert.equal(adjusted.taxAmount, 600_000);
  assert.equal(adjusted.total, 8_450_000);
});

test("không đoán mức VAT, phí chưa rõ hoặc tự đổi tiền tệ", () => {
  const unchanged = validateAdjustment({ changes: [], additions: [], questions: [] }, 1);
  const unclear = applyAdjustment(base(), unchanged, "VAT 8% hoặc 10%; phí vận chuyển chưa xác nhận.");
  assert.equal(unclear.status, "needs_info");
  assert.equal(unclear.taxRateConfirmed, false);
  assert.equal(unclear.shippingFeeConfirmed, false);
  const foreign = applyAdjustment(base(), unchanged, "Phí vận chuyển 10 USD");
  assert.equal(foreign.shippingFeeConfirmed, false);
  assert.equal(foreign.status, "needs_info");
});

test("không cộng thuế lần nữa khi yêu cầu nói đơn giá đã bao gồm VAT", () => {
  const adjusted = applyAdjustment(base(), validateAdjustment({ changes: [], additions: [], questions: [] }, 1), "Đơn giá đã bao gồm VAT 8%.");
  assert.equal(adjusted.taxRateConfirmed, false);
  assert.equal(adjusted.status, "needs_info");
  assert.equal(adjusted.taxAmount, 0);
});

test("không nhầm phần trăm đặt cọc với thuế suất VAT", () => {
  const adjusted = applyAdjustment(base(), validateAdjustment({ changes: [], additions: [], questions: [] }, 1), "VAT 8%, đặt cọc 30%, phí vận chuyển 350.000 VND.");
  assert.equal(adjusted.taxRate, 0.08);
  assert.equal(adjusted.taxRateConfirmed, true);
  assert.equal(adjusted.total, 3_590_000);
});

test("tính lại dùng toàn bộ câu trả lời, thông số và dữ liệu mới mà không áp lại diện tích, VAT, vận chuyển cũ", async () => {
  const estimate = base();
  estimate.lines = [{ ...estimate.lines[0]!, name: "Vữa chống thấm", unit: "bao", description: "Bao 25kg", quantity: 29, unitPrice: 100_000,
    catalogAttributes: { "Mật độ phủ": "2.5-3.5 m²", "Độ dày": "5-7mm" } }];
  estimate.sourceRequirements = "Dùng cho 100 m²; VAT 10%; phí vận chuyển 350.000 VND.";
  estimate.revisionRequirements = "Chỉ tính số bao tối thiểu, không cộng hao hụt.";
  estimate.additionalInformation = { "Câu hỏi bổ sung: Diện tích thực tế?": "50 m²", "Câu hỏi bổ sung: VAT 8% hay 10%?": "8%", "Câu hỏi bổ sung: Phí vận chuyển?": "300.000 VND" };
  estimate.informationNeeded = Object.keys(estimate.additionalInformation);
  let calls = 0;
  const result = await recalculateEstimateWithClarifications(estimate, estimate.sourceRequirements, async (messages) => {
    calls++;
    const payload = JSON.parse(messages.find((message) => message.role === "user")!.content);
    assert.equal(payload.clarifications.length, 3);
    assert.equal(payload.originalRequest, estimate.sourceRequirements);
    assert.equal(payload.revisionRequirements, estimate.revisionRequirements);
    assert.deepEqual(payload.lines[0].catalogAttributes, estimate.lines[0]!.catalogAttributes);
    assert.equal(payload.lines[0].quantity, 29);
    return { changes: [{ index: 0, quantity: 999, quantityRequirement: { quantity: 50, unit: "m²", evidence: "50 m²" } }], additions: [], questions: [] };
  });
  assert.equal(calls, 1);
  assert.equal(result.lines[0]!.quantity, 15);
  assert.equal(result.taxRate, 0.08);
  assert.equal(result.shippingFee, 300_000);
  assert.equal(result.total, 1_920_000);
  assert.deepEqual(result.informationNeeded, []);
  assert.deepEqual(result.additionalInformation, estimate.additionalInformation);
  assert.equal(result.requiresAiRecalculation, false);
  assert.equal(estimate.lines[0]!.quantity, 29);
});

test("sửa câu trả lời rồi chạy lại tiếp sẽ dùng diện tích mới và giữ điều khoản hiện tại", async () => {
  const estimate = base();
  estimate.lines = [{ ...estimate.lines[0]!, name: "Vữa chống thấm", unit: "bao", quantity: 15, unitPrice: 100_000, catalogAttributes: { "Độ phủ": "3.5 m²/bao" } }];
  estimate.additionalInformation = { "Câu hỏi bổ sung: Diện tích?": "70 m²" };
  estimate.taxRate = 0.08;
  estimate.shippingFee = 300_000;
  const result = await recalculateEstimateWithClarifications(estimate, "Ban đầu 100 m²; VAT 10%; phí vận chuyển 350.000 VND.", async () => ({ changes: [{ index: 0, quantity: 999, quantityRequirement: { quantity: 70, unit: "m²", evidence: "70 m²" } }], additions: [], questions: [] }));
  assert.equal(result.lines[0]!.quantity, 20);
  assert.equal(result.total, 2_460_000);
});

test("câu hỏi chưa trả lời và khoản chưa xác nhận vẫn cần bổ sung sau khi tính lại", async () => {
  const estimate = base();
  estimate.informationNeeded = ["Câu hỏi bổ sung: Diện tích?", "Câu hỏi bổ sung: Thời gian giao hàng?"];
  estimate.additionalInformation = { "Câu hỏi bổ sung: Diện tích?": "50 m²" };
  estimate.taxRateConfirmed = false;
  estimate.shippingFeeConfirmed = false;
  const result = await recalculateEstimateWithClarifications(estimate, "", async () => ({ changes: [], additions: [], questions: [] }));
  assert.equal(result.status, "needs_info");
  assert.equal(result.informationConfirmed, false);
  assert.ok(result.informationNeeded.includes("Câu hỏi bổ sung: Thời gian giao hàng?"));
  assert.ok(!result.informationNeeded.includes("Câu hỏi bổ sung: Diện tích?"));
  assert.ok(result.informationNeeded.some((field) => field.startsWith("VAT:")));
  assert.ok(result.informationNeeded.some((field) => field.startsWith("Phí vận chuyển:")));
});

test("chạy lại giữ nguyên mã dòng chưa biết giá, không biến giá trống thành miễn phí", async () => {
  const estimate = base();
  estimate.lines[0] = { ...estimate.lines[0]!, catalogItemId: "supplemental:pending", source: "supplemental", priceUnavailable: true, unitPrice: 0, lineTotal: 0, supplementalFor: "Sản phẩm cần bổ sung giá: Bàn" };
  estimate.informationNeeded = [estimate.lines[0]!.supplementalFor!];
  const result = await recalculateEstimateWithClarifications(estimate, "", async () => ({ changes: [{ index: 0, quantity: 4 }], additions: [], questions: [] }));
  assert.equal(result.lines[0]!.catalogItemId, "supplemental:pending");
  assert.equal(result.lines[0]!.priceUnavailable, true);
  assert.equal(result.status, "needs_info");
  assert.equal(result.lines[0]!.quantity, 4);
});

test("kết quả AI sai không sửa dữ liệu đang có, kể cả sau lần thử lại", async () => {
  const estimate = base();
  const before = structuredClone(estimate);
  let calls = 0;
  await assert.rejects(recalculateEstimateWithClarifications(estimate, "", async () => {
    calls++;
    return { changes: [{ index: 99, quantity: 4 }], additions: [], questions: [] };
  }), /tham chiếu/);
  assert.equal(calls, 2);
  assert.deepEqual(estimate, before);
});

test("yêu cầu cập nhật tự do có thể trả lời câu hỏi bằng trích dẫn đúng nội dung mới", async () => {
  const estimate = base();
  const question = "Câu hỏi bổ sung: Thời gian giao hàng?";
  estimate.informationNeeded = [question];
  estimate.revisionRequirements = "Giao hàng vào sáng thứ hai.";
  const result = await recalculateEstimateWithClarifications(estimate, "", async () => ({ changes: [], additions: [], questions: [], resolvedQuestions: [{ question, evidence: "sáng thứ hai" }] }));
  assert.equal(result.additionalInformation?.[question], "sáng thứ hai");
  assert.equal(result.status, "draft");
  await assert.rejects(recalculateEstimateWithClarifications(estimate, "", async () => ({ changes: [], additions: [], questions: [], resolvedQuestions: [{ question, evidence: "thứ ba" }] })), /không nằm/);
});

test("lần chạy tiếp phân biệt lệnh mới với lệnh đã áp dụng, giữ VAT và vận chuyển người dùng sửa trực tiếp", async () => {
  const estimate = base();
  estimate.additionalInformation = { "Câu hỏi bổ sung: VAT?": "8%", "Câu hỏi bổ sung: Phí vận chuyển?": "300.000 VND" };
  estimate.revisionRequirements = "Thêm 2 ghế.";
  estimate.aiAppliedInputs = { revisionRequirements: estimate.revisionRequirements, additionalInformation: { ...estimate.additionalInformation } };
  estimate.taxRate = 0.1;
  estimate.shippingFee = 400_000;
  const result = await recalculateEstimateWithClarifications(estimate, "VAT 5%", async (messages) => {
    const payload = JSON.parse(messages.find((message) => message.role === "user")!.content);
    assert.deepEqual(payload.newClarifications, []);
    assert.equal(payload.newRevisionRequirements, "");
    return { changes: [], additions: [], questions: [] };
  });
  assert.equal(result.lines.length, 1);
  assert.equal(result.taxRate, 0.1);
  assert.equal(result.shippingFee, 400_000);
  assert.equal(result.total, 3_700_000);
});

test("câu trả lời miễn phí vận chuyển được hiểu là 0, không giữ phí cũ", async () => {
  const estimate = base();
  estimate.shippingFee = 350_000;
  estimate.additionalInformation = { "Câu hỏi bổ sung: Phí vận chuyển?": "Miễn phí" };
  const result = await recalculateEstimateWithClarifications(estimate, "", async () => ({ changes: [], additions: [], questions: [] }));
  assert.equal(result.shippingFee, 0);
  assert.equal(result.shippingFeeConfirmed, true);
  assert.equal(result.total, 3_000_000);
});
