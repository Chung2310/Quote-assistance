import test from "node:test";
import assert from "node:assert/strict";
import { resolveMinimumQuantity, type QuantityProduct } from "./product-quantity.js";

const mortar: QuantityProduct = { name: "Vữa chống thấm", sku: "VUA-25", unit: "bao", attributes: {
  "Quy cách": "Bao 25kg", "Định mức": "Độ dày 5-7mm", "Mật độ phủ": "2.5-3.5 m2",
} };
function quantity(product: QuantityProduct, request: string, expected: number, requirement?: unknown) {
  const result = resolveMinimumQuantity(product, request, requirement);
  assert.equal(result.status, "resolved", JSON.stringify(result));
  if (result.status !== "resolved") return;
  assert.equal(result.quantity, expected);
  assert.match(result.note, /không cộng hao hụt/);
}

test("uses maximum stated coverage and whole bags without waste", () => {
  quantity(mortar, "Chống thấm 100 m²", 29);
  quantity(mortar, "Chống thấm 7 m²", 2);
  quantity(mortar, "Chống thấm 0,5 m²", 1);
  quantity(mortar, "Chống thấm 3,51 m²", 2);
});

test("does not mistake thickness or bag weight for coverage", () => {
  const { "Mật độ phủ": _coverage, ...attributes } = mortar.attributes!;
  assert.equal(resolveMinimumQuantity({ ...mortar, attributes }, "Chống thấm 100 m²").status, "unresolved");
});

test("converts a consumption range using the lowest consumption and package mass", () => {
  quantity({ ...mortar, attributes: { "Quy cách": "25 kg/bao", "Định mức": "1,5–2 kg/m²" } }, "Trát 100 m²", 6);
});

test("converts per-litre paint coverage through the bucket volume", () => {
  quantity({ name: "Sơn", unit: "thùng", attributes: { "Quy cách": "18 lít/thùng", "Độ phủ": "10-12 m²/lít" } }, "Sơn 500 m²", 3);
});

test("supports lengths per roll, pieces per box and metric unit conversions", () => {
  quantity({ name: "Cáp", unit: "cuộn", attributes: { "Quy cách": "100 m/cuộn" } }, "Cần 250 m cáp", 3);
  quantity({ name: "Vít", unit: "hộp", attributes: { "Quy cách": "100 cái/hộp" } }, "Cần 250 cái vít", 3);
  quantity({ name: "Dây", unit: "cuộn", attributes: { "Quy cách": "500 cm/cuộn" } }, "Cần 12 m dây", 3);
  quantity({ name: "Hạt", unit: "gói", attributes: { "Quy cách": "250 g/gói" } }, "Cần 1 kg hạt", 4);
});

test("reads the explicit length of a sold pipe or bar without confusing diameter and thickness", () => {
  quantity({ name: "Ống PPR cấp nước D25", unit: "cây", description: "PN20; cây dài 4 m" }, "Ống PPR cấp nước D25: cần 73 m ống", 19);
  quantity({ name: "Thép D14", unit: "cây", description: "Cây dài 11,7 m; đường kính 14 mm" }, "Thép D14: cần 24 m", 3);
  quantity({ name: "Ống", unit: "cây", description: "Mỗi cây chiều dài 400 cm; độ dày 2 mm" }, "Ống: cần 8 m", 2);
  assert.equal(resolveMinimumQuantity({ name: "Ống", unit: "cây", description: "Độ dày 2 mm; đường kính 25 mm" }, "Ống: cần 73 m").status, "unresolved");
});

test("derives sheet area from dimensions without inventing a thickness formula", () => {
  quantity({ name: "Tấm thạch cao", unit: "tấm", attributes: { "Kích thước": "1.2 x 2.4 m" } }, "Làm trần 100 m²", 35);
  quantity({ name: "Gạch", unit: "viên", attributes: { "Kích thước": "600 x 600 mm" } }, "Lát 100 m²", 278);
  quantity({ name: "Gạch", unit: "hộp", attributes: { "Kích thước viên": "600 x 600 mm", "Quy cách": "4 viên/hộp" } }, "Lát 10 m²", 7);
});

test("keeps continuous selling units fractional and avoids floating-point extra packages", () => {
  quantity({ name: "Nhân công", unit: "m²" }, "Thi công 2,5 m²", 2.5);
  quantity({ name: "Vật liệu", unit: "kg" }, "Cần 500 g vật liệu", 0.5);
  quantity({ name: "Tấm", unit: "tấm", attributes: { "Độ phủ": "0,1 m²/tấm" } }, "Cần 0,3 m²", 3);
});

test("keeps an explicitly ordered selling quantity", () => {
  quantity(mortar, "Vữa chống thấm: 4 bao để làm 100 m²", 4);
  quantity(mortar, "Vữa chống thấm: 4 bao để làm 100 m²", 4, { quantity: 100, unit: "m²", evidence: "100 m²" });
});

test("reads a package size in the selling unit and ignores dimensions in the product identity", () => {
  quantity({ name: "Vữa Bao 25kg", unit: "Bao 25kg", attributes: { "Độ phủ": "2.5-3.5 m²" } }, "Vữa Bao 25kg: 100 m²", 29);
  quantity({ name: "Hạt", unit: "gói", attributes: { "Quy cách": "0.001 kg/gói" } }, "Cần 5 g hạt", 5);
});

test("does not use two sides of a three-dimensional size as a sheet area", () => {
  assert.equal(resolveMinimumQuantity({ name: "Tấm", unit: "tấm", attributes: { "Kích thước": "1.2 x 2.4 x 0.009 m" } }, "Tấm dùng cho 100 m²").status, "unresolved");
});

test("scopes a calculation to its product and rejects ambiguous requirements", () => {
  quantity(mortar, "Vữa chống thấm: 100 m²\nSơn khác: 30 m²", 29);
  assert.equal(resolveMinimumQuantity(mortar, "WC 10 m² và ban công 30 m²").status, "unresolved");
  quantity(mortar, "WC 10 m² và ban công 30 m²", 3, { quantity: 10, unit: "m²", evidence: "WC 10 m²" });
});

test("requires AI-extracted operands to appear in the actual request", () => {
  assert.equal(resolveMinimumQuantity(mortar, "Chống thấm 100 m²", { quantity: 200, unit: "m²", evidence: "Chống thấm 100 m²" }).status, "unresolved");
  assert.equal(resolveMinimumQuantity(mortar, "Chống thấm 100 m²", { quantity: 200, unit: "m²", evidence: "Chống thấm 200 m²" }).status, "unresolved");
});

test("does not silently choose between conflicting catalog rates", () => {
  assert.equal(resolveMinimumQuantity({ ...mortar, description: "Độ phủ: 5 m²/bao" }, "Chống thấm 100 m²").status, "unresolved");
});

test("does not reuse coverage for an incompatible or unspecified application condition", () => {
  assert.equal(resolveMinimumQuantity(mortar, "Chống thấm 100 m², độ dày 20 mm").status, "unresolved");
  assert.equal(resolveMinimumQuantity(mortar, "Chống thấm 100 m², độ dày 7 mm").status, "unresolved");
  const paint = { name: "Sơn", unit: "thùng", attributes: { "Độ phủ": "100 m²/thùng cho 1 lớp" } };
  assert.equal(resolveMinimumQuantity(paint, "Sơn 100 m², 2 lớp").status, "unresolved");
  quantity(paint, "Sơn 100 m², 1 lớp", 1);
});
