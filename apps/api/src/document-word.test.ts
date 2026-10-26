import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { makeDocumentWord } from "./document-word.js";
import type { AcceptanceRecord, Contract } from "./types.js";

function documentXml(bytes: Buffer) {
  const zip = new PizZip(bytes);
  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("_rels/.rels"));
  const xml = zip.file("word/document.xml")?.asText();
  assert.ok(xml);
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  assert.ok(parsed.documentElement);
  assert.equal(parsed.documentElement.localName, "document");
  return xml;
}

test("contract and acceptance samples are editable DOCX packages", () => {
  const contract = documentXml(makeDocumentWord("contract"));
  const acceptance = documentXml(makeDocumentWord("acceptance"));
  assert.match(contract, /\[Điều khoản thanh toán\]/);
  assert.match(acceptance, /\[Địa điểm nghiệm thu\]/);
  assert.ok(contract.includes("TẠM ỨNG VÀ THANH TOÁN"));
  assert.match(contract, /\[Danh mục, định dạng và số lượng bàn giao\]/);
  assert.match(acceptance, /THỜI GIAN NGHIỆM THU/);
  assert.match(acceptance, /GIÁ TRỊ QUYẾT TOÁN/);
  assert.match(acceptance, /ĐÁNH GIÁ HỒ SƠ/);
});

test("filled Word documents escape user text and include accepted quantities", () => {
  const contract = {
    companyName: "A & B", customerName: "Khách <Test>", contractNumber: "HD-001", quoteNumber: "BG-001",
    lines: [{ name: "Máy & thiết bị", unit: "cái", quantity: 2, unitPrice: 100, lineTotal: 200 }],
    total: 200, currency: "VND", scope: "Lắp đặt\nBàn giao", paymentTerms: "Sau bàn giao", deliveryTerms: "30 ngày",
  } as Contract;
  const record = { acceptanceNumber: "NT-001", acceptedDate: "2026-10-26", location: "Hà Nội", result: "Đạt", notes: "", lines: [{ lineIndex: 0, acceptedQuantity: 1 }] } as AcceptanceRecord;
  const contractXml = documentXml(makeDocumentWord("contract", contract));
  const acceptanceXml = documentXml(makeDocumentWord("acceptance", contract, record));
  assert.match(contractXml, /Khách &lt;Test&gt;/);
  assert.match(contractXml, /A &amp; B/);
  assert.ok(/<w:br\/><w:t xml:space="preserve">Bàn giao<\/w:t>/.test(contractXml));
  assert.match(acceptanceXml, /NT-001/);
  assert.match(acceptanceXml, /Khối lượng NT/);
});

test("filled contract Word keeps the page layout and formatting used on screen", () => {
  const contract = {
    companyName: "Đơn vị Thiết kế", companyAddress: "Hà Nội", companyTaxId: "123456789",
    customerName: "Anh Hiệp", customerAddress: "Hải Phòng", contractNumber: "HD-002", quoteNumber: "BG-002",
    lines: [{ name: "Thiết kế kiến trúc", description: "Bản vẽ mặt bằng", unit: "bộ", quantity: 1, unitPrice: 23_920_000, lineTotal: 23_920_000 }],
    subtotal: 23_920_000, taxRate: 0, taxAmount: 0, shippingFee: 0, total: 23_920_000, depositAmount: 12_000_000,
    currency: "VND", scope: "Thiết kế", deliverables: "Bản vẽ", paymentTerms: "Theo tiến độ", deliveryTerms: "30 ngày",
  } as Contract;
  const bytes = makeDocumentWord("contract", contract);
  const zip = new PizZip(bytes);
  assert.ok(zip.file("word/styles.xml"), "Word styles are included");
  const document = new DOMParser().parseFromString(documentXml(bytes), "application/xml");
  const tables = document.getElementsByTagName("w:tbl");
  assert.ok(tables.length >= 4, "header, parties, project, items and signatures use structured tables");
  const xml = zip.file("word/document.xml")!.asText();
  assert.ok(xml.includes('<w:shd w:fill="EAF3FB"/>'), "items table has a shaded header");
  assert.ok(xml.includes('<w:jc w:val="right"/>'), "amounts are right aligned");
  assert.ok(xml.includes("23.920.000") && xml.includes("12.000.000"), "VND amounts are formatted");
  assert.ok(xml.includes("ĐẠI DIỆN BÊN A") && xml.includes("ĐẠI DIỆN BÊN B"));
});

test("acceptance settlement keeps the balance shown by the reference PDFs", () => {
  const contract = { contractNumber: "HD-001", total: 23_920_000, currency: "VND", lines: [] } as unknown as Contract;
  const record = { settlementAmount: 23_920_000, amountPaid: 12_000_000, paymentDueDays: 7, lines: [] } as unknown as AcceptanceRecord;
  const xml = documentXml(makeDocumentWord("acceptance", contract, record));
  assert.match(xml, /23\.920\.000 VND/);
  assert.match(xml, /12\.000\.000 VND/);
  assert.match(xml, /11\.920\.000 VND/);
  assert.match(xml, /Thời hạn thanh toán còn lại: 7 ngày/);
});
