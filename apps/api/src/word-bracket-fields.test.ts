import assert from "node:assert/strict";
import test from "node:test";
import { Binary, type Db } from "mongodb";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { contractBindings, renderContractFile } from "./contract-template.js";
import { tryFillBracketedContractTemplate } from "./word-bracket-fields.js";
import type { QuoteTemplate } from "./quote-template.js";
import type { Contract } from "./types.js";

const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const paragraph = (value: string) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${value}</w:t></w:r></w:p>`;
const table = (rows: string[][]) => `<w:tbl><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
function fixture(body: string): QuoteTemplate {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<w:document xmlns:w="${ns}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${ns}">${paragraph("TIÊU ĐỀ GIỮ NGUYÊN")}</w:hdr>`);
  return { companyId: "company", extension: "docx", originalFilename: "a-layout-with-any-name.docx", data: new Binary(zip.generate({ type: "nodebuffer" })) } as QuoteTemplate;
}
const contract = {
  contractNumber: "HD-NEW", quoteNumber: "BG-NEW", companyName: "Bên bán", customerName: "Khách A & B <mới>",
  customerRepresentative: "Đại diện A", companyRepresentative: "Đại diện B", companyAddress: "Địa chỉ B", customerAddress: "Địa chỉ A",
  customerTaxId: "", companyTaxId: "", customerPhone: "", companyPhone: "", customerEmail: "", companyEmail: "",
  projectName: "Dự án mới", projectAddress: "Địa điểm mới", signingPlace: "Hà Nội", signedDate: "2026-11-09",
  scope: "Cung cấp vật tư", deliverables: "Ba hạng mục", paymentTerms: "Thanh toán khi bàn giao", deliveryTerms: "Giao trong 15 ngày",
  bankDetails: "Tài khoản do người dùng nhập", otherTerms: "Điều khoản do người dùng nhập",
  subtotal: 10996250, taxRate: .08, taxAmount: 879700, shippingFee: 300000, total: 12175950, depositAmount: 2000000, currency: "VND",
  lines: [
    { name: "Gạch", sku: "GACH", description: "800x800", unit: "m²", quantity: 10.25, unitPrice: 385000, lineTotal: 3946250 },
    { name: "Lưới", sku: "LUOI", description: "Tấm 2x6m", unit: "tấm", quantity: 8, unitPrice: 735000, lineTotal: 5880000 },
    { name: "Ống", sku: "ONG", description: "Cây 4m", unit: "cây", quantity: 20, unitPrice: 58500, lineTotal: 1170000 },
  ],
} as Contract;
const products = () => contract.lines.map((line, index) => ({ ...Object.fromEntries(Object.entries(line).map(([key, value]) => [key, String(value)])), index: String(index + 1), quantity: String(line.quantity).replace(".", ","), unitPriceFormatted: `${line.unitPrice} VND`, lineTotalFormatted: `${line.lineTotal} VND` }));
const fields = () => contractBindings(contract);
const documentOf = (bytes: Buffer) => new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(), "application/xml");
const contents = (bytes: Buffer) => Array.from(documentOf(bytes).getElementsByTagNameNS(ns, "p")).map((p) => Array.from(p.getElementsByTagNameNS(ns, "t")).map((t) => t.textContent).join(""));
const productTable = () => table([["STT", "Hạng mục", "ĐVT", "Khối lượng", "Đơn giá", "Thành tiền"], ["1", "[Hạng mục]", "[ĐVT]", "[Khối lượng]", "[Đơn giá]", "[Thành tiền]"]]);

test("Vietnamese bracket contract fields fill all parties, project and payment positions without an AI request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("AI unavailable"); });
  const template = fixture([
    "[TÊN ĐƠN VỊ THỰC HIỆN]", "Số: [Số hợp đồng]", "Căn cứ dự toán: [Số dự toán]", "Ngày ký: [Ngày ký]; tại: [Địa điểm ký]",
    "Công trình / dự án: [Tên công trình]", "Địa điểm thực hiện: [Địa điểm công trình]", "Tên: [Tên khách hàng]; Đại diện: [Đại diện Bên A]",
    "Địa chỉ: [Địa chỉ Bên A]; MST: [MST Bên A]", "Điện thoại: [Điện thoại Bên A]; Email: [Email Bên A]",
    "Tên: [Tên đơn vị thực hiện]; Đại diện: [Đại diện Bên B]", "Địa chỉ: [Địa chỉ Bên B]; MST: [MST Bên B]",
    "Điện thoại: [Điện thoại Bên B]; Email: [Email Bên B]", "[Phạm vi công việc]", "Hồ sơ: [Danh mục, định dạng và số lượng bàn giao]",
    "Thông tin tài khoản: [Ngân hàng, chủ tài khoản, số tài khoản]", "[Điều khoản thanh toán]", "[Tiến độ và điều kiện bàn giao]",
    "[Quyền và nghĩa vụ; bất khả kháng; giải quyết tranh chấp; hiệu lực hợp đồng]",
  ].map(paragraph).join("") + productTable() + paragraph("Ký, ghi rõ họ tên"));
  let aiCalls = 0;
  const rendered = await renderContractFile({} as Db, template, contract, async () => { aiCalls++; throw new Error("AI must not be used for known labels"); });
  const text = contents(rendered.bytes).join("\n");
  for (const expected of [contract.contractNumber, contract.quoteNumber, contract.customerName, contract.companyName, contract.scope, contract.bankDetails, contract.paymentTerms, contract.deliveryTerms, contract.otherTerms]) assert.ok(text.includes(expected), expected);
  assert.doesNotMatch(text, /\[(?:Số|Tên|Địa|Thành|Hạng|Khối|Đơn|ĐVT)/);
  assert.equal(aiCalls, 0);
  assert.equal(new PizZip(rendered.bytes).file("word/header1.xml")!.asText(), new PizZip(Buffer.from(template.data.buffer)).file("word/header1.xml")!.asText());
  assert.ok(new PizZip(rendered.bytes).file("word/document.xml")!.asText().includes("w:tblBorders"));
});

test("identical amount labels resolve by their local meaning, including VAT after a tax-rate placeholder", () => {
  const data = fields();
  const labels = ["Tạm tính: [Thành tiền]", "VAT ([Thuế suất]): [Thành tiền]", "Vận chuyển: [Thành tiền]", "Tổng giá trị hợp đồng: [Thành tiền]", "Đặt cọc / tạm ứng: [Thành tiền]", "Số tiền dự kiến còn thanh toán: [Thành tiền]"];
  const rendered = tryFillBracketedContractTemplate(fixture(labels.map(paragraph).join("")), data, products())!;
  const result = contents(rendered);
  assert.equal(result[0], `Tạm tính: ${data.subtotalFormatted}`);
  assert.equal(result[1], `VAT (8%): ${data.taxAmountFormatted}`);
  assert.equal(result[2], `Vận chuyển: ${data.shippingFeeFormatted}`);
  assert.equal(result[3], `Tổng giá trị hợp đồng: ${data.totalFormatted}`);
  assert.equal(result[4], `Đặt cọc / tạm ứng: ${data.depositAmountFormatted}`);
  assert.equal(result[5], `Số tiền dự kiến còn thanh toán: ${data.balanceFormatted}`);
});

test("one bracket product row expands to every product with numbering and fractional quantities", () => {
  const rendered = tryFillBracketedContractTemplate(fixture(productTable()), fields(), products())!;
  const rows = Array.from(documentOf(rendered).getElementsByTagNameNS(ns, "tr"));
  assert.equal(rows.length, 4);
  const row = (index: number) => Array.from(rows[index]!.getElementsByTagNameNS(ns, "tc")).map((cell) => Array.from(cell.getElementsByTagNameNS(ns, "t")).map((t) => t.textContent).join(""));
  assert.deepEqual(row(1), ["1", "Gạch", "m²", "10,25", "385000 VND", "3946250 VND"]);
  assert.equal(row(3)[0], "3");
  assert.equal(row(3)[1], "Ống");
});

test("labels split across Word runs preserve the surrounding formatting", () => {
  const template = fixture('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Số: [Số hợp </w:t></w:r><w:r><w:t>đồng]</w:t></w:r></w:p>');
  const rendered = tryFillBracketedContractTemplate(template, fields(), products())!;
  assert.equal(contents(rendered)[0], "Số: HD-NEW");
  assert.ok(new PizZip(rendered).file("word/document.xml")!.asText().includes("<w:b/>"));
});

test("unknown labels, ambiguous amounts and unmarked product data defer to AI without modifying the template", () => {
  for (const body of [paragraph("[Thông tin chưa biết]"), paragraph("Giá: [Thành tiền]"), paragraph("Tạm tính [Thành tiền] tổng [Thành tiền]"), paragraph("Thông tin; Tạm tính [Thành tiền] tổng [Thành tiền]"), paragraph("Số: [Số hợp đồng]") + table([["Hạng mục", "Số lượng", "Đơn giá"], ["Ví dụ cũ", "2", "100"]]), table([["STT", "Hạng mục", "Số lượng"], ["1", "[Hạng mục]", "[Số lượng]"], ["2", "Sản phẩm mẫu cũ", "2"]])]) {
    const template = fixture(body); const before = Buffer.from(template.data.buffer);
    assert.equal(tryFillBracketedContractTemplate(template, fields(), products()), null);
    assert.ok(before.equals(Buffer.from(template.data.buffer)));
  }
});

test("empty optional fields and explicit zero amounts are filled without retaining sample labels", () => {
  const data = contractBindings({ ...contract, customerAddress: "", shippingFee: 0, depositAmount: 0 });
  const rendered = tryFillBracketedContractTemplate(fixture(["Địa chỉ: [Địa chỉ Bên A]", "Vận chuyển: [Thành tiền]", "Đặt cọc: [Thành tiền]"].map(paragraph).join("")), data, products())!;
  assert.deepEqual(contents(rendered), ["Địa chỉ: ", `Vận chuyển: ${data.shippingFeeFormatted}`, `Đặt cọc: ${data.depositAmountFormatted}`]);
});
