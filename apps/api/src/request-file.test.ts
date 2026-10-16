import test from "node:test";
import assert from "node:assert/strict";
import { Binary } from "mongodb";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { requestFileContent, type RequestFile } from "./request-file.js";

function file(originalFilename: string, data: Buffer): RequestFile {
  return { companyId: "company-a", uploadedBy: "sales-a", originalFilename, data: new Binary(data), bytes: data.length, createdAt: new Date() };
}

test("reads customer TXT as request data, separate from company price lists", async () => {
  const parts = await requestFileContent(file("yeu-cau.txt", Buffer.from("Công ty Minh An cần 2 máy lọc nước")));
  assert.match(JSON.stringify(parts), /FILE YÊU CẦU CỦA KHÁCH HÀNG/);
  assert.equal(parts[1].text, "Công ty Minh An cần 2 máy lọc nước");
});

test("reads every sheet in a customer workbook", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Máy A", 2]]), "Sản phẩm");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Giao trước thứ sáu"]]), "Ghi chú");
  const data = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parts = await requestFileContent(file("yeu-cau.xlsx", data));
  assert.match(String(parts[1].text), /Máy A/);
  assert.match(String(parts[1].text), /Giao trước thứ sáu/);
});

test("passes customer PDF bytes to AI without requiring text input", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const data = Buffer.from(await pdf.save());
  const parts = await requestFileContent(file("yeu-cau.pdf", data));
  const attachment = parts.find((part) => part.type === "file")!;
  assert.deepEqual(attachment.file, { filename: "yeu-cau.pdf", file_data: `data:application/pdf;base64,${data.toString("base64")}` });
});

test("rejects empty, oversized, unsupported, corrupted and invalid UTF-8 request files", async () => {
  await assert.rejects(requestFileContent(file("empty.txt", Buffer.alloc(0))), /nội dung/);
  await assert.rejects(requestFileContent(file("large.txt", Buffer.alloc(10 * 1024 * 1024 + 1))), /10 MB/);
  await assert.rejects(requestFileContent(file("bad.exe", Buffer.from("data"))), /hỗ trợ/);
  await assert.rejects(requestFileContent(file("bad.pdf", Buffer.from("not pdf"))));
  await assert.rejects(requestFileContent(file("bad.txt", Buffer.from([0xff, 0xfe]))), /UTF-8/);
});
