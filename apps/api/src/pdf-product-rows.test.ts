import assert from "node:assert/strict";
import test from "node:test";
import {expandPdfProductRows} from "./pdf-product-rows.js";
import type {TemplateFillPlan} from "./types.js";
const plan = (): TemplateFillPlan => ({edits:[],pdfEdits:[1,2].flatMap((index)=>[{page:1,x:40,y:500-index*50,width:300,height:18,fontSize:12,text:`[[line_${index}_name]]`,erase:true},{page:1,x:400,y:500-index*50,width:80,height:18,fontSize:12,text:`[[line_${index}_acceptedQuantity]]`,erase:true}])});
const fields={line_1_name:"A",line_1_acceptedQuantity:"18",line_2_name:"B",line_2_acceptedQuantity:"7",line_3_name:"C",line_3_acceptedQuantity:"0",line_4_name:"D",line_4_acceptedQuantity:"10,25"};
const sourceRows=[450,400].map(y=>({text:"Old product",x:40,y,width:300,height:18,fontSize:12}));
test("PDF product rows expand from the sample's own spacing, including zero and fractional quantities",()=>{
 const original=plan();const result=expandPdfProductRows(original,fields,[1,2,3,4],[{page:1,texts:[450,400].map(y=>({text:"Old product",x:40,y,width:100,height:18,fontSize:12}))}]);assert.equal(original.pdfEdits.length,4);assert.equal(result.pdfEdits.length,8);assert.ok(result.pdfEdits.some(edit=>edit.y===350&&edit.text==="[[line_3_acceptedQuantity]]"));assert.ok(result.pdfEdits.some(edit=>edit.y===300&&edit.text==="[[line_4_acceptedQuantity]]"));
});
test("PDF rows never overwrite source notes, signatures or another mapped value",()=>{
 const original=plan();assert.strictEqual(expandPdfProductRows(original,fields,[1,2,3,4],[{page:1,texts:[...sourceRows,{text:"Signature",x:40,y:350,width:300,height:18,fontSize:12}]}]),original);
 const other=plan();other.pdfEdits.push({page:1,x:40,y:350,width:300,height:18,fontSize:12,text:"[[customerName]]",erase:true});assert.strictEqual(expandPdfProductRows(other,fields,[1,2,3,4],[{page:1,texts:sourceRows}]),other);
});
test("PDF rows do not guess spacing from one sample row or inconsistent row geometry",()=>{
 const one=plan();one.pdfEdits=one.pdfEdits.slice(0,2);assert.strictEqual(expandPdfProductRows(one,fields,[1,2,3,4],[]),one);
 const different=plan();different.pdfEdits[2]!.x=250;assert.strictEqual(expandPdfProductRows(different,fields,[1,2,3,4],[{page:1,texts:sourceRows}]),different);
});
