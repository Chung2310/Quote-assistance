import PizZip from "pizzip";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { applyWordFillPlan, type WordFillPlan } from "./word-template-fill.js";
import type { QuoteTemplate } from "./quote-template.js";

const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const descendants = (node: Element, tag: string) => Array.from(node.getElementsByTagNameNS(ns, tag));
const children = (node: Element, tag: string) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).namespaceURI === ns && (child as Element).localName === tag);
const text = (node: Element) => descendants(node, "t").map((element) => element.textContent ?? "").join("");
const tokens = (value: string) => [...value.matchAll(/(?<!\[)\[([^\[\]\r\n]{1,200})\](?!\])/g)];
const scalarLabels: Record<string, string> = {
  "so hop dong": "contractNumber", "ma hop dong": "contractNumber", "so du toan": "quoteNumber", "so bao gia": "quoteNumber",
  "ten khach hang": "customerName", "ten ben a": "customerName", "dai dien ben a": "customerRepresentative",
  "dia chi ben a": "customerAddress", "mst ben a": "customerTaxId", "dien thoai ben a": "customerPhone", "email ben a": "customerEmail",
  "ten don vi thuc hien": "companyName", "ten cong ty": "companyName", "ten ben b": "companyName", "dai dien ben b": "companyRepresentative",
  "dia chi ben b": "companyAddress", "mst ben b": "companyTaxId", "dien thoai ben b": "companyPhone", "email ben b": "companyEmail",
  "ngay ky": "signedDateDisplay", "dia diem ky": "signingPlace", "ten cong trinh": "projectName", "ten du an": "projectName",
  "dia diem cong trinh": "projectAddress", "dia chi cong trinh": "projectAddress", "pham vi cong viec": "scope",
  "danh muc dinh dang va so luong ban giao": "deliverables", "ho so san pham ban giao": "deliverables",
  "ngan hang chu tai khoan so tai khoan": "bankDetails", "thong tin tai khoan": "bankDetails",
  "dieu khoan thanh toan": "paymentTerms", "tien do va dieu kien ban giao": "deliveryTerms", "dieu khoan bo sung": "otherTerms",
  "quyen va nghia vu bat kha khang giai quyet tranh chap hieu luc hop dong": "otherTerms", "thue suat": "taxRate",
  "tong gia tri hop dong": "totalFormatted", "tien dat coc": "depositAmountFormatted", "so tien con lai": "balanceFormatted",
};
const productLabels: Record<string, string> = {
  "stt": "index", "so thu tu": "index", "hang muc": "name", "ten hang muc": "name", "ten san pham": "name", "ten vat tu": "name",
  "ma hang": "sku", "ma san pham": "sku", "sku": "sku", "dvt": "unit", "don vi": "unit", "don vi tinh": "unit",
  "khoi luong": "quantity", "so luong": "quantity", "don gia": "unitPriceFormatted", "thanh tien": "lineTotalFormatted",
  "quy cach": "description", "mo ta": "description",
};

function amountField(context: string): string | undefined {
  const value = fold(context.split(/[;|\n]/).at(-1) ?? context);
  if (/con thanh toan|con lai/.test(value)) return "balanceFormatted";
  if (/dat coc|tam ung/.test(value)) return "depositAmountFormatted";
  if (/vat|thue suat/.test(value)) return "taxAmountFormatted";
  if (/van chuyen/.test(value)) return "shippingFeeFormatted";
  if (/tam tinh|tien hang/.test(value)) return "subtotalFormatted";
  if (/tong gia tri hop dong|gia tri hop dong|tong thanh toan|tong cong/.test(value)) return "totalFormatted";
  return undefined;
}

/** Fill explicit Vietnamese [field labels] only when every position is unambiguous.
 * Unknown labels and unmarked sample tables continue through semantic AI mapping. */
export function tryFillBracketedContractTemplate(template: QuoteTemplate, fields: Record<string, string>, products: Array<Record<string, string>>): Buffer | null {
  const zip = new PizZip(Buffer.from(template.data.buffer));
  const plan: WordFillPlan = { edits: [], tables: [] };
  let found = false;
  for (const part of zip.file(/^word\/(document|header\d+|footer\d+)\.xml$/)) {
    const document = new DOMParser({ onError: () => { throw new Error("File Word không đọc được. Hãy mở và lưu lại mẫu rồi thử lại."); } }).parseFromString(part.asText(), "application/xml");
    const paragraphs = Array.from(document.getElementsByTagNameNS(ns, "p"));
    const productParagraphs = new Set<Element>();
    for (const [tableIndex, table] of Array.from(document.getElementsByTagNameNS(ns, "tbl")).entries()) {
      const rows = children(table, "tr");
      const productRows: number[] = [];
      let columns: Array<{ column: number; key: string }> | undefined;
      const looksLikeProducts = rows.some((row) => {
        const labels = children(row, "tc").map((cell) => fold(text(cell)));
        return labels.some((label) => productLabels[label] === "name") && labels.some((label) => ["quantity", "unitPriceFormatted", "lineTotalFormatted"].includes(productLabels[label]));
      });
      for (const [rowIndex, row] of rows.entries()) {
        const cells = children(row, "tc");
        if (!cells.some((cell) => tokens(text(cell)).some((match) => productLabels[fold(match[1]!)] === "name"))) continue;
        const mapped: Array<{ column: number; key: string }> = [];
        for (const [column, cell] of cells.entries()) {
          const value = text(cell).trim();
          const matches = tokens(value);
          if (matches.length) {
            const key = matches.length === 1 && matches[0]![0] === value ? productLabels[fold(matches[0]![1]!)] : undefined;
            if (!key || products.some((product) => !(key in product))) return null;
            mapped.push({ column, key });
          } else if (/^\d+$/.test(value) && rows.slice(0, rowIndex).some((header) => productLabels[fold(text(children(header, "tc")[column] ?? header))] === "index")) mapped.push({ column, key: "index" });
        }
        if (new Set(mapped.map(({ key }) => key)).size !== mapped.length || columns && JSON.stringify(columns) !== JSON.stringify(mapped)) return null;
        columns = mapped;
        productRows.push(rowIndex);
        descendants(row, "p").forEach((paragraph) => productParagraphs.add(paragraph));
      }
      if (looksLikeProducts && !productRows.length) return null;
      if (productRows.length && columns) {
        // A partially marked table may still contain old sample products. Let AI map
        // the entire table instead of publishing a mix of new and old rows.
        if (rows.some((row, index) => !productRows.includes(index) && (
          index > productRows[0]! || children(row, "tc").some((cell) => text(cell).trim() && !productLabels[fold(text(cell))])
        ))) return null;
        plan.tables.push({ part: part.name, table: tableIndex, productRows, columns }); found = true;
      }
    }
    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
      if (productParagraphs.has(paragraph)) continue;
      const value = text(paragraph);
      const matches = tokens(value);
      if (!matches.length) continue;
      if (value.split(/[;|\n]/).some((clause) => tokens(clause).filter((match) => fold(match[1]!) === "thanh tien").length > 1)) return null;
      let replacement = "";
      let offset = 0;
      for (const match of matches) {
        const label = fold(match[1]!);
        const key = label === "thanh tien" ? amountField(value.slice(0, match.index)) : scalarLabels[label];
        if (!key || !(key in fields)) return null;
        replacement += value.slice(offset, match.index) + `[[${key}]]`;
        offset = match.index! + match[0].length;
      }
      replacement += value.slice(offset);
      plan.edits.push({ part: part.name, paragraph: paragraphIndex, find: value, replace: replacement });
      found = true;
    }
  }
  return found ? applyWordFillPlan(template, fields, products, plan) : null;
}
