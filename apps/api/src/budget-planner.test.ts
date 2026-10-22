import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectId } from "mongodb";
import { buildBudgetPlan, clarificationInput, mergeBudgetPlanAfterClarification, recalculationInput, recomputeBudgetPlanTotals, validMissingProducts } from "./budget-planner.js";
import type { CatalogItem } from "./types.js";

const tile: CatalogItem = {
  _id: new ObjectId(), companyId: "example", sku: "GACH-01", name: "Gạch lát nền", description: "", unit: "m²", price: 200_000,
  currency: "VND", active: true, createdAt: new Date(), updatedAt: new Date(),
};

test("uses catalog price and known floor area to compare with the budget", () => {
  const result = buildBudgetPlan({ description: "Lát nền phòng 25 m²", area: 25, budget: 10_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "floor_area", quantity: 999, reason: "Lát nền" }] }, []);
  assert.equal(result.lines[0]?.quantity, 25);
  assert.equal(result.total, 5_000_000);
  assert.equal(result.difference, 5_000_000);
});

test("leaves the total open when quantity or required products are unknown", () => {
  const result = buildBudgetPlan({ description: "Sửa phòng", budget: 10_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "unknown", quantity: 25 }] }, ["Nhân công lát nền"]);
  assert.equal(result.lines[0]?.quantity, null);
  assert.equal(result.total, null);
  assert.deepEqual(result.missingProducts, ["Nhân công lát nền"]);
  assert.ok(result.questions.length > 0);
});

test("does not calculate from conflicting areas", () => {
  const result = buildBudgetPlan({ description: "Lát nền phòng diện tích 20 m²", area: 25, budget: 10_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "floor_area" }] }, []);
  assert.equal(result.total, null);
  assert.match(result.questions.join(" "), /Diện tích/);
});

test("does not compare a VND budget with a different catalog currency", () => {
  const result = buildBudgetPlan({ description: "Lát nền phòng diện tích 25 m²", budget: 10_000_000 }, [{ ...tile, currency: "USD" }],
    { items: [{ sku: tile.sku, basis: "floor_area" }] }, []);
  assert.equal(result.total, null);
  assert.equal(result.difference, null);
  assert.match(result.questions.join(" "), /quy đổi/);
});

test("does not block a complete floor proposal with optional AI questions", () => {
  const result = buildBudgetPlan({ description: "Lát nền phòng diện tích 25 m²", budget: 10_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "floor_area" }], questions: ["Có cần sửa hệ thống điện không?"] }, []);
  assert.equal(result.total, 5_000_000);
  assert.deepEqual(result.questions, []);
});

test("rejects generic or already priced missing products", () => {
  const cement = { ...tile, name: "Xi măng bao PCB30 FICO", sku: "XM-01" };
  assert.deepEqual(validMissingProducts([
    "Xi măng cho bê tông và xây tô", "Vật liệu hoàn thiện khác như thiết bị vệ sinh", "Máy phát điện dự phòng",
  ], [cement]), ["Máy phát điện dự phòng"]);
});

test("calculates estimated quantities using catalog prices and records assumptions", () => {
  const result = buildBudgetPlan({ description: "Xây tòa nhà với ngân sách 8 tỷ", budget: 8_000_000_000 }, [tile],
    { assumedArea: 100, assumedFloors: 4, items: [{ sku: tile.sku, basis: "estimated", quantity: 420, quantityNote: "400 m² sàn và 5% hao hụt vật tư" }] }, []);
  assert.equal(result.lines[0]?.quantity, 420);
  assert.equal(result.lines[0]?.lineTotal, 84_000_000);
  assert.equal(result.total, 84_000_000);
  assert.equal(result.provisional, true);
  assert.deepEqual(result.scenario, { area: 100, floors: 4 });
  assert.match(result.assumptions[0] ?? "", /100 m²/);
});

test("rejects ungrounded estimates and conflicting area inputs", () => {
  const noReason = buildBudgetPlan({ description: "Xây tòa nhà", budget: 1_000_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "estimated", quantity: 100 }] }, []);
  assert.equal(noReason.lines[0]?.quantity, null);
  const conflict = buildBudgetPlan({ description: "Lát nền diện tích 20 m²", area: 25, budget: 10_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "estimated", quantity: 25, quantityNote: "Dựa trên diện tích được nêu" }] }, []);
  assert.equal(conflict.lines[0]?.quantity, null);
});

test("shows a priced selected-items total while leaving the budget comparison open", () => {
  const result = buildBudgetPlan({ description: "Xây tòa nhà", budget: 1_000_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "estimated", quantity: 100, quantityNote: "Ước tính theo quy mô sơ bộ" }], questions: ["Diện tích thực tế?"] }, ["Nhân công chưa có giá"]);
  assert.equal(result.total, 20_000_000);
  assert.equal(result.difference, null);
  assert.equal(recomputeBudgetPlanTotals({ ...result, total: null }).total, 20_000_000);
});

test("only compares budget after questions, missing products and assumptions are resolved", () => {
  const base = buildBudgetPlan({ description: "Lát nền phòng diện tích 25 m²", budget: 10_000_000 }, [tile],
    { items: [{ sku: tile.sku, basis: "floor_area" }], assumptions: ["Chưa gồm hao hụt"] }, []);
  assert.equal(recomputeBudgetPlanTotals(base).difference, null);
  assert.equal(recomputeBudgetPlanTotals({ ...base, assumptionConfirmations: [true] }).difference, 5_000_000);
  assert.equal(recomputeBudgetPlanTotals({ ...base, assumptionConfirmations: [true], missingProducts: ["Keo dán gạch"] }).difference, null);
});

test("reanalyzes clarified input while retaining manually confirmed products and quantities", () => {
  const input = { description: "Lát nền phòng", budget: 10_000_000 };
  const previous = buildBudgetPlan(input, [tile], { items: [{ sku: tile.sku, basis: "estimated", quantity: 20, quantityNote: "Ước lượng 20 m² sàn phòng" }] }, []);
  previous.lines[0].quantityNote = "Số lượng do người dùng xác nhận";
  previous.lines[0].quantityBasis = "measured";
  previous.lines.push({ ...previous.lines[0], catalogItemId: "manual", sku: "KEO-01", name: "Keo dán gạch", quantity: 2, unitPrice: 100_000, lineTotal: 200_000, reason: "Bổ sung cho hạng mục: Keo dán gạch" });
  previous.resolvedMissingProducts = ["Keo dán gạch"];
  previous.assumptions = ["Nền phẳng"];
  previous.assumptionConfirmations = [true];
  const answer = { question: "Diện tích lát nền?", answer: "30 m²" };
  const expanded = clarificationInput(input, [answer]);
  assert.match(expanded.description, /Diện tích 30 m²/);
  assert.equal(expanded.area, 30);
  assert.equal(input.description, "Lát nền phòng");
  const proposed = buildBudgetPlan({ ...input, description: "Lát nền phòng diện tích 30 m²" }, [tile],
    { items: [{ sku: tile.sku, basis: "floor_area" }], assumptions: ["Nền phẳng"] }, ["Keo dán gạch"]);
  const merged = mergeBudgetPlanAfterClarification(previous, proposed, answer);
  assert.equal(merged.lines.find((line) => line.sku === tile.sku)?.quantity, 20);
  assert.equal(merged.lines.find((line) => line.sku === "KEO-01")?.lineTotal, 200_000);
  assert.deepEqual(merged.missingProducts, []);
  assert.deepEqual(merged.clarifications, [answer]);
  assert.deepEqual(merged.assumptionConfirmations, [true]);
  const savedInput = recalculationInput(input, previous);
  assert.match(savedInput.description, /Gạch lát nền \(SKU GACH-01\): 20 m²/);
  assert.match(savedInput.description, /Nền phẳng/);
  const recalculated = mergeBudgetPlanAfterClarification(previous, proposed);
  assert.equal(recalculated.lines.find((line) => line.sku === "KEO-01")?.quantity, 2);
  assert.deepEqual(recalculated.clarifications, []);
});

test("supports PC products without construction fields or floor-area assumptions", () => {
  const cpu = { ...tile, sku: "CPU-AM5", name: "CPU AM5", unit: "cái", price: 4_500_000 };
  const result = buildBudgetPlan({ description: "Lắp một bộ PC làm việc", budget: 15_000_000 }, [cpu],
    { assumedArea: 100, assumedFloors: 3, items: [{ sku: cpu.sku, basis: "estimated", quantity: 1, quantityNote: "Một CPU cho một bộ PC" }] }, []);
  assert.equal(result.lines[0]?.quantity, 1);
  assert.equal(result.lines[0]?.lineTotal, 4_500_000);
  assert.equal(result.difference, 10_500_000);
  assert.equal(result.scenario, undefined);
  assert.deepEqual(result.assumptions, []);

  const invalidFloorBasis = buildBudgetPlan({ description: "Lắp một bộ PC làm việc", budget: 15_000_000 }, [cpu],
    { assumedArea: 100, assumedFloors: 3, items: [{ sku: cpu.sku, basis: "floor_area", quantity: 100 }] }, []);
  assert.equal(invalidFloorBasis.lines[0]?.quantity, null);
  assert.deepEqual(validMissingProducts(["CPU", "RAM", "Mainboard"], [cpu]), ["RAM", "Mainboard"]);
  const pcRepair = buildBudgetPlan({ description: "Sửa chữa máy tính văn phòng", budget: 15_000_000 }, [cpu],
    { assumedArea: 100, assumedFloors: 3, items: [{ sku: cpu.sku, basis: "estimated", quantity: 1, quantityNote: "Một CPU thay thế cho máy tính" }] }, []);
  assert.equal(pcRepair.scenario, undefined);
});

test("does not report a PC build as within budget when its PSU is below the GPU recommendation", () => {
  const gpu = { ...tile, sku: "GPU-01", name: "Card đồ họa 8GB 1080p", description: "Nguồn đề xuất 550W", unit: "cái", price: 6_300_000 };
  const psu = { ...tile, sku: "PSU-01", name: "Nguồn ATX 500W", description: "", unit: "cái", price: 1_150_000 };
  const result = buildBudgetPlan({ description: "Lắp một bộ PC chơi game 1080p", budget: 20_000_000 }, [gpu, psu],
    { items: [gpu, psu].map((item) => ({ sku: item.sku, basis: "estimated", quantity: 1, quantityNote: "Một linh kiện cho một bộ PC" })) }, []);
  assert.equal(result.total, 7_450_000);
  assert.equal(result.difference, null);
  assert.match(result.questions.join(" "), /550W/);
});
