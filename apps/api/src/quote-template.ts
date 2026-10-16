import { Binary, ObjectId, type Db } from "mongodb";
import { createRequire } from "node:module";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { PDFDocument, PDFTextField, rgb } from "pdf-lib";
import { DOMParser } from "@xmldom/xmldom";
import { requestTemplatePlan } from "./ai.js";
import fontkit from "@pdf-lib/fontkit";
import type { Company, Quote, QuoteTemplateSnapshot, TemplateFillPlan } from "./types.js";

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
  capacity?: number; // Only for previously created placeholder-based quotes.
  createdAt: Date;
  uploadedBy: string;
}
const lineFields = ["sku", "name", "quantity", "unit", "unitPrice", "lineTotal"];
const tokenPattern = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

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
  const raw = await requestTemplatePlan([
    { type: "text", text: JSON.stringify({
      instruction: "Create a reusable fill plan for this actual company template. Never require the user to add placeholders. Office: edits are exact unique XML find/replace operations applied in order to the supplied parts; preserve namespaces, styles, drawings, page settings. Use only [[key]] bindings inside XML text nodes, never literal quote data. For XLSX use inlineStr cells when replacing shared-string references, preserve cell style attributes; never put localized amounts in numeric <v> cells. Duplicate existing styled table rows as needed for the specified lineCount; adjust row/cell references and merges consistently. Replace old example line items, clear unused example rows. PDF: pdfEdits places text within boxes in PDF points (bottom-left origin); erase=true covers old example text only, never labels or logo. Do not overlap boxes. Use existing pages; if layout cannot fit, return empty arrays. Include customerName, total and every available line's name, quantity, unit price and line total. Other template-specific sections can remain unchanged when no new data is supplied. Return edits=[] for PDF or pdfEdits=[] for Office.",
      lineCount: quote.lines.length,
      availableBindings: Object.keys(quoteValues(quote)),
      ...(template.extension === "pdf" ? { exampleValues: quoteValues(quote) } : {}),
    }) },
    ...await templateAiContent(template),
  ], fillSchema);
  const plan = validateFillPlan(raw, quote);
  await renderAiTemplate(template, quote, plan);
  return plan;
}

export async function getOrCreateTemplateFillPlan(db: Db, template: QuoteTemplate, quote: Quote): Promise<TemplateFillPlan> {
  const key = String(quote.lines.length);
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
    const cache = template.fillPlanCache ?? {};
    const planBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
    const otherEntries = Object.entries(cache).filter(([entryKey]) => entryKey !== key);
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
    ? db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: new ObjectId(company.quoteTemplateId), companyId }, { projection: { data: 0, fillPlanCache: 0 } }) : null;
}

export async function savedTemplate(db: Db, companyId: string, snapshot: QuoteTemplateSnapshot) {
  const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: new ObjectId(snapshot.id), companyId });
  if (!template) throw new Error("Không tìm thấy mẫu đã lưu của báo giá.");
  return template;
}

export async function renderTemplate(template: QuoteTemplate, quote: Quote) {
  const fillPlan = quote.templateFillPlan ?? template.fillPlanCache?.[String(quote.lines.length)];
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
