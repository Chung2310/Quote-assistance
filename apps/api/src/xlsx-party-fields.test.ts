import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import PizZip from "pizzip";
import {fillXlsxPartyNames} from "./xlsx-party-fields.js";

test("settlement fills explicit party names on every cover and replaces stale formula caches", () => {
  const book=XLSX.utils.book_new();
  for (const name of ["Bìa","Trang khác"]) {
    const sheet=XLSX.utils.aoa_to_sheet([["BÊN A (BÊN GIAO)",":","Khách cũ"],["BÊN B (BÊN NHẬN)",":","Nhà thầu cũ"],["Địa chỉ",":","Giữ địa chỉ"],["ĐẠI DIỆN BÊN A","","Chữ ký"]]);
    sheet.C1.f='UPPER("OLD")';XLSX.utils.book_append_sheet(book,sheet,name);
  }
  const bytes=XLSX.write(book,{type:"buffer",bookType:"xlsx"});
  const output=fillXlsxPartyNames(bytes,{customerName:"Khách mới & Cộng sự",companyName:"Công ty mới"});
  const updated=XLSX.read(output,{type:"buffer"});
  for(const name of updated.SheetNames){const sheet=updated.Sheets[name]!;assert.equal(sheet.C1.v,"Khách mới & Cộng sự");assert.equal(sheet.C1.f,undefined);assert.equal(sheet.C2.v,"Công ty mới");assert.equal(sheet.C3.v,"Giữ địa chỉ");assert.equal(sheet.C4.v,"Chữ ký");}
  assert.equal(new PizZip(output).file("xl/styles.xml")!.asText(),new PizZip(bytes).file("xl/styles.xml")!.asText());
});

test("settlement ignores narrative and signature rows without an explicit party field", () => {
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Bên A có trách nhiệm", "Giữ nguyên"],["BÊN A"],["ĐẠI DIỆN BÊN B","Giữ chữ ký"]]),"Biên bản");
  const bytes=XLSX.write(book,{type:"buffer",bookType:"xlsx"});assert.deepEqual(fillXlsxPartyNames(bytes,{customerName:"Khách mới",companyName:"Công ty mới"}),bytes);
});
