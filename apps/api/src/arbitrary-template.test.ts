import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Binary, type Db } from "mongodb";
import PizZip from "pizzip";
import { DOMParser } from "@xmldom/xmldom";
import * as XLSX from "xlsx";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { config } from "./config.js";
import { contractTemplateMode, renderAcceptanceFile, renderContractFile } from "./contract-template.js";
import { assertPdfPagesPreserved, renderBoundPdfTemplate, renderTemplate, type QuoteTemplate } from "./quote-template.js";
import { pdfTextPositions } from "./pdf-layout.js";
import { fillWordBusinessTemplate, applyWordFillPlan } from "./word-template-fill.js";
import type { Contract, AcceptanceRecord, Quote } from "./types.js";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const p = (value: string) => `<w:p><w:r><w:t>${value}</w:t></w:r></w:p>`;
function word(body: string): QuoteTemplate {
  const zip = new PizZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`);
  return { extension:"docx",originalFilename:"user-layout.docx",data:new Binary(zip.generate({type:"nodebuffer"})) } as QuoteTemplate;
}
const quote = {quoteNumber:"DT-NEW",kind:"estimate",customerName:"Khách mới",customerEmail:"",subtotal:250000,taxRate:.1,taxAmount:25000,shippingFee:5000,total:280000,currency:"VND",createdAt:new Date("2026-11-09"),lines:[{sku:"NEW-A",name:"Hàng mới",description:"Bao 25kg",unit:"bao",quantity:2,unitPrice:125000,lineTotal:250000,currency:"VND",attributes:{}}]} as Quote;
const contract = {...quote,contractNumber:"HD-NEW",companyName:"Bên bán mới",customerRepresentative:"Người mua",companyRepresentative:"Người bán",customerAddress:"Hà Nội",companyAddress:"Đà Nẵng",depositAmount:100000,customerTaxId:"",companyTaxId:"",companyPhone:"",companyEmail:"",customerPhone:"",projectName:"Công trình mới",projectAddress:"Địa điểm mới",scope:"Vật tư",deliverables:"Vật tư",paymentTerms:"Theo hợp đồng",deliveryTerms:"Tại kho",signingPlace:"Hà Nội",signedDate:"2026-11-09",bankDetails:"",otherTerms:""} as unknown as Contract;
const record={acceptanceNumber:"NT-NEW",acceptedDate:"2026-11-09",location:"Hà Nội",result:"Đạt",notes:"",startTime:"09:00",endTime:"10:00",handoverDetails:"Vật tư",qualityAssessment:"Đạt",settlementAmount:137500,amountPaid:100000,lines:[{lineIndex:0,acceptedQuantity:1}],paymentDueDays:7} as AcceptanceRecord;
const xml=(bytes:Buffer)=>new PizZip(bytes).file("word/document.xml")!.asText();
function useKey(t: TestContext, value="test-key") {const previous=config.openRouterApiKey;config.openRouterApiKey=value;t.after(()=>{config.openRouterApiKey=previous;});}

test("Word quotation placeholders work without AI and keep unknown quantities and totals blank",async(t)=>{
  useKey(t,"");
  const template=word(p("{customerName} {total}")+p("{#lines}{name}|{quantity}|{unitPrice}|{lineTotal}{/lines}"));
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("AI must not run");});
  const output=xml(await renderTemplate(template,{...quote,kind:"customer"}));
  assert.match(output,/Khách mới/);assert.match(output,/Hàng mới\|\|125\.000\|/);assert.doesNotMatch(output,/280\.000|250\.000/);
});

test("Word fixed product placeholders remove surplus physical rows without AI",async(t)=>{
  useKey(t,"");const row=(index:number)=>`<w:tr><w:tc>${p(`{line_${index}_name}`)}</w:tc><w:tc>${p(`{line_${index}_quantity}`)}</w:tc></w:tr>`;
  const template=word(p("{customerName}")+`<w:tbl>${row(1)}${row(2)}${row(3)}<w:tr><w:tc>${p("Tổng cộng")}</w:tc><w:tc>${p("{total}")}</w:tc></w:tr></w:tbl>`);
  const output=xml(await renderTemplate(template,quote));assert.equal((output.match(/<w:tr>/g)??[]).length,2);assert.match(output,/Hàng mới/);assert.match(output,/280\.000/);
});

test("Word templates with only a product table need no mandatory party or money positions",()=>{
  const template=word(`<w:tbl><w:tr><w:tc>${p("Tên hàng")}</w:tc></w:tr><w:tr><w:tc>${p("Hàng cũ")}</w:tc></w:tr></w:tbl>`);
  const output=xml(applyWordFillPlan(template,{},[{name:"Hàng mới"}],{edits:[],tables:[{part:"word/document.xml",table:0,productRows:[1],columns:[{column:0,key:"name"}]}]}));assert.match(output,/Hàng mới/);assert.doesNotMatch(output,/Hàng cũ/);
});

test("gaps in fixed Word product placeholders cannot silently omit a requested product",async(t)=>{
  useKey(t);const template=word(p("{customerName}")+`<w:tbl><w:tr><w:tc>${p("{line_1_name}")}</w:tc></w:tr><w:tr><w:tc>${p("{line_3_name}")}</w:tc></w:tr></w:tbl>`);
  const plan={edits:[{part:"word/document.xml",paragraph:0,find:"{customerName}",replace:"[[customerName]]"}],tables:[{part:"word/document.xml",table:0,productRows:[0,1],columns:[{column:0,key:"name"}]}]};
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]})));
  const output=xml(await renderTemplate(template,{...quote,lines:[quote.lines[0]!,{...quote.lines[0]!,name:"Hàng thứ hai"},{...quote.lines[0]!,name:"Hàng thứ ba"}]}));assert.match(output,/Hàng mới/);assert.match(output,/Hàng thứ hai/);assert.match(output,/Hàng thứ ba/);
});

test("an unmarked Word contract can contain project fields without a fixed contract form",async(t)=>{
  useKey(t);const template=word(p("Công trình: Mẫu cũ"));
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[{part:"word/document.xml",paragraph:0,find:"Mẫu cũ",replace:"[[projectName]]"}],tables:[]})}}]})));
  const output=xml(await fillWordBusinessTemplate(template,{projectName:"Dự án mới",customerName:"Khách",companyName:"Bên bán",total:"100"},[],"contract"));assert.match(output,/Công trình: Dự án mới/);
});

test("PDF edits retain the selected template page count, size and orientation",async()=>{
  const source=await PDFDocument.create();source.addPage([842,595]);source.addPage([595,842]);
  const template={extension:"pdf",data:new Binary(Buffer.from(await source.save()))} as QuoteTemplate;
  await assertPdfPagesPreserved(template,Buffer.from(await source.save()));
  const missing=await PDFDocument.create();missing.addPage([842,595]);await assert.rejects(assertPdfPagesPreserved(template,Buffer.from(await missing.save())),/thay đổi trang/);
});

test("PDF mapping receives actual text positions and always clears the old sample value",async(t)=>{
  useKey(t);const source=await PDFDocument.create();source.addPage([300,200]).drawText("OLD",{x:20,y:80,size:12});const bytes=Buffer.from(await source.save());
  const positions=await pdfTextPositions(bytes);const old=positions[0]!.texts.find(item=>item.text==="OLD")!;assert.equal(old.x,19);assert.equal(old.y,76);assert.equal(old.fontSize,12);
  const plan={edits:[],pdfEdits:[{page:0,x:19,y:76,width:150,height:20,fontSize:12,text:"[[customerName]]",erase:false}]};
  let sentPositions=false;
  t.mock.method(globalThis,"fetch",async(_url: string | URL | Request,init?: RequestInit)=>{sentPositions=String(init?.body).includes("textPositions");return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(plan)}}]}));});
  const output=await renderBoundPdfTemplate({extension:"pdf",originalFilename:"source.pdf",data:new Binary(bytes)} as QuoteTemplate,{customerName:"NEW"},"acceptance");
  assert.equal(sentPositions,true);const pdf=await PDFDocument.load(output);const streams=pdf.getPages()[0]!.node.Contents() as PDFArray;const content=Array.from({length:streams.size()},(_,index)=>pdf.context.lookup(streams.get(index))).filter((stream):stream is PDFRawStream=>stream instanceof PDFRawStream).map(stream=>Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
  assert.match(content,/1 1 1 rg/);
});

test("Word acceptance placeholders retain original headers, footers and fonts",async(t)=>{
  useKey(t,"");const template=word(p("{acceptanceNumber} {settlementAmountFormatted}"));const zip=new PizZip(Buffer.from(template.data.buffer));zip.file("word/header1.xml",`<w:hdr xmlns:w="${w}"><w:p><w:r><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr><w:t>{companyName}</w:t></w:r></w:p></w:hdr>`);zip.file("word/footer1.xml",`<w:ftr xmlns:w="${w}">${p("{contractNumber}")}</w:ftr>`);
  zip.file("[Content_Types].xml",zip.file("[Content_Types].xml")!.asText().replace("</Types>",'<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'));
  zip.file("word/_rels/document.xml.rels",'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
  zip.file("word/document.xml",zip.file("word/document.xml")!.asText().replace("</w:body>",'<w:sectPr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:headerReference w:type="default" r:id="rHeader"/><w:footerReference w:type="default" r:id="rFooter"/></w:sectPr></w:body>'));template.data=new Binary(zip.generate({type:"nodebuffer"}));
  const output=new PizZip((await renderAcceptanceFile({} as Db,template,contract,record)).bytes);assert.match(output.file("word/header1.xml")!.asText(),/Courier New/);assert.match(output.file("word/header1.xml")!.asText(),/Bên bán mới/);assert.match(output.file("word/footer1.xml")!.asText(),/HD-NEW/);
});

test("PDF tables cannot silently drop products when the sample has fewer rows",async(t)=>{
  useKey(t);const pdf=await PDFDocument.create();pdf.addPage([300,200]);const template={extension:"pdf",originalFilename:"table.pdf",data:new Binary(Buffer.from(await pdf.save()))} as QuoteTemplate;
  const first={page:0,x:20,y:100,width:200,height:20,fontSize:12,text:"[[line_1_name]]",erase:false};
  let attempts=0;t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[],pdfEdits:++attempts===1?[first]:[first,{...first,y:60,text:"[[line_2_name]]"}]})}}]})));
  const output=await renderBoundPdfTemplate(template,{line_1_name:"FIRST",line_2_name:"SECOND"},"acceptance");assert.equal(attempts,2);const text=(await pdfTextPositions(output)).flatMap(page=>page.texts.map(item=>item.text));assert.ok(text.includes("FIRST"));assert.ok(text.includes("SECOND"));
});

test("PDF rendering expands a proven two-row sample to all four supplied products",async(t)=>{
  useKey(t);const pdf=await PDFDocument.create();const page=pdf.addPage([300,300]);page.drawText("OLD FIRST",{x:20,y:185,size:12});page.drawText("OLD SECOND",{x:20,y:145,size:12});const template={extension:"pdf",originalFilename:"table.pdf",data:new Binary(Buffer.from(await pdf.save()))} as QuoteTemplate;
  let attempts=0;const edits=[1,2].map(index=>({page:0,x:20,y:220-index*40,width:240,height:20,fontSize:12,text:`[[line_${index}_name]]`,erase:true}));
  t.mock.method(globalThis,"fetch",async()=>{attempts++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({edits:[],pdfEdits:edits})}}]}));});
  const output=await renderBoundPdfTemplate(template,{line_1_name:"FIRST",line_2_name:"SECOND",line_3_name:"THIRD",line_4_name:"FOURTH"},"acceptance");const text=(await pdfTextPositions(output)).flatMap(page=>page.texts.map(item=>item.text));assert.equal(attempts,1);for(const value of ["FIRST","SECOND","THIRD","FOURTH"])assert.ok(text.includes(value));
});

test("Excel contract samples remain Excel and preserve every worksheet",async(t)=>{
  useKey(t);const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Mẫu công ty","Mới"]]),"Bìa");XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([["Tên hàng"],["Hàng mới"]]),"Danh mục");
  const bytes=XLSX.write(book,{type:"buffer",bookType:"xlsx"});const template={extension:"xlsx",originalFilename:"custom.xlsx",data:new Binary(bytes)} as QuoteTemplate;
  assert.equal(contractTemplateMode(template),"xlsx-ai");
  const file=await renderContractFile({} as Db,template,contract,async<T>()=>bytes as unknown as T);assert.equal(file.extension,"xlsx");assert.deepEqual(XLSX.read(file.bytes,{type:"buffer"}).SheetNames,book.SheetNames);
});

test("PDF acceptance and settlement samples stay PDF without a Word conversion",async(t)=>{
  useKey(t);const pdf=await PDFDocument.create();pdf.addPage([842,595]);const bytes=Buffer.from(await pdf.save());const template={extension:"pdf",originalFilename:"custom.pdf",data:new Binary(bytes)} as QuoteTemplate;
  for(const kind of ["acceptance","settlement"] as const){const file=await renderAcceptanceFile({} as Db,template,contract,record,async<T>()=>bytes as unknown as T,kind);assert.equal(file.extension,"pdf");assert.equal((await PDFDocument.load(file.bytes)).getPageCount(),1);}
});

test("Word quotation fields may span styled runs",async(t)=>{
  useKey(t,"");const template=word('<w:p><w:r><w:t>{customer</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Name}</w:t></w:r></w:p>');
  const output=await renderTemplate(template,quote);const document=new DOMParser().parseFromString(xml(output),"application/xml");assert.equal(document.getElementsByTagNameNS(w,"t").item(0)?.textContent,"Khách mới");
});

test("Word contract fixed placeholders cannot omit products or leave unused table rows",async(t)=>{
  useKey(t,"");const row=(index:number)=>`<w:tr><w:tc>${p(`{line_${index}_name}`)}</w:tc></w:tr>`;
  const source=word(p("{contractNumber}")+`<w:tbl>${row(1)}${row(2)}${row(3)}</w:tbl>`);
  const result=await renderContractFile({} as Db,source,contract,async()=>{throw new Error("AI must not run");});assert.equal((xml(result.bytes).match(/<w:tr>/g)??[]).length,1);
});
