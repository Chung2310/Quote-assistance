import test from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import { prepareEditedOfficeFile, restoreOfficeXmlNamespaces } from "./office-xml.js";

const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
function packageWith(xml: string) {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file("xl/worksheets/sheet1.xml", xml);
  zip.file("xl/media/image1.png", Buffer.from([1, 2, 3]));
  return zip.generate({ type: "nodebuffer" });
}
const original = packageWith(`<worksheet xmlns="${main}" xmlns:mc="${mc}" xmlns:x14ac="urn:excel:2010" xmlns:xr="urn:excel:revision" mc:Ignorable="x14ac xr"><sheetData><row r="1"><c r="A1"><v>10</v></c></row></sheetData></worksheet>`);

test("restores namespaces dropped by Python while preserving edited values, formulas and binary parts", () => {
  const sheet = `<worksheet xmlns="${main}" xmlns:ns1="${mc}" ns1:Ignorable="x14ac xr"><sheetData><row r="1"><c r="A1" s="4"><f>2*12</f><v>24</v></c></row></sheetData></worksheet>`;
  const repaired = new PizZip(restoreOfficeXmlNamespaces(original, packageWith(sheet)), { checkCRC32: true });
  const xml = repaired.file("xl/worksheets/sheet1.xml")!.asText();
  const root = new DOMParser().parseFromString(xml, "application/xml").documentElement;
  assert.ok(root);
  assert.equal(root.lookupNamespaceURI("x14ac"), "urn:excel:2010");
  assert.equal(root.lookupNamespaceURI("xr"), "urn:excel:revision");
  assert.ok(xml.includes('<c r="A1" s="4"><f>2*12</f><v>24</v></c>'));
  assert.deepEqual(repaired.file("xl/media/image1.png")!.asUint8Array(), new Uint8Array([1, 2, 3]));
});

test("checks namespace references in AlternateContent Requires and qualified compatibility attributes", () => {
  const xml = `<worksheet xmlns="${main}" xmlns:mc="${mc}" mc:PreserveAttributes="x14ac:dyDescent"><mc:AlternateContent><mc:Choice Requires="xr"><sheetData/></mc:Choice></mc:AlternateContent></worksheet>`;
  const fixed = new PizZip(restoreOfficeXmlNamespaces(original, packageWith(xml))).file("xl/worksheets/sheet1.xml")!.asText();
  const root = new DOMParser().parseFromString(fixed, "application/xml").documentElement;
  assert.ok(root);
  assert.equal(root.lookupNamespaceURI("x14ac"), "urn:excel:2010");
  assert.equal(root.lookupNamespaceURI("xr"), "urn:excel:revision");
});

test("rejects unknown missing prefixes and malformed packages instead of saving an unreadable document", () => {
  assert.throws(() => restoreOfficeXmlNamespaces(original, packageWith(`<worksheet xmlns="${main}" xmlns:mc="${mc}" mc:Ignorable="unknown"/>`)), /không thể khôi phục/);
  assert.throws(() => restoreOfficeXmlNamespaces(original, Buffer.from("not an Office file")), /ZIP/);
  assert.throws(() => restoreOfficeXmlNamespaces(original, packageWith("<worksheet><invalid></worksheet>")), /XML không hợp lệ/);
});

test("keeps an already valid package byte-for-byte and respects locally declared namespaces", () => {
  assert.strictEqual(restoreOfficeXmlNamespaces(original, original), original);
  const local = packageWith(`<worksheet xmlns="${main}" xmlns:mc="${mc}"><sheetData xmlns:local="urn:local" mc:Ignorable="local"/></worksheet>`);
  assert.strictEqual(restoreOfficeXmlNamespaces(original, local), local);
});

test("removes the old calculation chain and its package references after formulas change", () => {
  const source = new PizZip(original);
  source.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
  source.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rSheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rChain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>');
  source.file("xl/calcChain.xml", `<calcChain xmlns="${main}"><c r="A1" i="1"/></calcChain>`);
  const sourceBytes = source.generate({ type: "nodebuffer" });
  const edited = new PizZip(sourceBytes);
  edited.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="${main}"><sheetData><row r="1"><c r="A1"><v>24</v></c></row></sheetData></worksheet>`);
  const prepared = prepareEditedOfficeFile(sourceBytes, edited.generate({ type: "nodebuffer" }));
  const fixed = new PizZip(prepared);
  assert.equal(fixed.file("xl/calcChain.xml"), null);
  assert.ok(!fixed.file("[Content_Types].xml")!.asText().includes("calcChain"));
  assert.ok(fixed.file("[Content_Types].xml")!.asText().includes("styles.xml"));
  assert.ok(!fixed.file("xl/_rels/workbook.xml.rels")!.asText().includes("calcChain"));
  assert.ok(fixed.file("xl/_rels/workbook.xml.rels")!.asText().includes("rSheet"));
  assert.ok(fixed.file("xl/worksheets/sheet1.xml")!.asText().includes("<v>24</v>"));
  assert.ok(new PizZip(sourceBytes).file("xl/calcChain.xml"));
  assert.strictEqual(prepareEditedOfficeFile(sourceBytes, prepared), prepared);
  assert.strictEqual(prepareEditedOfficeFile(sourceBytes, sourceBytes), sourceBytes);
});
