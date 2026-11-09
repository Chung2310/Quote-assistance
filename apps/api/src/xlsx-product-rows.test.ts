import test from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { compactXlsxProductRows, findUnusedProductRows, shiftFormulaAfterRowDeletion } from "./xlsx-product-rows.js";
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function fixture(edited = false, alreadyCompact = false) {
  const zip = new PizZip();
  const last = alreadyCompact ? 5 : 8;
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("xl/workbook.xml", `<workbook xmlns="${ns}" xmlns:r="${rns}"><sheets><sheet name="Items" sheetId="1" r:id="r1"/><sheet name="Summary" sheetId="2" r:id="r2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Items!$A$1:$G$${last+3}</definedName></definedNames></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="${rns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${rns}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`);
  const text = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const row = (number: number, index: number, name: string) => `<row r="${number}" ht="24"><c r="A${number}"><v>${index}</v></c>${text(`B${number}`,name)}<c r="C${number}"><v>1</v></c></row>`;
  const products = row(3,1,"New A") + row(4,2,"New B") + (edited ? "" : row(5,3,"Old C")+row(6,4,"Old D"));
  const leftover = edited && !alreadyCompact ? row(6,4,"Old D") : "";
  zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="${ns}" xmlns:r="${rns}"><dimension ref="A1:G${last+3}"/><sheetData><row r="1">${text("B1","Do not delete this header")}</row><row r="2">${text("A2","STT")}${text("B2","Product")}</row>${products}${leftover}<row r="${last}">${text(`B${last}`,"Total")}<c r="G${last}"><f>SUM(C3:C${alreadyCompact?4:6})</f><v>2</v></c></row><row r="${last+3}">${text(`B${last+3}`,"SIGNATURE")}</row></sheetData><mergeCells count="2"><mergeCell ref="B1:D1"/><mergeCell ref="B${last+3}:D${last+3}"/></mergeCells><rowBreaks count="1" manualBreakCount="1"><brk id="${last+2}" man="1" min="0" max="16383"/></rowBreaks><drawing r:id="drawing"/></worksheet>`);
  zip.file("xl/worksheets/sheet2.xml", `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1"><f>Items!$G$${last}</f><v>2</v></c><c r="B1"><f>G8</f><v>99</v></c></row></sheetData></worksheet>`);
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="drawing" Type="${rns}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file("xl/drawings/drawing1.xml", `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>${last+2}</xdr:row></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:row>${last+3}</xdr:row></xdr:to></xdr:twoCellAnchor></xdr:wsDr>`);
  zip.file("xl/media/logo.png", Buffer.from([7,8,9]));
  return zip.generate({ type: "nodebuffer" });
}

test("physically deletes cleared and leftover old product rows, and moves totals, signatures and linked formulas", () => {
  const original = fixture();
  const edited = fixture(true);
  const result = compactXlsxProductRows(original, edited, ["New A","New B"]);
  // Preserve the original single spacer row before the total.
  assert.deepEqual(result.removedRows, [{sheet:"Items",rows:[5,6]}]);
  const workbook = XLSX.read(result.bytes, {type:"buffer"});
  assert.equal(workbook.Sheets.Items!.B6!.v,"Total");
  assert.equal(workbook.Sheets.Items!.G6!.f,"SUM(C3:C4)");
  assert.equal(workbook.Sheets.Items!.B9!.v,"SIGNATURE");
  assert.equal(workbook.Sheets.Summary!.A1!.f,"Items!$G$6");
  assert.equal(workbook.Sheets.Summary!.B1!.f,"G8");
  const zip = new PizZip(result.bytes);
  assert.ok(zip.file("xl/workbook.xml")!.asText().includes("Items!$A$1:$G$9"));
  assert.ok(zip.file("xl/worksheets/sheet1.xml")!.asText().includes('ref="B9:D9"'));
  assert.ok(zip.file("xl/drawings/drawing1.xml")!.asText().includes("<xdr:row>8</xdr:row>"));
  assert.deepEqual(zip.file("xl/media/logo.png")!.asUint8Array(),new Uint8Array([7,8,9]));
  assert.deepEqual(findUnusedProductRows(original,result.bytes,["New A","New B"]),[]);
});

test("does not strip intentional spacing or already compacted tables", () => {
  assert.deepEqual(findUnusedProductRows(fixture(),fixture(true,true),["New A","New B"]),[]);
  assert.deepEqual(findUnusedProductRows(fixture(),fixture(true),["Unrelated product"]),[]);
});

test("shifts absolute, cross-sheet and row-range references while preserving text, function names and external workbooks", () => {
  const changes = new Map([["items",[5,6,7]]]);
  assert.equal(shiftFormulaAfterRowDeletion('SUM($C$3:$C$7)+LOG10(G8)+"G8"+Summary!G8+\'[Book.xlsx]Items\'!G8',"Items",changes),'SUM($C$3:$C$4)+LOG10(G5)+"G8"+Summary!G8+\'[Book.xlsx]Items\'!G8');
  assert.equal(shiftFormulaAfterRowDeletion("Items!$8:$11+Items!G6","Summary",changes),"Items!$5:$8+#REF!");
  assert.equal(shiftFormulaAfterRowDeletion("'Item''s data'!$G$8","Summary",new Map([["item's data",[5,6]]])),"'Item''s data'!$G$6");
});
