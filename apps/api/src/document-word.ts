import PizZip from "pizzip";
import type { AcceptanceRecord, Contract } from "./types.js";
import { makeStyledContractWord } from "./contract-word.js";

function escapeXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function paragraph(value: unknown, bold = false) {
  const content = String(value ?? "").split(/\r?\n/).map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("<w:br/>");
  return `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}${content}</w:r></w:p>`;
}

function table(rows: unknown[][]) {
  return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}

function money(value: number | undefined, currency = "VND") {
  return value === undefined ? "[Thành tiền]" : `${value.toLocaleString("vi-VN")} ${currency}`;
}

export function makeDocumentWord(kind: "contract" | "acceptance", contract?: Contract, record?: AcceptanceRecord): Buffer {
  if (kind === "contract") return makeStyledContractWord(contract);
  return makeLegacyDocumentWord(kind, contract, record);
}

function makeLegacyDocumentWord(kind: "contract" | "acceptance", contract?: Contract, record?: AcceptanceRecord): Buffer {
  const blank = (label: string) => `[${label}]`;
  const company = contract?.companyName || blank("Tên đơn vị thực hiện");
  const customer = contract?.customerName || blank("Tên khách hàng");
  const title = kind === "contract" ? "HỢP ĐỒNG" : "BIÊN BẢN NGHIỆM THU VÀ BÀN GIAO";
  const lines = contract?.lines ?? [];
  const body = [
    paragraph(company.toUpperCase(), true),
    paragraph("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", true),
    paragraph("Độc lập - Tự do - Hạnh phúc"),
    paragraph(title, true),
    paragraph(`Số: ${kind === "contract" ? contract?.contractNumber || blank("Số hợp đồng") : record?.acceptanceNumber || blank("Số biên bản")}`),
    ...(kind === "contract" && contract?.status === "draft" || kind === "acceptance" && record?.status === "draft" ? [paragraph("BẢN NHÁP", true)] : []),
    paragraph(kind === "contract" ? `Căn cứ dự toán: ${contract?.quoteNumber || blank("Số dự toán")}` : `Căn cứ hợp đồng: ${contract?.contractNumber || blank("Số hợp đồng")}`),
    paragraph(kind === "contract" ? `${contract?.status === "draft" ? "Ngày ký dự kiến" : "Ngày ký"}: ${contract?.signedDate || blank("Ngày ký")}; tại: ${contract?.signingPlace || blank("Địa điểm ký")}` : `Ngày nghiệm thu: ${record?.acceptedDate || blank("Ngày nghiệm thu")}; tại: ${record?.location || blank("Địa điểm nghiệm thu")}`),
    paragraph(`Công trình / dự án: ${contract?.projectName || blank("Tên công trình")}`),
    paragraph(`Địa điểm thực hiện: ${contract?.projectAddress || blank("Địa điểm công trình")}`),
    paragraph("BÊN A - KHÁCH HÀNG", true),
    paragraph(`Tên: ${customer}; Đại diện: ${contract?.customerRepresentative || blank("Đại diện Bên A")}`),
    paragraph(`Địa chỉ: ${contract?.customerAddress || blank("Địa chỉ Bên A")}; MST: ${contract?.customerTaxId || blank("MST Bên A")}`),
    paragraph(`Điện thoại: ${contract?.customerPhone || blank("Điện thoại Bên A")}; Email: ${contract?.customerEmail || blank("Email Bên A")}`),
    paragraph("BÊN B - ĐƠN VỊ THỰC HIỆN", true),
    paragraph(`Tên: ${company}; Đại diện: ${contract?.companyRepresentative || blank("Đại diện Bên B")}`),
    paragraph(`Địa chỉ: ${contract?.companyAddress || blank("Địa chỉ Bên B")}; MST: ${contract?.companyTaxId || blank("MST Bên B")}`),
    paragraph(`Điện thoại: ${contract?.companyPhone || blank("Điện thoại Bên B")}; Email: ${contract?.companyEmail || blank("Email Bên B")}`),
  ];
  if (kind === "contract") {
    body.push(paragraph("ĐIỀU 1. PHẠM VI CÔNG VIỆC", true), paragraph(contract?.scope || blank("Phạm vi công việc")));
    body.push(paragraph(`Hồ sơ / sản phẩm bàn giao: ${contract?.deliverables || blank("Danh mục, định dạng và số lượng bàn giao")}`));
    body.push(paragraph("ĐIỀU 2. GIÁ TRỊ HỢP ĐỒNG", true));
    body.push(table([
      ["STT", "Hạng mục", "ĐVT", "Khối lượng", "Đơn giá", "Thành tiền"],
      ...(lines.length ? lines.map((line, index) => [index + 1, line.name, line.unit, line.quantity, money(line.unitPrice, contract?.currency), money(line.lineTotal, contract?.currency)]) : [[1, blank("Hạng mục"), blank("ĐVT"), blank("Khối lượng"), blank("Đơn giá"), blank("Thành tiền")]]),
    ]));
    body.push(paragraph(`Tạm tính: ${money(contract?.subtotal, contract?.currency)}`));
    body.push(paragraph(`VAT (${contract?.taxRate === undefined ? blank("Thuế suất") : `${contract.taxRate * 100}%`}): ${money(contract?.taxAmount, contract?.currency)}`));
    body.push(paragraph(`Vận chuyển: ${money(contract?.shippingFee, contract?.currency)}`));
    body.push(paragraph(`Tổng giá trị hợp đồng: ${money(contract?.total, contract?.currency)}`, true));
    body.push(paragraph("ĐIỀU 3. TẠM ỨNG VÀ THANH TOÁN", true));
    body.push(paragraph(`Đặt cọc / tạm ứng: ${money(contract?.depositAmount, contract?.currency)}`));
    body.push(paragraph(`Số tiền dự kiến còn thanh toán: ${money(contract ? contract.total - (contract.depositAmount ?? 0) : undefined, contract?.currency)}`));
    body.push(paragraph(`Thông tin tài khoản: ${contract?.bankDetails || blank("Ngân hàng, chủ tài khoản, số tài khoản")}`));
    body.push(paragraph(contract?.paymentTerms || blank("Điều khoản thanh toán")));
    body.push(paragraph("ĐIỀU 4. TIẾN ĐỘ VÀ BÀN GIAO", true), paragraph(contract?.deliveryTerms || blank("Tiến độ và điều kiện bàn giao")));
    body.push(paragraph("ĐIỀU 5. ĐIỀU KHOẢN BỔ SUNG", true), paragraph(contract?.otherTerms || blank("Quyền và nghĩa vụ; bất khả kháng; giải quyết tranh chấp; hiệu lực hợp đồng")));
  } else {
    body.push(paragraph("1. THỜI GIAN NGHIỆM THU", true));
    body.push(paragraph(`Bắt đầu: ${record?.startTime || blank("Giờ bắt đầu")}; kết thúc: ${record?.endTime || blank("Giờ kết thúc")}`));
    body.push(paragraph("2. ĐÁNH GIÁ HỒ SƠ / CÔNG VIỆC VÀ BÀN GIAO", true));
    body.push(paragraph(`Hồ sơ / sản phẩm bàn giao: ${record?.handoverDetails || blank("Danh mục, định dạng và số lượng hồ sơ bàn giao")}`));
    body.push(paragraph(`Đánh giá chất lượng: ${record?.qualityAssessment || blank("Đánh giá chất lượng")}`));
    body.push(table([
      ["STT", "Hạng mục", "ĐVT", "Khối lượng HĐ", "Khối lượng NT", "Đơn giá", "Giá trị NT"],
      ...(lines.length ? lines.map((line, index) => [index + 1, line.name, line.unit, line.quantity, record?.lines[index]?.acceptedQuantity ?? blank("Khối lượng NT"), money(line.unitPrice, contract?.currency), record ? money((record.lines[index]?.acceptedQuantity ?? 0) * line.unitPrice, contract?.currency) : blank("Giá trị NT")]) : [[1, blank("Hạng mục"), blank("ĐVT"), blank("Khối lượng HĐ"), blank("Khối lượng NT"), blank("Đơn giá"), blank("Giá trị NT")]]),
    ]));
    if (record && contract) body.push(paragraph(`Tổng giá trị hạng mục nghiệm thu trước thuế: ${money(contract.lines.reduce((sum, line, index) => sum + (record.lines[index]?.acceptedQuantity ?? 0) * line.unitPrice, 0), contract.currency)}`, true));
    body.push(paragraph("3. GIÁ TRỊ QUYẾT TOÁN", true));
    body.push(paragraph(`Giá trị quyết toán: ${money(record?.settlementAmount, contract?.currency)}`));
    body.push(paragraph(`Đã thanh toán / đặt cọc: ${money(record?.amountPaid, contract?.currency)}`));
    body.push(paragraph(`Còn phải thanh toán: ${money(record && Number.isFinite(record.settlementAmount) && Number.isFinite(record.amountPaid) ? record.settlementAmount - record.amountPaid : undefined, contract?.currency)}`, true));
    body.push(paragraph(`Thời hạn thanh toán còn lại: ${record?.paymentDueDays == null ? blank("Số ngày") : record.paymentDueDays} ngày`));
    body.push(paragraph("4. KẾT LUẬN", true));
    body.push(paragraph(`Kết quả nghiệm thu: ${record?.result || blank("Kết quả nghiệm thu")}`, true));
    body.push(paragraph(`Ghi chú / tồn tại: ${record?.notes || blank("Ghi chú")}`));
  }
  body.push(paragraph("ĐẠI DIỆN BÊN A                                      ĐẠI DIỆN BÊN B", true));
  body.push(paragraph("Ký, ghi rõ họ tên                                        Ký, ghi rõ họ tên"));
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder("_rels")!.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")!.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
