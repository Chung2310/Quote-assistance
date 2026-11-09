import assert from "node:assert/strict";
import test from "node:test";
import { Binary } from "mongodb";
import PizZip from "pizzip";
import { applyWordFillPlan, type WordFillPlan } from "./word-template-fill.js";
import type { QuoteTemplate } from "./quote-template.js";
const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const p = (value: string) => `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${value}</w:t></w:r></w:p>`;
function fixture(): QuoteTemplate {
  const zip = new PizZip();
  zip.file("word/document.xml", `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Khách: Mẫu </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>cũ; giữ nguyên.</w:t></w:r></w:p>${p("Tổng: 100")}${p("Điều khoản giữ nguyên.")}<w:tbl><w:tr><w:tc>${p("Tên")}</w:tc><w:tc>${p("SL")}</w:tc><w:tc>${p("Tiền")}</w:tc></w:tr><w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:shd w:fill="EEEEEE"/></w:tcPr>${p("Hàng cũ 1")}</w:tc><w:tc>${p("1")}</w:tc><w:tc>${p("100")}</w:tc></w:tr><w:tr><w:tc>${p("Hàng cũ 2")}</w:tc><w:tc>${p("2")}</w:tc><w:tc>${p("200")}</w:tc></w:tr><w:tr><w:tc>${p("Tổng cộng")}</w:tc><w:tc>${p("")}</w:tc><w:tc>${p("300")}</w:tc></w:tr></w:tbl></w:body></w:document>`);
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${w}">${p("Công ty mẫu")}</w:hdr>`);
  zip.file("word/_rels/document.xml.rels", "original relationships"); zip.file("word/media/logo.png", "logo bytes");
  return { extension:"docx", data:new Binary(zip.generate({type:"nodebuffer"})) } as QuoteTemplate;
}
const fields = {customerName:"Khách mới & đối tác",companyName:"Công ty mới",total:"1.234.567"};
function plan(): WordFillPlan {
  return {edits:[{part:"word/document.xml",paragraph:0,find:"Mẫu cũ",replace:"[[customerName]]"},{part:"word/document.xml",paragraph:1,find:"100",replace:"[[total]]"},{part:"word/header1.xml",paragraph:0,find:"Công ty mẫu",replace:"[[companyName]]"}],tables:[{part:"word/document.xml",table:0,productRows:[1,2],columns:[{column:0,key:"name"},{column:1,key:"quantity"},{column:2,key:"lineTotal"}]}]};
}

test("Word fills values split across styled runs and preserves labels, legal text, logos and relationships", () => {
  const zip = new PizZip(applyWordFillPlan(fixture(),fields,[{name:"Sản phẩm mới",quantity:"3",lineTotal:"1.234.567"}],plan()));
  const xml=zip.file("word/document.xml")!.asText();
  assert.match(xml,/Khách: Khách mới &amp; đối tác/);assert.match(xml,/; giữ nguyên\./);assert.match(xml,/Điều khoản giữ nguyên\./);assert.match(xml,/<w:i\/>/);
  assert.match(zip.file("word/header1.xml")!.asText(),/Công ty mới/);
  assert.equal(zip.file("word/media/logo.png")!.asText(),"logo bytes");assert.equal(zip.file("word/_rels/document.xml.rels")!.asText(),"original relationships");
  assert.doesNotMatch(xml,/Mẫu |cũ|Hàng cũ/);
});

test("Word resizes product tables in both directions and keeps totals and row/cell formatting", () => {
  for (const count of [1,4]) {
    const products=Array.from({length:count},(_,index)=>({name:`Sản phẩm ${index+1}`,quantity:index===0?"0":"2,5",lineTotal:"123.456"}));
    const xml=new PizZip(applyWordFillPlan(fixture(),fields,products,plan())).file("word/document.xml")!.asText();
    assert.equal((xml.match(/<w:tr>/g)??[]).length,count+2);assert.equal((xml.match(/w:cantSplit/g)??[]).length,count);assert.equal((xml.match(/EEEEEE/g)??[]).length,count);
    for (const product of products) assert.ok(xml.includes(product.name));assert.match(xml,/>0<\/w:t>/);assert.match(xml,/Tổng cộng/);assert.doesNotMatch(xml,/Hàng cũ/);
  }
});

test("Word rejects missing, ambiguous and out-of-range text positions and unknown fields", () => {
  for (const edit of [{part:"word/document.xml",paragraph:999,find:"100",replace:"[[total]]"},{part:"word/document.xml",paragraph:0,find:"không có",replace:"[[total]]"},{part:"word/document.xml",paragraph:1,find:"100",replace:"[[unknown]]"},{part:"word/document.xml",paragraph:1,find:"100",replace:"invented total"},{part:"word/document.xml",paragraph:1,find:"Tổng: 100",replace:"Tổng: [[total]] VAT 40%"}]) assert.throws(()=>applyWordFillPlan(fixture(),fields,[],{edits:[edit],tables:[]}));
});

test("Word rejects tables that map a header twice or reference nonexistent cells", () => {
  for (const columns of [[{column:0,key:"name"},{column:0,key:"quantity"}],[{column:99,key:"name"}],[{column:0,key:"notProvided"}]]) {
    const current=plan();current.tables[0]!.columns=columns;
    assert.throws(()=>applyWordFillPlan(fixture(),fields,[{name:"Hàng mới",quantity:"2",lineTotal:"20"}],current));
  }
});

test("Word cannot remove a table header or total as if it were an old product", () => {
  for (const productRows of [[0,1,2],[1,2,3]]) {
    const current=plan();current.tables[0]!.productRows=productRows;
    assert.throws(()=>applyWordFillPlan(fixture(),fields,[{name:"Hàng mới",quantity:"2",lineTotal:"20"}],current),/tiêu đề hoặc tổng tiền/);
  }
});
