import assert from "node:assert/strict";
import test from "node:test";
import { Binary, type Db } from "mongodb";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { PDFDocument } from "pdf-lib";
import { config } from "./config.js";
import { makePdfReferenceContractWord } from "./contract-pdf-reference-word.js";
import { contractTemplateMode, renderAcceptanceFile, renderContractFile, renderContractWithTemplate, validateContractFillPlan } from "./contract-template.js";
import type { AcceptanceRecord, Contract } from "./types.js";
import type { QuoteTemplate } from "./quote-template.js";

const contract = {
  companyName: "Công ty Mới", companyAddress: "Hà Nội", companyPhone: "0900000000", companyEmail: "office@example.com", companyTaxId: "123456789",
  companyRepresentative: "Bà An", customerName: "Ông Bình", customerAddress: "Hải Phòng", customerRepresentative: "Ông Bình",
  customerPhone: "0911111111", customerEmail: "customer@example.com", customerTaxId: "",
  contractNumber: "HD-NEW", quoteNumber: "BG-NEW", projectName: "Nhà ở mới", projectAddress: "Hải Phòng", scope: "Thiết kế kiến trúc",
  deliverables: "Hồ sơ kiến trúc, kết cấu", deliveryTerms: "45 ngày", paymentTerms: "Thanh toán hai đợt", otherTerms: "Điều khoản riêng",
  signingPlace: "Hải Phòng", signedDate: "2026-10-26", status: "draft",
  lines: [{ name: "Thiết kế nhà ở", unit: "bộ", quantity: 1, unitPrice: 23_920_000, lineTotal: 23_920_000 }],
  subtotal: 23_920_000, taxRate: 0, taxAmount: 0, shippingFee: 0, total: 23_920_000, depositAmount: 12_000_000, currency: "VND", bankDetails: "Ngân hàng ABC",
} as Contract;

function addBranding(zip: PizZip, headerText = "Logo công ty", footerText = "Chân trang mẫu") {
  zip.file("[Content_Types].xml", zip.file("[Content_Types].xml")!.asText().replace("</Types>", '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'));
  zip.file("word/header1.xml", `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${headerText}</w:t></w:r></w:p></w:hdr>`);
  zip.file("word/footer1.xml", `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${footerText}</w:t></w:r></w:p></w:ftr>`);
  zip.file("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
  zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace('</w:body>', '<w:sectPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:headerReference w:type="default" r:id="rHeader"/><w:footerReference w:type="default" r:id="rFooter"/></w:sectPr></w:body>'));
}

function wordFixture(text: string) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip;
}

const acceptance = {
  acceptanceNumber: "NT-NEW", acceptedDate: "2026-10-27", location: "Hải Phòng", result: "Đạt yêu cầu", notes: "Đã bàn giao",
  startTime: "09:00", endTime: "10:00", handoverDetails: "Bộ hồ sơ thiết kế", qualityAssessment: "Đạt chất lượng",
  settlementAmount: 23_920_000, amountPaid: 12_000_000, paymentDueDays: 7,
  lines: [{ lineIndex: 0, acceptedQuantity: 1 }],
} as AcceptanceRecord;

test("Acceptance AI failures export default Word with saved acceptance and settlement data", async () => {
  const template = { extension: "docx", originalFilename: "acceptance.docx", data: new Binary(wordFixture("Mẫu nghiệm thu chưa điền").generate({ type: "nodebuffer" })) } as QuoteTemplate;
  for (const message of ["HTTP 402", "TimeoutError", "HTTP 503", "Invalid AI mapping", "AI quota exceeded"]) {
    let attempted = false;
    const file = await renderAcceptanceFile({} as Db, template, contract, acceptance, async () => { attempted = true; throw new Error(message); });
    assert.equal(attempted, true);
    assert.equal(file.fallback, true);
    assert.equal(file.extension, "docx");
    const document = new PizZip(file.bytes).file("word/document.xml")!.asText();
    for (const value of ["NT-NEW", "HD-NEW", "Đạt yêu cầu", "23.920.000", "12.000.000", "11.920.000"]) assert.ok(document.includes(value), value);
  }
});

test("Successful acceptance AI fill uses the selected template without fallback", async (t) => {
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  t.after(() => { config.openRouterApiKey = previousKey; });
  const template = { extension: "docx", originalFilename: "acceptance.docx", data: new Binary(wordFixture("Mẫu riêng: OLD_DATA").generate({ type: "nodebuffer" })) } as QuoteTemplate;
  const plan = { edits: [{ part: "word/document.xml", find: "OLD_DATA", replace: "[[acceptanceNumber]] [[customerName]] [[result]] [[settlementAmountFormatted]]" }], pdfEdits: [] };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }), { status: 200 }));
  const file = await renderAcceptanceFile({} as Db, template, contract, acceptance);
  assert.notEqual(file.fallback, true);
  const document = new PizZip(file.bytes).file("word/document.xml")!.asText();
  for (const value of ["Mẫu riêng:", "NT-NEW", "Ông Bình", "Đạt yêu cầu", "23.920.000"]) assert.ok(document.includes(value), value);
  assert.doesNotMatch(document, /OLD_DATA/);
});

test("Acceptance with Word placeholders exports directly without calling AI", async () => {
  const template = { extension: "docx", originalFilename: "acceptance.docx", data: new Binary(wordFixture("{acceptanceNumber} {result} {settlementAmountFormatted}").generate({ type: "nodebuffer" })) } as QuoteTemplate;
  const file = await renderAcceptanceFile({} as Db, template, contract, acceptance, async () => { throw new Error("AI must not run"); });
  assert.notEqual(file.fallback, true);
  assert.match(new PizZip(file.bytes).file("word/document.xml")!.asText(), /NT-NEW/);
});

test("Word export fills financial fields without AI and preserves header/footer data and relationships", async () => {
  const zip = wordFixture("{totalInWords} | {depositAmountInWords} | {balanceInWords} | {balanceFormatted} | {line_1_name}");
  addBranding(zip, "{companyName}", "{contractNumber}");
  const template = { extension: "docx", data: new Binary(zip.generate({ type: "nodebuffer" })) } as QuoteTemplate;
  const file = await renderContractFile({} as Db, template, contract, async () => { throw new Error("AI must not run"); });
  const output = new PizZip(file.bytes);
  assert.equal(file.extension, "docx");
  assert.match(output.file("word/header1.xml")!.asText(), /Công ty Mới/);
  assert.match(output.file("word/footer1.xml")!.asText(), /HD-NEW/);
  assert.equal(output.file("word/_rels/document.xml.rels")!.asText(), zip.file("word/_rels/document.xml.rels")!.asText());
  const document = output.file("word/document.xml")!.asText();
  assert.match(document, /w:headerReference/);
  assert.match(document, /Mười hai triệu đồng chẵn/);
  assert.match(document, /11\.920\.000/);
  assert.match(document, /Thiết kế nhà ở/);
  assert.doesNotMatch(document, /\{(?:total|deposit|balance|line_)/);
});

test("Word templates with only financial or payment placeholders are recognized without AI", () => {
  for (const field of ["totalFormatted", "totalInWords", "balanceFormatted", "paymentTerms", "bankDetails", "line_1_name"]) {
    const zip = wordFixture(`{${field}}`);
    assert.equal(contractTemplateMode({ extension: "docx", data: new Binary(zip.generate({ type: "nodebuffer" })) } as QuoteTemplate), "docx", field);
  }
});

test("Insufficient AI credit falls back to editable Word with current contract data", async (t) => {
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  t.after(() => { config.openRouterApiKey = previousKey; });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), { status: 402 }));
  const template = { extension: "docx", originalFilename: "contract.docx", data: new Binary(wordFixture("Mẫu hợp đồng chưa có trường dữ liệu").generate({ type: "nodebuffer" })) } as QuoteTemplate;
  const file = await renderContractFile({} as Db, template, contract);
  assert.equal(file.fallback, true);
  assert.equal(file.extension, "docx");
  const document = new PizZip(file.bytes).file("word/document.xml")!.asText();
  for (const value of ["HD-NEW", "Ông Bình", "Công ty Mới", "23.920.000", "Điều khoản riêng"]) assert.ok(document.includes(value), value);
});

test("AI timeout, unavailable service, invalid mapping and quota failures still export Word", async () => {
  const template = { extension: "docx", originalFilename: "contract.docx", data: new Binary(wordFixture("Mẫu chưa điền").generate({ type: "nodebuffer" })) } as QuoteTemplate;
  for (const message of ["TimeoutError", "HTTP 503", "AI trả ánh xạ không hợp lệ", "AI quota exceeded"]) {
    let attempted = false;
    const file = await renderContractFile({} as Db, template, contract, async () => { attempted = true; throw new Error(message); });
    assert.equal(attempted, true);
    assert.equal(file.fallback, true);
    assert.equal(file.extension, "docx");
    assert.match(new PizZip(file.bytes).file("word/document.xml")!.asText(), /HD-NEW/);
  }
});

test("Contract Word fills repeated lines and safely escapes multiline user data", () => {
  const zip = wordFixture("{contractNumber} {scope} {#lines}{index}. {name} {quantity} {unitPriceFormatted} {lineTotalFormatted}; {/lines}");
  const template = { extension: "docx", data: new Binary(zip.generate({ type: "nodebuffer" })) } as QuoteTemplate;
  const current = { ...contract, scope: "Thiết kế A & B\nChi tiết <mới>", lines: [
    { ...contract.lines[0], name: "Hạng mục A & B" },
    { ...contract.lines[0], name: "Hạng mục <C>", quantity: 2, unitPrice: 1000, lineTotal: 2000 },
  ] };
  const document = new PizZip(renderContractWithTemplate(template, current)).file("word/document.xml")!.asText();
  const parsed = new DOMParser().parseFromString(document, "application/xml");
  assert.equal(parsed.documentElement!.localName, "document");
  assert.match(document, /A &amp; B/);
  assert.match(document, /&lt;mới&gt;/);
  assert.match(document, /<w:br\s*\/>/);
  assert.match(parsed.documentElement!.textContent!, /1\. Hạng mục A & B/);
  assert.match(parsed.documentElement!.textContent!, /2\. Hạng mục <C> 2 1\.000/);
  assert.doesNotMatch(document, /\{[#/]?lines\}|\{name\}/);
});

test("PDF reference contract becomes an editable Word document with current contract data", () => {
  const zip = new PizZip(makePdfReferenceContractWord(contract));
  const document = zip.file("word/document.xml")!.asText();
  assert.equal(new DOMParser().parseFromString(document, "application/xml").documentElement!.localName, "document");
  assert.ok(zip.file("word/header1.xml"));
  assert.ok(zip.file("word/footer1.xml"));
  for (const value of ["HỢP ĐỒNG TƯ VẤN THIẾT KẾ", "HD-NEW", "CÔNG TY MỚI", "Ông Bình", "ĐIỀU 9: ĐIỀU KHOẢN CHUNG", "TẠM ỨNG VÀ THANH TOÁN HỢP ĐỒNG", "23.920.000", "12.000.000", "Mười hai triệu đồng chẵn"]) {
    assert.ok(document.includes(value) || zip.file("word/header1.xml")!.asText().includes(value), `missing ${value}`);
  }
  assert.ok(!document.includes("RUBICK") && !document.includes("0303/2026/HĐTVTK"));
  assert.ok(document.includes('<w:pageBreakBefore/>'));
  assert.ok(document.includes('<w:tblHeader/>'));
});

test("DOCX contract templates retain their original document while filling placeholders", () => {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder("_rels")!.file(".rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder("word")!.file("document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hợp đồng {contractNumber} - {customerName}</w:t></w:r></w:p></w:body></w:document>');
  const template = { extension: "docx", data: new Binary(zip.generate({ type: "nodebuffer" })) } as QuoteTemplate;
  assert.equal(contractTemplateMode(template), "docx");
  const output = new PizZip(renderContractWithTemplate(template, contract)).file("word/document.xml")!.asText();
  assert.ok(output.includes("HD-NEW") && output.includes("Ông Bình"));
  assert.ok(!output.includes("{contractNumber}"));
});

test("AI maps an unmarked Word contract to current data while preserving XML layout", async (t) => {
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  t.after(() => { config.openRouterApiKey = previousKey; });
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.folder("_rels")!.file(".rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.folder("word")!.file("document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Số cũ</w:t></w:r></w:p><w:p><w:r><w:t>Khách mẫu</w:t></w:r></w:p><w:p><w:r><w:t>Giá 100</w:t></w:r></w:p><w:p><w:r><w:t>Điều khoản giữ nguyên</w:t></w:r></w:p></w:body></w:document>');
  addBranding(zip);
  const template = { extension: "docx", originalFilename: "mau-khac.docx", data: new Binary(zip.generate({ type: "nodebuffer" })) } as QuoteTemplate;
  assert.equal(contractTemplateMode(template), "docx-ai");
  const plan = { edits: [
    { part: "word/document.xml", find: "<w:t>Số cũ</w:t>", replace: "<w:t>[[contractNumber]]</w:t>" },
    { part: "word/document.xml", find: "<w:t>Khách mẫu</w:t>", replace: "<w:t>[[customerName]]</w:t>" },
    { part: "word/document.xml", find: "<w:t>Giá 100</w:t>", replace: "<w:t>[[total]]</w:t>" },
  ], pdfEdits: [] };
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    assert.match(request.messages[0].content, /hợp đồng/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }), { status: 200 });
  });
  const file = await renderContractFile({} as Db, template, contract);
  assert.equal(file.extension, "docx");
  assert.notEqual(file.fallback, true);
  const output = new PizZip(file.bytes).file("word/document.xml")!.asText();
  assert.match(output, /HD-NEW/);
  assert.match(output, /Ông Bình/);
  assert.match(output, /23\.920\.000/);
  assert.match(output, /Điều khoản giữ nguyên/);
  assert.match(output, /<w:b\/>/);
  const exported = new PizZip(file.bytes);
  assert.equal(exported.file("word/header1.xml")!.asText(), zip.file("word/header1.xml")!.asText());
  assert.equal(exported.file("word/footer1.xml")!.asText(), zip.file("word/footer1.xml")!.asText());
  assert.equal(exported.file("word/_rels/document.xml.rels")!.asText(), zip.file("word/_rels/document.xml.rels")!.asText());
  assert.match(output, /w:headerReference/);
});

test("AI maps another PDF template and preserves its original page", async (t) => {
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  t.after(() => { config.openRouterApiKey = previousKey; });
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const template = { extension: "pdf", originalFilename: "mau-hop-dong-khac.pdf", data: new Binary(await source.save()) } as QuoteTemplate;
  assert.equal(contractTemplateMode(template), "pdf-ai");
  const plan = { edits: [], pdfEdits: [
    { page: 0, x: 30, y: 700, width: 180, height: 25, fontSize: 10, text: "[[contractNumber]]", erase: false },
    { page: 0, x: 30, y: 650, width: 180, height: 25, fontSize: 10, text: "[[customerName]]", erase: false },
    { page: 0, x: 30, y: 600, width: 180, height: 25, fontSize: 10, text: "[[total]]", erase: false },
  ] };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }), { status: 200 }));
  const file = await renderContractFile({} as Db, template, contract);
  assert.equal(file.extension, "pdf");
  assert.equal((await PDFDocument.load(file.bytes)).getPageCount(), 1);
  assert.equal(file.bytes.subarray(0, 4).toString(), "%PDF");
});

test("AI contract mappings reject fields that the server did not provide", () => {
  assert.throws(() => validateContractFillPlan({ edits: [{ part: "word/document.xml", find: "x", replace: "[[unknownField]] [[customerName]] [[total]] [[contractNumber]]" }], pdfEdits: [] }, { customerName: "A", total: "1", contractNumber: "H1" }, "docx"), /không tồn tại/);
});
