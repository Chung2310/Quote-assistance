import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { ObjectId } from "mongodb";
import { makeBudgetPlanExcel, makeQuoteExcel } from "./quote-excel.js";
import type { SavedBudgetPlan } from "./budget-planner.js";
import type { Quote } from "./types.js";

test("xuất Excel nháp khi báo giá chưa có sản phẩm và còn thiếu thông tin", () => {
  const quote = {
    quoteNumber: "BG-2026-00001",
    companyId: "company",
    requestId: "request",
    customerName: "Khách hàng chưa xác định",
    customerEmail: "",
    lines: [],
    subtotal: 0,
    taxRate: 0,
    taxAmount: 0,
    shippingFee: null,
    total: 0,
    currency: "VND",
    informationNeeded: ["Chưa có sản phẩm trong báo giá."],
    informationConfirmed: false,
    status: "needs_info",
    createdBy: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies Quote;
  const workbook = XLSX.read(makeQuoteExcel(quote), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Báo giá"], { header: 1 });
  assert.deepEqual(rows[0], ["BÁO GIÁ", "BG-2026-00001"]);
  assert.ok(rows.some((row) => row[0] === "Chưa có sản phẩm trong báo giá."));
  assert.ok(rows.some((row) => row[5] === "Tổng cộng" && row[7] === 0));
});

test("báo giá khách xuất tên, ĐVT và đơn giá nhưng không tính thành tiền", () => {
  const quote = {
    kind: "customer",
    quoteNumber: "BG-2026-00002",
    companyId: "company",
    requestId: "",
    customerName: "Khách xây nhà",
    customerEmail: "",
    missingProducts: ["Cát xây dựng"],
    lines: [{ catalogItemId: "item", sku: "VL-01", name: "Xi măng", quantity: 12, unit: "bao", unitPrice: 90000, currency: "VND", attributes: {}, lineTotal: 1080000 }],
    subtotal: 1080000,
    taxRate: 0,
    taxAmount: 0,
    total: 1080000,
    currency: "VND",
    informationNeeded: [],
    informationConfirmed: true,
    status: "approved",
    createdBy: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies Quote;
  const workbook = XLSX.read(makeQuoteExcel(quote), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Sản phẩm cần dùng"], { header: 1 });
  assert.deepEqual(rows[5], ["STT", "Sản phẩm, dịch vụ", "ĐVT", "Đơn giá"]);
  assert.deepEqual(rows[6], [1, "Xi măng", "bao", 90000]);
  assert.ok(rows.some((row) => row[0] === "CHƯA CÓ TRONG DANH MỤC"));
  assert.ok(rows.some((row) => row[1] === "Cát xây dựng"));
  assert.ok(!rows.flat().some((value) => ["Số lượng", "Thành tiền", "Tạm tính", "Tổng cộng", 1080000, 12].includes(value)));
});

test("phương án Excel giữ dòng chưa rõ số lượng và các sản phẩm còn thiếu", () => {
  const plan: SavedBudgetPlan = {
    _id: new ObjectId("507f1f77bcf86cd799439011"),
    companyId: "company",
    createdBy: "user",
    createdAt: new Date("2026-10-22T00:00:00Z"),
    input: { description: "Lắp PC chơi game", budget: 25_000_000 },
    result: {
      scope: "PC chơi game", budget: 25_000_000, currency: "VND",
      lines: [{ catalogItemId: "item", sku: "GPU-01", name: "Card đồ họa", unit: "cái", unitPrice: 8_000_000, currency: "VND", quantity: null, lineTotal: null, reason: "Chơi game 1080p" }],
      knownTotal: 0, total: null, difference: null,
      questions: ["Cần xác nhận số lượng card đồ họa."],
      missingProducts: ["Nguồn máy tính"], assumptions: ["Một bộ máy"], assumptionConfirmations: [true],
      clarifications: [{ question: "Dùng màn hình cũ?", answer: "Có" }],
    },
  };
  const workbook = XLSX.read(makeBudgetPlanExcel(plan), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets["Đề xuất phương án"], { header: 1 });
  assert.deepEqual(rows[6], ["STT", "Mã SKU", "Sản phẩm / Dịch vụ", "Lý do đề xuất", "Số lượng", "ĐVT", "Đơn giá", "Thành tiền", "Tiền tệ", "Cơ sở số lượng"]);
  assert.equal(rows[7][1], "GPU-01");
  assert.equal(rows[7][4], "");
  assert.equal(rows[7][7], "");
  assert.equal(rows[7][9], "Cần xác định");
  assert.ok(rows.some((row) => row[0] === "CHƯA CÓ TRONG BẢNG GIÁ"));
  assert.ok(rows.some((row) => row[1] === "Nguồn máy tính"));
  assert.ok(rows.some((row) => row[1] === "Cần xác nhận số lượng card đồ họa."));
  assert.ok(rows.some((row) => row[1] === "Dùng màn hình cũ? → Có"));
  assert.ok(rows.some((row) => row[1] === "Đã xác nhận: Một bộ máy"));
});
