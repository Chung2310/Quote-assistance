import * as XLSX from "xlsx";
import type { Quote } from "./types.js";

export function makeQuoteExcel(quote: Quote): Buffer {
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
