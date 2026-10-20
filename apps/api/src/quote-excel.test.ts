import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { makeQuoteExcel } from "./quote-excel.js";
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
