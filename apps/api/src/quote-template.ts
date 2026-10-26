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
  category?: "quote" | "estimate" | "contract" | "acceptance" | null;
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

const xlsxScalarKeys = ["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt", "subtotal", "shippingFee", "taxRate", "taxAmount", "total", "currency", "validityDays", "completionDate", "additionalInformation"] as const;
const xlsxLineKeys = ["index", "sku", "name", "details", "width", "height", "length", "quantity", "unit", "unitPrice", "lineTotal"] as const;
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
  // Keep the original ZIP for export, but omit Word formatting and embedded images from the AI prompt.
  // Exact text-run XML remains available so returned edits can still target the original document.
  const parts = officeParts(zip, template.extension).map((part) => ({
    part: part.name,
    xml: template.extension === "docx" ? compactDocxXmlForAi(part.asText()) : part.asText(),
  }));
  const referenceNames = template.extension === "docx" ? [] : ["xl/workbook.xml", "xl/styles.xml"];
  const referenceParts = referenceNames.flatMap((name) => zip.file(name) ? [{ part: name, xml: zip.file(name)!.asText() }] : []);
  const text = JSON.stringify({ filename: template.originalFilename, format: template.extension, parts, referenceParts });
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

export async function createTemplateFillPlan(template: QuoteTemplate, quote: Quote): Promise<TemplateFillPlan> {
  const lineDetails = quote.lines.map((line, index) => ({ line: index + 1, value: quoteLineDetails(line) }));
  const plan = await requestTemplatePlan<TemplateFillPlan>([
    { type: "text", text: JSON.stringify({
       instruction: "Create a reusable fill plan for this actual company template. Never require the user to add placeholders. Office: edits are exact unique XML find/replace operations applied in order to the supplied parts; preserve namespaces, styles, drawings, page settings. Use only [[key]] bindings inside XML text nodes, never literal quote data. For XLSX use inlineStr cells when replacing shared-string references, preserve cell style attributes; never put localized amounts in numeric <v> cells. Duplicate existing styled table rows as needed for the specified lineCount; adjust row/cell references and merges consistently. Replace old example line items, clear unused example rows. PDF: pdfEdits places text within boxes in PDF points (bottom-left origin); erase=true covers old example text only, never labels or logo. Do not overlap boxes. Use existing pages; if layout cannot fit, return empty arrays. Include customerName, total, subtotal, shippingFee, taxRate and taxAmount when the template has suitable matching fields, and every available line's name, quantity, unit price and line total. When line_n_details is non-empty and the template has a suitable product specification or description area, include it with that line while keeping quantity and prices in their own fields. If additionalInformation is available and the template has a clear notes or supplementary-information area, include it there. Other template-specific sections can remain unchanged when no new data is supplied. Return edits=[] for PDF or pdfEdits=[] for Office.",
      lineCount: quote.lines.length,
      availableBindings: Object.keys(quoteValues(quote)),
      lineDetails,
      ...(template.extension === "pdf" ? { exampleValues: quoteValues(quote) } : {}),
    }) },
    ...await templateAiContent(template),
  ], fillSchema, (raw) => validateFillPlan(raw, quote));
  await renderAiTemplate(template, quote, plan);
  return plan;
}

export async function getOrCreateTemplateFillPlan(db: Db, template: QuoteTemplate, quote: Quote): Promise<TemplateFillPlan> {
  const hasLineDetails = quote.lines.some((line) => Boolean(quoteLineDetails(line)));
  const key = `${hasLineDetails ? "v6d" : "v6"}_${quote.lines.length}_${quoteAdditionalInformation(quote) ? "i1" : "i0"}`;
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

function xlsxPlanKey(quote: Quote) {
  const dimensions = quote.lines.map((line) => dimensionKeys.map((key) => lineDimension(line, key) ? "1" : "0").join("")).join("");
  return `v6_${quote.lines.length}_${quote.lines.map((line) => quoteLineDetails(line) ? "1" : "0").join("")}_${dimensions}_${quoteAdditionalInformation(quote) ? "i1" : "i0"}`;
}

function normalizeSheetLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLocaleLowerCase("vi").replace(/[^a-z0-9]+/g, " ").trim();
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
  if (key === "quantity") return ["sl", "so luong", "khoi luong", "khoi luong thi cong", "qty", "quantity"].includes(label);
  if (key === "unitPrice") return label === "don gia" || label.startsWith("don gia ") || ["gia ban", "gia mot don vi", "unit price", "price"].includes(label);
  if (key === "lineTotal") return label === "thanh tien" || label.startsWith("thanh tien ") || ["line total", "amount", "total amount"].includes(label);
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
  return ["tong", "tong cong", "tong thanh toan", "tong tien thanh toan", "tong cong thanh toan", "grand total", "total", "amount due"].includes(label);
}

function summaryScalarKey(value: string): typeof xlsxScalarKeys[number] | undefined {
  const label = normalizeSheetLabel(value);
  if (/^(phi van chuyen|chi phi van chuyen|phi giao hang|cuoc van chuyen|shipping fee|delivery fee)( |$)/.test(label)) return "shippingFee";
  if (/^(thue suat|vat rate|tax rate)( |$)/.test(label)) return "taxRate";
  if (/^(tam tinh|cong tien hang|tong tien hang|tien hang|subtotal|amount before tax)( |$)/.test(label)) return "subtotal";
  if (/^(tien thue|thue gia tri gia tang|tien thue gtgt|thue gtgt(?: \d+)?|thue vat|vat(?: \d+)?|tax|tax amount|vat amount)( |$)/.test(label)) return "taxAmount";
  return undefined;
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
      workbook: JSON.parse(xlsxWorkbookSummary(template, info)),
    }) }], schema, (raw) => {
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

export async function createXlsxTemplateFillPlan(template: QuoteTemplate, quote: Quote, inputContext = ""): Promise<XlsxTemplateFillPlan> {
  const inferred = inferXlsxTemplateFillPlan(template, quote);
  if (inferred) {
    const plan = await addAiMappedSummaryCells(inferred, template, quote);
    renderXlsxTemplate(template, quote, plan, inputContext);
    return plan;
  }
  const info = workbookInfo(template);
  const mappedPlan = await requestTemplatePlan<XlsxTemplateFillPlan>([{ type: "text", text: JSON.stringify({
    instruction: "Map the supplied quote fields to existing cells in this Excel quote template. Return cell coordinates only; never return XML edits. `cells` maps scalar keys to cells. `lineRows` must contain exactly one row per quote product, in order, and all its cells must be in that same existing row. Include name, quantity, unitPrice and lineTotal for every line. Also include sku and unit when the template has columns for them, and details when it has a description/specification column. When a requested product has width, height or length in its request attributes, map each available value to a matching dimension column in that product's row, preserving the supplied value and unit. Never invent a missing dimension. Map quoteNumber and customerName when those fields have a suitable location. Map subtotal, shippingFee, taxRate, taxAmount and total to matching summary rows when present (for example tạm tính, phí vận chuyển, thuế suất, VAT/thuế GTGT and tổng thanh toán). Map additionalInformation only when supplied and when the template has a clear notes or supplementary-information cell. Map other scalar keys only when the template has a matching field. Use only listed cell coordinates and row numbers; never use formulas as text cells. Formula cells may be mapped only to numeric amount/quantity fields: the server will preserve each formula and update its cached result. Do not map labels, headers, terms, seller details, logos, or decorative cells. If the template does not have enough existing product rows or a suitable place for required values, return empty arrays.",
    requiredScalars: ["customerName", "total"], availableScalars: xlsxScalarKeys.filter((key) => key !== "additionalInformation" || Boolean(quoteAdditionalInformation(quote))), lineCount: quote.lines.length,
    lines: quote.lines.map((line, index) => ({ index: index + 1, detailsAvailable: Boolean(quoteLineDetails(line)), hasDescription: Boolean(line.description?.trim()), dimensionsAvailable: Object.fromEntries(dimensionKeys.map((key) => [key, Boolean(lineDimension(line, key))])) })),
    workbook: JSON.parse(xlsxWorkbookSummary(template, info)),
  }) }], xlsxMapSchema, (raw) => validateXlsxTemplateFillPlan(raw, template, quote));
  const plan = await addAiMappedSummaryCells(addRecognizedSummaryCells(mappedPlan, template), template, quote);
  validateXlsxTemplateFillPlan(plan, template, quote);
  renderXlsxTemplate(template, quote, plan, inputContext);
  return plan;
}

export async function getOrCreateXlsxTemplateFillPlan(db: Db, template: QuoteTemplate, quote: Quote, inputContext = ""): Promise<XlsxTemplateFillPlan> {
  const key = xlsxPlanKey(quote);
  const cached = template.xlsxFillPlanCache?.[key];
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
  const numericKeys = new Set(["subtotal", "shippingFee", "taxRate", "taxAmount", "total", "index", "quantity", "unitPrice", "lineTotal"]);
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
  if (quote.kind === "customer" && plan.cells.some((entry) => !["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt"].includes(entry.key))) throw new Error("Mẫu báo giá khách không được ánh xạ trường tính tiền.");
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
    if (!fieldKeys.has("name") || quote.kind === "customer" && !fieldKeys.has("unitPrice")
      || quote.kind !== "customer" && !["unitPrice", "lineTotal"].some((key) => fieldKeys.has(key))) throw new Error("AI chưa ánh xạ đủ cột sản phẩm và giá vào mẫu Excel.");
  }
  return plan;
}

function xlsxQuoteValues(quote: Quote): Record<string, string | number> {
  const additionalInformation = quoteAdditionalInformation(quote);
  const values: Record<string, string | number> = {
    quoteNumber: quote.quoteNumber, customerName: quote.customerName, customerEmail: quote.customerEmail, customerPhone: quote.customerPhone ?? "",
    createdAt: new Date(quote.createdAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
    subtotal: quote.subtotalUnknown ? "" : quote.subtotal, shippingFee: quote.shippingFee ?? 0, taxRate: quote.taxRate, taxAmount: quote.taxAmount, total: quote.totalUnknown ? "" : quote.total, currency: quote.currency,
    validityDays: quote.validityDays ?? "",
    completionDate: quote.completionDate ? new Date(`${quote.completionDate}T00:00:00Z`).toLocaleDateString("vi-VN", { timeZone: "UTC" }) : "",
    ...(additionalInformation ? { additionalInformation } : {}),
  };
  quote.lines.forEach((line, index) => {
    const lineValues: Record<string, string | number> = {
      index: index + 1, sku: line.sku, name: line.name, description: line.description ?? "", details: quoteLineDetails(line),
      width: lineDimension(line, "width"), height: lineDimension(line, "height"), length: lineDimension(line, "length"), quantity: line.quantityUnknown ? "" : line.quantity,
      unit: line.unit, unitPrice: line.priceUnavailable ? "" : line.unitPrice, lineTotal: line.lineTotalUnknown ? "" : line.lineTotal,
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
    const mappedSummaryRows = new Set(plan.cells.filter((entry) => entry.sheet === sheet.name && ["subtotal", "shippingFee", "taxRate", "taxAmount"].includes(entry.key))
      .map((entry) => parseCellRef(entry.cell)?.row).filter((row): row is number => row !== undefined));
    const measureColumns = rowsForSheet[0]!.fields.filter((field) => ["quantity", "unitPrice", "lineTotal"].includes(field.key)).map((field) => parseCellRef(field.cell)?.column).filter((value): value is string => Boolean(value));
    const productColumns = ["name", "quantity", "unitPrice", "lineTotal"].map((key) => {
      const field = rowsForSheet[0]!.fields.find((entry) => entry.key === key);
      return field ? parseCellRef(field.cell)?.column : undefined;
    }).filter((column): column is string => Boolean(column));
    if (!productColumns.includes(namePoint.column) || productColumns.length < 2) continue;
    const imageColumn = [...sheet.cells.values()].find((cell) => Number(cell.ref.match(/\d+$/)?.[0]) === headerRow && /hinh anh|image|photo/.test(normalizeSheetLabel(cell.value)))?.ref.match(/^[A-Z]+/)?.[0];
    const document = validateXml(info.zip.file(sheet.path)!.asText());
    const rowNodes = new Map(descendants(document, "row").map((row) => [Number(row.getAttribute("r")), row]));
    const cellsByRef = new Map(descendants(document, "c").map((cell) => [(cell.getAttribute("r") ?? "").replace(/\$/g, "").toUpperCase(), cell]));
    for (let row = headerRow + 1; row < totalPoint.row; row++) {
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
      if (isProductRow && isSummaryRow) {
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

function renderXlsxTemplate(template: QuoteTemplate, quote: Quote, raw: XlsxTemplateFillPlan, inputContext = "") {
  const plan = validateXlsxTemplateFillPlan(structuredClone(raw), template, quote);
  const info = workbookInfo(template);
  const taxRateStringTargets = quote.kind === "budget" ? new Set<string>() : addFallbackSummaryRows(info, plan);
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
        : entry.key === "customerName" && isCustomerLabel(current) ? `${current}${current.endsWith(" ") ? "" : " "}${values[entry.key]}` : values[entry.key];
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
      const formulaMode = entry.key.endsWith("_quantity") || entry.key.endsWith("_unitPrice") || entry.key.endsWith("_index") ? "replace" : ["subtotal", "shippingFee", "taxRate", "taxAmount", "total"].includes(entry.key) || entry.key.endsWith("_lineTotal") ? "preserve" : "reject";
      if (entry.value === "" && (entry.key === "subtotal" || entry.key === "total" || entry.key.endsWith("_quantity") || entry.key.endsWith("_lineTotal"))) clearSpreadsheetCell(cell);
      else setSpreadsheetCell(cell, entry.value!, formulaMode);
    }
    info.zip.file(sheet.path, serializer.serializeToString(document));
  }
  return info.zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
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
  if (inferred) return renderXlsxTemplate(inferred.template, quote, inferred.plan, inputContext);
  const plan = await createXlsxTemplateFillPlan(template, quote, inputContext);
  return renderXlsxTemplate(template, quote, plan, inputContext);
}

interface XlsxSemanticMap {
  sheet: string;
  headerRow: number;
  firstProductRow: number;
  summaryRow: number;
  productRows: number[];
  columns: Array<{ key: typeof xlsxLineKeys[number]; column: string }>;
  cells: Array<{ key: typeof xlsxScalarKeys[number]; cell: string }>;
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
      && !productRows.includes(point.row));
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
  const map = raw as XlsxSemanticMap;
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
  if (!columnKeys.has("name")) throw new Error("AI chưa xác định được cột tên sản phẩm.");
  if (quote.kind === "customer" ? !columnKeys.has("unitPrice") : !columnKeys.has("unitPrice") && !columnKeys.has("lineTotal")) throw new Error("AI chưa xác định được cột giá sản phẩm.");
  const nameColumn = map.columns.find((entry) => entry.key === "name")!.column;
  if (map.productRows.some((row) => !sheet.cells.has(`${nameColumn}${row}`) || !isMergeAnchor(`${nameColumn}${row}`, sheet.merged))) throw new Error("AI chọn dòng không có ô tên sản phẩm hợp lệ.");
  const scalarKeys = new Set<string>();
  for (const entry of map.cells) {
    const point = entry && typeof entry.cell === "string" ? parseCellRef(entry.cell) : null;
    if (!entry || !xlsxScalarKeys.includes(entry.key) || !point || !sheet.rows.has(point.row) || !isMergeAnchor(entry.cell, sheet.merged)
      || scalarKeys.has(entry.key) || quote.kind === "customer" && !["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt"].includes(entry.key)) throw new Error(`AI chọn ô thông tin Excel không hợp lệ (${String(entry?.key ?? "?").slice(0, 40)}).`);
    scalarKeys.add(entry.key);
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
      return { ...entry, cell: point.row >= oldSummaryRow ? `${point.column}${point.row + delta}` : entry.cell };
    }) };
    info = workbookInfo(template);
    sheet = info.sheets.get(map.sheet)!;
    for (let row = oldSummaryRow; row < map.summaryRow; row++) productRows.push(row);
  }
  const allowedFields = quote.kind === "customer" ? new Set(["index", "sku", "name", "details", "unit", "unitPrice"]) : null;
  const selectedRows = productRows.slice(0, quote.lines.length);
  const refs = [
    ...productRows.flatMap((row) => [...columns.values()].map((column) => `${column}${row}`)),
    ...map.cells.map((entry) => entry.cell),
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
    cells: map.cells.map((entry) => ({ ...entry, sheet: map.sheet })),
    lineRows: selectedRows.map((row) => ({ sheet: map.sheet, row, fields: [...columns.entries()]
      .filter(([key]) => !allowedFields || allowedFields.has(key))
      .map(([key, column]) => ({ key, cell: `${column}${row}` })) })),
  };
  validateXlsxTemplateFillPlan(plan, prepared, quote);
  return { template: prepared, plan };
}

export async function renderAiMappedXlsxTemplate(template: QuoteTemplate, quote: Quote, inputContext = ""): Promise<Buffer> {
  if (template.extension !== "xlsx") throw new Error("Hãy chọn mẫu Excel (.xlsx).");
  if (quote.kind === "customer" && quote.missingProducts?.length) quote = { ...quote, missingProducts: [], lines: [
    ...quote.lines,
    ...quote.missingProducts.map((name) => ({ catalogItemId: "", sku: "", name: `Chưa có trong danh mục: ${name}`, description: "", quantity: 1, unit: "", unitPrice: 0, priceUnavailable: true, currency: quote.currency, attributes: {}, lineTotal: 0 })),
  ] };
  const info = workbookInfo(template);
  return requestTemplatePlan<Buffer>([{ type: "text", text: JSON.stringify({
    instruction: "Read this actual Excel workbook on every export. Identify the product table by meaning, not fixed Vietnamese column names or layout. Return one worksheet, the header row, the first existing product row, the summary/total row (0 if absent), and `productRows`: all existing product/example rows in ascending order, skipping category headings and summary rows. Return only the column roles present; each role must point to a different existing header column. Every `cells[].cell` MUST be an Excel cell address like B3 or H30, NEVER the value in that cell, a formula, or a row number. The workbook cells are arrays [address, value, formula, style]; use the FIRST element as the address. `cells` maps customer/date/total fields to value cell addresses, including currently missing cells on existing rows. For a total row whose label spans merged columns, select the amount column outside that merged label. Choose a matching price variant if clear from product descriptions; otherwise choose the first consistent variant. For a customer product list map name and unitPrice, but omit quantity, lineTotal and summary amounts. Never treat old example values as field labels. Do not return product values or change the workbook. Omit fields absent from the template.",
    documentKind: quote.kind ?? "estimate",
    lineCount: quote.lines.length,
    availableLineFields: xlsxLineKeys,
    availableScalarFields: quote.kind === "customer" ? ["quoteNumber", "customerName", "customerEmail", "customerPhone", "createdAt"] : xlsxScalarKeys,
    productExamples: quote.lines.slice(0, 5).map((line) => ({ name: line.name, description: line.description ?? "", attributes: line.attributes })),
    workbook: JSON.parse(xlsxWorkbookSummary(template, info)),
  }) }], xlsxSemanticMapSchema, async (raw) => {
    const prepared = prepareAiXlsxPlan(template, quote, validateXlsxSemanticMap(resolveXlsxSemanticCells(raw, info), info, quote));
    return quote.kind === "customer"
      ? renderCustomerXlsxTemplate(prepared.template, quote, prepared.plan)
      : renderXlsxTemplate(prepared.template, quote, prepared.plan, inputContext);
  }, { xlsxSemanticMap: true });
}

export async function renderCustomerXlsxTemplate(template: QuoteTemplate, quote: Quote, mappedPlan?: XlsxTemplateFillPlan): Promise<Buffer> {
  if (template.extension !== "xlsx" || quote.kind !== "customer") throw new Error("Báo giá khách cần mẫu Excel (.xlsx).");
  if (quote.missingProducts?.length) quote = { ...quote, lines: [
    ...quote.lines,
    ...quote.missingProducts.map((name) => ({ catalogItemId: "", sku: "", name: `Chưa có trong danh mục: ${name}`, description: "", quantity: 1, unit: "", unitPrice: 0, priceUnavailable: true, currency: quote.currency, attributes: {}, lineTotal: 0 })),
  ] };
  const inferred = mappedPlan ?? inferCustomerXlsxPlan(template, quote);
  const plan = inferred ?? await requestTemplatePlan<XlsxTemplateFillPlan>([{ type: "text", text: JSON.stringify({
    instruction: "Read the Excel sheet headers, merged sections and sample rows, then map this customer product list into existing cells. Return cells and lineRows only. Map customerName, quoteNumber, customerEmail, customerPhone and createdAt only where the template has matching fields. Each product row must map name and unitPrice; map unit (ĐVT), index, sku and details only when those columns exist. When multiple unit-price columns describe different variants, choose the column matching the product description and attributes; if no variant matches clearly, use the first unit-price column. Skip section headings and summary rows. Never map quantity, lineTotal, subtotal, tax, shipping or total. Use only existing cells and enough distinct product rows. Preserve the template layout. If no suitable cells exist, return empty arrays.",
    lineCount: quote.lines.length,
    products: quote.lines.map((line) => ({ name: line.name, description: line.description ?? "", attributes: line.attributes ?? {}, unit: line.unit })),
    workbook: JSON.parse(xlsxWorkbookSummary(template)),
  }) }], xlsxMapSchema, (raw) => validateXlsxTemplateFillPlan(raw, template, quote));
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
