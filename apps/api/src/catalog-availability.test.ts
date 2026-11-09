import assert from "node:assert/strict";
import test from "node:test";
import {availablePriceListRows} from "./catalog-availability.js";
const rows=[{sheet:"Bảng giá",row:1,cells:["SKU","Tên sản phẩm","Đơn giá"]},{sheet:"Bảng giá",row:2,cells:["SP-OLD","Vữa 25kg","100000"]},{sheet:"Bảng giá",row:3,cells:["SP-NEW","Vữa 25kg","120000"]},{sheet:"Bảng giá",row:4,cells:["Không có mã","Hàng xóa","30000"]}];
test("saved price-list rows exclude deleted SKUs and products without a SKU",()=>{
 const result=availablePriceListRows(rows,[{sku:" sp-old ",name:"Vữa 25kg"},{sku:"AUTO-REMOVED",name:"Hàng xóa"}],["SP-NEW"]);
 assert.deepEqual(result.map(row=>row.row),[1,3]);assert.equal(rows.length,4);
});
test("deleting nothing leaves the source rows intact",()=>{assert.strictEqual(availablePriceListRows(rows,[],[]),rows);});
