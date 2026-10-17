import test from "node:test";
import assert from "node:assert/strict";
import { Binary } from "mongodb";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { createTemplateFillPlan, createXlsxTemplateFillPlan, inspectTemplate, renderTemplate, templateAiContent, validateFillPlan, type QuoteTemplate } from "./quote-template.js";
import { config } from "./config.js";
import type { Quote } from "./types.js";

const names = ["quoteNumber", "customerName", "total", "line_1_name", "line_1_quantity", "line_1_unitPrice", "line_1_lineTotal", "line_2_name", "line_2_quantity", "line_2_unitPrice", "line_2_lineTotal"];
const quote: Quote = {
  companyId: "company-a", quoteNumber: "BG-2026-00001", requestId: "request", customerName: "Công ty An & Bình <Việt>", customerEmail: "test@example.com",
  lines: [{ catalogItemId: "item", sku: "SP-01", name: "Máy lọc nước", quantity: 2, unit: "cái", unitPrice: 10000, currency: "VND", attributes: {}, lineTotal: 20000 }],
  subtotal: 20000, taxRate: 0.1, taxAmount: 2000, total: 22000, currency: "VND", informationNeeded: [], informationConfirmed: true,
  status: "approved", createdBy: "sales", createdAt: new Date("2026-10-16T00:00:00Z"), updatedAt: new Date(),
};
function template(bytes: Buffer, extension: string): QuoteTemplate {
  return { companyId: quote.companyId, originalFilename: `sample.${extension}`, extension, bytes: bytes.length, data: new Binary(bytes), capacity: 2, createdAt: new Date(), uploadedBy: "admin" };
}
function xlsxTemplateFixture() {
  const zip = new PizZip();
  zip.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estimate" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F7"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Khách hàng</t></is></c><c r="B1" s="2" t="inlineStr"><is><t>Mẫu cũ</t></is></c></row><row r="4"><c r="A4" s="3" t="inlineStr"><is><t>SP-OLD</t></is></c><c r="B4" s="3" t="inlineStr"><is><t>Sản phẩm cũ</t></is></c><c r="C4" s="4"><v>1</v></c><c r="D4" s="3" t="inlineStr"><is><t>cái</t></is></c><c r="E4" s="5"><v>10</v></c><c r="F4" s="6"><f>C4*E4</f><v>10</v></c></row><row r="7"><c r="C7" t="inlineStr"><is><t>Tổng cộng</t></is></c><c r="D7" s="7"><f>SUM(F4:F4)</f><v>10</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="B1:C1"/></mergeCells><pageSetup orientation="landscape"/></worksheet>');
  zip.file("xl/styles.xml", "original-styles");
  zip.file("xl/drawings/drawing1.xml", "original-logo-position");
  return template(zip.generate({ type: "nodebuffer" }), "xlsx");
}
function structuredXlsxTemplateFixture() {
  const zip = new PizZip();
  zip.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estimate" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="C1" t="inlineStr"><is><t>Khách hàng: </t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>STT</t></is></c><c r="B3" t="inlineStr"><is><t>HÌNH ẢNH SP</t></is></c><c r="C3" t="inlineStr"><is><t>TÊN SẢN PHẨM</t></is></c><c r="D3" t="inlineStr"><is><t>MÔ TẢ</t></is></c><c r="E3" t="inlineStr"><is><t>ĐVT</t></is></c><c r="F3" t="inlineStr"><is><t>SL</t></is></c><c r="G3" t="inlineStr"><is><t>ĐƠN GIÁ</t></is></c><c r="H3" t="inlineStr"><is><t>THÀNH TIỀN</t></is></c></row><row r="4"><c r="A4" s="1"><v>0</v></c><c r="B4" s="2"/><c r="C4" s="3" t="inlineStr"><is><t>Sản phẩm cũ 1</t></is></c><c r="D4" s="3" t="inlineStr"><is><t>Mô tả cũ</t></is></c><c r="E4" s="3" t="inlineStr"><is><t>cái</t></is></c><c r="F4" s="4"><f>A4</f><v>0</v></c><c r="G4" s="5"><v>100</v></c><c r="H4" s="6"><f>G4*F4</f><v>100</v></c></row><row r="5"><c r="A5" s="1"><v>2</v></c><c r="B5" s="2"/><c r="C5" s="3" t="inlineStr"><is><t>Sản phẩm cũ 2</t></is></c><c r="D5" s="3" t="inlineStr"><is><t>Mô tả cũ 2</t></is></c><c r="E5" s="3" t="inlineStr"><is><t>cái</t></is></c><c r="F5" s="4"><f>A5</f><v>2</v></c><c r="G5" s="5"><v>250</v></c><c r="H5" s="6"><f>G5*F5</f><v>500</v></c></row><row r="7"><c r="G7" t="inlineStr"><is><t>TỔNG</t></is></c><c r="H7" s="6"><f>SUM(H4:H5)</f><v>600</v></c></row></sheetData></worksheet>');
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>');
  zip.file("xl/drawings/drawing1.xml", '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>3</xdr:row></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:row>4</xdr:row></xdr:to><xdr:pic><xdr:nvPicPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:row>0</xdr:row></xdr:from><xdr:to><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:to><xdr:pic><xdr:nvPicPr/></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>');
  zip.file("xl/styles.xml", "original-styles");
  return template(zip.generate({ type: "nodebuffer" }), "xlsx");
}
function xlsxPlan() {
  return {
    cells: [{ key: "customerName", sheet: "Estimate", cell: "B1" }, { key: "total", sheet: "Estimate", cell: "D7" }],
    lineRows: [{ sheet: "Estimate", row: 4, fields: [
      { key: "sku", cell: "A4" }, { key: "name", cell: "B4" }, { key: "quantity", cell: "C4" },
      { key: "unit", cell: "D4" }, { key: "unitPrice", cell: "E4" }, { key: "lineTotal", cell: "F4" },
    ] }],
  };
}
function officeFixture(extension: "docx" | "xlsx", tags = names) {
  const zip = new PizZip();
  if (extension === "docx") {
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${tags.map((name) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{${name}}</w:t></w:r></w:p>`).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
    zip.file("word/media/logo.png", Buffer.from([1, 2, 3]));
  } else {
    zip.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>');
    zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${tags.map((name, i) => `<row r="${i + 1}"><c r="A${i + 1}" s="1" t="inlineStr"><is><t>{${name}}</t></is></c></row>`).join("")}</sheetData><mergeCells><mergeCell ref="A1:D1"/></mergeCells><pageSetup orientation="landscape"/></worksheet>`);
    zip.file("xl/styles.xml", "original-styles");
    zip.file("xl/drawings/drawing1.xml", "original-logo-position");
  }
  return zip.generate({ type: "nodebuffer" });
}

test("Word: fill Vietnamese values, preserve page layout and logo, clear unused rows", async () => {
  const input = officeFixture("docx");
  await inspectTemplate(input, "docx");
  const output = new PizZip(await renderTemplate(template(input, "docx"), quote));
  const xml = output.file("word/document.xml")!.asText();
  assert.match(xml, /Công ty An &amp; Bình &lt;Việt&gt;/);
  assert.match(xml, /Máy lọc nước/);
  assert.match(xml, /22.000/);
  assert.match(xml, /w:w="11906"/);
  assert.match(xml, /<w:b\/>/);
  assert.doesNotMatch(xml, /\{line_|\{total\}/);
  assert.deepEqual(output.file("word/media/logo.png")!.asNodeBuffer(), Buffer.from([1, 2, 3]));
});

test("Excel: replace text without rewriting styles, merged cells, drawings or print setup", async () => {
  const input = officeFixture("xlsx");
  await inspectTemplate(input, "xlsx");
  const output = new PizZip(await renderTemplate(template(input, "xlsx"), quote));
  const xml = output.file("xl/worksheets/sheet1.xml")!.asText();
  assert.match(xml, /Công ty An &amp; Bình &lt;Việt&gt;/);
  assert.match(xml, /mergeCell ref="A1:D1"/);
  assert.match(xml, /orientation="landscape"/);
  assert.doesNotMatch(xml, /\{line_/);
  assert.equal(output.file("xl/styles.xml")!.asText(), "original-styles");
  assert.equal(output.file("xl/drawings/drawing1.xml")!.asText(), "original-logo-position");
});

test("Excel coordinate mapping fills values, preserves formulas, styles, merged cells and drawings", async () => {
  const source = xlsxTemplateFixture();
  const output = new PizZip(await renderTemplate(source, { ...quote, xlsxTemplateFillPlan: xlsxPlan() }));
  const xml = output.file("xl/worksheets/sheet1.xml")!.asText();
  assert.match(xml, /Công ty An &amp; Bình &lt;Việt&gt;/);
  assert.match(xml, /<c r="B4"[^>]*s="3"[^>]*t="inlineStr"/);
  assert.match(xml, /<f>C4\*E4<\/f><v>20000<\/v>/);
  assert.match(xml, /<f>SUM\(F4:F4\)<\/f><v>22000<\/v>/);
  assert.match(xml, /mergeCell ref="B1:C1"/);
  assert.match(xml, /orientation="landscape"/);
  assert.equal(output.file("xl/styles.xml")!.asText(), "original-styles");
  assert.equal(output.file("xl/drawings/drawing1.xml")!.asText(), "original-logo-position");
});

test("Excel infers a standard quote table, removes old line data and keeps the logo", async (t) => {
  const source = structuredXlsxTemplateFixture();
  const previousKey = config.openRouterApiKey; config.openRouterApiKey = "test-key";
  t.after(() => { config.openRouterApiKey = previousKey; });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Known column headers should be mapped locally."); });
  const plan = await createXlsxTemplateFillPlan(source, quote);
  assert.equal(plan.lineRows.length, 1);
  assert.equal(plan.lineRows[0]!.row, 4);
  const output = new PizZip(await renderTemplate(source, { ...quote, xlsxTemplateFillPlan: plan }));
  const xml = output.file("xl/worksheets/sheet1.xml")!.asText();
  assert.match(xml, /Khách hàng: Công ty An &amp; Bình &lt;Việt&gt;/);
  assert.match(xml, /Máy lọc nước/);
  assert.doesNotMatch(xml, /Sản phẩm cũ 1|Sản phẩm cũ 2|Mô tả cũ/);
  assert.match(xml, /<c r="F4"[^>]*><v>2<\/v><\/c>/);
  assert.match(xml, /<f>G4\*F4<\/f><v>20000<\/v>/);
  assert.match(xml, /<f>SUM\(H4:H5\)<\/f><v>22000<\/v>/);
  const drawing = output.file("xl/drawings/drawing1.xml")!.asText();
  assert.equal((drawing.match(/<xdr:twoCellAnchor/g) ?? []).length, 1);
  assert.match(drawing, /<xdr:row>0<\/xdr:row>/);
});

test("Excel AI mapping uses compact cell coordinates instead of rewriting workbook XML", async (t) => {
  const source = xlsxTemplateFixture();
  const plan = xlsxPlan();
  const previousKey = config.openRouterApiKey; config.openRouterApiKey = "test-key";
  t.after(() => { config.openRouterApiKey = previousKey; });
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    const prompt = JSON.stringify(request.messages);
    assert.equal(request.model, config.openRouterModel);
    assert.ok(prompt.includes("Estimate"));
    assert.ok(prompt.includes("A4"));
    assert.ok(prompt.includes("SP-OLD"));
    assert.ok(!prompt.includes("<sheetData>"));
    assert.ok(!prompt.includes("Công ty An"));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }), { status: 200 });
  });
  assert.deepEqual(await createXlsxTemplateFillPlan(source, quote), plan);
});

test("PDF: fill and flatten Unicode form fields while preserving page dimensions", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawRectangle({ x: 20, y: 20, width: 555, height: 802 });
  names.forEach((name, i) => pdf.getForm().createTextField(name).addToPage(page, { x: 30, y: 780 - i * 40, width: 500, height: 30 }));
  const input = Buffer.from(await pdf.save());
  await inspectTemplate(input, "pdf");
  const output = await PDFDocument.load(await renderTemplate(template(input, "pdf"), quote));
  assert.equal(output.getPageCount(), 1);
  assert.deepEqual(output.getPage(0).getSize(), { width: 595, height: 842 });
  assert.equal(output.getForm().getFields().length, 0);
});

test("accept ordinary Office documents and PDFs without required fields", async () => {
  await inspectTemplate(officeFixture("xlsx", []), "xlsx");
  await inspectTemplate(officeFixture("docx", []), "docx");
  await assert.rejects(inspectTemplate(Buffer.from("fake"), "xls"), /docx/);
  await inspectTemplate(officeFixture("xlsx", [...names, "unknownField"]), "xlsx");
  const plain = await PDFDocument.create(); plain.addPage();
  await inspectTemplate(Buffer.from(await plain.save()), "pdf");
  await assert.rejects(inspectTemplate(Buffer.from("corrupt"), "pdf"));
});

test("Word supports placeholders split across formatting runs", async () => {
  const zip = new PizZip(officeFixture("docx"));
  zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("{customerName}", "{customer</w:t></w:r><w:r><w:t>Name}"));
  const input = zip.generate({ type: "nodebuffer" });
  await inspectTemplate(input, "docx");
  const output = new PizZip(await renderTemplate(template(input, "docx"), quote));
  assert.match(output.file("word/document.xml")!.asText(), /Công ty An/);
});

const bindingText = "Khách: [[customerName]]; Tổng: [[total]]; Hàng: [[line_1_name]]; SL: [[line_1_quantity]]; Đơn giá: [[line_1_unitPrice]]; Thành tiền: [[line_1_lineTotal]]";

test("AI receives the Word template and binding names without quote data", async (t) => {
  const zip = new PizZip(officeFixture("docx", []));
  const original = zip.file("word/document.xml")!.asText().replace("<w:body>", "<w:body><w:p><w:r><w:t>Báo giá mẫu doanh nghiệp</w:t></w:r></w:p>");
  zip.file("word/document.xml", original);
  const source = template(zip.generate({ type: "nodebuffer" }), "docx"); delete source.capacity;
  const plan = { edits: [{ part: "word/document.xml", find: "<w:t>Báo giá mẫu doanh nghiệp</w:t>", replace: `<w:t>${bindingText}</w:t>` }], pdfEdits: [] };
  const previousKey = config.openRouterApiKey; config.openRouterApiKey = "test-key";
  t.after(() => { config.openRouterApiKey = previousKey; });
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    const text = JSON.stringify(request.messages);
    assert.equal(request.model, config.openRouterModel);
    assert.ok(text.includes("Báo giá mẫu doanh nghiệp"));
    assert.ok(text.includes("line_1_name"));
    assert.ok(text.includes("line_1_quantity"));
    assert.ok(!text.includes("Công ty An & Bình <Việt>"));
    return new Response(JSON.stringify({ choices: [{ message: { content: `<think>Locate the table row.</think>\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` } }] }), { status: 200 });
  });
  const saved = await createTemplateFillPlan(source, quote);
  const result = new PizZip(await renderTemplate(source, { ...quote, templateFillPlan: saved, total: 33000 }));
  assert.match(result.file("word/document.xml")!.asText(), /33.000/);
  assert.match(result.file("word/document.xml")!.asText(), /Công ty An &amp; Bình &lt;Việt&gt;/);
  assert.deepEqual(result.file("word/media/logo.png")!.asNodeBuffer(), Buffer.from([1, 2, 3]));
  assert.equal(new PizZip(Buffer.from(source.data.buffer)).file("word/document.xml")!.asText(), original);
});

test("AI Excel edits retain drawings and styles, do not require named template fields", async () => {
  const sourceZip = new PizZip(officeFixture("xlsx", []));
  sourceZip.file("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Báo giá tham khảo</t></is></c></row></sheetData></worksheet>');
  const source = template(sourceZip.generate({ type: "nodebuffer" }), "xlsx"); delete source.capacity;
  const input = await templateAiContent(source);
  assert.match(JSON.stringify(input), /Báo giá tham khảo/);
  const plan = { edits: [{ part: "xl/worksheets/sheet1.xml", find: "<t>Báo giá tham khảo</t>", replace: `<t>${bindingText}</t>` }], pdfEdits: [] };
  const output = new PizZip(await renderTemplate(source, { ...quote, templateFillPlan: plan }));
  assert.match(output.file("xl/worksheets/sheet1.xml")!.asText(), /Máy lọc nước/);
  assert.equal(output.file("xl/drawings/drawing1.xml")!.asText(), "original-logo-position");
  assert.equal(output.file("xl/styles.xml")!.asText(), "original-styles");
});

test("ordinary PDF is sent as a file and can be filled without AcroForm", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([595, 842]);
  const source = template(Buffer.from(await pdf.save()), "pdf"); delete source.capacity;
  const input = await templateAiContent(source);
  assert.equal(input[0].type, "file");
  assert.match(JSON.stringify(input[0]), /data:application\/pdf;base64,/);
  const keys = ["customerName", "total", "line_1_name", "line_1_quantity", "line_1_unitPrice", "line_1_lineTotal"];
  const plan = { edits: [], pdfEdits: keys.map((key, index) => ({ page: 0, x: 30, y: 700 - index * 40, width: 500, height: 30, fontSize: 12, erase: false, text: `[[${key}]]` })) };
  const output = await PDFDocument.load(await renderTemplate(source, { ...quote, templateFillPlan: plan }));
  assert.equal(output.getPageCount(), 1);
  assert.deepEqual(output.getPage(0).getSize(), { width: 595, height: 842 });
  const outside = { ...plan, pdfEdits: plan.pdfEdits.map((entry) => ({ ...entry, x: 600 })) };
  await assert.rejects(renderTemplate(source, { ...quote, templateFillPlan: outside }), /ngoài trang/);
});

test("reject incomplete AI results, unknown bindings and edits outside template parts", async () => {
  assert.throws(() => validateFillPlan({ edits: [], pdfEdits: [] }, quote), /chưa xác định/);
  assert.throws(() => validateFillPlan({ edits: [{ part: "word/document.xml", find: "old", replace: "[[total]]" }], pdfEdits: [] }, quote), /chưa điền đủ/);
  assert.throws(() => validateFillPlan({ edits: [{ part: "word/document.xml", find: "old", replace: `${bindingText} [[inventedPrice]]` }], pdfEdits: [] }, quote), /không hợp lệ/);
  const plan = { edits: [{ part: "../outside.xml", find: "old", replace: bindingText }], pdfEdits: [] };
  await assert.rejects(renderTemplate(template(officeFixture("docx"), "docx"), { ...quote, templateFillPlan: plan }), /vị trí điền/);
});

test("AI unavailable fails explicitly instead of producing an unchanged template", async (t) => {
  const previousKey = config.openRouterApiKey; config.openRouterApiKey = "";
  t.after(() => { config.openRouterApiKey = previousKey; });
  await assert.rejects(createTemplateFillPlan(template(officeFixture("docx"), "docx"), quote), /chưa được cấu hình/);
});
