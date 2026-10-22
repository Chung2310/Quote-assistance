import { askCustomerQuoteAi, parseCustomerQuotePrompt, shortlistCatalog } from "./customer-quote-ai.js";
import type { CatalogItem } from "./types.js";
import type { ObjectId } from "mongodb";

export interface BudgetPlanInput { description: string; budget: number; area?: number; floors?: number }
const isConstructionRequest = (description: string) => /\b(xay (?:nha|toa|cong trinh)|sua(?: chua)? (?:\d+ )?(?:phong|nha|can ho)|cai tao|thi cong|lat|op lat|son tuong|chong tham|toa nha|nha pho|can ho|cong trinh|phong ngu|san nha)\b/.test(normalize(description));
export interface BudgetPlanLine {
  catalogItemId: string; sku: string; name: string; unit: string; unitPrice: number; currency: string;
  quantity: number | null; lineTotal: number | null; reason: string;
  quantityBasis?: "measured" | "estimated"; quantityNote?: string;
}
export interface BudgetPlanResult {
  scope: string; budget: number; currency: string; lines: BudgetPlanLine[];
  knownTotal: number | null; total: number | null; difference: number | null;
  questions: string[]; missingProducts: string[]; assumptions: string[];
  scenario?: { area?: number; floors?: number };
  provisional?: boolean;
  clarifications?: Array<{ question: string; answer: string }>;
  assumptionConfirmations?: boolean[];
  resolvedMissingProducts?: string[];
}
export interface SavedBudgetPlan {
  _id?: ObjectId; companyId: string; createdBy: string; input: BudgetPlanInput;
  result: BudgetPlanResult; createdAt: Date;
}

export function recomputeBudgetPlanTotals(result: BudgetPlanResult): BudgetPlanResult {
  const currencies = new Set(result.lines.map((line) => line.currency));
  const sameCurrency = currencies.size <= 1;
  const knownTotal = sameCurrency ? Math.round(result.lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0) * 100) / 100 : null;
  const pricedLinesComplete = result.lines.length > 0 && result.lines.every((line) => line.quantity !== null && line.lineTotal !== null) && sameCurrency && result.currency === "VND";
  const total = pricedLinesComplete ? knownTotal : null;
  const assumptionsConfirmed = result.assumptions.every((_, index) => result.assumptionConfirmations?.[index] === true);
  const difference = total !== null && result.questions.length === 0 && result.missingProducts.length === 0 && assumptionsConfirmed
    ? Math.round((result.budget - total) * 100) / 100 : null;
  const provisional = result.lines.some((line) => line.quantityBasis === "estimated" && line.quantity !== null);
  return { ...result, knownTotal, total, difference, provisional };
}

export function clarificationInput(input: BudgetPlanInput, clarifications: Array<{ question: string; answer: string }>): BudgetPlanInput {
  const areaAnswer = [...clarifications].reverse().find(({ question, answer }) => /dien tich/.test(normalize(question)) && /(m²|m2|mét vuông|met vuong)/i.test(answer));
  const areaMatch = areaAnswer?.answer.match(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|mét vuông|met vuong)/i);
  const confirmedArea = areaMatch ? Number(areaMatch[1].replace(",", ".")) : undefined;
  const confirmedFacts = clarifications.map(({ answer }) => answer).join("; ");
  return {
    ...input,
    ...(confirmedArea && confirmedArea > 0 ? { area: confirmedArea } : {}),
    description: `Thông tin đã xác nhận, ưu tiên khi khác yêu cầu ban đầu: ${confirmedArea ? `Diện tích ${confirmedArea} m². ` : ""}${confirmedFacts}\nYêu cầu ban đầu: ${input.description}`,
  };
}

export function recalculationInput(input: BudgetPlanInput, result: BudgetPlanResult, next?: { question: string; answer: string }): BudgetPlanInput {
  const clarifications = [...(result.clarifications ?? []), ...(next ? [next] : [])];
  const clarified = clarifications.length ? clarificationInput(input, clarifications) : input;
  const confirmedLines = result.lines.filter((line) => line.quantityNote === "Số lượng do người dùng xác nhận" || line.reason.startsWith("Bổ sung cho hạng mục:"));
  const facts = [
    ...confirmedLines.map((line) => `${line.name} (SKU ${line.sku}): ${line.quantity ?? "chưa rõ"} ${line.unit}`),
    ...result.assumptions.flatMap((assumption, index) => result.assumptionConfirmations?.[index] ? [assumption] : []),
  ];
  return facts.length ? { ...clarified, description: `${clarified.description}\nSản phẩm, số lượng và giả định đã được người dùng xác nhận; giữ các mục này:\n${facts.join("\n")}` } : clarified;
}

export function mergeBudgetPlanAfterClarification(
  previous: BudgetPlanResult,
  proposed: BudgetPlanResult,
  clarification?: { question: string; answer: string },
): BudgetPlanResult {
  const clarifications = [...(previous.clarifications ?? []), ...(clarification ? [clarification] : [])];
  const previousById = new Map(previous.lines.map((line) => [line.catalogItemId, line]));
  const manualLines = previous.lines.filter((line) => line.quantityNote === "Số lượng do người dùng xác nhận" || line.reason.startsWith("Bổ sung cho hạng mục:"));
  const lines = proposed.lines.map((line) => {
    const saved = previousById.get(line.catalogItemId);
    if (saved?.quantityNote !== "Số lượng do người dùng xác nhận" || saved.quantity === null) return line;
    return { ...line, quantity: saved.quantity, quantityBasis: "measured" as const, quantityNote: saved.quantityNote,
      lineTotal: Math.round((line.unitPrice * saved.quantity + Number.EPSILON) * 100) / 100 };
  });
  for (const line of manualLines) if (!lines.some((entry) => entry.catalogItemId === line.catalogItemId)) lines.push(line);
  const resolvedMissingProducts = previous.resolvedMissingProducts ?? [];
  return recomputeBudgetPlanTotals({
    ...proposed,
    lines,
    questions: proposed.questions.filter((question) => !clarifications.some((entry) => entry.question === question)),
    missingProducts: proposed.missingProducts.filter((name) => !resolvedMissingProducts.includes(name)),
    clarifications,
    resolvedMissingProducts,
    assumptionConfirmations: proposed.assumptions.map((assumption) => previous.assumptions.some((saved, index) => saved === assumption && previous.assumptionConfirmations?.[index] === true)),
  });
}

const strings = (value: unknown, max: number) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, max).map((item) => item.trim().slice(0, 250))
  : [];

function normalize(value: string) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

function pcCompatibilityQuestions(description: string, lines: BudgetPlanLine[], catalog: CatalogItem[]) {
  if (!/\b(pc|may tinh|cpu|gaming)\b/.test(normalize(description))) return [];
  const selected = catalog.filter((item) => lines.some((line) => line.sku === item.sku));
  const powerSupplies = selected.filter((item) => /\b(nguon|psu)\b/.test(normalize(item.name)));
  const powerWatts = powerSupplies.map((item) => Number(normalize(item.name).match(/\b(\d{3,4})\s*w\b/)?.[1] ?? 0));
  const gpuMinimum = Math.max(0, ...selected.filter((item) => /\b(card do hoa|gpu)\b/.test(normalize(item.name)))
    .map((item) => Number(normalize(item.description).match(/nguon de xuat\s*(\d{3,4})\s*w\b/)?.[1] ?? 0)));
  const selectedPower = Math.max(0, ...powerWatts);
  return gpuMinimum > 0 && selectedPower > 0 && selectedPower < gpuMinimum
    ? [`Nguồn ${selectedPower}W thấp hơn mức ${gpuMinimum}W được đề xuất cho card đồ họa; cần chọn nguồn phù hợp.`] : [];
}

export function validMissingProducts(names: string[], catalog: CatalogItem[]) {
  return names.filter((name) => {
    const normalized = normalize(name);
    if (/\b(khac|nhu)\b/.test(normalized) || /\b(vat lieu hoan thien|hang muc|he thong)\b/.test(normalized)) return false;
    const terms = normalized.match(/[a-z0-9]+/g) ?? [];
    const required = terms[0] === "nhan" && terms[1] === "cong" ? 3
      : terms.length === 1 && /^(cpu|ram|gpu|ssd|psu|mainboard)$/.test(terms[0] ?? "") ? 1 : 2;
    if (terms.length < required) return false;
    return !catalog.some((item) => {
      const itemTerms = normalize(item.name).match(/[a-z0-9]+/g) ?? [];
      return terms.slice(0, required).every((term, index) => itemTerms[index] === term);
    });
  });
}

export function buildBudgetPlan(input: BudgetPlanInput, catalog: CatalogItem[], raw: Record<string, unknown>, missing: string[]): BudgetPlanResult {
  const bySku = new Map(catalog.map((item) => [item.sku, item]));
  const seen = new Set<string>();
  const parsed = parseCustomerQuotePrompt(input.description);
  const construction = isConstructionRequest(input.description);
  const assumedArea = construction && typeof raw.assumedArea === "number" && Number.isFinite(raw.assumedArea) && raw.assumedArea >= 5 && raw.assumedArea <= 100_000 ? raw.assumedArea : undefined;
  const assumedFloors = construction && typeof raw.assumedFloors === "number" && Number.isInteger(raw.assumedFloors) && raw.assumedFloors >= 1 && raw.assumedFloors <= 200 ? raw.assumedFloors : undefined;
  const area = input.area ?? parsed.area ?? assumedArea;
  const floors = input.floors ?? parsed.floors ?? assumedFloors;
  const areaConflict = Boolean(input.area && parsed.area && Math.abs(input.area - parsed.area) > 0.01);
  const provisionalScenario = Boolean((!input.area && !parsed.area && assumedArea) || (!input.floors && !parsed.floors && assumedFloors));
  const selected = Array.isArray(raw.items) ? raw.items.slice(0, 30) : [];
  const lines: BudgetPlanLine[] = [];
  for (const entry of selected) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const item = typeof row.sku === "string" ? bySku.get(row.sku) : undefined;
    if (!item || seen.has(item.sku) || !Number.isFinite(item.price) || item.price < 0) continue;
    seen.add(item.sku);
    const basis = row.basis;
    let quantity: number | null = null;
    let quantityBasis: "measured" | "estimated" | undefined;
    let quantityNote: string | undefined;
    if (basis === "floor_area" && construction && area && !areaConflict && ["m²", "m2"].includes(item.unit.toLowerCase().replace(/\s/g, ""))) quantity = Math.round(area * (floors ?? 1) * 100) / 100;
    if (quantity !== null) {
      quantityBasis = provisionalScenario ? "estimated" : "measured";
      quantityNote = provisionalScenario ? `Diện tích giả định ${area} m² × ${floors ?? 1} tầng` : `Diện tích ${area} m² × ${floors ?? 1} tầng`;
    }
    const evidence = typeof row.evidence === "string" ? row.evidence.trim() : "";
    if (basis === "explicit" && evidence && input.description.includes(evidence)
      && typeof row.quantity === "number" && Number.isFinite(row.quantity) && row.quantity > 0 && row.quantity <= 1_000_000
      && evidence.includes(String(row.quantity))) {
      quantity = Math.round(row.quantity * 100) / 100;
      quantityBasis = "measured";
      quantityNote = `Theo yêu cầu: ${evidence.slice(0, 120)}`;
    }
    const estimateNote = typeof row.quantityNote === "string" ? row.quantityNote.trim().slice(0, 220) : "";
    if (basis === "estimated" && !areaConflict && typeof row.quantity === "number" && Number.isFinite(row.quantity)
      && row.quantity > 0 && row.quantity <= 1_000_000 && estimateNote.length >= 8) {
      quantity = Math.round(row.quantity * 100) / 100;
      quantityBasis = "estimated";
      quantityNote = estimateNote;
    }
    const reason = typeof row.reason === "string" ? row.reason.trim().slice(0, 240) : "Phù hợp với phạm vi công việc";
    lines.push({ catalogItemId: String(item._id), sku: item.sku, name: item.name, unit: item.unit, unitPrice: item.price, currency: item.currency,
      quantity, lineTotal: quantity === null ? null : Math.round(item.price * quantity * 100) / 100, reason,
      ...(quantityBasis ? { quantityBasis } : {}), ...(quantityNote ? { quantityNote } : {}) });
  }
  const currencies = new Set(lines.map((line) => line.currency));
  const currency = lines[0]?.currency ?? catalog[0]?.currency ?? "VND";
  const knownTotal = currencies.size > 1 ? null : Math.round(lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0) * 100) / 100;
  const missingProducts = validMissingProducts([...new Set([...missing, ...strings(raw.missingProducts, 20)])], catalog).slice(0, 20);
  const requiresClarification = lines.some((line) => line.quantity === null) || missingProducts.length > 0 || areaConflict;
  const questions = requiresClarification ? strings(raw.questions, 6) : [];
  if (areaConflict) questions.push("Diện tích trong mô tả khác với ô diện tích; hãy xác nhận số đúng.");
  if (lines.some((line) => line.quantity === null) && !questions.length) questions.push("Cần xác nhận số lượng hoặc kích thước cho các hạng mục chưa tính được.");
  if (currencies.size > 1) questions.push("Bảng giá chứa nhiều loại tiền tệ; cần chọn một loại trước khi tính tổng.");
  if (currency !== "VND") questions.push("Ngân sách nhập bằng VND nhưng sản phẩm dùng tiền tệ khác; cần quy đổi trước khi so sánh.");
  questions.push(...pcCompatibilityQuestions(input.description, lines, catalog));
  const pricedLinesComplete = lines.length > 0 && lines.every((line) => line.quantity !== null) && currencies.size === 1 && !areaConflict && currency === "VND";
  const budgetComparable = pricedLinesComplete && missingProducts.length === 0 && questions.length === 0;
  const provisional = provisionalScenario || lines.some((line) => line.quantityBasis === "estimated");
  const assumptions = strings(raw.assumptions, 8);
  if (provisionalScenario) assumptions.unshift(`Quy mô giả định để tính sơ bộ: ${area ?? "chưa rõ"} m² mỗi tầng, ${floors ?? "chưa rõ"} tầng.`);
  return { scope: typeof raw.scope === "string" ? raw.scope.slice(0, 300) : input.description,
    budget: input.budget, currency, lines, knownTotal,
    total: pricedLinesComplete ? knownTotal : null, difference: budgetComparable && knownTotal !== null ? Math.round((input.budget - knownTotal) * 100) / 100 : null,
    questions, missingProducts, assumptions, provisional,
    ...(provisionalScenario ? { scenario: { ...(area ? { area } : {}), ...(floors ? { floors } : {}) } } : {}) };
}

export async function suggestBudgetPlan(input: BudgetPlanInput, catalog: CatalogItem[]): Promise<BudgetPlanResult> {
  const brief = JSON.stringify(input);
  const plan = await askCustomerQuoteAi([
    { role: "system", content: "Bạn là chuyên viên tư vấn mua sắm theo ngân sách cho MỌI ngành hàng. Xác định lĩnh vực từ yêu cầu khách và bảng giá; không mặc định là xây dựng. Trả JSON {scope:string,needs:[{name:string,searchTerms:string[]}],questions:string[]}. needs gồm sản phẩm hoặc dịch vụ cụ thể, thiết yếu để đáp ứng yêu cầu; tối đa 20. Nếu khách muốn lắp PC, xét CPU, mainboard, RAM, lưu trữ, nguồn, vỏ, card đồ họa khi chơi game và tản nhiệt khi CPU không ghi kèm sẵn; xét khả năng tương thích. Chỉ thêm màn hình hoặc phụ kiện khi khách yêu cầu. Nếu là xây dựng, xét vật tư và nhân công đúng phạm vi. Không tự thêm hạng mục ngoài yêu cầu. Chỉ hỏi thông tin thực sự cần để chọn sản phẩm hoặc tính số lượng. Không giả định ngành, kích thước, số lượng hay giá. Chỉ trả JSON." },
    { role: "user", content: brief },
  ]);
  const needs = Array.isArray(plan.needs) ? plan.needs.slice(0, 15).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name.trim()) return [];
    return [{ name: row.name.trim().slice(0, 120), searchTerms: strings(row.searchTerms, 6) }];
  }) : [];
  const shortlist = shortlistCatalog({ scope: "", needs, questions: [] }, catalog);
  const candidates = catalog.length <= 150 ? catalog : shortlist.available;
  const raw = await askCustomerQuoteAi([
    { role: "system", content: "Lập phương án sản phẩm/dịch vụ và ước tính số lượng từ bảng giá cho đúng lĩnh vực khách yêu cầu. Trả JSON {scope:string,assumedArea:number|null,assumedFloors:number|null,items:[{sku:string,basis:string,quantity:number|null,evidence:string,quantityNote:string,reason:string}],missingProducts:string[],questions:string[],assumptions:string[]}. Chỉ chọn SKU có trong catalog, dùng đúng đơn vị và giá catalog. Nếu lắp PC, chọn các linh kiện tương thích: CPU và socket mainboard, chuẩn RAM, công suất nguồn, kích thước vỏ; đọc thông số nguồn đề xuất trong mô tả GPU và chọn nguồn có công suất ít nhất bằng mức đó. Nếu CPU không ghi có tản nhiệt kèm theo, chọn tản nhiệt phù hợp trong catalog hoặc hỏi xác nhận. Mỗi linh kiện chính thường có số lượng 1 trừ khi yêu cầu khác. Không chọn màn hình/phụ kiện nếu khách không yêu cầu. Nếu là xây dựng, chọn vật tư và nhân công đúng phạm vi; chỉ ngành xây dựng mới dùng assumedArea, assumedFloors hoặc basis=floor_area khi thiếu quy mô và cần một kịch bản giả định rõ ràng. Mọi ngành có thể dùng basis=explicit nếu số lượng có nguyên văn trong mô tả (evidence chép đúng), hoặc basis=estimated với quantity dương và quantityNote giải thích căn cứ. Không lấy ngân sách chia đơn giá để ép số lượng. Nếu chưa thể ước tính có trách nhiệm, dùng basis=unknown, quantity=null và đặt câu hỏi. missingProducts chỉ gồm sản phẩm/dịch vụ thiết yếu cụ thể không có trong catalog. Nêu mọi giả định; đây là tư vấn sơ bộ. Chỉ trả JSON." },
    { role: "user", content: JSON.stringify({ request: input, scope: plan.scope, needs, planningQuestions: strings(plan.questions, 6), catalog: candidates.map((item) => ({ sku: item.sku, name: item.name, description: item.description?.slice(0, 120), unit: item.unit, price: item.price, currency: item.currency })) }) },
  ], true);
  let result = buildBudgetPlan(input, candidates, raw, catalog.length <= 150 ? [] : shortlist.missing);
  const unresolved = result.lines.filter((line) => line.quantity === null);
  if (unresolved.length) {
    try {
    const estimates = await askCustomerQuoteAi([
      { role: "system", content: "Ước tính số lượng cho các SKU còn thiếu theo đúng ngành hàng, mô tả và đơn vị của catalog. Trả JSON {items:[{sku:string,quantity:number,quantityNote:string}]}. quantity phải dương; quantityNote giải thích căn cứ bằng ít nhất một câu. Với bộ PC, linh kiện chính thường là 1 chiếc mỗi loại trừ khi yêu cầu khác; bảo đảm cấu hình tương thích. Với công trình, vật tư và nhân công cùng việc phải nhất quán. Không lấy ngân sách chia đơn giá để ép số lượng và không tạo SKU. Nếu không đủ căn cứ, bỏ dòng đó khỏi items. Chỉ trả JSON." },
      { role: "user", content: JSON.stringify({ description: input.description, scenario: result.scenario, missingQuantities: unresolved.map((line) => ({ sku: line.sku, name: line.name, unit: line.unit, unitPrice: line.unitPrice })), alreadyEstimated: result.lines.filter((line) => line.quantity !== null).map((line) => ({ sku: line.sku, name: line.name, quantity: line.quantity, unit: line.unit })) }) },
    ], true);
    const bySku = new Map((Array.isArray(estimates.items) ? estimates.items : []).flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const item = entry as Record<string, unknown>;
      return typeof item.sku === "string" ? [[item.sku, item] as const] : [];
    }));
    const expanded = { ...raw, items: (Array.isArray(raw.items) ? raw.items : []).map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const item = entry as Record<string, unknown>;
      const estimate = typeof item.sku === "string" ? bySku.get(item.sku) : undefined;
      return estimate ? { ...item, basis: "estimated", quantity: estimate.quantity, quantityNote: estimate.quantityNote } : entry;
    }) };
    result = buildBudgetPlan(input, candidates, expanded, catalog.length <= 150 ? [] : shortlist.missing);
    } catch {
      // Keep the usable partial plan when the optional quantity pass is unavailable.
    }
  }
  if (result.total === null || result.missingProducts.length || result.questions.length) result.questions = [...new Set([...strings(plan.questions, 6), ...result.questions])].slice(0, 8);
  if (result.questions.length) result.difference = null;
  return result;
}
