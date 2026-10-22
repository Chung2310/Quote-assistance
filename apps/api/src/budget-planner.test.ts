import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectId } from "mongodb";
import { buildBudgetPlan, recomputeBudgetPlanTotals, validMissingProducts } from "./budget-planner.js";
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
