import assert from "node:assert/strict";
import test from "node:test";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { PDFDocument } from "pdf-lib";
import { inspectUploadedTemplate } from "./quote-template.js";

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Sản phẩm", "Số lượng"], ["Hàng thử", 2]]), "Báo giá");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("upload accepts a complete Excel package and a readable PDF", async () => {
  await inspectUploadedTemplate(workbook(), "xlsx");
  const pdf = await PDFDocument.create(); pdf.addPage();
  await inspectUploadedTemplate(Buffer.from(await pdf.save()), "pdf");
});

test("upload rejects incomplete Excel packages before they become selectable templates", async () => {
  const incomplete = new PizZip(); incomplete.file("xl/workbook.xml", "<invalid>");
  await assert.rejects(inspectUploadedTemplate(incomplete.generate({ type: "nodebuffer" }), "xlsx"), /File mẫu bị hỏng/);
  for (const missing of ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]) {
    const zip = new PizZip(workbook()); zip.remove(missing);
    await assert.rejects(inspectUploadedTemplate(zip.generate({ type: "nodebuffer" }), "xlsx"), /File mẫu bị hỏng/, missing);
  }
});

test("upload rejects a malformed workbook, worksheet or missing relationship", async () => {
  for (const [part, xml] of [["xl/workbook.xml", "<workbook>"], ["xl/worksheets/sheet1.xml", "<broken/>"], ["xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>']]) {
    const zip = new PizZip(workbook()); zip.file(part!, xml!);
    await assert.rejects(inspectUploadedTemplate(zip.generate({ type: "nodebuffer" }), "xlsx"), /File mẫu bị hỏng/);
  }
});

test("damaged uploads give an actionable message without parser details", async () => {
  for (const extension of ["docx", "xlsx", "pdf"]) await assert.rejects(inspectUploadedTemplate(Buffer.from("damaged file"), extension), /File mẫu bị hỏng.*mở và lưu lại/);
  await assert.rejects(inspectUploadedTemplate(workbook(), "docx"), /khớp định dạng/);
});

test("upload accepts Word with a document body and rejects a missing body", async () => {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Mẫu thử</w:t></w:r></w:p></w:body></w:document>');
  await inspectUploadedTemplate(zip.generate({ type: "nodebuffer" }), "docx");
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
  await assert.rejects(inspectUploadedTemplate(zip.generate({ type: "nodebuffer" }), "docx"), /File mẫu bị hỏng/);
});

test("upload retains explicit errors for macros and unsupported embedded objects", async () => {
  const zip = new PizZip(workbook()); zip.file("xl/vbaProject.bin", "macro");
  await assert.rejects(inspectUploadedTemplate(zip.generate({ type: "nodebuffer" }), "xlsx"), /macro/);
});
