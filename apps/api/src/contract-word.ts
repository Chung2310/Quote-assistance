import PizZip from "pizzip";
import type { Contract } from "./types.js";

const contentWidth = 10106;
const ink = "263852";
const heading = "153956";
const muted = "65768D";

function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function run(value: unknown, options: { bold?: boolean; size?: number; color?: string } = {}) {
  const properties = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/>${options.bold ? "<w:b/>" : ""}<w:color w:val="${options.color ?? ink}"/><w:sz w:val="${options.size ?? 20}"/><w:lang w:val="vi-VN"/></w:rPr>`;
  return String(value ?? "").split(/\r?\n/).map((line, index) => `<w:r>${properties}${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join("");
}

type ParagraphOptions = { align?: "left" | "center" | "right"; before?: number; after?: number; bold?: boolean; size?: number; color?: string; keepNext?: boolean; borderBottom?: boolean };
function paragraph(value: unknown, options: ParagraphOptions = {}) {
  const pPr = `<w:pPr><w:jc w:val="${options.align ?? "left"}"/><w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 80}" w:line="280" w:lineRule="auto"/>${options.keepNext ? "<w:keepNext/>" : ""}${options.borderBottom ? `<w:pBdr><w:bottom w:val="single" w:sz="5" w:space="6" w:color="DCE7EF"/></w:pBdr>` : ""}</w:pPr>`;
  return `<w:p>${pPr}${run(value, options)}</w:p>`;
}

type Cell = { content: string; width: number; fill?: string; align?: "left" | "center" | "right" };
function cell({ content, width, fill, align }: Cell) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill ? `<w:shd w:fill="${fill}"/>` : ""}<w:vAlign w:val="center"/><w:tcMar><w:top w:w="105" w:type="dxa"/><w:left w:w="115" w:type="dxa"/><w:bottom w:w="105" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tcMar></w:tcPr>${content || paragraph("", { align })}</w:tc>`;
}

function table(rows: Cell[][], widths: number[], options: { border?: boolean; header?: boolean; spacingAfter?: number } = {}) {
  const noBorder = `<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/>`;
  const gridBorder = `<w:top w:val="single" w:sz="4" w:color="DFE8EF"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="4" w:color="DFE8EF"/><w:right w:val="nil"/><w:insideH w:val="single" w:sz="4" w:color="DFE8EF"/><w:insideV w:val="nil"/>`;
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows.map((row, index) => `<w:tr><w:trPr><w:cantSplit/>${index === 0 && options.header ? "<w:tblHeader/>" : ""}</w:trPr>${row.map(cell).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${contentWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${options.border ? gridBorder : noBorder}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${options.spacingAfter ? paragraph("", { after: options.spacingAfter }) : ""}`;
}

function section(label: string) {
  return paragraph(label, { bold: true, size: 23, color: heading, before: 250, after: 150, keepNext: true, borderBottom: true });
}

function field(label: string, value: unknown) {
  return paragraph(`${label}: ${value || "—"}`, { after: 90 });
}

function money(value: number | undefined, currency = "VND") {
  if (value === undefined) return "[Thành tiền]";
  try { return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${new Intl.NumberFormat("vi-VN").format(value)} ${currency}`; }
}

function placeholder(value: unknown, label: string) {
  return value || `[${label}]`;
}

function party(contract: Contract | undefined, side: "customer" | "company") {
  const customer = side === "customer";
  const name = customer ? contract?.customerName : contract?.companyName;
  const representative = customer ? contract?.customerRepresentative : contract?.companyRepresentative;
  const address = customer ? contract?.customerAddress : contract?.companyAddress;
  const taxId = customer ? contract?.customerTaxId : contract?.companyTaxId;
  const email = customer ? contract?.customerEmail : contract?.companyEmail;
  const phone = customer ? contract?.customerPhone : contract?.companyPhone;
  return [
    paragraph(customer ? "Bên A · Khách hàng" : "Bên B · Đơn vị thực hiện", { bold: true, size: 21, color: heading, after: 120 }),
    paragraph(placeholder(name, customer ? "Tên khách hàng" : "Tên đơn vị thực hiện"), { bold: true, after: 80 }),
    field("Đại diện", placeholder(representative, "Người đại diện")),
    field("Địa chỉ", placeholder(address, "Địa chỉ")),
    field("Mã số thuế", taxId || "—"),
    field("Email", email || "—"),
    field("Điện thoại", phone || "—"),
  ].join("");
}

function packageWord(body: string[]) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.folder("_rels")!.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")!.file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`);
  zip.folder("word")!.folder("_rels")!.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("word")!.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="450" w:footer="450"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export function makeStyledContractWord(contract?: Contract): Buffer {
  const company = placeholder(contract?.companyName, "Tên đơn vị thực hiện");
  const widths = [500, 3300, 720, 1100, 1900, 2586];
  const lines = contract?.lines ?? [];
  const body: string[] = [];
  body.push(table([[
    { width: 5053, content: [
      paragraph(String(company).toUpperCase(), { bold: true, size: 20, color: heading, after: 100 }),
      paragraph(contract?.companyAddress || "[Địa chỉ đơn vị]", { size: 17, color: muted, after: 55 }),
      paragraph(`Mã số thuế: ${contract?.companyTaxId || "—"}`, { size: 17, color: muted, after: 0 }),
    ].join("") },
    { width: 5053, content: [
      paragraph("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", { align: "center", bold: true, size: 18, color: heading, after: 100 }),
      paragraph("Độc lập - Tự do - Hạnh phúc", { align: "center", size: 18, after: 0 }),
    ].join("") },
  ]], [5053, 5053], { spacingAfter: 220 }));
  body.push(paragraph("HỢP ĐỒNG", { align: "center", bold: true, size: 36, color: heading, before: 180, after: 90 }));
  body.push(paragraph(`Số: ${placeholder(contract?.contractNumber, "Số hợp đồng")}`, { align: "center", bold: true, size: 21, after: 90 }));
  if (contract?.status === "draft") body.push(paragraph("BẢN NHÁP", { align: "center", bold: true, size: 18, color: muted, after: 80 }));
  body.push(paragraph(`Căn cứ dự toán ${placeholder(contract?.quoteNumber, "Số dự toán")}`, { align: "center", size: 19, color: muted, after: 70 }));
  body.push(paragraph(`${contract?.status === "draft" ? "Ngày ký dự kiến" : "Ngày ký"}: ${placeholder(contract?.signedDate, "Ngày ký")} · Tại: ${placeholder(contract?.signingPlace, "Địa điểm ký")}`, { align: "center", size: 19, color: muted, after: 240 }));
  body.push(table([[
    { width: 5053, fill: "F6F9FC", content: party(contract, "customer") },
    { width: 5053, fill: "F6F9FC", content: party(contract, "company") },
  ]], [5053, 5053], { border: true, spacingAfter: 180 }));
  body.push(table([[{ width: contentWidth, fill: "F8FAFC", content: [
    paragraph("Công trình / dự án", { bold: true, size: 21, color: heading, after: 80 }),
    paragraph(`${placeholder(contract?.projectName, "Tên công trình")} · ${placeholder(contract?.projectAddress, "Địa điểm công trình")}`, { after: 0 }),
  ].join("") }]], [contentWidth], { border: true, spacingAfter: 120 }));
  body.push(section("NỘI DUNG VÀ ĐIỀU KHOẢN"));
  body.push(field("Tên công trình / dự án", placeholder(contract?.projectName, "Tên công trình")));
  body.push(field("Địa điểm thực hiện", placeholder(contract?.projectAddress, "Địa điểm công trình")));
  body.push(field("Địa điểm ký", placeholder(contract?.signingPlace, "Địa điểm ký")));
  body.push(field("Phạm vi công việc", placeholder(contract?.scope, "Phạm vi công việc")));
  body.push(field("Hồ sơ / sản phẩm bàn giao", placeholder(contract?.deliverables, "Danh mục, định dạng và số lượng bàn giao")));
  body.push(section("GIÁ TRỊ HỢP ĐỒNG"));
  const headings = ["STT", "Hạng mục", "ĐVT", "Khối lượng HĐ", "Đơn giá", "Thành tiền"];
  const rows: Cell[][] = [headings.map((label, index) => ({ width: widths[index], fill: "EAF3FB", content: paragraph(label, { bold: true, size: 17, color: heading, align: index === 1 ? "left" : index > 2 ? "right" : "center", after: 0 }) }))];
  const detailRows = lines.length ? lines.map((line, index) => [index + 1, `${line.name}${line.description ? `\n${line.description}` : ""}`, line.unit, line.quantity, money(line.unitPrice, contract?.currency), money(line.lineTotal, contract?.currency)]) : [[1, "[Hạng mục]", "[ĐVT]", "[Khối lượng]", "[Đơn giá]", "[Thành tiền]"]];
  detailRows.forEach((row, rowIndex) => rows.push(row.map((value, index) => ({ width: widths[index], fill: rowIndex % 2 ? "F8FAFC" : undefined, content: paragraph(value, { size: 17, align: index === 1 ? "left" : index > 2 ? "right" : "center", after: 0 }) }))));
  body.push(table(rows, widths, { border: true, header: true, spacingAfter: 150 }));
  body.push(paragraph(`Tạm tính: ${money(contract?.subtotal, contract?.currency)}`, { align: "right", after: 55 }));
  body.push(paragraph(`VAT (${contract?.taxRate === undefined ? "[Thuế suất]" : `${contract.taxRate * 100}%`}): ${money(contract?.taxAmount, contract?.currency)}`, { align: "right", after: 55 }));
  body.push(paragraph(`Vận chuyển: ${money(contract?.shippingFee, contract?.currency)}`, { align: "right", after: 70 }));
  body.push(paragraph(`Tổng giá trị hợp đồng: ${money(contract?.total, contract?.currency)}`, { align: "right", bold: true, size: 23, color: heading, after: 160 }));
  body.push(section("TẠM ỨNG VÀ THANH TOÁN"));
  body.push(field("Đặt cọc / tạm ứng", money(contract?.depositAmount, contract?.currency)));
  body.push(field("Số tiền dự kiến còn thanh toán", money(contract ? contract.total - (contract.depositAmount ?? 0) : undefined, contract?.currency)));
  body.push(field("Thông tin tài khoản", placeholder(contract?.bankDetails, "Ngân hàng, chủ tài khoản, số tài khoản")));
  body.push(paragraph(placeholder(contract?.paymentTerms, "Điều khoản thanh toán"), { after: 130 }));
  body.push(section("TIẾN ĐỘ VÀ BÀN GIAO"));
  body.push(paragraph(placeholder(contract?.deliveryTerms, "Tiến độ và điều kiện bàn giao"), { after: 130 }));
  body.push(section("ĐIỀU KHOẢN BỔ SUNG"));
  body.push(paragraph(placeholder(contract?.otherTerms, "Quyền và nghĩa vụ; bất khả kháng; giải quyết tranh chấp; hiệu lực hợp đồng"), { after: 260 }));
  body.push(table([[
    { width: 5053, content: paragraph("ĐẠI DIỆN BÊN A", { align: "center", bold: true, size: 20, color: heading, after: 60 }) + paragraph("Ký, ghi rõ họ tên", { align: "center", size: 17, color: muted, after: 600 }) },
    { width: 5053, content: paragraph("ĐẠI DIỆN BÊN B", { align: "center", bold: true, size: 20, color: heading, after: 60 }) + paragraph("Ký, ghi rõ họ tên", { align: "center", size: 17, color: muted, after: 600 }) },
  ]], [5053, 5053]));
  return packageWord(body);
}
