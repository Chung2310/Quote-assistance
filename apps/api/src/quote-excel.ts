import * as XLSX from "xlsx";
import { recomputeBudgetPlanTotals, type SavedBudgetPlan } from "./budget-planner.js";
import type { Quote } from "./types.js";

export function makeBudgetPlanExcel(plan: SavedBudgetPlan): Buffer {
  const result = recomputeBudgetPlanTotals(plan.result);
  const rows: Array<Array<string | number>> = [
    ["ĐỀ XUẤT PHƯƠNG ÁN", plan._id?.toHexString() ?? ""],
    ["Ngày tạo", plan.createdAt.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })],
    ["Nhu cầu", plan.input.description],
    ["Phạm vi", result.scope],
    ["Ngân sách dự kiến", plan.input.budget, "VND"],
    [],
    ["STT", "Mã SKU", "Sản phẩm / Dịch vụ", "Lý do đề xuất", "Số lượng", "ĐVT", "Đơn giá", "Thành tiền", "Tiền tệ", "Cơ sở số lượng"],
    ...result.lines.map((line, index) => [
      index + 1, line.sku, line.name, line.reason, line.quantity ?? "", line.unit,
      line.unitPrice, line.lineTotal ?? "", line.currency,
      line.quantity === null ? "Cần xác định" : [line.quantityBasis === "estimated" ? "Ước tính" : "Theo đầu vào", line.quantityNote].filter(Boolean).join(" · "),
    ]),
    [],
    ["", "", "", "", "", "Tạm tính đã biết", "", result.knownTotal ?? "", result.currency],
    ["", "", "", "", "", "Tổng đề xuất", "", result.total ?? "", result.currency],
    ["", "", "", "", "", "Chênh lệch ngân sách", "", result.difference ?? "", "VND"],
  ];
  if (result.total === null || result.difference === null || result.provisional) {
    rows.push(["Lưu ý", "Số liệu tạm tính; cần xác nhận số lượng, hạng mục và đơn vị tiền tệ trước khi dùng làm dự toán chính thức."]);
  }
  const appendList = (heading: string, entries: string[]) => {
    if (entries.length) rows.push([], [heading], ...entries.map((entry) => ["", entry]));
  };
  appendList("THÔNG TIN CẦN LÀM RÕ", result.questions);
  appendList("THÔNG TIN ĐÃ XÁC NHẬN", (result.clarifications ?? []).map(({ question, answer }) => `${question} → ${answer}`));
  appendList("CHƯA CÓ TRONG BẢNG GIÁ", result.missingProducts);
  appendList("GIẢ ĐỊNH TÍNH TOÁN", result.assumptions.map((assumption, index) => `${result.assumptionConfirmations?.[index] ? "Đã xác nhận" : "Chưa xác nhận"}: ${assumption}`));
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 8 }, { wch: 19 }, { wch: 38 }, { wch: 48 }, { wch: 13 }, { wch: 21 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 46 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Đề xuất phương án");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export function budgetPlanAsQuote(plan: SavedBudgetPlan): Quote {
  const result = recomputeBudgetPlanTotals(plan.result);
  const note = [
    `Nhu cầu: ${plan.input.description}`,
    `Phạm vi: ${result.scope}`,
    `Ngân sách dự kiến: ${plan.input.budget.toLocaleString("vi-VN")} VND`,
    ...result.questions.map((item) => `Cần làm rõ: ${item}`),
    ...result.missingProducts.map((item) => `Chưa có trong bảng giá: ${item}`),
    ...result.assumptions.map((item) => `Giả định: ${item}`),
  ].join("\n");
  return {
    kind: "budget",
    companyId: plan.companyId,
    quoteNumber: `PA-${plan._id?.toHexString() ?? ""}`,
    requestId: "",
    customerName: "Phương án tư vấn",
    customerEmail: "",
    lines: result.lines.map((line) => ({
      catalogItemId: line.catalogItemId,
      sku: line.sku,
      name: line.name,
      description: [line.reason, line.quantityNote].filter(Boolean).join(" · "),
      quantity: line.quantity ?? 0,
      quantityUnknown: line.quantity === null,
      unit: line.unit,
      unitPrice: line.unitPrice,
      currency: line.currency,
      attributes: {},
      lineTotal: line.lineTotal ?? 0,
      lineTotalUnknown: line.lineTotal === null,
    })),
    subtotal: result.knownTotal ?? 0,
    subtotalUnknown: result.knownTotal === null,
    taxRate: 0,
    taxAmount: 0,
    total: result.total ?? result.knownTotal ?? 0,
    totalUnknown: result.total === null,
    currency: result.currency,
    informationNeeded: [],
    additionalInformation: { "Thông tin phương án": note },
    informationConfirmed: false,
    status: "draft",
    createdBy: plan.createdBy,
    createdAt: plan.createdAt,
    updatedAt: plan.createdAt,
  };
}

export function makeQuoteExcel(quote: Quote): Buffer {
  if (quote.kind === "customer") {
    const rows: Array<Array<string | number>> = [
      ["DANH SÁCH SẢN PHẨM CẦN DÙNG", quote.quoteNumber],
      ["Khách hàng", quote.customerName],
      ["Email", quote.customerEmail],
      ["Điện thoại", quote.customerPhone ?? ""],
      [],
      ["STT", "Sản phẩm, dịch vụ", "ĐVT", "Đơn giá"],
      ...quote.lines.map((line, index) => [index + 1, line.name, line.unit, line.priceUnavailable ? "" : line.unitPrice]),
    ];
    if (quote.missingProducts?.length) rows.push([], ["CHƯA CÓ TRONG DANH MỤC"], ...quote.missingProducts.map((name) => ["", name]));
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [{ wch: 8 }, { wch: 48 }, { wch: 12 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Sản phẩm cần dùng");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  }
  const rows: Array<Array<string | number>> = [
    ["BÁO GIÁ", quote.quoteNumber],
    ["Khách hàng", quote.customerName],
    ["Email", quote.customerEmail],
    ["Điện thoại", quote.customerPhone ?? ""],
    [],
    ["STT", "Mã hàng", "Sản phẩm", "Mô tả", "Số lượng", "Đơn vị", "Đơn giá", "Thành tiền"],
    ...quote.lines.map((line, index) => [index + 1, line.sku, line.name, line.description ?? "", line.quantity, line.unit, line.unitPrice, line.lineTotal]),
    [],
    ["", "", "", "", "", "Tạm tính", "", quote.subtotal],
    ["", "", "", "", "", "VAT", "", quote.taxAmount],
    ["", "", "", "", "", "Phí vận chuyển", "", quote.shippingFee ?? 0],
    ["", "", "", "", "", "Tổng cộng", quote.currency, quote.total],
  ];
  if (quote.informationNeeded.length) {
    rows.push([], ["Thông tin cần kiểm tra"]);
    rows.push(...quote.informationNeeded.map((field) => [field, quote.additionalInformation?.[field] ?? ""]));
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 8 }, { wch: 18 }, { wch: 38 }, { wch: 42 }, { wch: 13 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Báo giá");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
