import test from "node:test";
import assert from "node:assert/strict";
import { Binary } from "mongodb";
import * as XLSX from "xlsx";
import { analyzePriceList, priceListContent, validatePriceAnalysis, type PriceList } from "./price-list.js";
import { calculateQuote } from "./pricing.js";
import { config } from "./config.js";

function fixture(): PriceList {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Bảng giá tự do"], ["Máy A", 120000]]), "Máy");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Dịch vụ B", 30000]]), "Dịch vụ");
  return { companyId: "company-a", originalFilename: "bang-gia.xlsx", bytes: 100, data: new Binary(XLSX.write(book, { type: "buffer", bookType: "xlsx" })), uploadedBy: "admin", updatedAt: new Date() };
}
const result = { status: "matched", items: [{ sku: "A", name: "Máy A", unit: "cái", price: 120000, currency: "VND", quantity: 2, evidence: "Sheet Máy, dòng 2, giá 120000" }], missingFields: [] };

test("reads every sheet without requiring catalog columns", () => {
  const content = priceListContent(fixture()).text;
  assert.match(content, /Máy A/);
  assert.match(content, /Dịch vụ B/);
});

test("validates AI prices and keeps quote candidates scoped to the company", () => {
  const parsed = validatePriceAnalysis(result, "company-a");
  assert.equal(parsed.candidates[0]!.companyId, "company-a");
  assert.equal(calculateQuote(parsed.candidates, parsed.items).subtotal, 240000);
  for (const price of [-1, Infinity, "120000"]) {
    assert.throws(() => validatePriceAnalysis({ ...result, items: [{ ...result.items[0], price }] }, "company-a"));
  }
  assert.throws(() => validatePriceAnalysis({ ...result, items: [] }, "company-a"));
});

test("sends saved workbook and request to AI and returns usable quote lines", async () => {
  const previousKey = config.openRouterApiKey;
  const previousFetch = globalThis.fetch;
  config.openRouterApiKey = "test-only";
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const content = JSON.stringify(body.messages.find((message: { role: string }) => message.role === "user").content);
    assert.match(content, /Mua 2 máy A/);
    assert.match(content, /Dịch vụ B/);
    assert.match(content, /bang-gia.xlsx/);
    assert.match(content, /bang-gia-thu-hai.xlsx/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), { status: 200 });
  };
  try {
    const analysis = await analyzePriceList("Mua 2 máy A", [fixture(), { ...fixture(), originalFilename: "bang-gia-thu-hai.xlsx" }], []);
    assert.equal(calculateQuote(analysis.candidates, analysis.items).subtotal, 240000);
  } finally { config.openRouterApiKey = previousKey; globalThis.fetch = previousFetch; }
});

test("rejects empty and mixed-company price list selections", async () => {
  await assert.rejects(analyzePriceList("Mua máy A", [], []));
  await assert.rejects(analyzePriceList("Mua máy A", [fixture(), { ...fixture(), companyId: "company-b" }], []));
});

test("file-only customer request uses exactly the selected price list and extracts customer details", async (t) => {
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-only";
  t.after(() => { config.openRouterApiKey = previousKey; });
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    const parts = body.messages.find((message: { role: string }) => message.role === "user").content;
    const content = JSON.stringify(parts);
    assert.match(content, /bang-gia-duoc-chon.xlsx/);
    assert.doesNotMatch(content, /bang-gia-thu-hai.xlsx/);
    assert.match(content, /FILE YÊU CẦU CỦA KHÁCH HÀNG/);
    assert.match(content, /Mua 2 máy A/);
    assert.match(content, /mẫu được chọn/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...result, customerName: "Công ty Minh An", customerEmail: "buyer@example.com" }) } }] }));
  });
  const analysis = await analyzePriceList("", { ...fixture(), originalFilename: "bang-gia-duoc-chon.xlsx" }, [{ type: "text", text: "mẫu được chọn" }], [{ type: "text", text: "FILE YÊU CẦU CỦA KHÁCH HÀNG: Mua 2 máy A" }]);
  assert.equal(analysis.customerName, "Công ty Minh An");
  assert.equal(analysis.customerEmail, "buyer@example.com");
  assert.equal(calculateQuote(analysis.candidates, analysis.items).subtotal, 240000);
});
