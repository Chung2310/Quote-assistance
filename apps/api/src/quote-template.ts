import { Binary, ObjectId, type Db } from "mongodb";
import { createRequire } from "node:module";
import { posix as pathPosix } from "node:path";
import { fillXlsxPartyNames } from "./xlsx-party-fields.js";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { PDFDocument, PDFTextField, rgb } from "pdf-lib";
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { requestTemplatePlan } from "./ai.js";
import { directDocumentEditorEnabled, editDocumentFileDirectly } from "./document-edit-ai.js";
import { words } from "./contract-pdf-reference-word.js";
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
  category?: "quote" | "estimate" | "contract" | "acceptance" | "settlement" | null;
  originalFilename: string;
  extension: string;
  bytes: number;
  data: Binary;
  fillPlanCache?: Record<string, TemplateFillPlan>;
  contractFillPlanCache?: Record<string, TemplateFillPlan>;
  acceptanceFillPlanCache?: Record<string, TemplateFillPlan>;
  xlsxFillPlanCache?: Record<string, XlsxTemplateFillPlan>;
  convertedWordData?: Binary;
  capacity?: number; // Only for previously created placeholder-based quotes.
  createdAt: Date;
  uploadedBy: string;
  deletedAt?: Date;
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

function quoteAdditionalInformation(quote: Quote) {
  return Object.entries(quote.additionalInformation ?? {}).filter(([, value]) => value.trim())
    .map(([field, value]) => `${field}: ${value.trim()}`).join("\n");
}

const xlsxScalarKeys = ["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt", "subtotal", "shippingFee", "taxRate", "taxAmount", "total", "currency", "validityDays", "completionDate", "additionalInformation", "contractNumber", "projectName", "projectAddress", "acceptanceNumber", "acceptedDate", "startTime", "endTime", "location", "result", "handoverDetails", "qualityAssessment", "contractValue", "settlementAmount", "amountPaid", "settlementBalance", "paymentDueDays", "acceptanceNotes"] as const;
const xlsxLineKeys = ["index", "sku", "name", "details", "width", "height", "length", "quantity", "unit", "unitPrice", "lineTotal", "lineTaxRate", "lineTaxAmount", "lineTotalAfterTax"] as const;
const dimensionKeys = ["width", "height", "length"] as const;
type DimensionKey = typeof dimensionKeys[number];
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
  const additionalInformation = quoteAdditionalInformation(quote);
  const values: Record<string, string> = {
    quoteNumber: quote.quoteNumber, customerName: quote.customerName, customerEmail: quote.customerEmail, customerPhone: quote.customerPhone ?? "",
    createdAt: new Date(quote.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    subtotal: quote.subtotal.toLocaleString("vi-VN"), shippingFee: (quote.shippingFee ?? 0).toLocaleString("vi-VN"), taxRate: `${quote.taxRate * 100}%`, taxAmount: quote.taxAmount.toLocaleString("vi-VN"), total: quote.total.toLocaleString("vi-VN"), currency: quote.currency,
    validityDays: quote.validityDays == null ? "" : `${quote.validityDays} ngày`,
    completionDate: quote.completionDate ? new Date(`${quote.completionDate}T00:00:00Z`).toLocaleDateString("vi-VN", { timeZone: "UTC" }) : "",
    ...(additionalInformation ? { additionalInformation } : {}),
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

export async function templateAiContent(template: QuoteTemplate, quote?: Quote): Promise<Record<string, unknown>[]> {
  const bytes = Buffer.from(template.data.buffer);
  if (template.extension === "pdf") {
    const pdf = await PDFDocument.load(bytes);
    return [
      { type: "file", file: { filename: template.originalFilename, file_data: `data:application/pdf;base64,${bytes.toString("base64")}` } },
      { type: "text", text: JSON.stringify({ pages: pdf.getPages().map((page, index) => ({ page: index, ...page.getSize(), rotation: page.getRotation().angle })), coordinateSystem: "PDF points, origin bottom-left, page zero-based" }) },
    ];
  }
  const zip = openZip(bytes);
  // Send the editable Office package structure and relationships, while the server keeps and edits the original ZIP.
  const prefix = template.extension === "docx" ? "word/" : "xl/";
  const parts = Object.keys(zip.files)
    .filter((name) => (name.startsWith(prefix) || name.startsWith("docProps/") || name === "_rels/.rels" || name === "[Content_Types].xml")
      && /(?:\.xml|\.rels)$/i.test(name) && !/^(?:word|xl)\/(?:media|embeddings)\//i.test(name))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => {
      const part = zip.file(name);
      return part ? [{ part: name, xml: part.asText() }] : [];
    });
  let aiParts = parts;
  if (template.extension === "xlsx") {
    const info = workbookInfo(template);
    const productSheetPaths = new Set([...info.sheets.values()].filter((sheet) => [...sheet.rows].some((row) => {
      const roles = new Set([...sheet.cells.values()].filter((cell) => parseCellRef(cell.ref)?.row === row)
        .flatMap((cell) => xlsxLineKeys.filter((key) => headerMatch(key, cell.value))));
      return roles.has("name") && (quote?.kind === "customer"
        ? roles.has("unitPrice")
        : roles.has("quantity") && (roles.has("unitPrice") || roles.has("lineTotal")));
    })).map((sheet) => sheet.path));
    // The workbook summary carries all tab names, labels, merged cells and relevant values.
    // Include full worksheet XML only for candidate product tables to stay within model context.
    const coreParts = new Set(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"]);
    aiParts = parts.filter(({ part }) => coreParts.has(part) || productSheetPaths.has(part));
    const compactText = JSON.stringify({ filename: template.originalFilename, format: template.extension, parts: aiParts });
    if (compactText.length > 600_000) throw new Error("CÃ¡c trang cÃ³ báº£ng sáº£n pháº©m trong máº«u Excel quÃ¡ lá»›n Ä‘á»ƒ AI Ä‘á»c trong má»™t láº§n.");
    return [{ type: "text", text: compactText }];
  }
  const text = JSON.stringify({ filename: template.originalFilename, format: template.extension, parts: aiParts });
  if (text.length > 600_000 && template.extension === "docx") {
    const compactParts = parts.map(({ part, xml }) => ({ part, xml: part.startsWith("word/") ? compactDocxXmlForAi(xml) : xml }));
    const compactText = JSON.stringify({ filename: template.originalFilename, format: template.extension, parts: compactParts });
    if (compactText.length <= 600_000) return [{ type: "text", text: compactText }];
  }
  if (text.length > 600_000) throw new Error("Mẫu quá lớn để AI đọc trong một lần. Hãy dùng file mẫu gọn hơn.");
  return [{ type: "text", text }];
}

function compactDocxXmlForAi(xml: string) {
  const fragments = xml.match(/<w:(?:tbl|tr|tc|p)\b[^>]*>|<\/w:(?:tbl|tr|tc|p)>|<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:(?:tab|br)\b[^>]*\/>/g) ?? [];
  return fragments.map((fragment) => {
    const structuralTag = fragment.match(/^<\/?w:(tbl|tr|tc|p)\b/);
    if (!structuralTag) return fragment;
    const tag = structuralTag[1];
    return fragment.startsWith("</") ? `</${tag}>` : `<${tag}>`;
  }).join("");
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

export const fillSchema = {
  type: "object", additionalProperties: false, required: ["edits", "pdfEdits"],
  properties: {
    edits: { type: "array", items: { type: "object", additionalProperties: false, required: ["part", "find", "replace"], properties: { part: { type: "string" }, find: { type: "string" }, replace: { type: "string" } } } },
    pdfEdits: { type: "array", items: { type: "object", additionalProperties: false, required: ["page", "x", "y", "width", "height", "fontSize", "text", "erase"], properties: {
      page: { type: "integer" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, fontSize: { type: "number" }, text: { type: "string" }, erase: { type: "boolean" },
    } } },
  },
};

export async function createTemplateFillPlan(template: QuoteTemplate, quote: Quote, inputContext = ""): Promise<TemplateFillPlan> {
  const lineDetails = quote.lines.map((line, index) => ({ line: index + 1, value: quoteLineDetails(line) }));
  const plan = await requestTemplatePlan<TemplateFillPlan>([
    { type: "text", text: JSON.stringify({
       instruction: "Create a reusable fill plan for this actual company template. Never require the user to add placeholders. Office: edits are exact unique XML find/replace operations applied in order to the supplied parts; preserve namespaces, styles, drawings, page settings. Use only [[key]] bindings inside XML text nodes, never literal quote data. For XLSX use inlineStr cells when replacing shared-string references, preserve cell style attributes; never put localized amounts in numeric <v> cells. Duplicate existing styled table rows as needed for the specified lineCount; adjust row/cell references and merges consistently. Replace old example line items, clear unused example rows. PDF: pdfEdits places text within boxes in PDF points (bottom-left origin); erase=true covers old example text only, never labels or logo. Do not overlap boxes. Use existing pages; if layout cannot fit, return empty arrays. Include customerName, total, subtotal, shippingFee, taxRate and taxAmount when the template has suitable matching fields, and every available line's name, quantity, unit price and line total. When line_n_details is non-empty and the template has a suitable product specification or description area, include it with that line while keeping quantity and prices in their own fields. If additionalInformation is available and the template has a clear notes or supplementary-information area, include it there. Other template-specific sections can remain unchanged when no new data is supplied. Return edits=[] for PDF or pdfEdits=[] for Office.",
      lineCount: quote.lines.length,
      sourceMayContainCurrentValues: true,
      availableBindings: Object.keys(quoteValues(quote)),
      quoteData: quoteValues(quote),
      inputContext,
      lineDetails,
    }) },
    ...await templateAiContent(template, quote),
  ], fillSchema, (raw) => validateFillPlan(raw, quote));
  await renderAiTemplate(template, quote, plan);
  return plan;
}

export async function getOrCreateTemplateFillPlan(db: Db, template: QuoteTemplate, quote: Quote): Promise<TemplateFillPlan> {
  const hasLineDetails = quote.lines.some((line) => Boolean(quoteLineDetails(line)));
  const key = `${hasLineDetails ? "v6d" : "v6"}_${quote.lines.length}_${quoteAdditionalInformation(quote) ? "i1" : "i0"}`;
  const cached = undefined;
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
    const cache = Object.fromEntries(Object.entries(template.fillPlanCache ?? {}).filter(([entryKey]) => entryKey.startsWith("v6") && entryKey !== key));
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

function setWordRunFont(run: string, font: string) {
  const fonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;
  const language = `<w:lang w:val="vi-VN" w:eastAsia="vi-VN"/>`;
  const properties = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(run);
  if (properties) {
    let content = properties[0];
    const fontTag = /<w:rFonts\b[^>]*(?:\/>|>[\s\S]*?<\/w:rFonts>)/;
    const languageTag = /<w:lang\b[^>]*(?:\/>|>[\s\S]*?<\/w:lang>)/;
    content = fontTag.test(content) ? content.replace(fontTag, fonts) : content.replace(/(<w:rPr\b[^>]*>)/, `$1${fonts}`);
    content = languageTag.test(content) ? content.replace(languageTag, language) : content.replace(/(<w:rPr\b[^>]*>)/, `$1${language}`);
    return run.replace(properties[0], content);
  }
  const emptyProperties = /<w:rPr\b[^>]*\/>/;
  if (emptyProperties.test(run)) return run.replace(emptyProperties, `<w:rPr>${fonts}${language}</w:rPr>`);
  return run.replace(/(<w:r\b[^>]*>)/, `$1<w:rPr>${fonts}${language}</w:rPr>`);
}

export function applyFontToBoundWordRuns(xml: string, font = "Arial") {
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => /\[\[\w+\]\]/.test(run) ? setWordRunFont(run, font) : run);
}

export function applyFontToAllWordRuns(xml: string, font = "Arial") {
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => setWordRunFont(run, font));
}

export function applyFontToTemplateWordParagraphs(xml: string, font = "Arial") {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!/\{[\s\S]*?\}/.test(paragraph)) return paragraph;
    return paragraph.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => setWordRunFont(run, font));
  });
}

export async function renderMappedTemplate(template: QuoteTemplate, values: Record<string, string>, plan: TemplateFillPlan, options: { boundTextFont?: string } = {}) {
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
      const preparedMarkup = options.boundTextFont ? applyFontToBoundWordRuns(markup, options.boundTextFont) : markup;
      const xml = interpolate(preparedMarkup, true);
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

async function renderAiTemplate(template: QuoteTemplate, quote: Quote, raw: TemplateFillPlan) {
  return renderMappedTemplate(template, quoteValues(quote), validateFillPlan(raw, quote));
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

export function assertXlsxWorksheetsPreserved(template: QuoteTemplate, editedBytes: Buffer) {
  const originalSheets = [...workbookInfo(template).sheets.keys()];
  const editedTemplate = { ...template, bytes: editedBytes.length, data: new Binary(editedBytes) };
  const editedSheets = [...workbookInfo(editedTemplate).sheets.keys()];
  if (originalSheets.length === editedSheets.length && originalSheets.every((name, index) => name === editedSheets[index])) return;
  const missing = originalSheets.filter((name) => !editedSheets.includes(name));
  const added = editedSheets.filter((name) => !originalSheets.includes(name));
  throw new Error(`AI đã thay đổi danh sách trang tính của file Excel. Mẫu có ${originalSheets.length} tab, file kết quả có ${editedSheets.length}. Tab bị thiếu: ${missing.join(", ") || "không có"}. Tab bị thêm hoặc đổi tên: ${added.join(", ") || "không có"}. File này chưa được lưu; mẫu gốc vẫn nguyên vẹn.`);
}

function xlsxWorkbookSummary(template: QuoteTemplate, info = workbookInfo(template), quote?: Quote, inputContext = "") {
  const candidateSheets = [...info.sheets.values()].filter((sheet) => quote && xlsxSheetHasCandidateTable(sheet, quote));
  let relevantSheets = candidateSheets;
  if (quote?.lines.length && candidateSheets.length > 1) {
    const genericWords = new Set(["camera", "san", "pham", "hang", "hoa", "dau", "ghi", "hinh", "switch", "chia", "mang", "o", "cung", "thiet", "bi"]);
    const ranked = candidateSheets.map((sheet) => {
      const examples = [...sheet.cells.values()].map((cell) => normalizeSheetLabel(cell.value)).filter(Boolean);
      const score = quote.lines.reduce((total, line) => {
        const tokens = normalizeSheetLabel(line.name).split(" ").filter((token) => token.length > 2 && !genericWords.has(token));
        const lineScore = examples.reduce((best, example) => {
          if (example === normalizeSheetLabel(line.name)) return Math.max(best, 10);
          const sharedTokens = tokens.filter((token) => example.includes(token)).length;
          return Math.max(best, sharedTokens >= 2 ? sharedTokens : 0);
        }, 0);
        return total + lineScore;
      }, 0);
      return { sheet, score, purposeScore: quote ? xlsxWorksheetPurposeScore(sheet, quote, inputContext) : 0 };
    });
    const bestPurposeScore = Math.max(...ranked.map((entry) => entry.purposeScore));
    const purposeRanked = bestPurposeScore > 0 ? ranked.filter((entry) => entry.purposeScore === bestPurposeScore) : ranked;
    purposeRanked.sort((left, right) => bestPurposeScore > 0
      ? right.score - left.score
      : right.score - left.score || right.purposeScore - left.purposeScore);
    if (purposeRanked.length === 1 && (purposeRanked[0]!.score > 0 || bestPurposeScore > 0)
      || purposeRanked.length > 1 && purposeRanked[0]!.score > purposeRanked[1]!.score) {
      relevantSheets = [purposeRanked[0]!.sheet];
    }
  }
  const relevantSheetNames = new Set(relevantSheets.map((sheet) => sheet.name));
  const hasCandidateTable = relevantSheets.length > 0;
  const sheets = [...info.sheets.values()].map((sheet) => {
    // Keep product tables intact. On other sheets retain the opening metadata and labeled totals,
    // while omitting long example tables and styled-but-empty cells from the AI context.
    const cells = [...sheet.cells.values()].filter((cell) => {
      if (cell.value === "" && !cell.formula) return false;
      if (!hasCandidateTable || relevantSheetNames.has(sheet.name)) return true;
      const row = parseCellRef(cell.ref)?.row ?? 0;
      const label = normalizeSheetLabel(cell.value);
      const referenceLabel = isCustomerLabel(cell.value) || isTotalLabel(cell.value) || Boolean(summaryScalarKey(cell.value))
        || /^(so bao gia|ma bao gia|quote|quotation|customer|client|khach hang|ten khach hang|email|e mail|dien thoai|phone|sdt|ngay|ngay lap|date)( |$)/.test(label);
      return row <= 15 || referenceLabel;
    }).map((cell) => [
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

function xlsxPlanKey(quote: Quote) {
  const dimensions = quote.lines.map((line) => dimensionKeys.map((key) => lineDimension(line, key) ? "1" : "0").join("")).join("");
  return `v6_${quote.lines.length}_${quote.lines.map((line) => quoteLineDetails(line) ? "1" : "0").join("")}_${dimensions}_${quoteAdditionalInformation(quote) ? "i1" : "i0"}`;
}

function normalizeSheetLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, " ").trim();
}

function xlsxTargetWorksheetPurpose(quote: Quote, inputContext = "") {
  if (quote.kind === "customer") return "customer quotation and customer-facing product prices";
  if (quote.kind === "budget") return "budget estimate and cost plan";
  if (/\b(quyet toan|settlement|current period|ky nay)\b/.test(normalizeSheetLabel(inputContext))) return "settlement quantities and settlement values";
  if (quote.kind === "estimate") return "estimate, quotation, or construction-cost worksheet with itemized products, quantities, and prices";
  return "estimate or quotation";
}

function xlsxWorksheetPurposeScore(sheet: XlsxSheetInfo, quote: Quote, inputContext = "") {
  const heading = [...sheet.cells.values()].filter((cell) => (parseCellRef(cell.ref)?.row ?? 0) <= 12)
    .map((cell) => cell.value).join(" ");
  const label = normalizeSheetLabel(`${sheet.name} ${heading}`);
  const has = (pattern: RegExp) => pattern.test(label);
  if (quote.kind === "customer") return (has(/\b(bao gia|quote|quotation)\b/) ? 100 : 0)
    - (has(/\b(du toan|budget|estimate|hop dong|contract|nghiem thu|acceptance|quyet toan|settlement)\b/) ? 100 : 0);
  if (quote.kind === "budget") return (has(/\b(du toan|budget|estimate|phuong an|chi phi|cost plan)\b/) ? 100 : 0)
    - (has(/\b(bao gia khach|customer quote|hop dong|contract|nghiem thu|acceptance|quyet toan|settlement)\b/) ? 100 : 0);
  if (/\b(quyet toan|settlement|current period|ky nay)\b/.test(normalizeSheetLabel(inputContext))) {
    return (has(/\b(quyet toan|settlement|nghiem thu|thanh toan)\b/) ? 100 : 0)
      + (has(/\b(gia tri|bang gia|amount|value)\b/) ? 30 : 0)
      - (has(/\b(du toan|budget|estimate|bao gia khach|customer quote|hop dong|contract)\b/) ? 100 : 0);
  }
  if (quote.kind === "estimate") return (has(/\b(du toan|budget|estimate|phuong an|chi phi|chi phi thi cong|construction cost|cost plan|bao gia|quotation|quote)\b/) ? 100 : 0)
    - (has(/\b(hop dong|contract|nghiem thu|acceptance|quyet toan|settlement)\b/) ? 100 : 0);
  return (has(/\b(du toan|estimate|bao gia|quotation|quote)\b/) ? 100 : 0)
    - (has(/\b(hop dong|contract|nghiem thu|acceptance|quyet toan|settlement)\b/) ? 100 : 0);
}

function xlsxSheetHasCandidateTable(sheet: XlsxSheetInfo, quote: Quote) {
  return [...sheet.rows].some((row) => {
    const roles = new Set([...sheet.cells.values()].filter((cell) => parseCellRef(cell.ref)?.row === row)
      .flatMap((cell) => xlsxLineKeys.filter((key) => headerMatch(key, cell.value))));
    return roles.has("name") && (quote.kind === "customer"
      ? roles.has("unitPrice")
      : quote.settlement ? roles.has("quantity") : roles.has("quantity") && (roles.has("unitPrice") || roles.has("lineTotal")));
  });
}

function assertXlsxMapMatchesPurpose(map: XlsxSemanticMap, info: XlsxWorkbookInfo, quote: Quote, inputContext = "") {
  const candidates = [...info.sheets.values()].filter((sheet) => xlsxSheetHasCandidateTable(sheet, quote));
  if (!candidates.length) return;
  const bestPurposeScore = Math.max(...candidates.map((sheet) => xlsxWorksheetPurposeScore(sheet, quote, inputContext)));
  const selected = info.sheets.get(map.sheet);
  const selectedScore = selected ? xlsxWorksheetPurposeScore(selected, quote, inputContext) : Number.NEGATIVE_INFINITY;
  const missesRecognizedPurpose = bestPurposeScore > 0 && selectedScore < bestPurposeScore;
  const onlyWrongPurposeSheetsExist = bestPurposeScore < 0 && selectedScore < 0;
  if (missesRecognizedPurpose || onlyWrongPurposeSheetsExist) {
    throw new Error("AI đã chọn nhầm tab Excel. Hãy ánh xạ đúng tab theo chức năng xuất hiện tại.");
  }
}

const dimensionAliases: Record<DimensionKey, string[]> = {
  width: ["chieu rong", "rong", "width"],
  height: ["chieu cao", "cao", "height"],
  length: ["chieu dai", "dai", "length"],
};

function matchesDimensionLabel(value: string, key: DimensionKey) {
  const padded = ` ${normalizeSheetLabel(value)} `;
  return dimensionAliases[key].some((alias) => padded.includes(` ${alias} `));
}

function lineDimension(line: Quote["lines"][number], key: DimensionKey) {
  const requested = Object.entries(line.attributes ?? {}).find(([name, value]) => value.trim() && matchesDimensionLabel(name, key))?.[1];
  if (requested) return requested.trim();
  if (line.source === "supplemental") {
    const label = dimensionAliases[key].map((alias) => alias.replace(/ /g, "\\s+")).join("|");
    const match = new RegExp(`(?:${label})\\s*[:=]?\\s*([\\d.,]+\\s*(?:mm|cm|m|inch|in)?\\b)`, "i").exec(line.description ?? "");
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function headerMatch(key: typeof xlsxLineKeys[number], value: string) {
  const label = normalizeSheetLabel(value);
  if (dimensionKeys.includes(key as DimensionKey) && matchesDimensionLabel(value, key as DimensionKey)) return true;
  if (key === "index") return ["stt", "no", "item no", "index"].includes(label);
  if (key === "sku") return /^(sku|ma san pham|ma hang|ma vat tu|ma hieu)$/.test(label);
  if (key === "name") return /^(ten san pham|ten hang hoa|ten hang hoa dich vu|ten vat tu|ten hang|hang muc|dien giai|noi dung|noi dung cong viec|san pham|hang hoa|product|item)$/.test(label);
  if (key === "quantity") return ["sl", "so luong", "so luong thi cong", "khoi luong", "khoi luong thi cong", "qty", "quantity"].includes(label);
  if (key === "unitPrice") return label === "don gia" || label.startsWith("don gia ") || ["gia ban", "gia mot don vi", "unit price", "price"].includes(label);
  if (key === "lineTotal") return (label === "thanh tien" || label.startsWith("thanh tien ") || ["line total", "amount", "total amount"].includes(label)) && !/sau thue|after tax/.test(label);
  if (key === "lineTaxRate") return /^(thue vat|thue suat|vat|vat rate|tax rate)$/.test(label);
  if (key === "lineTaxAmount") return /^(tien thue|thue gtgt|tien thue gtgt|tax amount|vat amount)$/.test(label);
  if (key === "lineTotalAfterTax") return /^(thanh tien sau thue|tong tien sau thue|amount after tax|total amount after tax)$/.test(label);
  if (key === "unit") return ["dvt", "don vi", "don vi tinh", "unit"].includes(label);
  if (key === "details") return !dimensionKeys.some((dimension) => matchesDimensionLabel(value, dimension)) && ["mo ta", "quy cach", "chat lieu", "thong so", "details", "description", "specification", "ghi chu"].some((term) => label.includes(term));
  return false;
}

function isCustomerLabel(value: string) {
  const label = normalizeSheetLabel(value);
  return label.startsWith("khach hang") || label.startsWith("ten khach hang") || label.startsWith("kinh gui") || label === "customer" || label.startsWith("customer name");
}

function isTotalLabel(value: string) {
  const label = normalizeSheetLabel(value);
  return ["tong", "tong cong", "tong thanh toan", "tong tien thanh toan", "tong cong thanh toan", "tong gia tri sau thue", "grand total", "total", "amount due"].includes(label);
}

function summaryScalarKey(value: string): typeof xlsxScalarKeys[number] | undefined {
  const label = normalizeSheetLabel(value);
  if (/^(phi van chuyen|chi phi van chuyen|phi giao hang|cuoc van chuyen|shipping fee|delivery fee)( |$)/.test(label)) return "shippingFee";
  if (/^(thue suat|vat rate|tax rate)( |$)/.test(label)) return "taxRate";
  if (/^(tam tinh|cong tien hang|tong tien hang|tien hang|subtotal|amount before tax)( |$)/.test(label)) return "subtotal";
  if (/^(tien thue|thue gia tri gia tang|tien thue gtgt|thue gtgt(?: \d+)?|thue vat|vat(?: \d+)?|tax|tax amount|vat amount)( |$)/.test(label)) return "taxAmount";
  return undefined;
}

function settlementScalarKey(value: string): typeof xlsxScalarKeys[number] | undefined {
  const colon = value.indexOf(":");
  const label = normalizeSheetLabel(colon >= 0 ? value.slice(0, colon) : value);
  if (/^(so hop dong|ma hop dong|contract number|contract no)( |$)/.test(label)) return "contractNumber";
  if (/^(du an|ten du an|project name)( |$)/.test(label)) return "projectName";
  if (/^(dia diem cong trinh|dia chi cong trinh|project address)( |$)/.test(label)) return "projectAddress";
  if (/^(so bien ban nghiem thu|so bbnt|ma bien ban nghiem thu|acceptance number|acceptance no)( |$)/.test(label)) return "acceptanceNumber";
  if (/^(ngay nghiem thu|ngay lap bien ban|accepted date)( |$)/.test(label)) return "acceptedDate";
  if (/^(gio bat dau|thoi gian bat dau|start time)( |$)/.test(label)) return "startTime";
  if (/^(gio ket thuc|thoi gian ket thuc|end time)( |$)/.test(label)) return "endTime";
  if (/^(dia diem nghiem thu|location)( |$)/.test(label)) return "location";
  if (/^(ket qua nghiem thu|ket qua|result)( |$)/.test(label)) return "result";
  if (/^(ho so ban giao|san pham ban giao|handover details)( |$)/.test(label)) return "handoverDetails";
  if (/^(danh gia chat luong|chat luong|quality assessment)( |$)/.test(label)) return "qualityAssessment";
  if (/^(gia tri hop dong|contract value|contract amount)( |$)/.test(label)) return "contractValue";
  if (/^(gia tri khoi luong quyet toan)( |$)/.test(label)) return "settlementAmount";
  if (/^(gia tri quyet toan|gia tri de nghi thanh toan|tong gia tri de nghi thanh toan|gia tri thanh toan|settlement amount|settlement value)( |$)/.test(label)) return "settlementAmount";
  if (/^(so tien da thanh toan|gia tri da thanh toan|da thanh toan|amount paid)$/.test(label)) return "amountPaid";
  if (/^(so tien con lai|con phai thanh toan|gia tri con lai|settlement balance|balance due)( |$)/.test(label)) return "settlementBalance";
  if (/^(thoi han thanh toan con lai|so ngay con lai|payment due days)( |$)/.test(label)) return "paymentDueDays";
  if (/^(ghi chu|ton tai|ghi chu ton tai|acceptance notes)( |$)/.test(label)) return "acceptanceNotes";
  return undefined;
}

function settlementValueTarget(sheet: XlsxSheetInfo, label: XlsxCellInfo) {
  if (label.formula) return undefined;
  const colon = label.value.indexOf(":");
  if (colon >= 0 && label.value.slice(colon + 1).trim()) return label.ref;
  const point = parseCellRef(label.ref);
  if (!point) return undefined;
  let lastLabelColumn = columnNumber(point.column);
  for (const range of sheet.merged) {
    const [start, end = start] = range.split(":");
    const first = parseCellRef(start ?? "");
    const last = parseCellRef(end);
    if (start === label.ref && first && last) lastLabelColumn = columnNumber(last.column);
  }
  const ref = `${columnLetters(lastLabelColumn + 1)}${point.row}`;
  return sheet.cells.get(ref)?.formula ? undefined : ref;
}

function settlementLabelPrefix(value: string, key: string) {
  const colon = value.indexOf(":");
  return colon > 0 && settlementScalarKey(value.slice(0, colon)) === key ? `${value.slice(0, colon + 1)} ` : "";
}

function isSummaryRowLabel(value: string) {
  const label = normalizeSheetLabel(value);
  return Boolean(summaryScalarKey(value)) || isTotalLabel(value) || /^(thanh toan|discount|chiet khau)$/.test(label);
}

function addRecognizedSummaryCells(plan: XlsxTemplateFillPlan, template: QuoteTemplate): XlsxTemplateFillPlan {
  const mappedKeys = new Set(plan.cells.map((cell) => cell.key));
  const occupied = new Set(plan.cells.map((cell) => `${cell.sheet}!${cell.cell.replace(/\$/g, "").toUpperCase()}`));
  for (const sheet of workbookInfo(template).sheets.values()) {
    for (const cell of sheet.cells.values()) {
      const key = summaryScalarKey(cell.value);
      if (!key || mappedKeys.has(key)) continue;
      const point = parseCellRef(cell.ref);
      if (!point) continue;
      const merge = sheet.merged.map((range) => {
        const [start, end = start] = range.split(":");
        return { start, first: parseCellRef(start ?? ""), last: parseCellRef(end) };
      }).find(({ start, first, last }) => start === cell.ref && first && last && point.row >= first.row && point.row <= last.row && columnNumber(point.column) >= columnNumber(first.column) && columnNumber(point.column) <= columnNumber(last.column));
      const targetColumn = merge?.last ? columnNumber(merge.last.column) + 1 : columnNumber(point.column) + 1;
      const targetRef = `${columnLetters(targetColumn)}${point.row}`;
      const target = sheet.cells.get(targetRef);
      if (!target || !isMergeAnchor(targetRef, sheet.merged) || target.formula && key === "taxRate") continue;
      const targetKey = `${sheet.name}!${targetRef}`;
      if (occupied.has(targetKey)) continue;
      plan.cells.push({ key, sheet: sheet.name, cell: targetRef });
      mappedKeys.add(key);
      occupied.add(targetKey);
    }
  }
  return plan;
}

async function addAiMappedSummaryCells(plan: XlsxTemplateFillPlan, template: QuoteTemplate, quote: Quote): Promise<XlsxTemplateFillPlan> {
  const summaryKeys = ["subtotal", "shippingFee", "taxRate", "taxAmount"] as const;
  const missingKeys = summaryKeys.filter((key) => !plan.cells.some((cell) => cell.key === key));
  if (!missingKeys.length) return plan;

  const schema = {
    type: "object", additionalProperties: false, required: ["cells"],
    properties: { cells: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "sheet", "cell"], properties: { key: { type: "string", enum: [...missingKeys] }, sheet: { type: "string" }, cell: { type: "string" } } } } },
  };
  const info = workbookInfo(template);
  try {
    const result = await requestTemplatePlan<{ cells: XlsxTemplateFillPlan["cells"] }>([{ type: "text", text: JSON.stringify({
      instruction: "Locate only existing summary value cells in this Excel quote template. Map each available key to the blank or numeric cell belonging to its matching row label, including merged cells; never choose a label, product row, header, or unrelated field. Look for subtotal/tạm tính, shipping fee/phí vận chuyển/giao hàng, tax rate/thuế suất, and tax amount/VAT/thuế GTGT. Return only keys with a clear matching location; do not invent cells or alter layout.",
      keys: missingKeys,
      quoteData: xlsxQuoteValues(quote),
      workbook: JSON.parse(xlsxWorkbookSummary(template, info, quote)),
    }) }, ...await templateAiContent(template, quote)], schema, (raw) => {
      if (!raw || typeof raw !== "object") throw new Error("AI returned an invalid summary map.");
      const summary = raw as { cells?: unknown };
      if (!Array.isArray(summary.cells) || summary.cells.length > missingKeys.length) throw new Error("AI returned an invalid summary map.");
      const cells = summary.cells as XlsxTemplateFillPlan["cells"];
      const candidate = { ...plan, cells: [...plan.cells, ...cells] };
      validateXlsxTemplateFillPlan(candidate, template, quote);
      const activeRows = new Set(plan.lineRows.map((row) => `${row.sheet}!${row.row}`));
      for (const cell of cells) {
        if (!missingKeys.includes(cell.key as typeof missingKeys[number])) throw new Error("AI mapped an unexpected summary field.");
        const point = parseCellRef(cell.cell);
        if (!point || activeRows.has(`${cell.sheet}!${point.row}`)) throw new Error("AI mapped a summary field to a product row.");
      }
      return { cells };
    });
    return { ...plan, cells: [...plan.cells, ...result.cells] };
  } catch {
    return plan;
  }
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
    const cells: XlsxTemplateFillPlan["cells"] = [{ key: "customerName", sheet: sheet.name, cell: customerLabel.ref }, { key: "total", sheet: sheet.name, cell: totalTarget.ref }];
    if (quoteAdditionalInformation(quote)) {
      const noteLabel = [...sheet.cells.values()].find((cell) => /^(ghi chu|thong tin bo sung|ghi chu them|additional information|notes?)$/.test(normalizeSheetLabel(cell.value)));
      const notePoint = noteLabel ? parseCellRef(noteLabel.ref) : undefined;
      const noteCell = notePoint ? sheet.cells.get(`${columnLetters(columnNumber(notePoint.column) + 1)}${notePoint.row}`) : undefined;
      if (noteCell && !noteCell.formula) cells.push({ key: "additionalInformation", sheet: sheet.name, cell: noteCell.ref });
    }
    const lineRows = candidateRows.slice(0, quote.lines.length).map((row) => ({
      sheet: sheet.name,
      row,
      fields: [...columns.entries()].filter(([key]) => xlsxLineKeys.includes(key as typeof xlsxLineKeys[number])).map(([key, column]) => ({ key, cell: `${column}${row}` })),
    }));
    const plan = addRecognizedSummaryCells({ cells, lineRows }, template);
    try {
      validateXlsxTemplateFillPlan(plan, template, quote);
      return plan;
    } catch { /* This sheet's labels were ambiguous; try the next worksheet. */ }
  }
  return undefined;
}

export async function createXlsxTemplateFillPlan(template: QuoteTemplate, quote: Quote, inputContext = "", machineSuggestedPlan?: XlsxTemplateFillPlan): Promise<XlsxTemplateFillPlan> {
  const inferred = machineSuggestedPlan ?? inferXlsxTemplateFillPlan(template, quote);
  const info = workbookInfo(template);
  const mappedPlan = await requestTemplatePlan<XlsxTemplateFillPlan>([{ type: "text", text: JSON.stringify({
    instruction: "Map the supplied quote fields to existing cells in this Excel quote template. Return cell coordinates only; never return XML edits. `cells` maps scalar keys to cells. `lineRows` must contain exactly one row per quote product, in order, and all its cells must be in that same existing row. Include name, quantity, unitPrice and lineTotal for every line. Also include sku and unit when the template has columns for them, and details when it has a description/specification column. When a requested product has width, height or length in its request attributes, map each available value to a matching dimension column in that product's row, preserving the supplied value and unit. Never invent a missing dimension. Map quoteNumber and customerName when those fields have a suitable location. Map subtotal, shippingFee, taxRate, taxAmount and total to matching summary rows when present (for example tạm tính, phí vận chuyển, thuế suất, VAT/thuế GTGT and tổng thanh toán). Map additionalInformation only when supplied and when the template has a clear notes or supplementary-information cell. Map other scalar keys only when the template has a matching field. Use only listed cell coordinates and row numbers; never use formulas as text cells. Formula cells may be mapped only to numeric amount/quantity fields: the server will preserve each formula and update its cached result. Do not map labels, headers, terms, seller details, logos, or decorative cells. If the template does not have enough existing product rows or a suitable place for required values, return empty arrays.",
    requiredScalars: ["customerName", "total"], targetWorksheetPurpose: xlsxTargetWorksheetPurpose(quote, inputContext),
    worksheetSelectionRule: "When a workbook has multiple tabs, map this export only to the tab whose name, title and headers match targetWorksheetPurpose. Leave unrelated quote, budget, contract, acceptance and settlement tabs unchanged.",
    availableScalars: xlsxScalarKeys.filter((key) => key !== "additionalInformation" || Boolean(quoteAdditionalInformation(quote))), lineCount: quote.lines.length,
    quoteData: xlsxQuoteValues(quote), inputContext, sourceMayContainCurrentValues: true, machineSuggestedPlan: inferred ?? null,
    lines: quote.lines.map((line, index) => ({ index: index + 1, detailsAvailable: Boolean(quoteLineDetails(line)), hasDescription: Boolean(line.description?.trim()), dimensionsAvailable: Object.fromEntries(dimensionKeys.map((key) => [key, Boolean(lineDimension(line, key))])) })),
    workbook: JSON.parse(xlsxWorkbookSummary(template, info, quote, inputContext)),
  }) }, ...await templateAiContent(template, quote)], xlsxMapSchema, (raw) => validateXlsxTemplateFillPlan(raw, template, quote));
  const plan = await addAiMappedSummaryCells(addRecognizedSummaryCells(mappedPlan, template), template, quote);
  validateXlsxTemplateFillPlan(plan, template, quote);
  renderXlsxTemplate(template, quote, plan, inputContext);
  return plan;
}

export async function getOrCreateXlsxTemplateFillPlan(db: Db, template: QuoteTemplate, quote: Quote, inputContext = ""): Promise<XlsxTemplateFillPlan> {
  const key = xlsxPlanKey(quote);
  const cached = undefined;
  if (cached) {
    try {
      const plan = await addAiMappedSummaryCells(addRecognizedSummaryCells(structuredClone(cached), template), template, quote);
      validateXlsxTemplateFillPlan(plan, template, quote);
      renderXlsxTemplate(template, quote, plan, inputContext);
      if (JSON.stringify(plan) !== JSON.stringify(cached) && template._id) {
        await db.collection<QuoteTemplate>("quoteTemplates").updateOne({ _id: template._id, companyId: template.companyId }, { $set: { [`xlsxFillPlanCache.${key}`]: plan } });
        template.xlsxFillPlanCache = { ...template.xlsxFillPlanCache, [key]: plan };
      }
      return plan;
    } catch { /* A stale or malformed per-template map is regenerated below. */ }
  }
  const plan = await createXlsxTemplateFillPlan(template, quote, inputContext);
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
  const numericKeys = new Set(["subtotal", "shippingFee", "taxRate", "taxAmount", "total", "index", "quantity", "unitPrice", "lineTotal", "lineTaxRate", "lineTaxAmount", "lineTotalAfterTax", "contractValue", "settlementAmount", "amountPaid", "settlementBalance", "paymentDueDays"]);
  const checkTarget = (sheetName: unknown, refValue: unknown, key: string, expectedRow?: number) => {
    const sheet = typeof sheetName === "string" ? info.sheets.get(sheetName) : undefined;
    const ref = typeof refValue === "string" ? refValue.replace(/\$/g, "").toUpperCase() : "";
    const point = parseCellRef(ref);
    if (!sheet || !point || expectedRow !== undefined && point.row !== expectedRow || !sheet.rows.has(point.row) || !sheet.cells.has(ref) || !isMergeAnchor(ref, sheet.merged)) throw new Error(`Vị trí ô Excel ${String(sheetName)}!${ref} không hợp lệ cho trường ${key}.`);
    if (sheet.cells.get(ref)!.formula && !numericKeys.has(key)) throw new Error("AI đã chọn ô công thức cho dữ liệu văn bản.");
    const target = `${sheetName}!${ref}`;
    if (targets.has(target)) throw new Error("AI đã ánh xạ nhiều giá trị vào cùng một ô.");
    targets.add(target);
    return ref;
  };
  const scalarKeys = new Set<string>();
  for (const entry of plan.cells) {
    const scopedKey = entry ? `${entry.sheet}!${entry.key}` : "";
    if (!entry || typeof entry.key !== "string" || !xlsxScalarKeys.includes(entry.key as typeof xlsxScalarKeys[number]) || scalarKeys.has(scopedKey)) throw new Error("Invalid Excel scalar mapping.");
    entry.cell = checkTarget(entry.sheet, entry.cell, entry.key);
    scalarKeys.add(scopedKey);
  }  if (quote.kind === "customer" && plan.cells.some((entry) => !["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt"].includes(entry.key))) throw new Error("Mẫu báo giá khách không được ánh xạ trường tính tiền.");
  const usedRows = new Set<string>();
  for (const row of plan.lineRows) {
    if (!row || typeof row.sheet !== "string" || !Number.isInteger(row.row) || row.row < 1 || !Array.isArray(row.fields)) throw new Error("AI trả về dòng sản phẩm Excel không hợp lệ.");
    const rowKey = `${row.sheet}!${row.row}`;
    if (usedRows.has(rowKey)) throw new Error("AI ánh xạ nhiều sản phẩm vào cùng một dòng Excel.");
    usedRows.add(rowKey);
    const fieldKeys = new Set<string>();
    for (const field of row.fields) {
      if (!field || typeof field.key !== "string" || !xlsxLineKeys.includes(field.key as typeof xlsxLineKeys[number]) || fieldKeys.has(field.key)
        || quote.kind === "customer" && !["index", "sku", "name", "details", "unit", "unitPrice"].includes(field.key)) throw new Error("AI trả về cột sản phẩm Excel không hợp lệ.");
      field.cell = checkTarget(row.sheet, field.cell, field.key, row.row);
      fieldKeys.add(field.key);
    }
    if (!fieldKeys.has("name") || quote.kind !== "customer" && quote.kind !== "budget" && !fieldKeys.has("quantity")
      || quote.kind === "customer" && !fieldKeys.has("unitPrice")
      || quote.kind !== "customer" && !quote.settlement && !["unitPrice", "lineTotal"].some((key) => fieldKeys.has(key))) throw new Error("AI chưa ánh xạ đủ cột sản phẩm, số lượng và giá vào mẫu Excel.");
  }
  return plan;
}

function xlsxQuoteValues(quote: Quote): Record<string, string | number> {
  const additionalInformation = quoteAdditionalInformation(quote);
  const values: Record<string, string | number> = {
    quoteNumber: quote.quoteNumber, customerName: quote.customerName, customerEmail: quote.customerEmail, customerPhone: quote.customerPhone ?? "",
    createdAt: new Date(quote.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    subtotal: quote.subtotalUnknown ? "" : quote.subtotal, shippingFee: quote.shippingFeeConfirmed === false ? "" : quote.shippingFee ?? 0,
    taxRate: quote.taxRateConfirmed === false ? "" : quote.taxRate, taxAmount: quote.taxRateConfirmed === false ? "" : quote.taxAmount,
    total: quote.totalUnknown ? "" : quote.total, currency: quote.currency,
    totalInWords: quote.totalUnknown ? "" : words(quote.total, quote.currency),
    validityDays: quote.validityDays ?? "",
    completionDate: quote.completionDate ? new Date(`${quote.completionDate}T00:00:00Z`).toLocaleDateString("vi-VN", { timeZone: "UTC" }) : "",
    ...(additionalInformation ? { additionalInformation } : {}),
  };
  if (quote.settlement) Object.assign(values, {
    contractNumber: quote.settlement.contractNumber,
    projectName: quote.settlement.projectName,
    projectAddress: quote.settlement.projectAddress,
    acceptanceNumber: quote.settlement.acceptanceNumber,
    acceptedDate: new Date(`${quote.settlement.acceptedDate}T00:00:00Z`).toLocaleDateString("vi-VN", { timeZone: "UTC" }),
    startTime: quote.settlement.startTime,
    endTime: quote.settlement.endTime,
    location: quote.settlement.location,
    result: quote.settlement.result,
    handoverDetails: quote.settlement.handoverDetails,
    qualityAssessment: quote.settlement.qualityAssessment,
    contractValue: quote.settlement.contractValue,
    settlementAmount: quote.settlement.settlementAmount,
    settlementAmountInWords: words(quote.settlement.settlementAmount, quote.currency),
    amountPaid: quote.settlement.amountPaid,
    amountPaidInWords: words(quote.settlement.amountPaid, quote.currency),
    settlementBalance: quote.settlement.balance,
    settlementBalanceInWords: words(quote.settlement.balance, quote.currency),
    paymentDueDays: quote.settlement.paymentDueDays ?? "",
    acceptanceNotes: quote.settlement.notes,
  });
  quote.lines.forEach((line, index) => {
    const lineValues: Record<string, string | number> = {
      index: index + 1, sku: line.sku, name: line.name, description: line.description ?? "", details: quoteLineDetails(line),
      width: lineDimension(line, "width"), height: lineDimension(line, "height"), length: lineDimension(line, "length"), quantity: line.quantityUnknown ? "" : line.quantity,
      unit: line.unit, unitPrice: line.priceUnavailable ? "" : line.unitPrice, lineTotal: line.lineTotalUnknown ? "" : line.lineTotal,
      lineTaxRate: quote.taxRateConfirmed === false ? "" : quote.taxRate,
      lineTaxAmount: line.lineTotalUnknown || quote.taxRateConfirmed === false ? "" : Math.round(line.lineTotal * quote.taxRate * 100) / 100,
      lineTotalAfterTax: line.lineTotalUnknown || quote.taxRateConfirmed === false ? "" : Math.round(line.lineTotal * (1 + quote.taxRate)),
    };
    for (const [key, value] of Object.entries(lineValues)) values[`line_${index + 1}_${key}`] = value;
  });
  return values;
}

function directDocumentData(quote: Quote, documentKind: string) {
  const businessFields = xlsxQuoteValues(quote);
  if (quote.kind === "customer") {
    for (const key of ["subtotal", "shippingFee", "taxRate", "taxAmount", "total", "totalInWords"]) delete businessFields[key];
    for (const key of Object.keys(businessFields)) {
      if (/^line_\d+_(?:quantity|lineTotal|lineTaxRate|lineTaxAmount|lineTotalAfterTax)$/.test(key)) delete businessFields[key];
    }
  }
  return {
    documentKind,
    businessFields,
    products: quote.lines.map((line, index) => ({
      index: index + 1,
      sku: line.sku,
      name: line.name,
      description: line.description ?? "",
      ...((quote.kind === "customer" || line.quantityUnknown) ? {} : { quantity: line.quantity }),
      unit: line.unit,
      unitPrice: line.priceUnavailable ? null : line.unitPrice,
      ...(quote.kind === "customer" || line.lineTotalUnknown ? {} : { lineTotal: line.lineTotal }),
      currency: line.currency,
      attributes: line.attributes,
      catalogAttributes: line.catalogAttributes ?? {},
    })),
    additionalInformation: quoteAdditionalInformation(quote),
    settlement: quote.settlement ?? null,
    contract: quote.settlement?.contract ?? null,
    contractProducts: quote.settlement?.contractLines?.map((line, index) => ({
      index: index + 1, sku: line.sku, name: line.name, description: line.description ?? "",
      quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, lineTotal: line.lineTotal,
      currency: line.currency, attributes: line.attributes, catalogAttributes: line.catalogAttributes ?? {},
    })) ?? null,
    missingProducts: quote.missingProducts ?? [],
  };
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

function clearTableRows(info: XlsxWorkbookInfo, plan: XlsxTemplateFillPlan, inputContext: string) {
  const serializer = new XMLSerializer();
  const requestedText = normalizeSheetLabel(inputContext);
  for (const sheet of info.sheets.values()) {
    const rowsForSheet = plan.lineRows.filter((row) => row.sheet === sheet.name);
    const totalEntry = plan.cells.find((entry) => entry.key === "total" && entry.sheet === sheet.name);
    const nameEntry = rowsForSheet[0]?.fields.find((field) => field.key === "name");
    const namePoint = nameEntry ? parseCellRef(nameEntry.cell) : null;
    const totalPoint = totalEntry ? parseCellRef(totalEntry.cell) : plan.tableEndRow ? { column: "A", row: plan.tableEndRow } : null;
    if (!rowsForSheet.length || !namePoint || !totalPoint || totalPoint.row <= namePoint.row) continue;
    let headerRow: number | undefined = plan.tableHeaderRow;
    if (!headerRow) for (let row = namePoint.row - 1; row >= Math.max(1, namePoint.row - 12); row--) {
      const headerCell = sheet.cells.get(`${namePoint.column}${row}`);
      if (headerCell && headerMatch("name", headerCell.value)) { headerRow = row; break; }
    }
    if (!headerRow) continue;
    const activeRows = new Set(rowsForSheet.map((row) => row.row));
    const firstProductRow = Math.min(...rowsForSheet.map((row) => row.row));
    const preserveContractColumns = /\b(quyet toan|settlement|current period|ky nay)\b/.test(requestedText);
    const parallelColumns = new Map<string, Set<string>>();
    for (const key of ["quantity", "unitPrice", "lineTotal", "lineTaxRate", "lineTaxAmount", "lineTotalAfterTax"] as const) {
      const mappedField = rowsForSheet[0]!.fields.find((field) => field.key === key);
      const mappedColumn = mappedField ? parseCellRef(mappedField.cell)?.column : undefined;
      const columns = new Set<string>();
      if (mappedColumn) {
        for (const cell of sheet.cells.values()) {
          const point = parseCellRef(cell.ref);
          if ((!point || point.row !== headerRow && point.row !== headerRow + 1) || !headerMatch(key, cell.value)) continue;
          for (const range of sheet.merged) {
            const [start, end = start] = range.split(":");
            const first = parseCellRef(start ?? "");
            const last = parseCellRef(end);
            if (!first || !last || point.row < first.row || point.row > last.row
              || columnNumber(mappedColumn) < columnNumber(first.column) || columnNumber(mappedColumn) > columnNumber(last.column)) continue;
            for (let column = columnNumber(first.column); column <= columnNumber(last.column); column++) columns.add(columnLetters(column));
          }
        }
        if (!columns.size) columns.add(mappedColumn);
      }
      parallelColumns.set(key, columns);
    }
    const contractVariantColumns = new Set<string>();
    if (preserveContractColumns) for (const columns of parallelColumns.values()) for (const column of columns) {
      const childLabel = normalizeSheetLabel(sheet.cells.get(`${column}${headerRow + 1}`)?.value ?? "");
      if (/^(theo hop dong|contract|contract quantity|contract amount)$/.test(childLabel)) contractVariantColumns.add(column);
    }
    const mappedSummaryRows = new Set(plan.cells.filter((entry) => entry.sheet === sheet.name && ["subtotal", "shippingFee", "taxRate", "taxAmount", "total"].includes(entry.key))
      .map((entry) => parseCellRef(entry.cell)?.row).filter((row): row is number => row !== undefined));
    const measureColumns = rowsForSheet[0]!.fields.filter((field) => ["quantity", "unitPrice", "lineTotal", "lineTaxRate", "lineTaxAmount", "lineTotalAfterTax"].includes(field.key)).map((field) => parseCellRef(field.cell)?.column).filter((value): value is string => Boolean(value));
    const productColumns = ["name", "quantity", "unitPrice", "lineTotal"].map((key) => {
      const field = rowsForSheet[0]!.fields.find((entry) => entry.key === key);
      return field ? parseCellRef(field.cell)?.column : undefined;
    }).filter((column): column is string => Boolean(column));
    if (!productColumns.includes(namePoint.column) || productColumns.length < 2) continue;
    const imageColumn = [...sheet.cells.values()].find((cell) => Number(cell.ref.match(/\d+$/)?.[0]) === headerRow && /hinh anh|image|photo/.test(normalizeSheetLabel(cell.value)))?.ref.match(/^[A-Z]+/)?.[0];
    const document = validateXml(info.zip.file(sheet.path)!.asText());
    const rowNodes = new Map(descendants(document, "row").map((row) => [Number(row.getAttribute("r")), row]));
    const cellsByRef = new Map(descendants(document, "c").map((cell) => [(cell.getAttribute("r") ?? "").replace(/\$/g, "").toUpperCase(), cell]));
    for (let row = Math.max(headerRow + 1, firstProductRow); row < totalPoint.row; row++) {
      const nameCell = sheet.cells.get(`${namePoint.column}${row}`);
      const labelCell = nameCell?.value.trim() ? nameCell : [...sheet.cells.values()]
        .filter((cell) => Number(cell.ref.match(/\d+$/)?.[0]) === row && cell.value.trim())
        .sort((left, right) => columnNumber(parseCellRef(left.ref)?.column ?? "A") - columnNumber(parseCellRef(right.ref)?.column ?? "A"))
        .find((cell) => columnNumber(parseCellRef(cell.ref)?.column ?? "A") <= columnNumber(namePoint.column));
      const active = activeRows.has(row);
      const isProductRow = productColumns.every((column) => sheet.cells.has(`${column}${row}`));
      const label = normalizeSheetLabel(labelCell?.value ?? "");
      const hasLineValues = measureColumns.some((column) => {
        const cell = sheet.cells.get(`${column}${row}`);
        return Boolean(cell && cell.value !== "" && (!cell.formula || Number(cell.value) !== 0));
      });
      const isSummaryRow = mappedSummaryRows.has(row) || isSummaryRowLabel(label);
      if (isSummaryRow && (isProductRow || mappedSummaryRows.has(row))) {
        for (const column of measureColumns) {
          const cellInfo = sheet.cells.get(`${column}${row}`);
          const cell = cellsByRef.get(`${column}${row}`);
          if (!cellInfo || !cell) continue;
          if (cellInfo.formula) setSpreadsheetCell(cell, 0, "preserve");
          else if (cellInfo.value !== "") {
            for (const child of [...childElements(cell)]) if (child.localName === "v" || child.localName === "is") cell.removeChild(child);
            cell.removeAttribute("t");
          }
        }
        for (const [key, columns] of parallelColumns) {
          const mappedField = rowsForSheet[0]!.fields.find((field) => field.key === key);
          const mappedColumn = mappedField ? parseCellRef(mappedField.cell)?.column : undefined;
          for (const column of columns) {
            if (column === mappedColumn) continue;
            if (preserveContractColumns && contractVariantColumns.has(column)) continue;
            const cell = cellsByRef.get(`${column}${row}`);
            if (cell) clearSpreadsheetCell(cell);
          }
        }
        rowNodes.get(row)?.removeAttribute("hidden");
        continue;
      }
      const rowNode = rowNodes.get(row);
      if (isSummaryRow) {
        rowNode?.removeAttribute("hidden");
        continue;
      }
      if (!active && label && !hasLineValues && !isSummaryRow) {
        const words = label.split(" ");
        const titlePhrases = [label];
        for (let start = 0; start < words.length - 1; start++) {
          for (let end = start + 2; end <= words.length; end++) titlePhrases.push(words.slice(start, end).join(" "));
        }
        const requested = titlePhrases.some((phrase) => phrase.length >= 5 && requestedText.includes(phrase));
        if (requested) rowNode?.removeAttribute("hidden");
        else {
          rowNode?.setAttribute("hidden", "1");
          for (const cellInfo of sheet.cells.values()) {
            if (Number(cellInfo.ref.match(/\d+$/)?.[0]) !== row || cellInfo.formula || cellInfo.value === "") continue;
            const cell = cellsByRef.get(cellInfo.ref);
            if (!cell) continue;
            for (const child of [...childElements(cell)]) if (child.localName === "v" || child.localName === "is") cell.removeChild(child);
            cell.removeAttribute("t");
          }
        }
        continue;
      }
      if (!isProductRow) continue;
      if (isSummaryRow) continue;
      if (active) {
        rowNode?.removeAttribute("hidden");
        const activeLine = rowsForSheet.find((line) => line.row === row);
        const mappedCellRefs = new Set(activeLine?.fields.map((field) => field.cell.replace(/\$/g, "").toUpperCase()) ?? []);
        for (const cellInfo of sheet.cells.values()) {
          const point = parseCellRef(cellInfo.ref);
          if (point?.row !== row || mappedCellRefs.has(cellInfo.ref) || imageColumn && point.column === imageColumn
            || preserveContractColumns && contractVariantColumns.has(point.column)) continue;
          const cell = cellsByRef.get(cellInfo.ref);
          if (cell) clearSpreadsheetCell(cell);
        }
        for (const [key, columns] of parallelColumns) {
          const mappedField = rowsForSheet[0]!.fields.find((field) => field.key === key);
          const mappedColumn = mappedField ? parseCellRef(mappedField.cell)?.column : undefined;
          for (const column of columns) {
            if (column === mappedColumn) continue;
            if (preserveContractColumns && contractVariantColumns.has(column)) continue;
            const cell = cellsByRef.get(`${column}${row}`);
            if (cell) clearSpreadsheetCell(cell);
          }
        }
        continue;
      }
      rowNode?.setAttribute("hidden", "1");
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
    for (const row of mappedSummaryRows) {
      rowNodes.get(row)?.removeAttribute("hidden");
      for (const [key, columns] of parallelColumns) {
        const mappedField = rowsForSheet[0]!.fields.find((field) => field.key === key);
        const mappedColumn = mappedField ? parseCellRef(mappedField.cell)?.column : undefined;
        for (const column of columns) {
          if (column === mappedColumn) continue;
          if (preserveContractColumns && contractVariantColumns.has(column)) continue;
          const cell = cellsByRef.get(`${column}${row}`);
          if (cell) clearSpreadsheetCell(cell);
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

function addFallbackSummaryRows(info: XlsxWorkbookInfo, plan: XlsxTemplateFillPlan) {
  const labels = {
    subtotal: "Tạm tính",
    shippingFee: "Phí vận chuyển",
    taxRate: "Thuế suất VAT",
    taxAmount: "Tiền thuế VAT",
  } as const;
  const missing = (Object.keys(labels) as (keyof typeof labels)[]).filter((key) => !plan.cells.some((entry) => entry.key === key));
  const taxRateStringTargets = new Set<string>();
  if (!missing.length) return taxRateStringTargets;

  const totalEntry = plan.cells.find((entry) => entry.key === "total");
  const totalPoint = totalEntry ? parseCellRef(totalEntry.cell) : null;
  const sheet = totalEntry ? info.sheets.get(totalEntry.sheet) : undefined;
  if (!totalEntry || !totalPoint || !sheet) return taxRateStringTargets;

  const rowLabel = [...sheet.cells.values()]
    .filter((cell) => Number(cell.ref.match(/\d+$/)?.[0]) === totalPoint.row && isTotalLabel(cell.value))
    .sort((left, right) => columnNumber(parseCellRef(right.ref)?.column ?? "A") - columnNumber(parseCellRef(left.ref)?.column ?? "A"))[0];
  const fallbackName = plan.lineRows.find((row) => row.sheet === sheet.name)?.fields.find((field) => field.key === "name");
  const fallbackNamePoint = fallbackName ? parseCellRef(fallbackName.cell) : null;
  const proposedLabelColumn = (rowLabel && parseCellRef(rowLabel.ref)?.column) || fallbackNamePoint?.column || columnLetters(Math.max(1, columnNumber(totalPoint.column) - 1));
  const labelColumn = proposedLabelColumn === totalPoint.column
    ? columnLetters(columnNumber(totalPoint.column) > 1 ? columnNumber(totalPoint.column) - 1 : 2)
    : proposedLabelColumn;
  const labelSource = rowLabel ?? (fallbackName ? sheet.cells.get(fallbackName.cell) : undefined);
  const amountSource = sheet.cells.get(totalEntry.cell);
  const maxProductRow = Math.max(0, ...plan.lineRows.filter((row) => row.sheet === sheet.name).map((row) => row.row));
  const blankRows: number[] = [];
  for (let row = maxProductRow + 1; row < totalPoint.row; row++) {
    const occupied = [...sheet.cells.values()].some((cell) => Number(cell.ref.match(/\d+$/)?.[0]) === row && (cell.value.trim() !== "" || Boolean(cell.formula)));
    const labelRef = `${labelColumn}${row}`;
    const amountRef = `${totalPoint.column}${row}`;
    if (!occupied && labelRef !== amountRef && isMergeAnchor(labelRef, sheet.merged) && isMergeAnchor(amountRef, sheet.merged)) blankRows.push(row);
  }
  if (blankRows.length < missing.length) blankRows.length = 0;
  const maxUsedRow = Math.max(0, ...sheet.rows);
  const rows = [...blankRows];
  while (rows.length < missing.length) rows.push(maxUsedRow + rows.length - blankRows.length + 1);

  const document = validateXml(info.zip.file(sheet.path)!.asText());
  const root = document.documentElement;
  if (!root) return taxRateStringTargets;
  let sheetData = descendants(document, "sheetData")[0];
  if (!sheetData) {
    sheetData = document.createElementNS(spreadsheetNamespace, "sheetData");
    root.appendChild(sheetData);
  }
  const rowNodes = new Map(descendants(sheetData, "row").map((row) => [Number(row.getAttribute("r")), row]));
  const getOrCreateRow = (rowNumber: number) => {
    let rowNode = rowNodes.get(rowNumber);
    if (!rowNode) {
      rowNode = document.createElementNS(spreadsheetNamespace, "row");
      rowNode.setAttribute("r", String(rowNumber));
      const next = [...rowNodes.entries()].sort(([left], [right]) => left - right).find(([number]) => number > rowNumber)?.[1];
      if (next) sheetData!.insertBefore(rowNode, next);
      else sheetData!.appendChild(rowNode);
      rowNodes.set(rowNumber, rowNode);
    }
    rowNode.removeAttribute("hidden");
    return rowNode;
  };
  const getOrCreateCell = (rowNode: Element, ref: string, styleSource?: XlsxCellInfo) => {
    let cell = childElements(rowNode).find((element) => element.localName === "c" && (element.getAttribute("r") ?? "").toUpperCase() === ref);
    if (!cell) {
      cell = document.createElementNS(spreadsheetNamespace, "c");
      cell.setAttribute("r", ref);
      const style = styleSource?.style;
      if (style) cell.setAttribute("s", style);
      const targetColumn = columnNumber(parseCellRef(ref)!.column);
      const next = childElements(rowNode).filter((element) => element.localName === "c")
        .find((element) => columnNumber(parseCellRef(element.getAttribute("r") ?? "")?.column ?? "A") > targetColumn);
      if (next) rowNode.insertBefore(cell, next);
      else rowNode.appendChild(cell);
    } else if (!cell.getAttribute("s") && styleSource?.style) cell.setAttribute("s", styleSource.style ?? "");
    return cell;
  };
  const serializer = new XMLSerializer();
  for (let index = 0; index < missing.length; index++) {
    const key = missing[index]!;
    const row = rows[index]!;
    const labelRef = `${labelColumn}${row}`;
    const amountRef = `${totalPoint.column}${row}`;
    const rowNode = getOrCreateRow(row);
    const labelCell = getOrCreateCell(rowNode, labelRef, labelSource);
    const amountCell = getOrCreateCell(rowNode, amountRef, amountSource);
    setSpreadsheetCell(labelCell, labels[key], "reject");
    sheet.rows.add(row);
    const labelStyle = labelCell.getAttribute("s");
    const amountStyle = amountCell.getAttribute("s");
    sheet.cells.set(labelRef, { ref: labelRef, value: labels[key], ...(labelStyle ? { style: labelStyle } : {}) });
    sheet.cells.set(amountRef, { ref: amountRef, value: "", ...(amountStyle ? { style: amountStyle } : {}) });
    plan.cells.push({ key, sheet: sheet.name, cell: amountRef });
    if (key === "taxRate") taxRateStringTargets.add(`${sheet.name}!${amountRef}`);
  }

  const dimension = directChild(root, "dimension");
  const dimensionRefs = [...(dimension?.getAttribute("ref") ?? "").split(":"), ...sheet.cells.keys()]
    .map((ref) => parseCellRef(ref))
    .filter((point): point is { column: string; row: number } => point !== null);
  if (dimensionRefs.length) {
    const minColumn = Math.min(...dimensionRefs.map((point) => columnNumber(point.column)));
    const minRow = Math.min(...dimensionRefs.map((point) => point.row));
    const maxColumn = Math.max(...dimensionRefs.map((point) => columnNumber(point.column)));
    const maxRow = Math.max(...dimensionRefs.map((point) => point.row));
    const start = `${columnLetters(minColumn)}${minRow}`;
    const end = `${columnLetters(maxColumn)}${maxRow}`;
    const ref = start === end ? start : `${start}:${end}`;
    if (dimension) dimension.setAttribute("ref", ref);
    else {
      const newDimension = document.createElementNS(spreadsheetNamespace, "dimension");
      newDimension.setAttribute("ref", ref);
      const before = childElements(root).find((element) => ["sheetViews", "sheetFormatPr", "cols", "sheetData"].includes(element.localName ?? ""));
      if (before) root.insertBefore(newDimension, before);
      else root.appendChild(newDimension);
    }
  }
  info.zip.file(sheet.path, serializer.serializeToString(document));
  return taxRateStringTargets;
}

function renderXlsxTemplate(template: QuoteTemplate, quote: Quote, raw: XlsxTemplateFillPlan, inputContext = "", addFallbackSummary = true) {
  const plan = validateXlsxTemplateFillPlan(structuredClone(raw), template, quote);
  const info = workbookInfo(template);
  const taxRateStringTargets = quote.kind === "budget" || !addFallbackSummary ? new Set<string>() : addFallbackSummaryRows(info, plan);
  clearTableRows(info, plan, inputContext);
  if (quote.kind === "budget") {
    const serializer = new XMLSerializer();
    for (const sheet of info.sheets.values()) {
      const activeRows = new Set(plan.lineRows.filter((row) => row.sheet === sheet.name).map((row) => row.row));
      if (!activeRows.size) continue;
      const document = validateXml(info.zip.file(sheet.path)!.asText());
      for (const cell of descendants(document, "c")) {
        const row = parseCellRef(cell.getAttribute("r") ?? "")?.row;
        if (row && activeRows.has(row)) clearSpreadsheetCell(cell);
      }
      info.zip.file(sheet.path, serializer.serializeToString(document));
    }
  }
  const values = xlsxQuoteValues(quote);
  const targets = [
    ...plan.cells.map((entry) => {
      const current = info.sheets.get(entry.sheet)?.cells.get(entry.cell)?.value ?? "";
      const value = taxRateStringTargets.has(`${entry.sheet}!${entry.cell}`) && entry.key === "taxRate"
        ? `${(quote.taxRate * 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`
        : entry.key === "customerName" && isCustomerLabel(current) ? `${current}${current.endsWith(" ") ? "" : " "}${values[entry.key]}`
        : settlementLabelPrefix(current, entry.key) ? `${settlementLabelPrefix(current, entry.key)}${values[entry.key]}` : values[entry.key];
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
    const shippingFee = entries.find((entry) => entry.key === "shippingFee");
    const shippingPoint = shippingFee ? parseCellRef(shippingFee.cell) : null;
    const document = validateXml(info.zip.file(sheet.path)!.asText());
    for (const entry of entries) {
      const cell = descendants(document, "c").find((element) => (element.getAttribute("r") ?? "").replace(/\$/g, "").toUpperCase() === entry.cell);
      if (!cell) throw new Error("Không tìm thấy ô đã ánh xạ trong file Excel.");
      if (entry.key === "total" && shippingPoint && Number(shippingFee?.value ?? 0) !== 0) {
        const formula = directChild(cell, "f");
        const formulaText = formula?.textContent ?? "";
        const reference = `${shippingPoint.column}${shippingPoint.row}`;
        const referencePattern = new RegExp(`(?:^|[^A-Z0-9_.])\\$?${shippingPoint.column}\\$?${shippingPoint.row}(?:$|[^A-Z0-9_])`, "i");
        if (formula && !referencePattern.test(formulaText)) formula.textContent = `${formulaText}+${reference}`;
      }
      const settlementValue = quote.settlement && ["contractValue", "settlementAmount", "amountPaid", "settlementBalance"].includes(entry.key);
      const formulaMode = settlementValue || entry.key.endsWith("_quantity") || entry.key.endsWith("_unitPrice") || entry.key.endsWith("_index") || entry.key.endsWith("_lineTaxRate") || entry.key === "paymentDueDays" ? "replace" : ["subtotal", "shippingFee", "taxRate", "taxAmount", "total", "settlementAmount", "amountPaid", "settlementBalance"].includes(entry.key) || entry.key.endsWith("_lineTotal") || entry.key.endsWith("_lineTotalAfterTax") ? "preserve" : "reject";
      if (entry.value === "" && (entry.key === "subtotal" || entry.key === "total" || entry.key.endsWith("_quantity") || entry.key.endsWith("_lineTotal") || entry.key.endsWith("_lineTotalAfterTax"))) clearSpreadsheetCell(cell);
      else setSpreadsheetCell(cell, entry.value!, formulaMode);
    }
    info.zip.file(sheet.path, serializer.serializeToString(document));
  }
  const targetWorksheet = plan.lineRows[0]?.sheet ?? plan.cells[0]?.sheet;
  if (targetWorksheet) activateXlsxWorksheet(info, targetWorksheet);
  if (quote.settlement) requestXlsxRecalculation(info);
  return info.zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function requestXlsxRecalculation(info: XlsxWorkbookInfo) {
  const workbookPart = info.zip.file("xl/workbook.xml");
  if (!workbookPart) return;
  const workbook = validateXml(workbookPart.asText());
  const root = workbook.documentElement;
  if (!root) return;
  let calcPr = directChild(root, "calcPr");
  if (!calcPr) {
    const created = workbook.createElementNS(spreadsheetNamespace, "calcPr");
    if (!created) return;
    calcPr = created;
    const extensionList = directChild(root, "extLst");
    if (extensionList) root.insertBefore(calcPr, extensionList);
    else root.appendChild(calcPr);
  }
  calcPr.setAttribute("calcMode", "auto");
  calcPr.setAttribute("fullCalcOnLoad", "1");
  calcPr.setAttribute("forceFullCalc", "1");
  calcPr.setAttribute("calcCompleted", "0");
  info.zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(workbook));
}

function activateXlsxWorksheet(info: XlsxWorkbookInfo, sheetName: string) {
  const sheetIndex = [...info.sheets.keys()].indexOf(sheetName);
  const workbookPart = info.zip.file("xl/workbook.xml");
  if (sheetIndex < 0 || !workbookPart) return;
  const workbook = validateXml(workbookPart.asText());
  const workbookView = descendants(workbook, "workbookView")[0];
  if (workbookView) {
    workbookView.setAttribute("activeTab", String(sheetIndex));
    info.zip.file("xl/workbook.xml", new XMLSerializer().serializeToString(workbook));
  }
  const serializer = new XMLSerializer();
  for (const [name, sheet] of info.sheets) {
    const part = info.zip.file(sheet.path);
    if (!part) continue;
    const document = validateXml(part.asText());
    const views = descendants(document, "sheetView");
    if (!views.length) continue;
    views.forEach((view, index) => {
      if (name === sheetName && index === 0) view.setAttribute("tabSelected", "1");
      else view.removeAttribute("tabSelected");
    });
    info.zip.file(sheet.path, serializer.serializeToString(document));
  }
}

function inferCustomerXlsxPlan(template: QuoteTemplate, quote: Quote): XlsxTemplateFillPlan | undefined {
  for (const sheet of workbookInfo(template).sheets.values()) {
    const rows = [...sheet.rows].sort((a, b) => a - b);
    for (const headerRow of rows) {
      const headers = [...sheet.cells.values()].filter((cell) => parseCellRef(cell.ref)?.row === headerRow);
      const columns = new Map<string, string>();
      for (const cell of headers) for (const key of xlsxLineKeys) if (!columns.has(key) && headerMatch(key, cell.value)) columns.set(key, parseCellRef(cell.ref)!.column);
      if (!["name", "unitPrice"].every((key) => columns.has(key))) continue;
      const nextSummary = rows.find((row) => row > headerRow && [...sheet.cells.values()].some((cell) => parseCellRef(cell.ref)?.row === row && isSummaryRowLabel(cell.value)));
      const candidateRows = rows.filter((row) => row > headerRow && (!nextSummary || row < nextSummary)
        && ["name", "unitPrice"].every((key) => sheet.cells.has(`${columns.get(key)}${row}`)));
      if (candidateRows.length < quote.lines.length) continue;
      const populated = candidateRows.filter((row) => Boolean(sheet.cells.get(`${columns.get("name")}${row}`)?.value.trim()));
      const lineRows = [...populated, ...candidateRows.filter((row) => !populated.includes(row))].slice(0, quote.lines.length).map((row) => ({
        sheet: sheet.name, row,
        fields: [...columns.entries()].filter(([key]) => ["index", "sku", "name", "details", "unit", "unitPrice"].includes(key))
          .filter(([, column]) => sheet.cells.has(`${column}${row}`))
          .map(([key, column]) => ({ key, cell: `${column}${row}` })),
      }));
      const customerLabel = [...sheet.cells.values()].find((cell) => isCustomerLabel(cell.value));
      const cells: XlsxTemplateFillPlan["cells"] = [];
      if (customerLabel) {
        const point = parseCellRef(customerLabel.ref)!;
        const adjacent = `${columnLetters(columnNumber(point.column) + 1)}${point.row}`;
        const customerCell = sheet.cells.has(adjacent) && isMergeAnchor(adjacent, sheet.merged) ? adjacent : customerLabel.ref;
        cells.push({ key: "customerName", sheet: sheet.name, cell: customerCell });
      }
      const quoteLabel = [...sheet.cells.values()].find((cell) => /^(so bao gia|ma bao gia|quote no|quotation no)/.test(normalizeSheetLabel(cell.value)));
      if (quoteLabel) {
        const location = parseCellRef(quoteLabel.ref)!;
        const next = `${columnLetters(columnNumber(location.column) + 1)}${location.row}`;
        if (sheet.cells.has(next) && isMergeAnchor(next, sheet.merged) && !cells.some((cell) => cell.cell === next)) cells.push({ key: "quoteNumber", sheet: sheet.name, cell: next });
      }
      const plan = { cells, lineRows };
      try { return validateXlsxTemplateFillPlan(plan, template, quote); } catch { /* Try the next table. */ }
    }
  }
  return undefined;
}

function clearSpreadsheetCell(cell: Element) {
  for (const child of [...childElements(cell)]) if (["f", "v", "is"].includes(child.localName ?? "")) cell.removeChild(child);
  cell.removeAttribute("t");
}

function expandXlsxTable(template: QuoteTemplate, info: XlsxWorkbookInfo, sheet: XlsxSheetInfo, sourceRow: number, insertRow: number, count: number): QuoteTemplate {
  if (count < 1 || count > 100) throw new Error("Phương án có quá nhiều dòng so với mẫu Excel.");
  const document = validateXml(info.zip.file(sheet.path)!.asText());
  const sheetData = descendants(document, "sheetData")[0];
  const rowNodes = sheetData ? descendants(sheetData, "row") : [];
  const source = rowNodes.find((row) => Number(row.getAttribute("r")) === sourceRow);
  const insertionPoint = rowNodes.find((row) => Number(row.getAttribute("r")) === insertRow);
  if (!sheetData || !source || !insertionPoint) throw new Error("Không tìm được dòng sản phẩm để mở rộng mẫu Excel.");
  const shiftFormula = (value: string, fromRow: number, offset: number) => value.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (match, column: string, number: string) => Number(number) >= fromRow ? `${column}${Number(number) + offset}` : match);
  for (const row of [...rowNodes].reverse()) {
    const oldRow = Number(row.getAttribute("r"));
    if (oldRow >= insertRow) {
      row.setAttribute("r", String(oldRow + count));
      for (const cell of childElements(row).filter((entry) => entry.localName === "c")) {
        const point = parseCellRef(cell.getAttribute("r") ?? "");
        if (point) cell.setAttribute("r", `${point.column}${oldRow + count}`);
      }
    }
  }
  for (const formula of descendants(document, "f")) if (formula.textContent) formula.textContent = shiftFormula(formula.textContent, insertRow, count);
  for (let index = 0; index < count; index++) {
    const rowNumber = insertRow + index;
    const copy = source.cloneNode(true) as Element;
    copy.setAttribute("r", String(rowNumber));
    for (const cell of childElements(copy).filter((entry) => entry.localName === "c")) {
      const point = parseCellRef(cell.getAttribute("r") ?? "");
      if (point) cell.setAttribute("r", `${point.column}${rowNumber}`);
      const formula = directChild(cell, "f");
      if (formula?.textContent) formula.textContent = formula.textContent.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (match, column: string, number: string) => Number(number) === sourceRow ? `${column}${rowNumber}` : match);
    }
    sheetData.insertBefore(copy, insertionPoint);
  }
  for (const merged of descendants(document, "mergeCell")) {
    const value = merged.getAttribute("ref");
    if (value) merged.setAttribute("ref", shiftFormula(value, insertRow, count));
  }
  const dimension = document.documentElement ? directChild(document.documentElement, "dimension") : null;
  const dimensionRef = dimension?.getAttribute("ref");
  if (dimension && dimensionRef) dimension.setAttribute("ref", shiftFormula(dimensionRef, insertRow, count));
  info.zip.file(sheet.path, new XMLSerializer().serializeToString(document));
  const bytes = info.zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  return { ...template, bytes: bytes.length, data: new Binary(bytes) };
}

function inferBudgetXlsxPlan(template: QuoteTemplate, quote: Quote): { template: QuoteTemplate; plan: XlsxTemplateFillPlan } | undefined {
  const info = workbookInfo(template);
  let largestTable = 0;
  for (const sheet of info.sheets.values()) {
    const rows = [...sheet.rows].sort((a, b) => a - b);
    for (const headerRow of rows) {
      const columns = new Map<string, string>();
      for (const cell of sheet.cells.values()) {
        if (parseCellRef(cell.ref)?.row !== headerRow) continue;
        for (const key of xlsxLineKeys) if (!columns.has(key) && headerMatch(key, cell.value)) columns.set(key, parseCellRef(cell.ref)!.column);
      }
      if (!["name", "quantity", "unitPrice", "lineTotal"].every((key) => columns.has(key))) continue;
      const totalRow = rows.find((row) => row > headerRow && [...sheet.cells.values()].some((cell) => parseCellRef(cell.ref)?.row === row && isTotalLabel(cell.value)));
      if (!totalRow) continue;
      const nameColumn = columns.get("name")!;
      const quantityColumn = columns.get("quantity")!;
      const unitPriceColumn = columns.get("unitPrice")!;
      const productRows = rows.filter((row) => row > headerRow && row < totalRow
        && sheet.cells.get(`${nameColumn}${row}`)?.value.trim()
        && sheet.cells.has(`${quantityColumn}${row}`) && sheet.cells.has(`${unitPriceColumn}${row}`)
        && isMergeAnchor(`${nameColumn}${row}`, sheet.merged));
      if (productRows.length < quote.lines.length) {
        if (productRows.length) {
          const expanded = expandXlsxTable(template, info, sheet, productRows[productRows.length - 1]!, totalRow, quote.lines.length - productRows.length);
          return inferBudgetXlsxPlan(expanded, quote);
        }
        largestTable = Math.max(largestTable, productRows.length);
        continue;
      }
      const selectedRows = productRows.slice(0, quote.lines.length);
      const totalRef = `${columns.get("lineTotal")!}${totalRow}`;
      if (!isMergeAnchor(totalRef, sheet.merged)) continue;
      const refs = [totalRef, ...productRows.flatMap((row) => [...columns.values()].map((column) => `${column}${row}`))]
        .filter((ref) => !sheet.cells.has(ref) && isMergeAnchor(ref, sheet.merged));
      const document = validateXml(info.zip.file(sheet.path)!.asText());
      const rowNodes = new Map(descendants(document, "row").map((row) => [Number(row.getAttribute("r")), row]));
      for (const ref of refs) {
        const point = parseCellRef(ref)!;
        const rowNode = rowNodes.get(point.row);
        if (!rowNode) continue;
        const cell = document.createElementNS(spreadsheetNamespace, "c");
        cell.setAttribute("r", ref);
        const sameColumn = [...sheet.cells.values()].find((source) => parseCellRef(source.ref)?.column === point.column && source.style && parseCellRef(source.ref)!.row > headerRow);
        if (sameColumn?.style) cell.setAttribute("s", sameColumn.style);
        const next = childElements(rowNode).filter((entry) => entry.localName === "c")
          .find((entry) => columnNumber(parseCellRef(entry.getAttribute("r") ?? "")?.column ?? "A") > columnNumber(point.column));
        if (next) rowNode.insertBefore(cell, next);
        else rowNode.appendChild(cell);
      }
      info.zip.file(sheet.path, new XMLSerializer().serializeToString(document));
      const bytes = info.zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
      const prepared = { ...template, bytes: bytes.length, data: new Binary(bytes) };
      const customerLabel = [...sheet.cells.values()].find((cell) => isCustomerLabel(cell.value));
      const customerPoint = customerLabel ? parseCellRef(customerLabel.ref) : null;
      const adjacentCustomer = customerPoint ? `${columnLetters(columnNumber(customerPoint.column) + 1)}${customerPoint.row}` : "";
      const cells: XlsxTemplateFillPlan["cells"] = [{ key: "total", sheet: sheet.name, cell: totalRef }];
      if (adjacentCustomer && sheet.cells.has(adjacentCustomer) && isMergeAnchor(adjacentCustomer, sheet.merged)) cells.push({ key: "customerName", sheet: sheet.name, cell: adjacentCustomer });
      for (const cell of sheet.cells.values()) {
        const label = normalizeSheetLabel(cell.value);
        const key = /^(ngay|ngay lap|date)$/.test(label) ? "createdAt"
          : /^(email|e mail)$/.test(label) ? "customerEmail"
          : /^(sdt|so dien thoai|dien thoai|phone)$/.test(label) ? "customerPhone" : null;
        if (!key || cells.some((entry) => entry.key === key)) continue;
        const point = parseCellRef(cell.ref);
        const adjacent = point ? `${columnLetters(columnNumber(point.column) + 1)}${point.row}` : "";
        if (adjacent && sheet.cells.has(adjacent) && isMergeAnchor(adjacent, sheet.merged)) cells.push({ key, sheet: sheet.name, cell: adjacent });
      }
      const lineRows = selectedRows.map((row) => ({
        sheet: sheet.name, row,
        fields: [...columns.entries()].filter(([key, column]) => ["index", "sku", "name", "details", "quantity", "unit", "unitPrice", "lineTotal"].includes(key)
          && (sheet.cells.has(`${column}${row}`) || refs.includes(`${column}${row}`)))
          .map(([key, column]) => ({ key, cell: `${column}${row}` })),
      }));
      const plan = validateXlsxTemplateFillPlan({ cells, lineRows }, prepared, quote);
      return { template: prepared, plan };
    }
  }
  if (largestTable) throw new Error(`Mẫu Excel chỉ có ${largestTable} dòng sản phẩm; phương án có ${quote.lines.length} dòng.`);
  return undefined;
}

export async function renderBudgetPlanXlsxTemplate(template: QuoteTemplate, quote: Quote, inputContext = ""): Promise<Buffer> {
  if (template.extension !== "xlsx" || quote.kind !== "budget") throw new Error("Phương án tư vấn cần mẫu Excel (.xlsx).");
  const inferred = inferBudgetXlsxPlan(template, quote);
  const workingTemplate = inferred?.template ?? template;
  const plan = await createXlsxTemplateFillPlan(workingTemplate, quote, inputContext, inferred?.plan);
  return renderXlsxTemplate(workingTemplate, quote, plan, inputContext);
}

interface XlsxSemanticMap {
  sheet: string;
  headerRow: number;
  firstProductRow: number;
  summaryRow: number;
  productRows: number[];
  columns: Array<{ key: typeof xlsxLineKeys[number]; column: string }>;
  cells: Array<{ key: typeof xlsxScalarKeys[number]; cell: string; sheet?: string }>;
}

const xlsxSemanticMapSchema = {
  type: "object", additionalProperties: false, required: ["sheet", "headerRow", "firstProductRow", "summaryRow", "productRows", "columns", "cells"],
  properties: {
    sheet: { type: "string" }, headerRow: { type: "integer" }, firstProductRow: { type: "integer" }, summaryRow: { type: "integer" },
    productRows: { type: "array", items: { type: "integer" } },
    columns: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "column"], properties: {
      key: { type: "string", enum: [...xlsxLineKeys] }, column: { type: "string" },
    } } },
    cells: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "cell"], properties: {
      key: { type: "string", enum: [...xlsxScalarKeys] }, cell: { type: "string", description: "Excel cell address such as B3, never the cell value or formula" },
    } } },
  },
};

function resolveXlsxSemanticCells(raw: unknown, info: XlsxWorkbookInfo): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const map = raw as XlsxSemanticMap;
  const sheet = typeof map.sheet === "string" ? info.sheets.get(map.sheet) : undefined;
  if (!sheet || !Array.isArray(map.cells)) return raw;
  const resolved = map.cells.flatMap((entry) => {
    if (!entry || typeof entry.cell !== "string") return [entry];
    const requested = entry.cell.trim();
    const matching = parseCellRef(requested.toUpperCase()) ? [{ ref: requested.toUpperCase() }]
      : [...sheet.cells.values()].filter((cell) => cell.value.trim() === requested || cell.formula?.trim() === requested);
    if (matching.length !== 1) return [];
    let ref = matching[0]!.ref;
    const source = sheet.cells.get(ref);
    if (source?.value.trim().endsWith(":")) {
      const label = normalizeSheetLabel(source.value);
      const labels: Partial<Record<typeof xlsxScalarKeys[number], RegExp>> = {
        quoteNumber: /\b(so bao gia|ma bao gia|quote|quotation)\b/,
        customerName: /\b(khach hang|kinh gui|customer|client)\b/,
        customerEmail: /\b(email|e mail)\b/,
        customerPhone: /\b(sdt|dien thoai|phone|tel)\b/,
        createdAt: /\b(ngay|date)\b/,
      };
      if (!labels[entry.key]?.test(label)) return [];
      const point = parseCellRef(ref)!;
      ref = `${columnLetters(columnNumber(point.column) + 1)}${point.row}`;
      if (!isMergeAnchor(ref, sheet.merged)) return [];
    }
    return [{ ...entry, cell: ref }];
  });
  const indexColumn = Array.isArray(map.columns) ? map.columns.find((entry) => entry.key === "index")?.column : undefined;
  const nameColumn = Array.isArray(map.columns) ? map.columns.find((entry) => entry.key === "name")?.column : undefined;
  const indexedRows = indexColumn && nameColumn && Number.isInteger(map.headerRow)
    ? [...sheet.rows].filter((row) => row > map.headerRow && (!map.summaryRow || row < map.summaryRow)
      && Boolean(sheet.cells.get(`${nameColumn}${row}`)?.value.trim())
      && /^\d+(?:[.,]\d+)?$/.test(sheet.cells.get(`${indexColumn}${row}`)?.value.trim() ?? ""))
    : [];
  const productRows = Array.isArray(map.productRows) ? [...new Set([...map.productRows, ...indexedRows])].sort((a, b) => a - b) : map.productRows;
  const priorities: Partial<Record<typeof xlsxScalarKeys[number], number>> = {
    total: 100, customerName: 90, customerEmail: 90, customerPhone: 90, createdAt: 90, quoteNumber: 90, subtotal: 80,
  };
  const used = new Set<string>();
  const cells = resolved.map((entry, index) => ({ entry, index })).filter(({ entry }) => {
    if (!entry || typeof entry.cell !== "string") return true;
    const point = parseCellRef(entry.cell);
    return Boolean(point && sheet.rows.has(point.row) && isMergeAnchor(entry.cell, sheet.merged)
      && !productRows.includes(point.row)
      && !(Number.isInteger(map.headerRow) && Number.isInteger(map.firstProductRow)
        && point.row >= map.headerRow && point.row < map.firstProductRow)
      && !/^\[\d+\]$/.test(sheet.cells.get(entry.cell)?.value.trim() ?? ""));
  }).sort((a, b) => (priorities[b.entry?.key] ?? 0) - (priorities[a.entry?.key] ?? 0) || a.index - b.index)
    .filter(({ entry }) => {
      if (!entry || typeof entry.cell !== "string") return true;
      if (used.has(entry.cell)) return false;
      used.add(entry.cell);
      return true;
    }).sort((a, b) => a.index - b.index).map(({ entry }) => entry);
  return { ...map, cells, productRows, firstProductRow: Array.isArray(productRows) && productRows.length ? productRows[0] : map.firstProductRow };
}

function validateXlsxSemanticMap(raw: unknown, info: XlsxWorkbookInfo, quote: Quote): XlsxSemanticMap {
  let map = raw as XlsxSemanticMap;
  const sheet = map && typeof map.sheet === "string" ? info.sheets.get(map.sheet) : undefined;
  if (!sheet || !Number.isInteger(map.headerRow) || !Number.isInteger(map.firstProductRow) || !Number.isInteger(map.summaryRow)
    || map.headerRow < 1 || map.firstProductRow <= map.headerRow || map.summaryRow < 0
    || map.summaryRow !== 0 && map.summaryRow <= map.firstProductRow || !sheet.rows.has(map.headerRow)
    || !sheet.rows.has(map.firstProductRow) || map.summaryRow !== 0 && !sheet.rows.has(map.summaryRow)
    || !Array.isArray(map.columns) || !Array.isArray(map.cells) || !Array.isArray(map.productRows) || map.productRows.length < 1
    || map.productRows.length > 500 || map.productRows[0] !== map.firstProductRow
    || map.productRows.some((row, index) => !Number.isInteger(row) || row <= map.headerRow || map.summaryRow && row >= map.summaryRow
      || !sheet.rows.has(row) || index > 0 && row <= map.productRows[index - 1]!)) throw new Error("AI chưa nhận diện được các dòng sản phẩm trong mẫu Excel.");
  const columnKeys = new Set<string>();
  const columnLettersUsed = new Set<string>();
  for (const entry of map.columns) {
    if (!entry || !xlsxLineKeys.includes(entry.key) || typeof entry.column !== "string" || !/^[A-Z]{1,3}$/.test(entry.column)
      || columnKeys.has(entry.key) || columnLettersUsed.has(entry.column) || !sheet.cells.has(`${entry.column}${map.headerRow}`)) throw new Error("AI chọn cột Excel không hợp lệ.");
    columnKeys.add(entry.key);
    columnLettersUsed.add(entry.column);
  }
  if (quote.kind !== "customer" && quote.kind !== "budget" && !columnKeys.has("quantity")) {
    const usedColumns = new Set(map.columns.map((entry) => entry.column));
    const quantityHeaders = [...sheet.cells.values()].filter((cell) => parseCellRef(cell.ref)?.row === map.headerRow
      && headerMatch("quantity", cell.value) && !usedColumns.has(parseCellRef(cell.ref)!.column));
    if (quantityHeaders.length === 1) {
      const column = parseCellRef(quantityHeaders[0]!.ref)!.column;
      map = { ...map, columns: [...map.columns, { key: "quantity", column }] };
      columnKeys.add("quantity");
    }
  }
  if (!columnKeys.has("name")) throw new Error("AI chưa xác định được cột tên sản phẩm.");
  if (quote.kind !== "customer" && quote.kind !== "budget" && !columnKeys.has("quantity")) {
    throw new Error("Mẫu Excel chưa xác định được cột số lượng để điền theo dự toán.");
  }
  if (quote.kind === "customer" ? !columnKeys.has("unitPrice") : !quote.settlement && !columnKeys.has("unitPrice") && !columnKeys.has("lineTotal")) throw new Error("AI chưa xác định được cột giá sản phẩm.");
  const nameColumn = map.columns.find((entry) => entry.key === "name")!.column;
  if (map.productRows.some((row) => !sheet.cells.has(`${nameColumn}${row}`) || !isMergeAnchor(`${nameColumn}${row}`, sheet.merged))) throw new Error("AI chọn dòng không có ô tên sản phẩm hợp lệ.");
  const scalarKeys = new Set<string>();
  for (const entry of map.cells) {
    const targetSheetName = entry?.sheet ?? map.sheet;
    const targetSheet = info.sheets.get(targetSheetName);
    const point = entry && typeof entry.cell === "string" ? parseCellRef(entry.cell) : null;
    const scopedKey = `${targetSheetName}!${entry?.key}`;
    if (entry && point && targetSheetName === map.sheet && (point.row >= map.headerRow && point.row < map.firstProductRow || map.productRows.includes(point.row)
      || /^\[\d+\]$/.test(targetSheet?.cells.get(entry.cell)?.value.trim() ?? ""))) throw new Error("Invalid Excel information-cell mapping.");
    if (!entry || !xlsxScalarKeys.includes(entry.key) || !targetSheet || !point || !targetSheet.rows.has(point.row) || !isMergeAnchor(entry.cell, targetSheet.merged)
      || scalarKeys.has(scopedKey) || quote.kind === "customer" && !["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt"].includes(entry.key)) throw new Error("Invalid Excel information-cell mapping.");
    scalarKeys.add(scopedKey);
  }
  return map;
}

function prepareAiXlsxPlan(template: QuoteTemplate, quote: Quote, map: XlsxSemanticMap): { template: QuoteTemplate; plan: XlsxTemplateFillPlan } {
  let info = workbookInfo(template);
  let sheet = info.sheets.get(map.sheet)!;
  const columns = new Map(map.columns.map(({ key, column }) => [key, column]));
  const nameColumn = columns.get("name")!;
  const productRows = map.productRows.filter((row) => sheet.cells.has(`${nameColumn}${row}`) && isMergeAnchor(`${nameColumn}${row}`, sheet.merged));
  if (!productRows.length) throw new Error("Mẫu Excel không có dòng sản phẩm phù hợp để điền.");
  if (productRows.length < quote.lines.length) {
    if (!map.summaryRow) throw new Error("Mẫu Excel thiếu dòng tổng kết để mở rộng bảng sản phẩm.");
    const delta = quote.lines.length - productRows.length;
    template = expandXlsxTable(template, info, sheet, productRows[productRows.length - 1]!, map.summaryRow, delta);
    const oldSummaryRow = map.summaryRow;
    map = { ...map, summaryRow: oldSummaryRow + delta, cells: map.cells.map((entry) => {
      const point = parseCellRef(entry.cell)!;
      return { ...entry, cell: (entry.sheet ?? map.sheet) === map.sheet && point.row >= oldSummaryRow ? `${point.column}${point.row + delta}` : entry.cell };
    }) };
    info = workbookInfo(template);
    sheet = info.sheets.get(map.sheet)!;
    for (let row = oldSummaryRow; row < map.summaryRow; row++) productRows.push(row);
  }
  const allowedFields = quote.kind === "customer" ? new Set(["index", "sku", "name", "details", "unit", "unitPrice"]) : null;
  const selectedRows = productRows.slice(0, quote.lines.length);
  const refs = [
    ...productRows.flatMap((row) => [...columns.values()].map((column) => `${column}${row}`)),
    ...map.cells.filter((entry) => (entry.sheet ?? map.sheet) === map.sheet).map((entry) => entry.cell),
  ].filter((ref) => !sheet.cells.has(ref) && isMergeAnchor(ref, sheet.merged));
  const document = validateXml(info.zip.file(sheet.path)!.asText());
  const rowNodes = new Map(descendants(document, "row").map((row) => [Number(row.getAttribute("r")), row]));
  for (const ref of new Set(refs)) {
    const point = parseCellRef(ref)!;
    const rowNode = rowNodes.get(point.row);
    if (!rowNode) throw new Error("AI chọn ô không có dòng tương ứng trong mẫu Excel.");
    const cell = document.createElementNS(spreadsheetNamespace, "c");
    cell.setAttribute("r", ref);
    const style = [...sheet.cells.values()].find((source) => parseCellRef(source.ref)?.column === point.column && source.style && parseCellRef(source.ref)!.row > map.headerRow)?.style;
    if (style) cell.setAttribute("s", style);
    const next = childElements(rowNode).filter((entry) => entry.localName === "c")
      .find((entry) => columnNumber(parseCellRef(entry.getAttribute("r") ?? "")?.column ?? "A") > columnNumber(point.column));
    if (next) rowNode.insertBefore(cell, next);
    else rowNode.appendChild(cell);
  }
  info.zip.file(sheet.path, new XMLSerializer().serializeToString(document));
  const bytes = info.zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  const prepared = { ...template, bytes: bytes.length, data: new Binary(bytes) };
  const plan: XlsxTemplateFillPlan = {
    tableHeaderRow: map.headerRow,
    ...(map.summaryRow ? { tableEndRow: map.summaryRow } : {}),
    tableProductRows: productRows,
    cells: map.cells.map((entry) => ({ ...entry, sheet: entry.sheet ?? map.sheet })),
    lineRows: selectedRows.map((row) => ({ sheet: map.sheet, row, fields: [...columns.entries()]
      .filter(([key]) => !allowedFields || allowedFields.has(key))
      .map(([key, column]) => ({ key, cell: `${column}${row}` })) })),
  };
  validateXlsxTemplateFillPlan(plan, prepared, quote);
  return { template: prepared, plan };
}

function inferSemanticXlsxMap(template: QuoteTemplate, quote: Quote, inputContext = ""): XlsxSemanticMap | undefined {
  if (quote.kind === "customer" || quote.kind === "budget") return undefined;
  const info = workbookInfo(template);
  const candidates: Array<{ map: XlsxSemanticMap; score: number; purposeScore: number; paired: boolean; large: boolean; financialVariants: boolean }> = [];
  const genericWords = new Set(["camera", "san", "pham", "hang", "hoa", "dau", "ghi", "hinh", "switch", "chia", "mang", "o", "cung", "thiet", "bi"]);
  const preferSettlement = /\b(quyet toan|settlement|current period|ky nay)\b/.test(normalizeSheetLabel(inputContext));
  const hasNumericValue = (cell: XlsxCellInfo | undefined) => Boolean(cell && (cell.formula || /^[+-]?(?:\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)(?:%|\s*)$/.test(cell.value.trim())));
  const primaryColumn = (sheet: XlsxSheetInfo, headerRow: number, column: string) => {
    const columnIndex = columnNumber(column);
    for (const range of sheet.merged) {
      const [start, end = start] = range.split(":");
      const first = parseCellRef(start ?? "");
      const last = parseCellRef(end);
      if (!first || !last || headerRow < first.row || headerRow > last.row
        || columnIndex < columnNumber(first.column) || columnIndex > columnNumber(last.column)) continue;
      const childColumns = Array.from({ length: columnNumber(last.column) - columnNumber(first.column) + 1 }, (_, index) => columnLetters(columnNumber(first.column) + index));
      if (preferSettlement) {
        const settlementColumn = childColumns.find((child) => /^(quyet toan|settlement|ky nay|current period|nghiem thu ky nay)$/.test(normalizeSheetLabel(sheet.cells.get(`${child}${headerRow + 1}`)?.value ?? "")));
        if (settlementColumn) return settlementColumn;
      }
      for (const child of childColumns) {
        const label = normalizeSheetLabel(sheet.cells.get(`${child}${headerRow + 1}`)?.value ?? "");
        if (/^(theo hop dong|contract|contract quantity|contract amount)$/.test(label)) return child;
      }
      return first.column;
    }
    return column;
  };
  const summaryTarget = (sheet: XlsxSheetInfo, label: XlsxCellInfo, headerRow: number) => {
    const labelPoint = parseCellRef(label.ref);
    if (!labelPoint) return undefined;
    let lastLabelColumn = columnNumber(labelPoint.column);
    for (const range of sheet.merged) {
      const [start, end = start] = range.split(":");
      const first = parseCellRef(start ?? "");
      const last = parseCellRef(end);
      if (start === label.ref && first && last) lastLabelColumn = columnNumber(last.column);
    }
    const targets = [...sheet.cells.values()].filter((cell) => {
      const point = parseCellRef(cell.ref);
      return point?.row === labelPoint.row && columnNumber(point.column) > lastLabelColumn && hasNumericValue(cell);
    });
    if (preferSettlement) {
      const settlementTarget = targets.find((cell) => {
        const point = parseCellRef(cell.ref)!;
        return [headerRow, headerRow + 1].some((row) => {
          const childLabel = normalizeSheetLabel(sheet.cells.get(`${point.column}${row}`)?.value ?? "");
          return /^(quyet toan|settlement|ky nay|current period|nghiem thu ky nay)$/.test(childLabel);
        });
      });
      if (settlementTarget) return settlementTarget;
    }
    return targets.sort((left, right) => columnNumber(parseCellRef(left.ref)!.column) - columnNumber(parseCellRef(right.ref)!.column))[0];
  };

  for (const sheet of info.sheets.values()) {
    for (const headerRow of [...sheet.rows].sort((left, right) => left - right)) {
      const headerCells = [...sheet.cells.values()].filter((cell) => parseCellRef(cell.ref)?.row === headerRow)
        .sort((left, right) => columnNumber(parseCellRef(left.ref)!.column) - columnNumber(parseCellRef(right.ref)!.column));
      const columns = new Map<string, string>();
      const usedColumns = new Set<string>();
      for (const cell of headerCells) {
        const column = primaryColumn(sheet, headerRow, parseCellRef(cell.ref)!.column);
        for (const key of xlsxLineKeys) {
          if (columns.has(key) || usedColumns.has(column) || !headerMatch(key, cell.value)) continue;
          columns.set(key, column);
          usedColumns.add(column);
          break;
        }
      }
      for (const cell of sheet.cells.values()) {
        if (parseCellRef(cell.ref)?.row !== headerRow + 1) continue;
        const column = parseCellRef(cell.ref)!.column;
        for (const key of ["lineTaxRate", "lineTaxAmount", "lineTotalAfterTax"] as const) {
          if (!columns.has(key) && !usedColumns.has(column) && headerMatch(key, cell.value)) {
            columns.set(key, column);
            usedColumns.add(column);
          }
        }
      }
      if (!columns.has("name") || !columns.has("quantity") || !quote.settlement && !columns.has("unitPrice") && !columns.has("lineTotal")) continue;
      const hasContractSettlementVariants = [...columns.entries()].some(([key, column]) => {
        if (!["quantity", "unitPrice", "lineTotal"].includes(key)) return false;
        const header = headerCells.find((cell) => headerMatch(key as typeof xlsxLineKeys[number], cell.value)
          && primaryColumn(sheet, headerRow, parseCellRef(cell.ref)!.column) === column);
        if (!header) return false;
        const point = parseCellRef(header.ref)!;
        const range = sheet.merged.map((merged) => {
          const [start, end = start] = merged.split(":");
          return { start, first: parseCellRef(start ?? ""), last: parseCellRef(end) };
        }).find(({ first, last }) => first && last && point.row >= first.row && point.row <= last.row
          && columnNumber(point.column) >= columnNumber(first.column) && columnNumber(point.column) <= columnNumber(last.column));
        if (!range?.first || !range.last || range.first.column === range.last.column) return false;
        const labels = Array.from({ length: columnNumber(range.last.column) - columnNumber(range.first.column) + 1 }, (_, index) =>
          normalizeSheetLabel(sheet.cells.get(`${columnLetters(columnNumber(range.first!.column) + index)}${headerRow + 1}`)?.value ?? ""));
        return labels.some((label) => /^(theo hop dong|contract)$/.test(label)) && labels.some((label) => /^(quyet toan|settlement)$/.test(label));
      });
      const financialVariants = headerCells.filter((cell) => headerMatch("lineTotal", cell.value) || headerMatch("lineTotalAfterTax", cell.value)).length > 1
        && headerCells.some((cell) => headerMatch("lineTaxRate", cell.value));
      const nameColumn = columns.get("name")!;
      const quantityColumn = columns.get("quantity")!;
      const amountColumns = [columns.get("unitPrice"), columns.get("lineTotal")].filter((column): column is string => Boolean(column));
      const productRows = [...sheet.rows].filter((row) => row > headerRow).sort((left, right) => left - right).filter((row) => {
        const name = sheet.cells.get(`${nameColumn}${row}`)?.value.trim();
        return Boolean(name && hasNumericValue(sheet.cells.get(`${quantityColumn}${row}`))
          && (quote.settlement || amountColumns.some((column) => hasNumericValue(sheet.cells.get(`${column}${row}`)))));
      });
      if (!productRows.length || productRows.length > 500) continue;
      const lastProductRow = productRows[productRows.length - 1]!;
      const summaryRow = [...sheet.rows].filter((row) => row > lastProductRow && [...sheet.cells.values()].some((cell) =>
        parseCellRef(cell.ref)?.row === row && isSummaryRowLabel(cell.value))).sort((left, right) => left - right)[0] ?? 0;
      const rowsForScore = productRows.map((row) => normalizeSheetLabel(sheet.cells.get(`${nameColumn}${row}`)?.value ?? ""));
      const score = quote.lines.reduce((total, line) => {
        const tokens = normalizeSheetLabel(line.name).split(" ").filter((token) => token.length > 2 && !genericWords.has(token));
        const lineScore = rowsForScore.reduce((best, example) => {
          if (example === normalizeSheetLabel(line.name)) return Math.max(best, 10);
          const sharedTokens = tokens.filter((token) => example.includes(token)).length;
          return Math.max(best, sharedTokens >= 2 ? sharedTokens : 0);
        }, 0);
        return total + lineScore;
      }, 0);
      const summaryCells: XlsxSemanticMap["cells"] = [];
      const seenScalarKeys = new Set<string>();
      for (const cell of [...sheet.cells.values()].filter((entry) => {
        const row = parseCellRef(entry.ref)?.row;
        return row !== undefined && row >= (summaryRow || lastProductRow + 1) && isSummaryRowLabel(entry.value);
      }).sort((left, right) => parseCellRef(left.ref)!.row - parseCellRef(right.ref)!.row)) {
        const label = normalizeSheetLabel(cell.value);
        const key = label === "tong cong" ? "subtotal" : summaryScalarKey(cell.value) ?? (isTotalLabel(cell.value) ? "total" : undefined);
        if (!key || seenScalarKeys.has(key)) continue;
        const target = summaryTarget(sheet, cell, headerRow);
        if (!target) continue;
        summaryCells.push({ key, cell: target.ref });
        seenScalarKeys.add(key);
      }
      if (quote.settlement) {
        for (const cell of sheet.cells.values()) {
          const key = settlementScalarKey(cell.value);
          if (!key || seenScalarKeys.has(key)) continue;
          const numericKey = ["settlementAmount", "amountPaid", "settlementBalance", "paymentDueDays"].includes(key);
          const target = numericKey ? summaryTarget(sheet, cell, headerRow)?.ref ?? settlementValueTarget(sheet, cell) : settlementValueTarget(sheet, cell);
          if (!target || summaryCells.some((entry) => entry.cell === target)) continue;
          summaryCells.push({ key, cell: target });
          seenScalarKeys.add(key);
        }
      }
      candidates.push({ map: {
        sheet: sheet.name, headerRow, firstProductRow: productRows[0]!, summaryRow, productRows,
        columns: [...columns.entries()].map(([key, column]) => ({ key: key as typeof xlsxLineKeys[number], column })),
        cells: summaryCells,
      }, score, purposeScore: xlsxWorksheetPurposeScore(sheet, quote, inputContext), paired: hasContractSettlementVariants,
      large: sheet.rows.size > 500, financialVariants });
    }
  }
  if (!candidates.length) return undefined;
  const bestPurposeScore = Math.max(...candidates.map((candidate) => candidate.purposeScore));
  const purposeCandidates = bestPurposeScore > 0 ? candidates.filter((candidate) => candidate.purposeScore === bestPurposeScore) : candidates;
  purposeCandidates.sort((left, right) => bestPurposeScore > 0
    ? right.score - left.score
    : right.score - left.score || right.purposeScore - left.purposeScore);
  if (purposeCandidates.length > 1 && (purposeCandidates[0]!.score === 0
    || purposeCandidates[0]!.score === purposeCandidates[1]!.score && purposeCandidates[0]!.purposeScore === purposeCandidates[1]!.purposeScore)) return undefined;
  if (purposeCandidates.length === 1 && bestPurposeScore <= 0 && purposeCandidates[0]!.score === 0
    && !purposeCandidates[0]!.paired && !purposeCandidates[0]!.large && !purposeCandidates[0]!.financialVariants) return undefined;
  const selected = purposeCandidates[0]!.map;
  if (quote.settlement) {
    const seenTargets = new Set(selected.cells.map((entry) => `${selected.sheet}!${entry.cell}`));
    const seenKeys = new Set(selected.cells.map((entry) => `${selected.sheet}!${entry.key}`));
    for (const sheet of info.sheets.values()) {
      const cellsByRow = new Map<number, XlsxCellInfo[]>();
      for (const item of sheet.cells.values()) {
        const row = parseCellRef(item.ref)?.row;
        if (row === undefined) continue;
        const rowCells = cellsByRow.get(row) ?? [];
        rowCells.push(item);
        cellsByRow.set(row, rowCells);
      }
      const tableHeaderRows = new Set([...cellsByRow].filter(([, rowCells]) => {
        const recognizedHeaders = new Set(rowCells.flatMap((item) => xlsxLineKeys.filter((lineKey) => headerMatch(lineKey, item.value))));
        return recognizedHeaders.size >= 2;
      }).map(([row]) => row));
      for (const cell of sheet.cells.values()) {
        const row = parseCellRef(cell.ref)?.row;
        if (row !== undefined && tableHeaderRows.has(row)) continue;
        const key = settlementScalarKey(cell.value);
        if (!key) continue;
        const scopedKey = `${sheet.name}!${key}`;
        if (seenKeys.has(scopedKey)) continue;
        const numericKey = ["contractValue", "settlementAmount", "amountPaid", "settlementBalance", "paymentDueDays"].includes(key);
        const target = numericKey ? summaryTarget(sheet, cell, selected.headerRow)?.ref ?? settlementValueTarget(sheet, cell) : settlementValueTarget(sheet, cell);
        if (!target || seenTargets.has(`${sheet.name}!${target}`)) continue;
        const targetSheet = info.sheets.get(sheet.name);
        const targetPoint = parseCellRef(target);
        if (!targetSheet || !targetPoint || !targetSheet.rows.has(targetPoint.row)) continue;
        selected.cells.push({ key, cell: target, ...(sheet.name === selected.sheet ? {} : { sheet: sheet.name }) });
        seenTargets.add(`${sheet.name}!${target}`);
        seenKeys.add(scopedKey);
      }
    }
  }
  return selected;
}

export async function renderAiMappedXlsxTemplate(template: QuoteTemplate, quote: Quote, inputContext = ""): Promise<Buffer> {
  if (template.extension !== "xlsx") throw new Error("Hãy chọn mẫu Excel (.xlsx).");
  if (quote.kind === "customer" && quote.missingProducts?.length) quote = { ...quote, missingProducts: [], lines: [
    ...quote.lines,
    ...quote.missingProducts.map((name) => ({ catalogItemId: "", sku: "", name: `Chưa có trong danh mục: ${name}`, description: "", quantity: 1, unit: "", unitPrice: 0, priceUnavailable: true, currency: quote.currency, attributes: {}, lineTotal: 0 })),
  ] };
  if (directDocumentEditorEnabled()) {
    const workbook = workbookInfo(template);
    const originalSheets = [...workbook.sheets.keys()];
    const estimateWorksheet = quote.kind === "estimate" && !quote.settlement
      ? [...workbook.sheets.values()]
        .filter((sheet) => xlsxSheetHasCandidateTable(sheet, quote))
        .map((sheet) => ({ sheet, score: xlsxWorksheetPurposeScore(sheet, quote, inputContext) }))
        .filter(({ score }) => score >= 0)
        .sort((left, right) => right.score - left.score)[0]?.sheet
      : undefined;
    const worksheetSummaries = [...workbook.sheets.values()].map((sheet) => {
      const rowsToShow = new Set<number>(Array.from({ length: 12 }, (_, index) => index + 1));
      const rowCellsByNumber = new Map<number, XlsxCellInfo[]>();
      for (const cell of sheet.cells.values()) {
        const rowNumber = parseCellRef(cell.ref)?.row;
        if (!rowNumber) continue;
        const rowCells = rowCellsByNumber.get(rowNumber) ?? [];
        rowCells.push(cell);
        rowCellsByNumber.set(rowNumber, rowCells);
      }
      for (const rowNumber of sheet.rows) {
        const rowCells = rowCellsByNumber.get(rowNumber) ?? [];
        const roles = new Set(rowCells.flatMap((cell) => xlsxLineKeys.filter((key) => headerMatch(key, cell.value))));
        const rowLabel = normalizeSheetLabel(rowCells.map((cell) => cell.value).join(" "));
        if (roles.has("name") && (roles.has("quantity") || roles.has("unitPrice") || roles.has("lineTotal"))) {
          for (let offset = 0; offset <= 2; offset++) rowsToShow.add(rowNumber + offset);
        } else if (/\b(tong cong|tong gia tri|thanh toan|quyet toan|nghiem thu|contract value|settlement|payment)\b/.test(rowLabel)) {
          rowsToShow.add(rowNumber);
        }
      }
      const cellsByRow = new Map<number, string[]>();
      for (const cell of sheet.cells.values()) {
        if (!cell.value.trim()) continue;
        const point = parseCellRef(cell.ref);
        if (!point || !rowsToShow.has(point.row)) continue;
        const row = cellsByRow.get(point.row) ?? [];
        row.push(`${cell.ref}=${cell.value.slice(0, 100)}`);
        cellsByRow.set(point.row, row);
      }
      return {
        name: sheet.name,
        content: [...cellsByRow.entries()].sort(([a], [b]) => a - b).slice(0, 35).map(([row, cells]) => `row ${row}: ${cells.join(" | ")}`).join("\n").slice(0, 4_000),
      };
    });
    const functionName = quote.settlement ? "Settlement dossier"
      : quote.kind === "budget" ? "Budget plan"
        : template.category === "estimate" || quote.kind === "estimate" ? "Estimate"
          : "Quotation";
    const worksheetInstructions = quote.settlement
      ? `This workbook may contain several related documents and its tabs may use different layouts and labels. First inspect every tab, its actual headings, field labels, table columns, sample rows, formulas, and cross-sheet references. Identify all tabs and sections relevant to acceptance and settlement from their content; do not rely on tab names, fixed positions, or known sample templates. Then fill every matching field and itemized table using the correct data scope: "contractProducts" contains original contracted items and quantities; "products" contains items and quantities actually accepted; "settlement" contains approved amounts, payments, balances, dates, results, handover details, and identifiers. Never use contracted quantities as accepted quantities. Use supplied amounts and totals as given; do not calculate or infer them. Replace stale example values only in relevant sections, preserve legal text, signatures, formulas, formatting, and unrelated tabs. Reopen the workbook and verify each relevant tab against the supplied data, including all item rows and accepted quantities, before saving. Keep every original tab exactly once and in its original order.`
      : `Select the worksheet by inspecting its actual headings, table columns, labels, and content, not by worksheet name alone. For an Estimate export, a quotation, bao gia, chi phi thi cong, or construction-cost worksheet is a valid match when its actual rows and columns can represent the supplied estimate products, quantities, units, unit prices, and totals. A sheet name alone is never enough to accept or reject a worksheet. Do not use a settlement, acceptance, or contract form as an estimate just because it contains money or item descriptions. ${estimateWorksheet ? `Local workbook inspection found a valid estimate product table in worksheet "${estimateWorksheet.name}". Use this exact worksheet for the estimate; do not reject it because it is labeled as a quotation or bao gia. Replace the existing example product rows with the supplied estimate products, keeping each supplied product on its own row and preserving the requested quantities.` : "If no worksheet has a matching itemized product table, explain that clearly and do not create a mismatched output."}`;
    const editedBytes = await editDocumentFileDirectly({
      bytes: Buffer.from(template.data.buffer), filename: template.originalFilename, extension: "xlsx", functionName,
      userInstructions: [inputContext, `The workbook worksheets and their extracted cell contents are provided here: ${JSON.stringify(worksheetSummaries)}. ${worksheetInstructions} The original worksheet order is ${JSON.stringify(originalSheets)}. The final workbook MUST retain every worksheet exactly once, with the exact same names and order. Do not delete, rename, add, or recreate any worksheet.`].filter(Boolean).join("\n\n"),
      data: directDocumentData(quote, functionName),
    });
    if (!editedBytes) throw new Error("Direct template editing is enabled but returned no edited file.");
    const bytes = quote.settlement?.contract ? fillXlsxPartyNames(editedBytes, quote.settlement.contract) : editedBytes;
    await inspectTemplate(bytes, "xlsx");
    assertXlsxWorksheetsPreserved(template, bytes);
    return bytes;
  }
  if (!quote.lines.length) {
    if (quote.kind === "customer") return renderCustomerXlsxTemplate(template, quote);
    const plan = await createXlsxTemplateFillPlan(template, quote, inputContext);
    return renderXlsxTemplate(template, quote, plan, inputContext);
  }
  const info = workbookInfo(template);
  const inferred = inferSemanticXlsxMap(template, quote, inputContext);
  if (quote.settlement && inferred) {
    const fallbackMap = validateXlsxSemanticMap(inferred, info, quote);
    assertXlsxMapMatchesPurpose(fallbackMap, info, quote, inputContext);
    const prepared = prepareAiXlsxPlan(template, quote, fallbackMap);
    return renderXlsxTemplate(prepared.template, quote, prepared.plan, inputContext);
  }
  try {
    return await requestTemplatePlan<Buffer>([{ type: "text", text: JSON.stringify({
    instruction: "Read this actual Excel workbook on every export. Identify the product table by meaning, not fixed Vietnamese column names or layout. Return one worksheet, the header row, the first existing product row, the summary/total row (0 if absent), and `productRows`: all existing product/example rows in ascending order, skipping category headings and summary rows. Return only the column roles present; each role must point to a different existing header column. For an estimate or settlement dossier, quantity is required: map the quantity column, including headers such as Số lượng, SL, Khối lượng, or Quantity. For a settlement dossier, select a settlement or acceptance worksheet, use accepted quantities from the provided record, and map settlement amount, amount paid, balance, acceptance number/date, location, result and handover details only when matching cells exist. Never select an estimate or customer quotation worksheet for a settlement export. Every `cells[].cell` MUST be an Excel cell address like B3 or H30, NEVER the value in that cell, a formula, or a row number. The workbook cells are arrays [address, value, formula, style]; use the FIRST element as the address. `cells` maps customer/date/total fields to value cell addresses, including currently missing cells on existing rows. For a total row whose label spans merged columns, select the amount column outside that merged label. Choose a matching price variant if clear from product descriptions; otherwise choose the first consistent variant. For a customer product list map name and unitPrice, but omit quantity, lineTotal and summary amounts. Never treat old example values as field labels. Do not return product values or change the workbook. Omit fields absent from the template.",
    documentKind: quote.settlement ? "settlement dossier" : quote.kind ?? "estimate",
    targetWorksheetPurpose: xlsxTargetWorksheetPurpose(quote, inputContext),
    worksheetSelectionRule: "Select the single tab whose name, title and headers match targetWorksheetPurpose and this export function. Do not map into a different function's quote, budget, contract, acceptance or settlement sheet; leave all other tabs unchanged.",
    lineCount: quote.lines.length,
    quoteData: xlsxQuoteValues(quote),
    inputContext,
    sourceMayContainCurrentValues: true,
    availableLineFields: xlsxLineKeys,
    availableScalarFields: quote.kind === "customer" ? ["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt"] : quote.settlement ? [...xlsxScalarKeys] : xlsxScalarKeys.slice(0, 14),
    productExamples: quote.lines.slice(0, 5).map((line) => ({ name: line.name, description: line.description ?? "", attributes: line.attributes })),
    machineSuggestedMap: inferred ?? null,
    workbook: JSON.parse(xlsxWorkbookSummary(template, info, quote, inputContext)),
  }) }, ...await templateAiContent(template, quote)], xlsxSemanticMapSchema, async (raw) => {
    let map: XlsxSemanticMap;
    if (inferred) {
      map = inferred;
      try {
        const aiMap = validateXlsxSemanticMap(resolveXlsxSemanticCells(raw, info), info, quote);
        if (aiMap.sheet === inferred.sheet && aiMap.headerRow === inferred.headerRow) {
          const mappedKeys = new Set(inferred.cells.map((entry) => entry.key));
          const lastTableRow = inferred.summaryRow || Math.max(...inferred.productRows);
          const extraCells = aiMap.cells.filter((entry) => {
            const point = parseCellRef(entry.cell);
            return !mappedKeys.has(entry.key) && point !== null
              && (point.row < inferred.headerRow || point.row > lastTableRow);
          });
          const candidateMap = { ...inferred, cells: [...inferred.cells, ...extraCells] };
          try {
            prepareAiXlsxPlan(template, quote, candidateMap);
            map = candidateMap;
          } catch {
            // Drop unsafe scalar cells while retaining the verified product table and totals.
          }
        }
      } catch {
        // Keep the verified workbook map when the model returns an invalid mapping.
      }
    } else {
      map = validateXlsxSemanticMap(resolveXlsxSemanticCells(raw, info), info, quote);
    }
    assertXlsxMapMatchesPurpose(map, info, quote, inputContext);
    const prepared = prepareAiXlsxPlan(template, quote, map);
    return quote.kind === "customer"
      ? renderCustomerXlsxTemplate(prepared.template, quote, prepared.plan)
      : renderXlsxTemplate(prepared.template, quote, prepared.plan, inputContext);
    }, { xlsxSemanticMap: true });
  } catch (error) {
    if (!quote.settlement || !inferred) throw error;
    const fallbackMap = validateXlsxSemanticMap(inferred, info, quote);
    assertXlsxMapMatchesPurpose(fallbackMap, info, quote, inputContext);
    const prepared = prepareAiXlsxPlan(template, quote, fallbackMap);
    return renderXlsxTemplate(prepared.template, quote, prepared.plan, inputContext);
  }
}

export async function renderCustomerXlsxTemplate(template: QuoteTemplate, quote: Quote, mappedPlan?: XlsxTemplateFillPlan): Promise<Buffer> {
  if (template.extension !== "xlsx" || quote.kind !== "customer") throw new Error("Báo giá khách cần mẫu Excel (.xlsx).");
  if (quote.missingProducts?.length) quote = { ...quote, lines: [
    ...quote.lines,
    ...quote.missingProducts.map((name) => ({ catalogItemId: "", sku: "", name: `Chưa có trong danh mục: ${name}`, description: "", quantity: 1, unit: "", unitPrice: 0, priceUnavailable: true, currency: quote.currency, attributes: {}, lineTotal: 0 })),
  ] };
  const inferred = inferCustomerXlsxPlan(template, quote);
  const plan = mappedPlan ?? await requestTemplatePlan<XlsxTemplateFillPlan>([{ type: "text", text: JSON.stringify({
    instruction: "Read the Excel sheet headers, merged sections and sample rows, then map this customer product list into existing cells. Return cells and lineRows only. Map customerName, quoteNumber, customerEmail, customerPhone and createdAt only where the template has matching fields. Each product row must map name and unitPrice; map unit (ĐVT), index, sku and details only when those columns exist. When multiple unit-price columns describe different variants, choose the column matching the product description and attributes; if no variant matches clearly, use the first unit-price column. Skip section headings and summary rows. Never map quantity, lineTotal, subtotal, tax, shipping or total. Use only existing cells and enough distinct product rows. Preserve the template layout. If no suitable cells exist, return empty arrays.",
    lineCount: quote.lines.length,
    products: quote.lines.map((line) => ({ name: line.name, description: line.description ?? "", attributes: line.attributes ?? {}, unit: line.unit })),
    quoteData: xlsxQuoteValues(quote),
    machineSuggestedMap: inferred ?? null,
    workbook: JSON.parse(xlsxWorkbookSummary(template, workbookInfo(template), quote)),
  }) }, ...await templateAiContent(template, quote)], xlsxMapSchema, (raw) => validateXlsxTemplateFillPlan(raw, template, quote));
  validateXlsxTemplateFillPlan(plan, template, quote);
  const info = workbookInfo(template);
  const values = xlsxQuoteValues(quote);
  const serializer = new XMLSerializer();
  for (const sheet of info.sheets.values()) {
    const mappedRows = plan.lineRows.filter((row) => row.sheet === sheet.name);
    const mappedCells = plan.cells.filter((cell) => cell.sheet === sheet.name);
    if (!mappedRows.length && !mappedCells.length) continue;
    const document = validateXml(info.zip.file(sheet.path)!.asText());
    const cellNodes = new Map(descendants(document, "c").map((cell) => [(cell.getAttribute("r") ?? "").replace(/\$/g, "").toUpperCase(), cell]));
    const rowNodes = new Map(descendants(document, "row").map((row) => [Number(row.getAttribute("r")), row]));
    if (mappedRows.length) {
      const nameColumn = parseCellRef(mappedRows[0]!.fields.find((field) => field.key === "name")!.cell)!.column;
      const firstRow = Math.min(...mappedRows.map((row) => row.row));
      let headerRow: number | undefined = plan.tableHeaderRow;
      if (!headerRow) for (let row = firstRow - 1; row >= Math.max(1, firstRow - 15); row--) {
        if (headerMatch("name", sheet.cells.get(`${nameColumn}${row}`)?.value ?? "")) { headerRow = row; break; }
      }
      if (!headerRow) {
        const mappedColumns = new Set(mappedRows[0]!.fields.map((field) => parseCellRef(field.cell)!.column));
        for (let row = firstRow - 1; row >= Math.max(1, firstRow - 15); row--) {
          const labels = [...mappedColumns].filter((column) => sheet.cells.get(`${column}${row}`)?.value.trim()).length;
          if (labels >= 2) { headerRow = row; break; }
        }
      }
      const mappedRowNumbers = new Set(mappedRows.map((row) => row.row));
      const summaryRows = [...sheet.rows].filter((row) => row > (headerRow ?? firstRow) && (row === plan.tableEndRow
        || [...sheet.cells.values()].some((cell) => parseCellRef(cell.ref)?.row === row && isSummaryRowLabel(cell.value))));
      const endRow = summaryRows.find((row) => row > firstRow) ?? Math.max(...sheet.rows) + 1;
      if (headerRow) {
        const productColumns = new Set([
          ...(plan.tableProductRows ? [...sheet.cells.values()]
            .filter((cell) => plan.tableProductRows!.includes(parseCellRef(cell.ref)?.row ?? 0))
            .map((cell) => parseCellRef(cell.ref)!.column) : []),
          ...[...sheet.cells.values()].filter((cell) => parseCellRef(cell.ref)?.row === headerRow)
            .filter((cell) => xlsxLineKeys.some((key) => headerMatch(key, cell.value))).map((cell) => parseCellRef(cell.ref)!.column),
          ...mappedRows[0]!.fields.map((field) => parseCellRef(field.cell)!.column),
        ]);
        for (const row of sheet.rows) {
          if (row <= headerRow || row >= endRow) continue;
          const isProductRow = plan.tableProductRows ? plan.tableProductRows.includes(row) : sheet.cells.has(`${nameColumn}${row}`);
          if (!isProductRow) continue;
          for (const column of productColumns) {
            const cell = cellNodes.get(`${column}${row}`);
            if (cell) clearSpreadsheetCell(cell);
          }
          if (!mappedRowNumbers.has(row)) rowNodes.get(row)?.setAttribute("hidden", "1");
          else rowNodes.get(row)?.removeAttribute("hidden");
        }
        clearTableProductImages(info.zip, sheet, headerRow, endRow);
      }
      for (const row of summaryRows) {
        rowNodes.get(row)?.setAttribute("hidden", "1");
        for (const cell of sheet.cells.values()) if (parseCellRef(cell.ref)?.row === row) {
          const target = cellNodes.get(cell.ref);
          if (target) clearSpreadsheetCell(target);
        }
      }
    }
    for (const entry of mappedCells) {
      const cell = cellNodes.get(entry.cell)!;
      const previous = sheet.cells.get(entry.cell)?.value ?? "";
      const value = entry.key === "customerName" && isCustomerLabel(previous)
        ? `${previous}${previous.endsWith(" ") ? "" : " "}${quote.customerName}` : values[entry.key];
      setSpreadsheetCell(cell, value, "replace");
    }
    for (const [index, row] of mappedRows.entries()) for (const field of row.fields) {
      const value = values[`line_${index + 1}_${field.key}`];
      if (value === undefined) throw new Error("Mẫu Excel thiếu dữ liệu sản phẩm cần điền.");
      if (field.key === "unitPrice" && value === "") clearSpreadsheetCell(cellNodes.get(field.cell)!);
      else setSpreadsheetCell(cellNodes.get(field.cell)!, value, "replace");
    }
    info.zip.file(sheet.path, serializer.serializeToString(document));
  }
  const targetWorksheet = plan.lineRows[0]?.sheet ?? plan.cells[0]?.sheet;
  if (targetWorksheet) activateXlsxWorksheet(info, targetWorksheet);
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

/** Validate the Office package before saving a user-uploaded template. */
export async function inspectUploadedTemplate(bytes: Buffer, extension: string) {
  const invalidFile = "File mẫu bị hỏng hoặc thiếu nội dung. Hãy mở và lưu lại bằng Word, Excel hoặc trình đọc PDF rồi tải lại.";
  try {
    await inspectTemplate(bytes, extension);
    if (extension === "pdf") return;
    const zip = openZip(bytes);
    const readPart = (name: string, root: string) => {
      const part = zip.file(name);
      if (!part) throw new Error(invalidFile);
      const document = validateXml(part.asText());
      if (document.documentElement?.localName !== root) throw new Error(invalidFile);
      return document;
    };
    const types = readPart("[Content_Types].xml", "Types");
    const relationships = readPart("_rels/.rels", "Relationships");
    const root = extension === "docx" ? "word/document.xml" : "xl/workbook.xml";
    if (!descendants(types, "Override").some((entry) => entry.getAttribute("PartName") === `/${root}`)
      || !descendants(relationships, "Relationship").some((entry) => /\/officeDocument$/.test(entry.getAttribute("Type") ?? "") && (entry.getAttribute("Target") ?? "").replace(/^\//, "") === root)) throw new Error(invalidFile);
    if (extension === "docx") {
      const document = readPart(root, "document");
      if (!descendants(document, "body").length) throw new Error(invalidFile);
      return;
    }
    const workbook = readPart(root, "workbook");
    const relations = readPart("xl/_rels/workbook.xml.rels", "Relationships");
    const sheets = descendants(workbook, "sheet");
    if (!sheets.length) throw new Error(invalidFile);
    for (const sheet of sheets) {
      const relation = descendants(relations, "Relationship").find((entry) => entry.getAttribute("Id") === sheet.getAttribute("r:id"));
      const target = relation?.getAttribute("Target");
      if (!target || relation?.getAttribute("TargetMode") === "External") throw new Error(invalidFile);
      const path = target.startsWith("/") ? target.slice(1) : pathPosix.normalize(pathPosix.join("xl", target));
      const kind = relation!.getAttribute("Type")?.split("/").pop();
      if (kind !== "worksheet" && kind !== "chartsheet") throw new Error(invalidFile);
      readPart(path, kind);
    }
  } catch (error) {
    // Keep useful limits and unsupported-content errors, without leaking parser diagnostics.
    if (error instanceof Error && /50 MB|macro|đối tượng nhúng|khớp định dạng|Hãy chọn mẫu/.test(error.message)) throw error;
    throw new Error(invalidFile);
  }
}

export function templateDetails(template: QuoteTemplate) {
  return { id: template._id!.toHexString(), name: template.name || template.originalFilename, originalFilename: template.originalFilename, extension: template.extension, bytes: template.bytes, createdAt: template.createdAt, category: template.category ?? "quote" };
}

export async function currentTemplate(db: Db, companyId: string) {
  const company = await db.collection<Company>("companies").findOne({ _id: new ObjectId(companyId) });
  const templates = db.collection<QuoteTemplate>("quoteTemplates");
  const active = { companyId, deletedAt: { $exists: false }, category: { $in: ["quote", null] as const } };
  const selected = company?.quoteTemplateId && ObjectId.isValid(company.quoteTemplateId)
    ? await templates.findOne({ ...active, _id: new ObjectId(company.quoteTemplateId) }, { projection: { data: 0, fillPlanCache: 0, xlsxFillPlanCache: 0 } }) : null;
  return selected ?? templates.find(active, { projection: { data: 0, fillPlanCache: 0, xlsxFillPlanCache: 0 } }).sort({ _id: -1 }).limit(1).next();
}

export async function savedTemplate(db: Db, companyId: string, snapshot: QuoteTemplateSnapshot) {
  const template = await db.collection<QuoteTemplate>("quoteTemplates").findOne({ _id: new ObjectId(snapshot.id), companyId });
  if (!template) throw new Error("Không tìm thấy mẫu đã lưu của báo giá.");
  return template;
}

export async function renderTemplate(template: QuoteTemplate, quote: Quote, inputContext = "") {
  if (directDocumentEditorEnabled() && ["xlsx", "docx", "pdf"].includes(template.extension)) {
    const functionName = quote.settlement ? "Settlement dossier"
      : quote.kind === "budget" ? "Budget plan"
        : template.category === "estimate" || quote.kind === "estimate" ? "Estimate"
          : "Quotation";
    const bytes = await editDocumentFileDirectly({
      bytes: Buffer.from(template.data.buffer), filename: template.originalFilename,
      extension: template.extension as "xlsx" | "docx" | "pdf", functionName,
      userInstructions: inputContext,
      data: directDocumentData(quote, functionName),
    });
    if (!bytes) throw new Error("Direct template editing is enabled but returned no edited file.");
    await inspectTemplate(bytes, template.extension);
    if (template.extension === "xlsx") assertXlsxWorksheetsPreserved(template, bytes);
    return bytes;
  }
  if (template.extension === "xlsx") {
    const xlsxPlan = quote.xlsxTemplateFillPlan ?? template.xlsxFillPlanCache?.[xlsxPlanKey(quote)];
    if (xlsxPlan) return renderXlsxTemplate(template, quote, xlsxPlan, inputContext);
  }
  const hasLineDetails = quote.lines.some((line) => Boolean(quoteLineDetails(line)));
  const fillPlanKey = `${hasLineDetails ? "v3d" : "v3"}_${quote.lines.length}`;
  const fillPlan = quote.templateFillPlan ?? template.fillPlanCache?.[fillPlanKey] ?? template.fillPlanCache?.[String(quote.lines.length)];
  if (fillPlan) return renderAiTemplate(template, quote, fillPlan);
  if (!template.capacity) throw new Error("Báo giá chưa được AI điền theo mẫu. Vui lòng tạo lại báo giá.");
  if (quote.lines.length > template.capacity) throw new Error(`Mẫu cũ chỉ có ${template.capacity} dòng. Hãy tạo báo giá mới để AI điền mẫu.`);
  const values: Record<string, string> = {
    quoteNumber: quote.quoteNumber, customerName: quote.customerName, customerEmail: quote.customerEmail, customerPhone: quote.customerPhone ?? "",
    createdAt: new Date(quote.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    subtotal: quote.subtotal.toLocaleString("vi-VN"), shippingFee: (quote.shippingFee ?? 0).toLocaleString("vi-VN"), taxRate: `${quote.taxRate * 100}%`, taxAmount: quote.taxAmount.toLocaleString("vi-VN"), total: quote.total.toLocaleString("vi-VN"), currency: quote.currency,
    validityDays: quote.validityDays == null ? "" : `${quote.validityDays} ngày`,
    completionDate: quote.completionDate ? new Date(`${quote.completionDate}T00:00:00Z`).toLocaleDateString("vi-VN", { timeZone: "UTC" }) : "",
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
