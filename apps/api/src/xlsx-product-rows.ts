import path from "node:path";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import { prepareEditedOfficeFile } from "./office-xml.js";

export interface RemovedProductRows { sheet: string; rows: number[] }
const parse = (xml: string) => new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(xml, "application/xml");
const elements = (document: Document | Element, name = "*") => Array.from(document.getElementsByTagNameNS("*", name));
const folded = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/\s+/g, " ").trim();
const firstLine = (value: unknown) => folded(String(value ?? "").split(/[\r\n]/)[0]);

function rowCells(sheet: XLSX.WorkSheet) {
  const result = new Map<number, Map<number, XLSX.CellObject>>();
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;
    const { r, c } = XLSX.utils.decode_cell(address);
    const row = result.get(r + 1) ?? new Map<number, XLSX.CellObject>();
    row.set(c, cell);
    result.set(r + 1, row);
  }
  return result;
}
const isBlank = (cells?: Map<number, XLSX.CellObject>) => !cells || [...cells.values()].every((cell) => cell.v == null || String(cell.v).trim() === "" || cell.v === 0);
const isFooter = (cells?: Map<number, XLSX.CellObject>) => [...(cells?.values() ?? [])].some((cell) => /^(tong (?:cong|tien|gia tri)|tam tinh|thue (?:vat|gtgt)|dai dien|bang chu|subtotal|grand total|total|signature)\b/.test(folded(cell.v)));

/** Only remove rows proven to belong to a replaced, numbered product table. */
export function findUnusedProductRows(originalBytes: Buffer, editedBytes: Buffer, productNames: readonly string[]): RemovedProductRows[] {
  const names = new Set(productNames.map(firstLine).filter(Boolean));
  if (!names.size) return [];
  const original = XLSX.read(originalBytes, { type: "buffer" });
  const edited = XLSX.read(editedBytes, { type: "buffer" });
  const plans: RemovedProductRows[] = [];
  for (const sheetName of edited.SheetNames) {
    if (!original.Sheets[sheetName]) continue;
    const current = rowCells(edited.Sheets[sheetName]!);
    const previous = rowCells(original.Sheets[sheetName]!);
    const groups = new Map<number, number[]>();
    for (const [row, cells] of current) for (const [column, cell] of cells) {
      if (!names.has(firstLine(cell.v)) || column === 0) continue;
      const index = Number(cells.get(column - 1)?.v);
      if (!Number.isInteger(index) || index < 1 || index > names.size) continue;
      const matched = groups.get(column) ?? [];
      matched.push(row);
      groups.set(column, matched);
    }
    const removed = new Set<number>();
    for (const [column, matched] of groups) {
      if (new Set(matched.map((row) => firstLine(current.get(row)?.get(column)?.v))).size !== names.size) continue;
      const start = Math.min(...matched);
      const last = Math.max(...matched);
      let oldEnd = start - 1;
      // A contiguous original sequence 1..N establishes the exact old table boundary.
      for (let row = start, index = 1; row <= 1_048_576; row++, index++) {
        const cells = previous.get(row);
        if (Number(cells?.get(column - 1)?.v) !== index || !firstLine(cells?.get(column)?.v)) break;
        oldEnd = row;
      }
      if (oldEnd <= last) continue;
      let end = oldEnd;
      let originalSpacing = 0;
      for (let row = oldEnd + 1; row <= oldEnd + 20; row++) {
        if (isFooter(previous.get(row))) break;
        if (!isBlank(previous.get(row))) break;
        originalSpacing++;
      }
      for (let row = last + 1; row <= oldEnd + originalSpacing + 1; row++) {
        if (!isFooter(current.get(row))) continue;
        let preservedSpacing = 0;
        while (preservedSpacing < originalSpacing && row - preservedSpacing - 1 > last && isBlank(current.get(row - preservedSpacing - 1))) preservedSpacing++;
        end = Math.min(oldEnd, row - preservedSpacing - 1);
        break;
      }
      for (let row = start; row <= end; row++) {
        if (matched.includes(row)) continue;
        const cells = current.get(row);
        const blank = isBlank(cells);
        const oldName = firstLine(previous.get(row)?.get(column)?.v);
        const unchangedOldProduct = oldName && !names.has(oldName) && firstLine(cells?.get(column)?.v) === oldName
          && Number(cells?.get(column - 1)?.v) === Number(previous.get(row)?.get(column - 1)?.v);
        if (blank || unchangedOldProduct) removed.add(row);
      }
    }
    if (removed.size) plans.push({ sheet: sheetName, rows: [...removed].sort((a, b) => a - b) });
  }
  return plans;
}

type RowChanges = Map<string, number[]>;
function mappedRow(row: number, removed: readonly number[]) { return row - removed.filter((deleted) => deleted <= row).length; }
function rangeRows(first: number, last: number, removed: readonly number[]) {
  const deleted = new Set(removed);
  while (first <= last && deleted.has(first)) first++;
  while (last >= first && deleted.has(last)) last--;
  return first > last ? null : [mappedRow(first, removed), mappedRow(last, removed)];
}

function shiftReference(reference: string, removed: readonly number[], anchor = false): string | null {
  const match = /^(\$?[A-Za-z]{1,3})(\$?)(\d+)(?::(\$?[A-Za-z]{1,3})(\$?)(\d+))?$/.exec(reference);
  if (!match) return reference;
  const first = Number(match[3]);
  if (!match[4]) return removed.includes(first) && !anchor ? null : `${match[1]}${match[2]}${Math.max(1, mappedRow(first, removed))}`;
  const rows = rangeRows(first, Number(match[6]), removed);
  return rows ? `${match[1]}${match[2]}${rows[0]}:${match[4]}${match[5]}${rows[1]}` : null;
}

/** Structural deletion moves absolute references too; quoted text and external workbooks stay literal. */
export function shiftFormulaAfterRowDeletion(formula: string, ownSheet: string, changes: RowChanges) {
  const referencePattern = /(?<![\p{L}\p{N}_.'\[\]])(?:(?<sheet>'(?:[^']|'')+'|(?:\[[^\]]+\])?[\p{L}_\\][\p{L}\p{N}_.\\]*)!)?(?<reference>\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![\p{L}\p{N}_]|\s*\()/gu;
  return formula.split(/("(?:[^"]|"")*")/g).map((segment, index) => {
    if (index % 2) return segment;
    const shifted = segment.replace(referencePattern, (full, ...args: unknown[]) => {
      const groups = args.at(-1) as { sheet?: string; reference: string };
      const sheet = groups.sheet?.replace(/^'|'$/g, "").replace(/''/g, "'") ?? ownSheet;
      if (sheet.includes("[")) return full;
      const removed = changes.get(sheet.toLocaleLowerCase("vi"));
      if (!removed) return full;
      const next = shiftReference(groups.reference, removed);
      return next ? `${groups.sheet ? `${groups.sheet}!` : ""}${next}` : "#REF!";
    });
    // Whole-row references occur in print titles and formulas such as SUM(14:41).
    return shifted.replace(/(?<![\p{L}\p{N}_.'\[\]])(?:(?<sheet>'(?:[^']|'')+'|(?:\[[^\]]+\])?[\p{L}_\\][\p{L}\p{N}_.\\]*)!)?(?<a>\$?)(?<first>\d+):(?<b>\$?)(?<last>\d+)(?![\p{L}\p{N}_])/gu, (full, ...args: unknown[]) => {
      const group = args.at(-1) as { sheet?: string; a: string; first: string; b: string; last: string };
      const sheet = group.sheet?.replace(/^'|'$/g, "").replace(/''/g, "'") ?? ownSheet;
      const removed = sheet.includes("[") ? undefined : changes.get(sheet.toLocaleLowerCase("vi"));
      if (!removed) return full;
      const rows = rangeRows(Number(group.first), Number(group.last), removed);
      return rows ? `${group.sheet ? `${group.sheet}!` : ""}${group.a}${rows[0]}:${group.b}${rows[1]}` : "#REF!";
    });
  }).join("");
}

function sheetParts(zip: PizZip) {
  const workbook = parse(zip.file("xl/workbook.xml")!.asText());
  const relationships = parse(zip.file("xl/_rels/workbook.xml.rels")!.asText());
  const targets = new Map(elements(relationships, "Relationship").map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target")!]));
  return { workbook, sheets: elements(workbook, "sheet").map((sheet) => {
    const target = targets.get(sheet.getAttribute("r:id"))!;
    return { name: sheet.getAttribute("name")!, path: target.startsWith("/") ? target.slice(1) : path.posix.normalize(`xl/${target}`) };
  }) };
}

export function deleteXlsxProductRows(bytes: Buffer, plans: readonly RemovedProductRows[]): Buffer {
  if (!plans.length) return bytes;
  const zip = new PizZip(bytes);
  const { workbook, sheets } = sheetParts(zip);
  const changes: RowChanges = new Map(plans.map(({ sheet, rows }) => [sheet.toLocaleLowerCase("vi"), [...new Set(rows)].sort((a, b) => a - b)]));
  const serializer = new XMLSerializer();
  const related = new Map<string, { sheet: string; kind: string; rows: number[] }>();
  for (const sheet of sheets) {
    const source = zip.file(sheet.path)!.asText();
    const document = parse(source);
    const removed = changes.get(sheet.name.toLocaleLowerCase("vi")) ?? [];
    for (const row of elements(document, "row")) {
      const index = Number(row.getAttribute("r"));
      if (removed.includes(index)) { row.parentNode!.removeChild(row); continue; }
      if (removed.length) {
        row.setAttribute("r", String(mappedRow(index, removed)));
        for (const cell of elements(row, "c")) cell.setAttribute("r", shiftReference(cell.getAttribute("r")!, removed)!);
      }
    }
    for (const element of elements(document)) {
      if (["f", "formula", "formula1", "formula2"].includes(element.localName ?? "") && element.textContent) element.textContent = shiftFormulaAfterRowDeletion(element.textContent, sheet.name, changes);
      if (!removed.length) continue;
      for (const key of ["ref", "sqref", "activeCell", "topLeftCell"]) {
        const ref = element.getAttribute(key);
        if (!ref) continue;
        const anchor = ["selection", "sheetView", "pane"].includes(element.localName ?? "");
        const next = ref.split(/\s+/).map((part) => shiftReference(part, removed, anchor)).filter((part): part is string => Boolean(part)).join(" ");
        if (next) element.setAttribute(key, next);
        else if (["mergeCell", "hyperlink", "dataValidation", "conditionalFormatting", "ignoredError"].includes(element.localName ?? "")) element.parentNode?.removeChild(element);
        else element.removeAttribute(key);
      }
      if (element.localName === "brk" && element.parentNode?.localName === "rowBreaks") {
        const index = Number(element.getAttribute("id")) + 1;
        if (removed.includes(index)) element.parentNode.removeChild(element);
        else element.setAttribute("id", String(Math.max(0, mappedRow(index, removed) - 1)));
      }
    }
    for (const parent of elements(document)) {
      const counted = { mergeCells: "mergeCell", dataValidations: "dataValidation", rowBreaks: "brk" }[parent.localName ?? ""];
      if (!counted) continue;
      const children = elements(parent, counted);
      if (!children.length) parent.parentNode?.removeChild(parent);
      else {
        parent.setAttribute("count", String(children.length));
        if (parent.localName === "rowBreaks") parent.setAttribute("manualBreakCount", String(children.filter((child) => child.getAttribute("man") === "1").length));
      }
    }
    const serialized = serializer.serializeToString(document);
    if (serialized !== source) zip.file(sheet.path, serialized);
    if (!removed.length) continue;
    const relPath = path.posix.join(path.posix.dirname(sheet.path), "_rels", `${path.posix.basename(sheet.path)}.rels`);
    const relations = zip.file(relPath);
    if (!relations) continue;
    for (const relation of elements(parse(relations.asText()), "Relationship")) {
      if (relation.getAttribute("TargetMode") === "External") continue;
      const kind = relation.getAttribute("Type")?.split("/").at(-1) ?? "";
      if (!["drawing", "table", "comments", "vmlDrawing"].includes(kind)) continue;
      const target = relation.getAttribute("Target")!;
      const part = target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(sheet.path), target));
      const existing = related.get(part);
      if (existing && existing.sheet !== sheet.name) throw new Error("Không thể dồn dòng vì nhiều trang tính dùng chung cấu trúc hình vẽ hoặc bảng.");
      related.set(part, { sheet: sheet.name, kind, rows: removed });
    }
  }
  for (const defined of elements(workbook, "definedName")) {
    if (!defined.textContent) continue;
    const own = sheets[Number(defined.getAttribute("localSheetId"))]?.name ?? "";
    defined.textContent = shiftFormulaAfterRowDeletion(defined.textContent, own, changes);
  }
  zip.file("xl/workbook.xml", serializer.serializeToString(workbook));
  for (const [name, context] of related) {
    const part = zip.file(name);
    if (!part) continue;
    const document = parse(part.asText());
    for (const element of elements(document)) {
      if (context.kind === "drawing" && element.localName === "row" && ["from", "to"].includes(element.parentNode?.localName ?? "")) element.textContent = String(Math.max(0, mappedRow(Number(element.textContent) + 1, context.rows) - 1));
      if (context.kind === "vmlDrawing" && element.localName === "Row") element.textContent = String(Math.max(0, mappedRow(Number(element.textContent) + 1, context.rows) - 1));
      if (context.kind === "vmlDrawing" && element.localName === "Anchor") {
        const values = (element.textContent ?? "").split(",").map(Number);
        if (values.length === 8) { for (const index of [2, 6]) values[index] = Math.max(0, mappedRow(values[index]! + 1, context.rows) - 1); element.textContent = values.join(", "); }
      }
      const ref = element.getAttribute("ref");
      if (ref && (context.kind === "table" || context.kind === "comments")) {
        const next = shiftReference(ref, context.rows);
        if (next) element.setAttribute("ref", next);
        else if (element.localName === "comment") element.parentNode?.removeChild(element);
      }
      if (["calculatedColumnFormula", "totalsRowFormula", "f"].includes(element.localName ?? "") && element.textContent) element.textContent = shiftFormulaAfterRowDeletion(element.textContent, context.sheet, changes);
    }
    zip.file(name, serializer.serializeToString(document));
  }
  return prepareEditedOfficeFile(bytes, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}

export function compactXlsxProductRows(originalBytes: Buffer, editedBytes: Buffer, productNames: readonly string[]) {
  const removedRows = findUnusedProductRows(originalBytes, editedBytes, productNames);
  return { bytes: deleteXlsxProductRows(editedBytes, removedRows), removedRows };
}
