import assert from "node:assert/strict";
import test from "node:test";
import { Binary } from "mongodb";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { config } from "./config.js";
import { applyWordFillPlan, fillWordBusinessTemplate, type WordFillPlan } from "./word-template-fill.js";
import type { QuoteTemplate } from "./quote-template.js";

const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const paragraph = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
const row = (cells: string[]) => `<w:tr>${cells.map((cell) => `<w:tc>${paragraph(cell)}</w:tc>`).join("")}</w:tr>`;
function template(): QuoteTemplate {
  const zip = new PizZip();
  zip.file("word/document.xml", `<w:document xmlns:w="${ns}"><w:body><w:tbl>${row(["STT", "Mã hàng", "Chủng loại", "ĐƠN GIÁ (đ/bao)"])}${row(["1", "OLD1", "Sản phẩm cũ 1", "100"])}${row(["2", "OLD2", "Sản phẩm cũ 2", "200"])}</w:tbl><w:tbl>${row(["3", "OLD3", "Sản phẩm cũ 3", "300"])}</w:tbl>${paragraph("Điều khoản và logo giữ nguyên.")}</w:body></w:document>`);
  zip.file("word/media/logo.png", "original image");
  return { extension: "docx", data: new Binary(zip.generate({ type: "nodebuffer" })) } as QuoteTemplate;
}
const products = [{ name: "Hàng mới A", sku: "NEW-A", index: "1", unitPrice: "1.980.000" }, { name: "Hàng mới B", sku: "NEW-B", index: "2", unitPrice: "92.000" }];
const columns = [{ column: 0, key: "index" }, { column: 1, key: "sku" }, { column: 2, key: "name" }, { column: 3, key: "unitPrice" }];
const validPlan = (): WordFillPlan => ({ edits: [], tables: [{ part: "word/document.xml", table: 0, productRows: [1, 2], columns, clearOnly: false }, { part: "word/document.xml", table: 1, productRows: [0], columns, clearOnly: true }] });

test("quotation continuation tables remove every old row and fill current prices exactly once", async (t) => {
  const previous = config.openRouterApiKey; config.openRouterApiKey = "test-key"; t.after(() => { config.openRouterApiKey = previous; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: JSON.stringify(validPlan()) } }] }));
  const bytes = await fillWordBusinessTemplate(template(), {}, products, "quotation");
  const zip = new PizZip(bytes); const xml = zip.file("word/document.xml")!.asText();
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const rows = Array.from(document.getElementsByTagNameNS(ns, "tr"));
  assert.equal(rows.length, 3);
  assert.doesNotMatch(xml, /OLD[123]|Sản phẩm cũ/);
  for (const product of products) {
    assert.equal(xml.split(product.name).length - 1, 1);
    assert.ok(xml.includes(product.unitPrice));
  }
  assert.match(xml, /Điều khoản và logo giữ nguyên/);
  assert.equal(zip.file("word/media/logo.png")!.asText(), "original image");
});

test("quotation mapping retries when it omits the price, leaves old continuation rows, or repeats the new list", async (t) => {
  const previous = config.openRouterApiKey; config.openRouterApiKey = "test-key"; t.after(() => { config.openRouterApiKey = previous; });
  for (const invalid of [
    { ...validPlan(), tables: validPlan().tables.map((table) => ({ ...table, columns: columns.filter((column) => column.key !== "unitPrice") })) },
    { ...validPlan(), tables: validPlan().tables.slice(0, 1) },
    { ...validPlan(), tables: validPlan().tables.map((table) => ({ ...table, clearOnly: false })) },
  ]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: JSON.stringify(calls++ ? validPlan() : invalid) } }] }));
    const bytes = await fillWordBusinessTemplate(template(), {}, products, "quotation");
    assert.equal(calls, 2);
    assert.doesNotMatch(new PizZip(bytes).file("word/document.xml")!.asText(), /OLD3/);
    t.mock.restoreAll();
  }
});

test("clear-only removal validates row boundaries and cannot remove table headers or totals", () => {
  const plan = validPlan(); plan.tables[0]!.productRows = [0]; plan.tables[0]!.clearOnly = true;
  assert.throws(() => applyWordFillPlan(template(), {}, products, plan), /tiêu đề|tổng tiền/);
});

test("clear-only continuation rows need no unused column bindings and cannot delete an unproven row", () => {
  const plan = validPlan(); plan.tables[1]!.columns = [];
  const bytes = applyWordFillPlan(template(), {}, products, plan);
  assert.doesNotMatch(new PizZip(bytes).file("word/document.xml")!.asText(), /OLD3/);
  plan.tables[0]!.clearOnly = true; plan.tables[0]!.columns = []; plan.tables[0]!.productRows = [0];
  assert.throws(() => applyWordFillPlan(template(), {}, products, plan), /chưa xác định/);
});

test("numbered blank products and following empty rows are removed physically, including empty continuation tables", async (t) => {
  const previous = config.openRouterApiKey; config.openRouterApiKey = "test-key"; t.after(() => { config.openRouterApiKey = previous; });
  const input = template(); const zip = new PizZip(Buffer.from(input.data.buffer));
  zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace("</w:body>", `<w:tbl>${row(["1", "", "", ""])}${row(["", "", "", ""])}</w:tbl></w:body>`));
  input.data = new Binary(zip.generate({ type: "nodebuffer" }));
  const plan = validPlan(); plan.tables.push({ part: "word/document.xml", table: 2, productRows: [0, 1], columns: [], clearOnly: true });
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
  const result = await fillWordBusinessTemplate(input, {}, products, "quotation");
  const document = new DOMParser().parseFromString(new PizZip(result).file("word/document.xml")!.asText(), "application/xml");
  assert.equal(document.getElementsByTagNameNS(ns, "tbl").length, 1);
  assert.equal(document.getElementsByTagNameNS(ns, "tr").length, 3);
});

test("an overbroad clear-only selection removes proven products while preserving the adjacent header", () => {
  const plan = validPlan(); plan.tables[0]!.clearOnly = true; plan.tables[0]!.columns = []; plan.tables[0]!.productRows = [0, 1, 2];
  const result = applyWordFillPlan(template(), {}, products, plan);
  const xml = new PizZip(result).file("word/document.xml")!.asText();
  assert.match(xml, /Chủng loại/);
  assert.doesNotMatch(xml, /OLD[123]/);
});

test("quotation deletes omitted empty slots across merged gaps and removes an empty continuation section", async (t) => {
  const previous = config.openRouterApiKey; config.openRouterApiKey = "test-key"; t.after(() => { config.openRouterApiKey = previous; });
  const input = template(); const zip = new PizZip(Buffer.from(input.data.buffer));
  const mergedEmpty = `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="4"/></w:tcPr>${paragraph("")}</w:tc></w:tr>`;
  const verticallyMergedEmpty = row(["", "", "", ""]).replaceAll("<w:tc>", '<w:tc><w:tcPr><w:vMerge/></w:tcPr>');
  zip.file("word/document.xml", zip.file("word/document.xml")!.asText().replace(
    row(["3", "OLD3", "Sản phẩm cũ 3", "300"]),
    row(["3", "OLD3", "Sản phẩm cũ 3", "300"]) + row(["II", "Nhóm sản phẩm cũ"]) + row(["4", "OLD4", "Hàng cũ 4", "400"]) + verticallyMergedEmpty + mergedEmpty + verticallyMergedEmpty + mergedEmpty,
  ));
  input.data = new Binary(zip.generate({ type: "nodebuffer" }));
  const plan = validPlan(); plan.tables[1]!.productRows = [0, 2]; plan.tables[1]!.columns = [];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ choices: [{ message: { content: JSON.stringify(plan) } }] }); });
  const result = await fillWordBusinessTemplate(input, {}, products.slice(0, 1), "quotation");
  const xml = new PizZip(result).file("word/document.xml")!.asText();
  const document = new DOMParser().parseFromString(xml, "application/xml");
  assert.equal(calls, 1, "blank rows are removed by the server without another AI mapping");
  assert.equal(document.getElementsByTagNameNS(ns, "tbl").length, 1);
  assert.equal(document.getElementsByTagNameNS(ns, "tr").length, 2, "only the header and one current product remain");
  assert.doesNotMatch(xml, /OLD[1234]|Nhóm sản phẩm cũ/);
  assert.match(xml, /Điều khoản và logo giữ nguyên/);
});

test("an already-cleared template shrinks blank product rows even when the AI maps only one slot", () => {
  const input = template(); const zip = new PizZip(Buffer.from(input.data.buffer));
  const header = row(["STT", "Mã hàng", "Chủng loại", "Đơn giá"]);
  zip.file("word/document.xml", `<w:document xmlns:w="${ns}"><w:body><w:tbl>${header}${row(["", "", "", ""])}${row(["", "", "", ""])}</w:tbl>${paragraph("")}<w:tbl>${row(["II", "Nhóm cũ"])}${row(["", "", "", ""])}${row(["", "", "", ""])}</w:tbl>${paragraph("Ghi chú giữ nguyên.")}</w:body></w:document>`);
  input.data = new Binary(zip.generate({ type: "nodebuffer" }));
  const plan = validPlan(); plan.tables = [{ ...plan.tables[0]!, productRows: [1] }];
  const result = new PizZip(applyWordFillPlan(input, {}, products, plan)).file("word/document.xml")!.asText();
  const document = new DOMParser().parseFromString(result, "application/xml");
  assert.equal(document.getElementsByTagNameNS(ns, "tbl").length, 1);
  assert.equal(document.getElementsByTagNameNS(ns, "tr").length, products.length + 1);
  assert.match(result, /Ghi chú giữ nguyên/);
});

test("empty rows outside the product region, signature spaces and rows containing images are preserved", () => {
  const input = template(); const zip = new PizZip(Buffer.from(input.data.buffer));
  const before = row(["", "", "", ""]);
  const note = row(["", "Ghi chú thanh toán", "", ""]);
  const after = row(["", "", "", ""]);
  const signature = row(["", "ĐẠI DIỆN KHÁCH HÀNG", "", ""]);
  const image = row(["", "", "", ""]).replace("<w:p>", '<w:p><w:r><w:drawing/></w:r>');
  zip.file("word/document.xml", zip.file("word/document.xml")!.asText()
    .replace("<w:tbl>", `<w:tbl>${before}`)
    .replace(row(["2", "OLD2", "Sản phẩm cũ 2", "200"]), row(["2", "OLD2", "Sản phẩm cũ 2", "200"]) + note + after + signature + after)
    .replace("</w:body>", `<w:tbl>${after}${image}${after}</w:tbl></w:body>`));
  input.data = new Binary(zip.generate({ type: "nodebuffer" }));
  const plan = validPlan(); plan.tables[0]!.productRows = [2, 3];
  const result = new PizZip(applyWordFillPlan(input, {}, products, plan)).file("word/document.xml")!.asText();
  const document = new DOMParser().parseFromString(result, "application/xml");
  assert.equal(document.getElementsByTagNameNS(ns, "tr").length, 11);
  assert.equal(document.getElementsByTagNameNS(ns, "drawing").length, 1);
  assert.match(result, /Ghi chú thanh toán/);
  assert.match(result, /ĐẠI DIỆN KHÁCH HÀNG/);
});
