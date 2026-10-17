import { Binary, ObjectId, type Db } from "mongodb";
import { createRequire } from "node:module";
import { posix as pathPosix } from "node:path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { PDFDocument, PDFTextField, rgb } from "pdf-lib";
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { requestTemplatePlan } from "./ai.js";
import fontkit from "@pdf-lib/fontkit";
import type { Company, Quote, QuoteTemplateSnapshot, TemplateFillPlan, XlsxTemplateFillPlan } from "./types.js";

const require = createRequire(import.meta.url);
export const templateFormats: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};
export interface QuoteTemplate {
  _id?: ObjectId;
  name?: string;
  companyId: string;
  originalFilename: string;
  extension: string;
  bytes: number;
  data: Binary;
  fillPlanCache?: Record<string, TemplateFillPlan>;
  xlsxFillPlanCache?: Record<string, XlsxTemplateFillPlan>;
  capacity?: number; // Only for previously created placeholder-based quotes.
  createdAt: Date;
  uploadedBy: string;
}
const lineFields = ["sku", "name", "quantity", "unit", "unitPrice", "lineTotal"];
const tokenPattern = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function quoteLineDetails(line: Quote["lines"][number]) {
  const description = line.description?.trim() ? [`Mô tả: ${line.description.trim()}`] : [];
  const catalogDetails = Object.entries(line.catalogAttributes ?? {}).map(([key, value]) => `${key}: ${value}`);
  const requestedDetails = Object.entries(line.attributes ?? {}).map(([key, value]) => `Yêu cầu ${key}: ${value}`);
  return [...description, ...catalogDetails, ...requestedDetails].join(" · ");
}

const xlsxScalarKeys = ["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt", "subtotal", "taxRate", "taxAmount", "total", "currency"] as const;
const xlsxLineKeys = ["index", "sku", "name", "details", "quantity", "unit", "unitPrice", "lineTotal"] as const;
const spreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

interface XlsxCellInfo {
  ref: string;
  value: string;
  formula?: string;
  style?: string;
  type?: string;
}

interface XlsxSheetInfo {
  name: string;
  path: string;
  rows: Set<number>;
  cells: Map<string, XlsxCellInfo>;
  merged: string[];
}

interface XlsxWorkbookInfo {
  zip: PizZip;
  sheets: Map<string, XlsxSheetInfo>;
}

function validateXml(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Mẫu chứa cấu trúc XML không hỗ trợ.");
  return new DOMParser({ onError: () => { throw new Error("AI trả về cấu trúc file không hợp lệ."); } }).parseFromString(xml, "application/xml");
}

function quoteValues(quote: Quote): Record<string, string> {
  const values: Record<string, string> = {
    quoteNumber: quote.quoteNumber, customerName: quote.customerName, customerEmail: quote.customerEmail, customerPhone: quote.customerPhone ?? "",
    createdAt: new Date(quote.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    subtotal: quote.subtotal.toLocaleString("vi-VN"), taxRate: `${quote.taxRate * 100}%`, taxAmount: quote.taxAmount.toLocaleString("vi-VN"), total: quote.total.toLocaleString("vi-VN"), currency: quote.currency,
  };
  quote.lines.forEach((line, index) => {
    values[`line_${index + 1}_index`] = String(index + 1);
    for (const key of lineFields) {
      const value = line[key as keyof typeof line];
      values[`line_${index + 1}_${key}`] = typeof value === "number" ? value.toLocaleString("vi-VN") : String(value);
    }
    values[`line_${index + 1}_details`] = quoteLineDetails(line);
  });
  return values;
}

export async function templateAiContent(template: QuoteTemplate): Promise<Record<string, unknown>[]> {
  const bytes = Buffer.from(template.data.buffer);
  if (template.extension === "pdf") {
    const pdf = await PDFDocument.load(bytes);
    return [
      { type: "file", file: { filename: template.originalFilename, file_data: `data:application/pdf;base64,${bytes.toString("base64")}` } },
      { type: "text", text: JSON.stringify({ pages: pdf.getPages().map((page, index) => ({ page: index, ...page.getSize(), rotation: page.getRotation().angle })), coordinateSystem: "PDF points, origin bottom-left, page zero-based" }) },
    ];
  }
  const zip = openZip(bytes);
  // Send the complete editable Office XML, including cell styles/merges and shared strings.
  // A base64 Office ZIP is not readable by every chat provider; the original ZIP is retained for export.
  const parts = officeParts(zip, template.extension).map((part) => ({ part: part.name, xml: part.asText() }));
  const referenceNames = template.extension === "docx" ? ["word/styles.xml", "word/numbering.xml"] : ["xl/workbook.xml", "xl/styles.xml"];
  const referenceParts = referenceNames.flatMap((name) => zip.file(name) ? [{ part: name, xml: zip.file(name)!.asText() }] : []);
  const text = JSON.stringify({ filename: template.originalFilename, format: template.extension, parts, referenceParts });
  if (text.length > 600_000) throw new Error("Mẫu quá lớn để AI đọc trong một lần. Hãy dùng file mẫu gọn hơn.");
  return [{ type: "text", text }];
}

export function previewDocxHtml(bytes: Buffer, filename: string) {
  const zip = openZip(bytes);
  const part = zip.file("word/document.xml");
  if (!part) throw new Error("File Word không có nội dung xem trước.");
  const document = validateXml(part.asText());
  const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const paragraphs = Array.from(document.getElementsByTagName("*"))
    .filter((element) => element.localName === "p")
    .map((paragraph) => {
      let text = "";
      const descendants = paragraph.getElementsByTagName("*");
      for (let index = 0; index < descendants.length; index++) if (descendants.item(index)?.localName === "t") text += descendants.item(index)?.textContent ?? "";
      return text ? `<p>${escapeHtml(text)}</p>` : "";
    }).filter(Boolean).join("\n");
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(filename)}</title><style>body{font:15px/1.65 Arial,sans-serif;color:#27352c;max-width:850px;margin:32px auto;padding:32px;background:#fff;box-shadow:0 2px 18px #0001}p{margin:0 0 9px;min-height:1em}@media(max-width:600px){body{margin:0;padding:18px}}</style></head><body>${paragraphs || "<p>File không có văn bản để xem trước.</p>"}</body></html>`;
}

const fillSchema = {
  type: "object", additionalProperties: false, required: ["edits", "pdfEdits"],
  properties: {
    edits: { type: "array", items: { type: "object", additionalProperties: false, required: ["part", "find", "replace"], properties: { part: { type: "string" }, find: { type: "string" }, replace: { type: "string" } } } },
    pdfEdits: { type: "array", items: { type: "object", additionalProperties: false, required: ["page", "x", "y", "width", "height", "fontSize", "text", "erase"], properties: {
      page: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, fontSize: { type: "number" }, text: { type: "string" }, erase: { type: "boolean" },
    } } },
  },
};

export async function createTemplateFillPlan(template: QuoteTemplate, quote: Quote): Promise<TemplateFillPlan> {
  const lineDetails = quote.lines.map((line, index) => ({ line: index + 1, value: quoteLineDetails(line) }));
  const raw = await requestTemplatePlan([
    { type: "text", text: JSON.stringify({
      instruction: "Create a reusable fill plan for this actual company template. Never require the user to add placeholders. Office: edits are exact unique XML find/replace operations applied in order to the supplied parts; preserve namespaces, styles, drawings, page settings. Use only [[key]] bindings inside XML text nodes, never literal quote data. For XLSX use inlineStr cells when replacing shared-string references, preserve cell style attributes; never put localized amounts in numeric <v> cells. Duplicate existing styled table rows as needed for the specified lineCount; adjust row/cell references and merges consistently. Replace old example line items, clear unused example rows. PDF: pdfEdits places text within boxes in PDF points (bottom-left origin); erase=true covers old example text only, never labels or logo. Do not overlap boxes. Use existing pages; if layout cannot fit, return empty arrays. Include customerName, total and every available line's name, quantity, unit price and line total. When line_n_details is non-empty and the template has a suitable product specification or description area, include it with that line while keeping quantity and prices in their own fields. Other template-specific sections can remain unchanged when no new data is supplied. Return edits=[] for PDF or pdfEdits=[] for Office.",
      lineCount: quote.lines.length,
      availableBindings: Object.keys(quoteValues(quote)),
      lineDetails,
      ...(template.extension === "pdf" ? { exampleValues: quoteValues(quote) } : {}),
    }) },
    ...await templateAiContent(template),
  ], fillSchema);
  const plan = validateFillPlan(raw, quote);
  await renderAiTemplate(template, quote, plan);
  return plan;
}

export async function getOrCreateTemplateFillPlan(db: Db, template: QuoteTemplate, quote: Quote): Promise<TemplateFillPlan> {
  const hasLineDetails = quote.lines.some((line) => Boolean(quoteLineDetails(line)));
  const key = `${hasLineDetails ? "v2d" : "v2"}_${quote.lines.length}`;
  const cached = template.extension === "pdf" || quote.lines.length > 30 ? undefined : template.fillPlanCache?.[key];
  if (cached) {
    try {
      validateFillPlan(cached, quote);
      await renderAiTemplate(template, quote, cached);
      return cached;
    } catch {
      // A cached plan can fail for unusually long quote values; regenerate it for this quote.
    }
  }

  const plan = await createTemplateFillPlan(template, quote);
  if (template.extension !== "pdf" && quote.lines.length <= 30 && template._id) {
    const cache = Object.fromEntries(Object.entries(template.fillPlanCache ?? {}).filter(([entryKey]) => entryKey.startsWith("v2") && entryKey !== key));
    const planBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
    const otherEntries = Object.entries(cache);
    const cachedBytes = otherEntries.reduce((total, [, entry]) => total + Buffer.byteLength(JSON.stringify(entry), "utf8"), 0);
    if (planBytes <= 1024 * 1024 && (key in cache || otherEntries.length < 8) && cachedBytes + planBytes <= 4 * 1024 * 1024) {
      await db.collection<QuoteTemplate>("quoteTemplates").updateOne(
        { _id: template._id, companyId: template.companyId },
        { $set: { [`fillPlanCache.${key}`]: plan } },
      );
      template.fillPlanCache = { ...cache, [key]: plan };
    }
  }
  return plan;
}

export function validateFillPlan(raw: unknown, quote: Quote): TemplateFillPlan {
  if (!raw || typeof raw !== "object") throw new Error("AI chưa xác định được cách điền mẫu. Hãy thử lại.");
  const plan = raw as TemplateFillPlan;
  if (!Array.isArray(plan.edits) || !Array.isArray(plan.pdfEdits) || plan.edits.length + plan.pdfEdits.length === 0 || plan.edits.length + plan.pdfEdits.length > 2000) throw new Error("AI chưa xác định được cách điền mẫu. Hãy thử lại.");
  for (const edit of plan.edits) if (!edit || typeof edit.part !== "string" || typeof edit.find !== "string" || !edit.find || typeof edit.replace !== "string") throw new Error("AI trả về thao tác sửa mẫu không hợp lệ.");
  for (const edit of plan.pdfEdits) if (!edit || typeof edit.text !== "string" || typeof edit.erase !== "boolean" || ![edit.page, edit.x, edit.y, edit.width, edit.height, edit.fontSize].every(Number.isFinite) || !Number.isInteger(edit.page) || edit.page < 0 || edit.width <= 0 || edit.height <= 0 || edit.fontSize < 6 || edit.fontSize > 72) throw new Error("AI trả về vị trí điền PDF không hợp lệ.");
  if (JSON.stringify(plan).length > 2_000_000) throw new Error("AI trả về nội dung mẫu quá lớn.");
  const contents = [...plan.edits.map((edit) => edit.replace), ...plan.pdfEdits.map((edit) => edit.text)].join("\n");
  const values = quoteValues(quote);
  const references = new Set([...contents.matchAll(/\[\[([\w]+)\]\]/g)].map((match) => match[1]));
  for (const key of references) if (!(key in values)) throw new Error(`AI tham chiếu dữ liệu báo giá không hợp lệ: ${key}.`);
  const required = ["customerName", "total", ...quote.lines.flatMap((_, index) => ["name", "quantity", "unitPrice", "lineTotal"].map((key) => `line_${index + 1}_${key}`))];
  if (required.some((key) => !references.has(key))) throw new Error("AI chưa điền đủ dữ liệu báo giá vào mẫu. Hãy thử lại.");
  return plan;
}

async function renderAiTemplate(template: QuoteTemplate, quote: Quote, raw: TemplateFillPlan) {
  const plan = validateFillPlan(raw, quote);
  const values = quoteValues(quote);
  const interpolate = (text: string, xml = false) => text.replace(/\[\[(\w+)\]\]/g, (_token, key: string) => xml ? xmlEscape(values[key]) : values[key]);
  const bytes = Buffer.from(template.data.buffer);
  if (template.extension !== "pdf") {
    if (plan.pdfEdits.length) throw new Error("AI trả về định dạng không khớp mẫu.");
    const zip = openZip(bytes);
    const parts = new Map(officeParts(zip, template.extension).map((part) => [part.name, part.asText()]));
    const originals = new Map(parts);
    for (const edit of plan.edits) {
      const xml = parts.get(edit.part);
      if (!xml || !xml.includes(edit.find) || xml.indexOf(edit.find) !== xml.lastIndexOf(edit.find)) throw new Error("AI chưa xác định duy nhất vị trí điền trong mẫu. Hãy thử lại.");
      // Bindings must be visible text, never attributes, formulas or relationship targets.
      if (/<[^>]*\[\[/.test(edit.replace) || /<(?:\w+:)?f\b[^>]*>[^<]*\[\[/.test(edit.replace)) throw new Error("AI đặt dữ liệu ngoài vị trí văn bản của mẫu.");
      parts.set(edit.part, xml.replace(edit.find, () => edit.replace));
    }
    for (const [part, markup] of parts) {
      const document = validateXml(markup);
      const elements = document.getElementsByTagName("*");
      for (let index = 0; index < elements.length; index++) {
        const element = elements.item(index)!;
        for (let child = element.firstChild; child; child = child.nextSibling) {
          if ((child.nodeType === 3 || child.nodeType === 4) && /\[\[\w+\]\]/.test(child.nodeValue ?? "") && element.localName !== "t") throw new Error("AI đặt dữ liệu ngoài ô văn bản của mẫu.");
        }
      }
      const xml = interpolate(markup, true);
      validateXml(xml);
      if (document.documentElement?.nodeName !== validateXml(originals.get(part)!).documentElement?.nodeName) throw new Error("AI thay đổi cấu trúc gốc của mẫu.");
      const oldLinks = new Set(originals.get(part)!.match(/(?:r:id|r:embed|r:link)="[^"]*"/g));
      if ([...xml.matchAll(/(?:r:id|r:embed|r:link)="[^"]*"/g)].some((match) => !oldLinks.has(match[0]))) throw new Error("AI thêm liên kết không có trong mẫu.");
      zip.file(part, xml);
    }
    return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  }
  if (plan.edits.length) throw new Error("AI trả về định dạng không khớp mẫu.");
  const pdf = await PDFDocument.load(bytes);
  pdf.getForm().flatten({ updateFieldAppearances: false });
  pdf.registerFontkit(fontkit);
  const fonts = require("pdfmake/build/vfs_fonts.js") as Record<string, string>;
  const font = await pdf.embedFont(Buffer.from(fonts["Roboto-Regular.ttf"], "base64"), { subset: true });
  for (const [index, edit] of plan.pdfEdits.entries()) {
    const page = pdf.getPages()[edit.page];
    if (!page || edit.x < 0 || edit.y < 0 || edit.x + edit.width > page.getWidth() || edit.y + edit.height > page.getHeight()) throw new Error("AI đặt nội dung ngoài trang PDF. Hãy thử lại.");
    if (plan.pdfEdits.slice(0, index).some((other) => other.page === edit.page && edit.x < other.x + other.width && edit.x + edit.width > other.x && edit.y < other.y + other.height && edit.y + edit.height > other.y)) throw new Error("AI đặt các vùng dữ liệu PDF chồng nhau. Hãy thử lại.");
    const text = interpolate(edit.text);
    const lines = text.split(/\r?\n/);
    const widest = Math.max(1, ...lines.map((line) => font.widthOfTextAtSize(line, edit.fontSize)));
    const size = Math.min(edit.fontSize, edit.fontSize * (edit.width - 4) / widest, (edit.height - 4) / (lines.length * 1.2));
    if (size < 6) throw new Error("Nội dung chưa vừa vị trí AI chọn trong PDF. Hãy thử lại với mẫu có thêm khoảng trống.");
    if (edit.erase) page.drawRectangle({ x: edit.x, y: edit.y, width: edit.width, height: edit.height, color: rgb(1, 1, 1) });
    page.drawText(text, { x: edit.x + 2, y: edit.y + edit.height - size - 2, font, size, lineHeight: size * 1.2, color: rgb(0, 0, 0) });
  }
  return Buffer.from(await pdf.save());
}

function openZip(bytes: Buffer) {
  const zip = new PizZip(bytes);
  const entries = Object.values(zip.files);
  // Inspect declared sizes before decompressing Office XML.
  const expanded = entries.reduce((sum, entry) => sum + ((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (entries.length > 2000 || expanded > 50 * 1024 * 1024) throw new Error("Mẫu quá phức tạp hoặc vượt giới hạn giải nén 50 MB.");
  if (entries.some((entry) => /vbaProject|embeddings\//i.test(entry.name))) throw new Error("Mẫu không được chứa macro hoặc đối tượng nhúng.");
  return zip;
}

function officeParts(zip: PizZip, extension: string) {
  const root = extension === "docx" ? "word/document.xml" : "xl/workbook.xml";
  if (!zip.file(root)) throw new Error("Nội dung file không khớp định dạng mẫu.");
  return zip.file(extension === "docx" ? /^word\/(document|header\d+|footer\d+)\.xml$/ : /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/);
}

function childElements(node: Node): Element[] {
  const children: Element[] = [];
  for (let index = 0; index < node.childNodes.length; index++) {
    const child = node.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as Element);
  }
  return children;
}

function descendants(node: Node, localName: string): Element[] {
  const all = (node as Document).getElementsByTagName?.("*") ?? (node as Element).getElementsByTagName("*");
  const matches: Element[] = [];
  for (let index = 0; index < all.length; index++) {
    const element = all.item(index);
    if (element?.localName === localName) matches.push(element);
  }
  return matches;
}

function directChild(node: Node, localName: string) {
  return childElements(node).find((element) => element.localName === localName);
}

function workbookInfo(template: QuoteTemplate): XlsxWorkbookInfo {
  if (template.extension !== "xlsx") throw new Error("Ánh xạ theo ô chỉ áp dụng cho file Excel.");
  const zip = openZip(Buffer.from(template.data.buffer));
  const workbookPart = zip.file("xl/workbook.xml");
  if (!workbookPart) throw new Error("File Excel không có danh sách trang tính.");
  const workbook = validateXml(workbookPart.asText());
  const relationships = zip.file("xl/_rels/workbook.xml.rels");
  const relationTargets = new Map<string, string>();
  if (relationships) {
    for (const relation of descendants(validateXml(relationships.asText()), "Relationship")) {
      const id = relation.getAttribute("Id");
      const target = relation.getAttribute("Target");
      if (id && target) relationTargets.set(id, target.startsWith("/") ? target.slice(1) : pathPosix.normalize(pathPosix.join("xl", target)));
    }
  }
  const sharedStrings: string[] = [];
  const sharedPart = zip.file("xl/sharedStrings.xml");
  if (sharedPart) {
    for (const item of descendants(validateXml(sharedPart.asText()), "si")) sharedStrings.push(descendants(item, "t").map((text) => text.textContent ?? "").join(""));
  }

  const sheetEntries = descendants(workbook, "sheet").map((sheet, index) => ({
    name: sheet.getAttribute("name") || `Sheet${index + 1}`,
    path: relationTargets.get(sheet.getAttribute("r:id") ?? "") || `xl/worksheets/sheet${index + 1}.xml`,
  }));
  const entries = sheetEntries.length ? sheetEntries : Object.keys(zip.files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort().map((path, index) => ({ name: `Sheet${index + 1}`, path }));
  const sheets = new Map<string, XlsxSheetInfo>();
  for (const entry of entries) {
    const part = zip.file(entry.path);
    if (!part) continue;
    const document = validateXml(part.asText());
    const sheetData = descendants(document, "sheetData")[0];
    const rows = new Set<number>();
    const cells = new Map<string, XlsxCellInfo>();
    if (sheetData) {
      for (const row of descendants(sheetData, "row")) {
        const rowNumber = Number(row.getAttribute("r"));
        if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
        rows.add(rowNumber);
        for (const cell of childElements(row).filter((element) => element.localName === "c")) {
          const ref = (cell.getAttribute("r") ?? "").replace(/\$/g, "").toUpperCase();
          if (!ref) continue;
          const type = cell.getAttribute("t") || undefined;
          const formula = directChild(cell, "f")?.textContent || undefined;
          let value = directChild(cell, "v")?.textContent ?? "";
          if (type === "s" && value !== "") value = sharedStrings[Number(value)] ?? "";
          else if (type === "inlineStr") value = descendants(directChild(cell, "is") ?? cell, "t").map((text) => text.textContent ?? "").join("");
          const style = cell.getAttribute("s") ?? undefined;
          cells.set(ref, { ref, value, ...(formula ? { formula } : {}), ...(style ? { style } : {}), ...(type ? { type } : {}) });
        }
      }
    }
    const merged = descendants(document, "mergeCell").map((element) => element.getAttribute("ref")).filter((ref): ref is string => Boolean(ref));
    sheets.set(entry.name, { name: entry.name, path: entry.path, rows, cells, merged });
  }
  if (!sheets.size) throw new Error("File Excel không có trang tính để điền.");
  return { zip, sheets };
}

function xlsxWorkbookSummary(template: QuoteTemplate, info = workbookInfo(template)) {
  const sheets = [...info.sheets.values()].map((sheet) => {
    const cells = [...sheet.cells.values()].filter((cell) => cell.value !== "" || cell.formula || cell.style).map((cell) => [
      cell.ref, cell.value ? cell.value.slice(0, 160) : null, cell.formula ? cell.formula.slice(0, 120) : null, cell.style ?? null,
    ]);
    return { name: sheet.name, merged: sheet.merged.slice(0, 120), cells };
  });
  const text = JSON.stringify({ sheets });
  if (text.length > 180_000 || sheets.reduce((total, sheet) => total + sheet.cells.length, 0) > 6_000) throw new Error("Mẫu Excel có quá nhiều ô để phân tích trong một lần.");
  return text;
}

const xlsxMapSchema = {
  type: "object", additionalProperties: false, required: ["cells", "lineRows"],
  properties: {
    cells: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "sheet", "cell"], properties: { key: { type: "string", enum: [...xlsxScalarKeys] }, sheet: { type: "string" }, cell: { type: "string" } } } },
    lineRows: { type: "array", items: { type: "object", additionalProperties: false, required: ["sheet", "row", "fields"], properties: {
      sheet: { type: "string" }, row: { type: "integer" }, fields: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "cell"], properties: { key: { type: "string", enum: [...xlsxLineKeys] }, cell: { type: "string" } } } },
    } } },
  },
};

function xlsxPlanKey(quote: Quote) { return `v1_${quote.lines.length}_${quote.lines.map((line) => quoteLineDetails(line) ? "1" : "0").join("")}`; }

function normalizeSheetLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, " ").trim();
}

function headerMatch(key: typeof xlsxLineKeys[number], value: string) {
  const label = normalizeSheetLabel(value);
  if (key === "index") return ["stt", "no", "item no", "index"].includes(label);
  if (key === "sku") return /^(sku|ma san pham|ma hang|ma vat tu|ma hieu)$/.test(label);
  if (key === "name") return /^(ten san pham|ten hang hoa|ten hang|hang muc|dien giai|noi dung cong viec|san pham|hang hoa|product|item)$/.test(label);
  if (key === "quantity") return ["sl", "so luong", "khoi luong", "khoi luong thi cong", "qty", "quantity"].includes(label);
  if (key === "unitPrice") return label === "don gia" || label.startsWith("don gia ") || ["unit price", "price"].includes(label);
  if (key === "lineTotal") return label === "thanh tien" || label.startsWith("thanh tien ") || ["line total", "amount", "total amount"].includes(label);
  if (key === "unit") return ["dvt", "don vi", "don vi tinh", "unit"].includes(label);
  if (key === "details") return ["mo ta", "quy cach", "chat lieu", "thong so", "details", "description", "specification", "ghi chu"].some((term) => label.includes(term));
  return false;
}

function isCustomerLabel(value: string) {
  const label = normalizeSheetLabel(value);
  return label.startsWith("khach hang") || label === "customer" || label.startsWith("customer name");
}

function isTotalLabel(value: string) {
  const label = normalizeSheetLabel(value);
  return ["tong", "tong cong", "grand total", "total", "amount due"].includes(label);
}

function columnLetters(column: number) {
  let index = column;
  let result = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    index = Math.floor((index - 1) / 26);
  }
  return result;
}

function inferXlsxTemplateFillPlan(template: QuoteTemplate, quote: Quote): XlsxTemplateFillPlan | undefined {
  const info = workbookInfo(template);
  for (const sheet of info.sheets.values()) {
    const rowCells = new Map<number, XlsxCellInfo[]>();
    for (const cell of sheet.cells.values()) {
      const rowNumber = Number(cell.ref.match(/\d+$/)?.[0]);
      const cells = rowCells.get(rowNumber) ?? [];
      cells.push(cell);
      rowCells.set(rowNumber, cells);
    }
    const headers = [...rowCells.entries()].sort(([left], [right]) => left - right).map(([row, cells]) => {
      const columns = new Map<string, string>();
      for (const cell of cells) for (const key of xlsxLineKeys) if (!columns.has(key) && headerMatch(key, cell.value)) columns.set(key, cell.ref.match(/^[A-Z]+/)![0]);
      return { row, cells, columns };
    }).filter((entry) => ["name", "quantity", "unitPrice", "lineTotal"].every((key) => entry.columns.has(key)));
    if (!headers.length) continue;
    const header = headers[0]!;
    const customerLabel = [...sheet.cells.values()].find((cell) => isCustomerLabel(cell.value));
    if (!customerLabel) continue;
    let totalTarget: XlsxCellInfo | undefined;
    for (const cell of sheet.cells.values()) {
      if (!isTotalLabel(cell.value)) continue;
      const point = parseCellRef(cell.ref);
      if (!point) continue;
      const adjacent = sheet.cells.get(`${columnLetters(columnNumber(point.column) + 1)}${point.row}`);
      if (adjacent) { totalTarget = adjacent; break; }
    }
    if (!totalTarget) continue;
    const nameColumn = header.columns.get("name")!;
    const totalPoint = parseCellRef(totalTarget.ref)!;
    const dataRows = [...sheet.rows].filter((row) => row > header.row && row < totalPoint.row).sort((left, right) => left - right).filter((row) => {
      const nameCell = sheet.cells.get(`${nameColumn}${row}`);
      return Boolean(nameCell && ["name", "quantity", "unitPrice", "lineTotal"].every((key) => sheet.cells.has(`${header.columns.get(key)}${row}`)));
    });
    const existingRows = dataRows.filter((row) => Boolean(sheet.cells.get(`${nameColumn}${row}`)?.value.trim()));
    const candidateRows = [...existingRows, ...dataRows.filter((row) => !existingRows.includes(row))];
    if (candidateRows.length < quote.lines.length) continue;
    const columns = new Map(header.columns);
    const cells = [{ key: "customerName", sheet: sheet.name, cell: customerLabel.ref }, { key: "total", sheet: sheet.name, cell: totalTarget.ref }];
    const lineRows = candidateRows.slice(0, quote.lines.length).map((row) => ({
      sheet: sheet.name,
      row,
      fields: [...columns.entries()].filter(([key]) => ["index", "sku", "name", "details", "quantity", "unit", "unitPrice", "lineTotal"].includes(key)).map(([key, column]) => ({ key, cell: `${column}${row}` })),
    }));
    const plan: XlsxTemplateFillPlan = { cells, lineRows };
    try {
      validateXlsxTemplateFillPlan(plan, template, quote);
      return plan;
    } catch { /* This sheet's labels were ambiguous; try the next worksheet. */ }
  }
  return undefined;
}

export async function createXlsxTemplateFillPlan(template: QuoteTemplate, quote: Quote): Promise<XlsxTemplateFillPlan> {
  const inferred = inferXlsxTemplateFillPlan(template, quote);
  if (inferred) {
    renderXlsxTemplate(template, quote, inferred);
    return inferred;
  }
  const info = workbookInfo(template);
  const raw = await requestTemplatePlan([{ type: "text", text: JSON.stringify({
    instruction: "Map the supplied quote fields to existing cells in this Excel quote template. Return cell coordinates only; never return XML edits. `cells` maps scalar keys to cells. `lineRows` must contain exactly one row per quote product, in order, and all its cells must be in that same existing row. Include name, quantity, unitPrice and lineTotal for every line. Also include sku and unit when the template has columns for them, and details when it has a description/specification column. Map quoteNumber, customerName and total when those fields have a suitable location. Map other scalar keys only when the template has a matching field. Use only listed cell coordinates and row numbers; never use formulas as text cells. Formula cells may be mapped only to numeric amount/quantity fields: the server will preserve each formula and update its cached result. Do not map labels, headers, terms, seller details, logos, or decorative cells. If the template does not have enough existing product rows or a suitable place for required values, return empty arrays.",
    requiredScalars: ["customerName", "total"], availableScalars: xlsxScalarKeys, lineCount: quote.lines.length,
    lines: quote.lines.map((line, index) => ({ index: index + 1, detailsAvailable: Boolean(quoteLineDetails(line)), hasDescription: Boolean(line.description?.trim()) })),
    workbook: JSON.parse(xlsxWorkbookSummary(template, info)),
  }) }], xlsxMapSchema);
  const plan = validateXlsxTemplateFillPlan(raw, template, quote);
  renderXlsxTemplate(template, quote, plan);
  return plan;
}

export async function getOrCreateXlsxTemplateFillPlan(db: Db, template: QuoteTemplate, quote: Quote): Promise<XlsxTemplateFillPlan> {
  const key = xlsxPlanKey(quote);
  const cached = template.xlsxFillPlanCache?.[key];
  if (cached) {
    try {
      validateXlsxTemplateFillPlan(cached, template, quote);
      renderXlsxTemplate(template, quote, cached);
      return cached;
    } catch { /* A stale or malformed per-template map is regenerated below. */ }
  }
  const plan = await createXlsxTemplateFillPlan(template, quote);
  if (template._id) {
    const cache = Object.fromEntries(Object.entries(template.xlsxFillPlanCache ?? {}).filter(([entryKey]) => entryKey !== key));
    const planBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
    if (planBytes <= 256 * 1024 && Object.keys(cache).length < 20) {
      await db.collection<QuoteTemplate>("quoteTemplates").updateOne({ _id: template._id, companyId: template.companyId }, { $set: { [`xlsxFillPlanCache.${key}`]: plan } });
      template.xlsxFillPlanCache = { ...cache, [key]: plan };
    }
  }
  return plan;
}

function parseCellRef(ref: string) {
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref.replace(/\$/g, "").toUpperCase());
  return match ? { column: match[1]!, row: Number(match[2]) } : null;
}

function columnNumber(column: string) {
  let value = 0;
  for (const character of column) value = value * 26 + character.charCodeAt(0) - 64;
  return value;
}

function isMergeAnchor(ref: string, ranges: string[]) {
  const point = parseCellRef(ref);
  if (!point) return false;
  for (const range of ranges) {
    const [start, end = start] = range.split(":");
    const first = parseCellRef(start ?? "");
    const last = parseCellRef(end);
    if (!first || !last) continue;
    if (point.row >= first.row && point.row <= last.row && columnNumber(point.column) >= columnNumber(first.column) && columnNumber(point.column) <= columnNumber(last.column)) return ref === start;
  }
  return true;
}

export function validateXlsxTemplateFillPlan(raw: unknown, template: QuoteTemplate, quote: Quote): XlsxTemplateFillPlan {
  if (!raw || typeof raw !== "object") throw new Error("AI chưa xác định được các ô trong mẫu Excel.");
  const plan = raw as XlsxTemplateFillPlan;
  if (!Array.isArray(plan.cells) || !Array.isArray(plan.lineRows) || plan.lineRows.length !== quote.lines.length || plan.cells.length + plan.lineRows.reduce((sum, row) => sum + (Array.isArray(row?.fields) ? row.fields.length : 0), 0) > 2000) throw new Error("AI trả về ánh xạ Excel không hợp lệ.");
  const info = workbookInfo(template);
  const targets = new Set<string>();
  const numericKeys = new Set(["subtotal", "taxRate", "taxAmount", "total", "index", "quantity", "unitPrice", "lineTotal"]);
  const checkTarget = (sheetName: unknown, refValue: unknown, key: string, expectedRow?: number) => {
    const sheet = typeof sheetName === "string" ? info.sheets.get(sheetName) : undefined;
    const ref = typeof refValue === "string" ? refValue.replace(/\$/g, "").toUpperCase() : "";
    const point = parseCellRef(ref);
    if (!sheet || !point || expectedRow !== undefined && point.row !== expectedRow || !sheet.rows.has(point.row) || !sheet.cells.has(ref) || !isMergeAnchor(ref, sheet.merged)) throw new Error("AI đã chọn ô không hợp lệ trong mẫu Excel.");
    if (sheet.cells.get(ref)!.formula && !numericKeys.has(key)) throw new Error("AI đã chọn ô công thức cho dữ liệu văn bản.");
    const target = `${sheetName}!${ref}`;
    if (targets.has(target)) throw new Error("AI đã ánh xạ nhiều giá trị vào cùng một ô.");
    targets.add(target);
    return ref;
  };
  const scalarKeys = new Set<string>();
  for (const entry of plan.cells) {
    if (!entry || typeof entry.key !== "string" || !xlsxScalarKeys.includes(entry.key as typeof xlsxScalarKeys[number]) || scalarKeys.has(entry.key)) throw new Error("AI trả về trường thông tin Excel không hợp lệ.");
    entry.cell = checkTarget(entry.sheet, entry.cell, entry.key);
    scalarKeys.add(entry.key);
  }
  if (!scalarKeys.has("customerName") || !scalarKeys.has("total")) throw new Error("AI chưa ánh xạ tên khách hàng hoặc tổng tiền vào mẫu Excel.");
  const usedRows = new Set<string>();
  for (const row of plan.lineRows) {
    if (!row || typeof row.sheet !== "string" || !Number.isInteger(row.row) || row.row < 1 || !Array.isArray(row.fields)) throw new Error("AI trả về dòng sản phẩm Excel không hợp lệ.");
    const rowKey = `${row.sheet}!${row.row}`;
    if (usedRows.has(rowKey)) throw new Error("AI ánh xạ nhiều sản phẩm vào cùng một dòng Excel.");
    usedRows.add(rowKey);
    const fieldKeys = new Set<string>();
    for (const field of row.fields) {
      if (!field || typeof field.key !== "string" || !xlsxLineKeys.includes(field.key as typeof xlsxLineKeys[number]) || fieldKeys.has(field.key)) throw new Error("AI trả về cột sản phẩm Excel không hợp lệ.");
      field.cell = checkTarget(row.sheet, field.cell, field.key, row.row);
      fieldKeys.add(field.key);
    }
    if (!["name", "quantity", "unitPrice", "lineTotal"].every((key) => fieldKeys.has(key))) throw new Error("AI chưa ánh xạ đầy đủ tên, số lượng và giá sản phẩm vào mẫu Excel.");
  }
  return plan;
}

function xlsxQuoteValues(quote: Quote): Record<string, string | number> {
  const values: Record<string, string | number> = {
    quoteNumber: quote.quoteNumber, customerName: quote.customerName, customerEmail: quote.customerEmail, customerPhone: quote.customerPhone ?? "",
    createdAt: new Date(quote.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    subtotal: quote.subtotal, taxRate: quote.taxRate, taxAmount: quote.taxAmount, total: quote.total, currency: quote.currency,
  };
  quote.lines.forEach((line, index) => {
    const lineValues: Record<string, string | number> = {
      index: index + 1, sku: line.sku, name: line.name, description: line.description ?? "", details: quoteLineDetails(line), quantity: line.quantity,
      unit: line.unit, unitPrice: line.unitPrice, lineTotal: line.lineTotal,
    };
    for (const [key, value] of Object.entries(lineValues)) values[`line_${index + 1}_${key}`] = value;
  });
  return values;
}

function setSpreadsheetCell(cell: Element, value: string | number, formulaMode: "preserve" | "replace" | "reject") {
  let formula = directChild(cell, "f");
  if (formula && typeof value !== "number") throw new Error("Không thể thay dữ liệu văn bản trong ô công thức Excel.");
  if (formula && formulaMode === "reject") throw new Error("Không thể ghi dữ liệu vào ô công thức Excel không tương thích.");
  if (formula && formulaMode === "replace") {
    cell.removeChild(formula);
    formula = undefined;
  }
  for (const child of [...childElements(cell)]) if (child.localName === "v" || child.localName === "is") cell.removeChild(child);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Giá trị số trong báo giá không hợp lệ.");
    if (!formula) cell.removeAttribute("t");
    const numeric = cell.ownerDocument!.createElementNS(spreadsheetNamespace, "v");
    numeric.appendChild(cell.ownerDocument!.createTextNode(String(value)));
    if (formula) cell.insertBefore(numeric, formula.nextSibling);
    else cell.appendChild(numeric);
    return;
  }
  if (formula) throw new Error("Không thể thay dữ liệu văn bản trong ô công thức Excel.");
  cell.setAttribute("t", "inlineStr");
  const inline = cell.ownerDocument!.createElementNS(spreadsheetNamespace, "is");
  const text = cell.ownerDocument!.createElementNS(spreadsheetNamespace, "t");
  text.appendChild(cell.ownerDocument!.createTextNode(value));
  if (value.trim() !== value || /[\r\n]/.test(value)) text.setAttribute("xml:space", "preserve");
  inline.appendChild(text);
  cell.appendChild(inline);
}

function clearTableRows(info: XlsxWorkbookInfo, plan: XlsxTemplateFillPlan) {
  const serializer = new XMLSerializer();
  for (const sheet of info.sheets.values()) {
    const rowsForSheet = plan.lineRows.filter((row) => row.sheet === sheet.name);
    const totalEntry = plan.cells.find((entry) => entry.key === "total" && entry.sheet === sheet.name);
    const nameEntry = rowsForSheet[0]?.fields.find((field) => field.key === "name");
    const namePoint = nameEntry ? parseCellRef(nameEntry.cell) : null;
    const totalPoint = totalEntry ? parseCellRef(totalEntry.cell) : null;
    if (!rowsForSheet.length || !namePoint || !totalPoint || totalPoint.row <= namePoint.row) continue;
    let headerRow: number | undefined;
    for (let row = namePoint.row - 1; row >= Math.max(1, namePoint.row - 12); row--) {
      const headerCell = sheet.cells.get(`${namePoint.column}${row}`);
      if (headerCell && headerMatch("name", headerCell.value)) { headerRow = row; break; }
    }
    if (!headerRow) continue;
    const activeRows = new Set(rowsForSheet.map((row) => row.row));
    const measureColumns = rowsForSheet[0]!.fields.filter((field) => ["quantity", "unitPrice", "lineTotal"].includes(field.key)).map((field) => parseCellRef(field.cell)?.column).filter((value): value is string => Boolean(value));
    const imageColumn = [...sheet.cells.values()].find((cell) => Number(cell.ref.match(/\d+$/)?.[0]) === headerRow && /hinh anh|image|photo/.test(normalizeSheetLabel(cell.value)))?.ref.match(/^[A-Z]+/)?.[0];
    const document = validateXml(info.zip.file(sheet.path)!.asText());
    const cellsByRef = new Map(descendants(document, "c").map((cell) => [(cell.getAttribute("r") ?? "").replace(/\$/g, "").toUpperCase(), cell]));
    for (let row = headerRow + 1; row < totalPoint.row; row++) {
      const nameCell = sheet.cells.get(`${namePoint.column}${row}`);
      const active = activeRows.has(row);
      if (!active) {
        if (!nameCell?.value.trim()) continue;
        const hasLineValue = measureColumns.some((column) => {
          const candidate = sheet.cells.get(`${column}${row}`);
          return Boolean(candidate && (candidate.value !== "" || candidate.formula));
        });
        if (!hasLineValue) continue;
      }
      for (const cellInfo of sheet.cells.values()) {
        const point = parseCellRef(cellInfo.ref);
        if (point?.row !== row || imageColumn && point.column === imageColumn) continue;
        const cell = cellsByRef.get(cellInfo.ref);
        if (!cell) continue;
        const formula = directChild(cell, "f");
        if (formula) setSpreadsheetCell(cell, 0, "preserve");
        else if (cellInfo.value !== "") {
          for (const child of [...childElements(cell)]) if (child.localName === "v" || child.localName === "is") cell.removeChild(child);
          cell.removeAttribute("t");
        }
      }
    }
    info.zip.file(sheet.path, serializer.serializeToString(document));
    clearTableProductImages(info.zip, sheet, headerRow, totalPoint.row);
  }
}

function clearTableProductImages(zip: PizZip, sheet: XlsxSheetInfo, headerRow: number, totalRow: number) {
  const headerCells = [...sheet.cells.values()].filter((cell) => Number(cell.ref.match(/\d+$/)?.[0]) === headerRow);
  const imageHeader = headerCells.find((cell) => /hinh anh|image|photo/.test(normalizeSheetLabel(cell.value)));
  const imageColumn = imageHeader ? parseCellRef(imageHeader.ref)?.column : undefined;
  if (!imageColumn) return;
  const relPath = pathPosix.join(pathPosix.dirname(sheet.path), "_rels", `${pathPosix.basename(sheet.path)}.rels`);
  const rels = zip.file(relPath);
  if (!rels) return;
  const relationships = validateXml(rels.asText());
  const drawingTargets = descendants(relationships, "Relationship").filter((relationship) => (relationship.getAttribute("Type") ?? "").endsWith("/drawing")).map((relationship) => relationship.getAttribute("Target")).filter((target): target is string => Boolean(target));
  const serializer = new XMLSerializer();
  for (const target of drawingTargets) {
    const drawingPath = target.startsWith("/") ? target.slice(1) : pathPosix.normalize(pathPosix.join(pathPosix.dirname(sheet.path), target));
    const drawing = zip.file(drawingPath);
    if (!drawing) continue;
    let document: Document;
    try { document = validateXml(drawing.asText()); } catch { continue; }
    let changed = false;
    for (const anchor of [...descendants(document, "twoCellAnchor"), ...descendants(document, "oneCellAnchor")]) {
      const from = directChild(anchor, "from");
      const row = Number(directChild(from ?? anchor, "row")?.textContent) + 1;
      const column = Number(directChild(from ?? anchor, "col")?.textContent) + 1;
      if (!Number.isInteger(row) || row <= headerRow || row >= totalRow || column !== columnNumber(imageColumn) || !descendants(anchor, "pic").length) continue;
      anchor.parentNode?.removeChild(anchor);
      changed = true;
    }
    if (changed) zip.file(drawingPath, serializer.serializeToString(document));
  }
}

function renderXlsxTemplate(template: QuoteTemplate, quote: Quote, raw: XlsxTemplateFillPlan) {
  const plan = validateXlsxTemplateFillPlan(raw, template, quote);
  const info = workbookInfo(template);
  clearTableRows(info, plan);
  const values = xlsxQuoteValues(quote);
  const targets = [
    ...plan.cells.map((entry) => {
      const current = info.sheets.get(entry.sheet)?.cells.get(entry.cell)?.value ?? "";
      const value = entry.key === "customerName" && isCustomerLabel(current) ? `${current}${current.endsWith(" ") ? "" : " "}${values[entry.key]}` : values[entry.key];
      return { ...entry, value };
    }),
    ...plan.lineRows.flatMap((row, index) => row.fields.map((field) => ({ sheet: row.sheet, cell: field.cell, key: `line_${index + 1}_${field.key}`, value: values[`line_${index + 1}_${field.key}`] }))),
  ];
  const grouped = new Map<string, typeof targets>();
  for (const target of targets) {
    if (target.value === undefined) throw new Error("Ánh xạ Excel tham chiếu dữ liệu không có trong báo giá.");
    const list = grouped.get(target.sheet) ?? [];
    list.push(target);
    grouped.set(target.sheet, list);
  }
  const serializer = new XMLSerializer();
  for (const [sheetName, entries] of grouped) {
    const sheet = info.sheets.get(sheetName)!;
    const document = validateXml(info.zip.file(sheet.path)!.asText());
    for (const entry of entries) {
      const cell = descendants(document, "c").find((element) => (element.getAttribute("r") ?? "").replace(/\$/g, "").toUpperCase() === entry.cell);
      if (!cell) throw new Error("Không tìm thấy ô đã ánh xạ trong file Excel.");
      const formulaMode = entry.key.endsWith("_quantity") || entry.key.endsWith("_unitPrice") || entry.key.endsWith("_index") ? "replace" : ["subtotal", "taxRate", "taxAmount", "total"].includes(entry.key) || entry.key.endsWith("_lineTotal") ? "preserve" : "reject";
      setSpreadsheetCell(cell, entry.value!, formulaMode);
    }
    info.zip.file(sheet.path, serializer.serializeToString(document));
  }
  return info.zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function inspectTemplate(bytes: Buffer, extension: string) {
  if (!templateFormats[extension]) throw new Error("Hãy chọn mẫu Word (.docx), Excel (.xlsx) hoặc PDF.");
  if (extension === "pdf") {
    const pdf = await PDFDocument.load(bytes);
    if (!pdf.getPageCount()) throw new Error("File PDF không có trang.");
  } else {
    const zip = openZip(bytes);
    for (const part of officeParts(zip, extension)) validateXml(part.asText());
  }
}

export function templateDetails(template: QuoteTemplate) {
  return { id: template._id!.toHexString(), name: template.name || template.originalFilename, originalFilename: template.originalFilename, extension: template.extension, bytes: template.bytes, createdAt: template.createdAt };
}

export async function currentTemplate(db: Db, companyId: string) {
  const company = await db.collection<Company>("companies").findOne({ _id: new ObjectId(companyId) });
  return company?.quoteTemplateId && ObjectId.isValid(company.quoteTemplateId)
    ? db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: new ObjectId(company.quoteTemplateId), companyId }, { projection: { data: 0, fillPlanCache: 0, xlsxFillPlanCache: 0 } }) : null;
}

export async function savedTemplate(db: Db, companyId: string, snapshot: QuoteTemplateSnapshot) {
  const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: new ObjectId(snapshot.id), companyId });
  if (!template) throw new Error("Không tìm thấy mẫu đã lưu của báo giá.");
  return template;
}

export async function renderTemplate(template: QuoteTemplate, quote: Quote) {
  if (template.extension === "xlsx") {
    const xlsxPlan = quote.xlsxTemplateFillPlan ?? template.xlsxFillPlanCache?.[xlsxPlanKey(quote)];
    if (xlsxPlan) return renderXlsxTemplate(template, quote, xlsxPlan);
  }
  const hasLineDetails = quote.lines.some((line) => Boolean(quoteLineDetails(line)));
  const fillPlanKey = `${hasLineDetails ? "v2d" : "v2"}_${quote.lines.length}`;
  const fillPlan = quote.templateFillPlan ?? template.fillPlanCache?.[fillPlanKey] ?? template.fillPlanCache?.[String(quote.lines.length)];
  if (fillPlan) return renderAiTemplate(template, quote, fillPlan);
  if (!template.capacity) throw new Error("Báo giá chưa được AI điền theo mẫu. Vui lòng tạo lại báo giá.");
  if (quote.lines.length > template.capacity) throw new Error(`Mẫu cũ chỉ có ${template.capacity} dòng. Hãy tạo báo giá mới để AI điền mẫu.`);
  const values: Record<string, string> = {
    quoteNumber: quote.quoteNumber, customerName: quote.customerName, customerEmail: quote.customerEmail, customerPhone: quote.customerPhone ?? "",
    createdAt: new Date(quote.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    subtotal: quote.subtotal.toLocaleString("vi-VN"), taxRate: `${quote.taxRate * 100}%`, taxAmount: quote.taxAmount.toLocaleString("vi-VN"), total: quote.total.toLocaleString("vi-VN"), currency: quote.currency,
  };
  for (let row = 1; row <= template.capacity; row++) {
    const line = quote.lines[row - 1];
    values[`line_${row}_details`] = line ? quoteLineDetails(line) : "";
    for (const field of lineFields) {
      const value = line?.[field as keyof typeof line];
      values[`line_${row}_${field}`] = value == null ? "" : typeof value === "number" ? value.toLocaleString("vi-VN") : String(value);
    }
  }
  const bytes = Buffer.from(template.data.buffer);
  if (template.extension === "pdf") {
    const pdf = await PDFDocument.load(bytes);
    pdf.registerFontkit(fontkit);
    const fonts = require("pdfmake/build/vfs_fonts.js") as Record<string, string>;
    const font = await pdf.embedFont(Buffer.from(fonts["Roboto-Regular.ttf"], "base64"), { subset: true });
    const form = pdf.getForm();
    for (const field of form.getFields()) if (field instanceof PDFTextField && field.getName() in values) field.setText(values[field.getName()]);
    form.updateFieldAppearances(font);
    form.flatten();
    return Buffer.from(await pdf.save());
  }
  const zip = openZip(bytes);
  if (template.extension === "docx") {
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
    doc.render(values);
    return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  }
  // Edit only XML text tokens, leaving drawings, styles, print settings and other ZIP parts intact.
  for (const part of officeParts(zip, "xlsx")) {
    zip.file(part.name, part.asText().replace(tokenPattern, (token, key: string) => key in values ? xmlEscape(values[key]) : token));
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
