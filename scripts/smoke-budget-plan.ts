import { MongoClient } from "mongodb";
import { config } from "../apps/api/src/config.js";
import { recomputeBudgetPlanTotals, suggestBudgetPlan, validMissingProducts, type SavedBudgetPlan } from "../apps/api/src/budget-planner.js";
import type { CatalogItem } from "../apps/api/src/types.js";

const examples = [
  { key: "room-renovation", input: { description: "Sửa phòng ngủ diện tích 25 m²: lát lại nền bằng gạch porcelain 600x600, gồm vật tư và nhân công lát gạch. Ngân sách 30 triệu đồng.", budget: 30_000_000, area: 25 } },
  { key: "building-concept", input: { description: "Muốn xây một tòa nhà từ phần móng đến hoàn thiện với ngân sách 8 tỷ đồng, chưa xác định diện tích và số tầng. Hãy đề xuất các sản phẩm, dịch vụ cần thiết từ bảng giá.", budget: 8_000_000_000 } },
  { key: "pc-build", input: { description: "Lắp một bộ PC chơi game 1080p, RAM 32GB, SSD 1TB; không cần màn hình hay phụ kiện.", budget: 25_000_000 } },
] as const;

async function main() {
const client = new MongoClient(config.mongoUri, {
  serverSelectionTimeoutMS: 8_000,
  authSource: config.mongoAuthSource,
  ...(config.mongoUser && config.mongoPassword ? { auth: { username: config.mongoUser, password: config.mongoPassword } } : {}),
});

try {
  await client.connect();
  const db = client.db(config.mongoDatabase);
  const companies = await db.collection<CatalogItem>("catalogItems").aggregate<{ _id: string; count: number }>([
    { $match: { active: true } }, { $group: { _id: "$companyId", count: { $sum: 1 } } }, { $sort: { count: -1 } },
  ]).toArray();
  const selectedCompany = process.argv.find((argument) => argument.startsWith("--company="))?.slice("--company=".length);
  if (!selectedCompany && companies.length !== 1) throw new Error(`Found ${companies.length} companies with an active catalog. Pass --company=<companyId> to select one.`);
  const companyId = selectedCompany ?? companies[0]?._id;
  if (!companyId || !companies.some((company) => company._id === companyId)) throw new Error("The selected company has no active catalog.");
  const today = new Date().toISOString().slice(0, 10);
  const catalog = await db.collection<CatalogItem>("catalogItems").find({ companyId, active: true,
    $and: [
      { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: null }, { effectiveFrom: { $lte: today } }] },
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: today } }] },
    ],
  }).sort({ sku: 1 }).limit(1000).toArray();
  if (!catalog.length) throw new Error("No active products for the test company.");
  const plans = db.collection<SavedBudgetPlan & { testCaseKey?: string }>("budgetPlans");
  const selectedCase = process.argv.find((argument) => argument.startsWith("--case="))?.slice("--case=".length);
  if (process.argv.includes("--inspect-existing")) {
    for (const example of examples) {
      if (selectedCase ? example.key !== selectedCase : example.key === "pc-build") continue;
      const stored = await plans.findOne({ companyId, testCaseKey: example.key });
      if (!stored?._id) throw new Error(`${example.key}: saved test plan was not found.`);
      process.stdout.write(JSON.stringify({ case: example.key, id: String(stored._id), scenario: stored.result.scenario,
        provisional: stored.result.provisional, lines: stored.result.lines.map((line) => ({ sku: line.sku, quantity: line.quantity, unit: line.unit, lineTotal: line.lineTotal, basis: line.quantityBasis })),
        knownTotal: stored.result.knownTotal, total: stored.result.total, assumptions: stored.result.assumptions }, null, 2) + "\n");
    }
    return;
  }
  if (process.argv.includes("--recompute-existing")) {
    for (const example of examples) {
      if (selectedCase ? example.key !== selectedCase : example.key === "pc-build") continue;
      const stored = await plans.findOne({ companyId, testCaseKey: example.key });
      if (!stored?._id) throw new Error(`${example.key}: saved test plan was not found.`);
      const result = recomputeBudgetPlanTotals(stored.result);
      await plans.updateOne({ _id: stored._id, companyId }, { $set: { result } });
      const verified = await plans.findOne({ _id: stored._id, companyId });
      if (verified?.result.total !== result.total) throw new Error(`${example.key}: total was not read back.`);
      process.stdout.write(`${example.key} | ${String(stored._id)} | total=${result.total ?? "unknown"}\n`);
    }
    return;
  }
  if (process.argv.includes("--sanitize-existing")) {
    for (const example of examples) {
      if (selectedCase ? example.key !== selectedCase : example.key === "pc-build") continue;
      const stored = await plans.findOne({ companyId, testCaseKey: example.key });
      if (!stored?._id) throw new Error(`${example.key}: saved test plan was not found.`);
      const missingProducts = validMissingProducts(stored.result.missingProducts, catalog);
      await plans.updateOne({ _id: stored._id, companyId }, { $set: { "result.missingProducts": missingProducts } });
      const verified = await plans.findOne({ _id: stored._id, companyId });
      if (JSON.stringify(verified?.result.missingProducts) !== JSON.stringify(missingProducts)) throw new Error(`${example.key}: updated missing products were not read back.`);
      process.stdout.write(`${example.key} | ${String(stored._id)} | missingProducts=${JSON.stringify(missingProducts)}\n`);
    }
    return;
  }
  if (!process.argv.includes("--dry-run")) await plans.createIndex({ companyId: 1, createdAt: -1 });
  for (const example of examples) {
    if (selectedCase ? example.key !== selectedCase : example.key === "pc-build") continue;
    const result = await suggestBudgetPlan(example.input, catalog);
    if (!result.lines.length && !result.missingProducts.length) throw new Error(`${example.key}: AI did not produce a useful proposal.`);
    if (process.argv.includes("--dry-run")) {
      process.stdout.write(JSON.stringify({ case: example.key, companyId, result }, null, 2) + "\n");
      continue;
    }
    const createdAt = new Date();
    const saved: SavedBudgetPlan & { testCaseKey: string } = {
      companyId, createdBy: "system-smoke", testCaseKey: example.key,
      input: example.input, result, createdAt,
    };
    await plans.updateOne({ companyId, testCaseKey: example.key }, { $set: saved }, { upsert: true });
    const stored = await plans.findOne({ companyId, testCaseKey: example.key });
    if (!stored || stored.result.lines.length !== result.lines.length) throw new Error(`${example.key}: database read-back failed.`);
    process.stdout.write(JSON.stringify({ case: example.key, id: String(stored._id), companyId,
      products: stored.result.lines.map((line) => line.sku), knownTotal: stored.result.knownTotal,
      total: stored.result.total, missingProducts: stored.result.missingProducts,
      questions: stored.result.questions }, null, 2) + "\n");
  }
} finally {
  await client.close();
}
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
