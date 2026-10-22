import { config } from "./config.js";
import { parseJsonResponse, responseContent } from "./structured-ai.js";
import type { CatalogItem } from "./types.js";

export interface CustomerQuoteInputs {
  budget?: number;
  floors?: number;
  area?: number;
  length?: number;
  width?: number;
  height?: number;
  description?: string;
}

export interface CustomerQuoteSuggestion {
  items: Array<{ catalogItemId: string; quantity: number; unit: string; reason: string }>;
  pending: Array<{ catalogItemId: string; sku: string; name: string; unit: string; reason: string }>;
  missingProducts: string[];
  questions: string[];
  notes: string[];
}

export interface CustomerQuotePlan {
  scope: string;
  needs: Array<{ name: string; searchTerms: string[]; essential?: boolean }>;
  questions: string[];
}

function positive(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum;
}

function normalize(value: string) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

export function parseCustomerQuotePrompt(prompt: string): CustomerQuoteInputs {
  const text = normalize(prompt);
  const read = (pattern: RegExp) => {
    const matched = text.match(pattern)?.[1];
    if (!matched) return undefined;
    const value = Number(matched.replace(",", "."));
    return positive(value, 1_000_000_000) ? value : undefined;
  };
  const dimensions = text.match(/\b(\d+(?:[.,]\d+)?)\s*m?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*m\b/);
  const pairLength = dimensions ? Number(dimensions[1]!.replace(",", ".")) : undefined;
  const pairWidth = dimensions ? Number(dimensions[2]!.replace(",", ".")) : undefined;
  const hasDimensions = positive(pairLength, 1_000_000_000) && positive(pairWidth, 1_000_000_000);
  return {
    description: prompt.trim(),
    floors: read(/\b(\d{1,2})\s*(?:tang|lau)\b/),
    area: read(/\b(?:dien tich(?: san)?|san)\s*(?:la|khoang|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:m2|m²|met vuong)(?=$|[\s,.;])/) ?? (hasDimensions ? Math.round(pairLength! * pairWidth! * 100) / 100 : undefined),
    length: read(/\b(?:chieu dai|dai)\s*(?:la|:)?\s*(\d+(?:[.,]\d+)?)\s*m?\b/) ?? (hasDimensions ? pairLength : undefined),
    width: read(/\b(?:chieu rong|rong)\s*(?:la|:)?\s*(\d+(?:[.,]\d+)?)\s*m?\b/) ?? (hasDimensions ? pairWidth : undefined),
    height: read(/\b(?:chieu cao|cao)\s*(?:la|:)?\s*(\d+(?:[.,]\d+)?)\s*m\b/),
  };
}

const searchStopWords = new Set(["cho", "cua", "voi", "theo", "can", "loai", "hang", "muc", "vat", "tu", "dich", "vu", "thi", "cong"]);

function words(value: string) {
  return [...new Set((normalize(value).match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !searchStopWords.has(word)))];
}

export function shortlistCatalog(plan: CustomerQuotePlan, catalog: CatalogItem[]) {
  const selected = new Map<string, CatalogItem>();
  const missing: string[] = [];
  for (const need of plan.needs) {
    const specificNeed = words(need.name).length >= 2;
    const phrases = [need.name, ...need.searchTerms.filter((term) => !specificNeed || words(term).length >= 2)];
    const ranked = catalog.map((item) => {
      const nameWords = new Set(words(item.name));
      const detailsWords = new Set(words(`${item.description} ${item.sku}`));
      const score = phrases.reduce((best, phrase) => {
        const terms = words(phrase);
        const matched = terms.filter((term) => nameWords.has(term) || detailsWords.has(term));
        return matched.length >= Math.min(2, terms.length) && terms.length ? Math.max(best, matched.reduce((sum, term) => sum + (nameWords.has(term) ? 3 : 1), 0)) : best;
      }, 0);
      return { item, score };
    }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.item.sku.localeCompare(b.item.sku, "vi"));
    if (!ranked.length) missing.push(need.name);
    for (const { item } of ranked.slice(0, 8)) selected.set(item.sku, item);
  }
  return { available: [...selected.values()].slice(0, 80), missing };
}

export async function askCustomerQuoteAi(messages: Array<{ role: string; content: string }>, preferMainModel = false): Promise<Record<string, unknown>> {
  let lastError: unknown;
  const models = preferMainModel ? [config.openRouterModel, config.openRouterFileModel] : [config.openRouterFileModel, config.openRouterModel];
  for (const model of [...new Set(models)]) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": config.openRouterSiteUrl,
          "X-Title": config.openRouterAppName,
        },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 4000, response_format: { type: "json_object" }, messages }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`Dịch vụ AI tạm thời không khả dụng (HTTP ${response.status}).`);
      const parsed = parseJsonResponse(responseContent(await response.json()));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AI trả về dữ liệu không hợp lệ.");
      return parsed as Record<string, unknown>;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Không thể tạo đề xuất bằng AI.");
}

function parsePlan(raw: Record<string, unknown>): CustomerQuotePlan {
  const needs = Array.isArray(raw.needs) ? raw.needs.slice(0, 20).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name.trim() || row.essential === false) return [];
    return [{ name: row.name.trim().slice(0, 120), searchTerms: Array.isArray(row.searchTerms) ? row.searchTerms.filter((term): term is string => typeof term === "string").slice(0, 6).map((term) => term.slice(0, 80)) : [] }];
  }) : [];
  return {
    scope: typeof raw.scope === "string" ? raw.scope.slice(0, 300) : "",
    needs,
    questions: Array.isArray(raw.questions) ? raw.questions.filter((question): question is string => typeof question === "string").slice(0, 8).map((question) => question.slice(0, 250)) : [],
  };
}

export function calculateSuggestedQuantity(unit: string, inputs: CustomerQuoteInputs, proposed: number, basis?: string) {
  const normalized = unit.toLowerCase().replace(/\s/g, "");
  const floorCount = inputs.floors ?? 1;
  const footprint = inputs.area ?? (inputs.length && inputs.width ? inputs.length * inputs.width : undefined);
  const perimeter = inputs.length && inputs.width ? 2 * (inputs.length + inputs.width) : undefined;
  if (hasAreaConflict(inputs) && ["floor_area", "wall_area", "volume", "perimeter"].includes(basis ?? "")) return NaN;
  if (["m²", "m2"].includes(normalized) && basis === "floor_area" && footprint) return Math.round(footprint * floorCount * 100) / 100;
  if (["m²", "m2"].includes(normalized) && basis === "wall_area" && perimeter && inputs.height) return Math.round(perimeter * inputs.height * floorCount * 100) / 100;
  if (["m³", "m3"].includes(normalized) && basis === "volume" && footprint && inputs.height) return Math.round(footprint * floorCount * inputs.height * 100) / 100;
  if (normalized === "m" && basis === "perimeter" && perimeter) return Math.round(perimeter * floorCount * 100) / 100;
  if (basis && basis !== "count") return NaN;
  return proposed;
}

function hasAreaConflict(inputs: CustomerQuoteInputs) {
  return Boolean(inputs.area && inputs.length && inputs.width && Math.abs(inputs.area - inputs.length * inputs.width) > 0.01);
}

export async function suggestCustomerQuote(inputs: CustomerQuoteInputs, catalog: CatalogItem[]): Promise<CustomerQuoteSuggestion> {
  if (!config.openRouterApiKey) throw new Error("Chưa cấu hình AI để đề xuất hạng mục. Bạn vẫn có thể chọn sản phẩm thủ công.");
  const plan = parsePlan(await askCustomerQuoteAi([
    { role: "system", content: "Đọc yêu cầu khách và xác định các LOẠI SẢN PHẨM khách cần mua hoặc dịch vụ khách cần thuê để đáp ứng đúng yêu cầu. Trả JSON {scope:string,needs:[{name:string,searchTerms:string[],essential:boolean}],questions:string[]}. Chỉ ghi mỗi công dụng một lần, tối đa 15 needs; tên đồng nghĩa ghi vào searchTerms, không lập thành need riêng. Bao gồm vật tư hoàn thiện chuyên dụng thật sự cần thiết. Loại bỏ toàn bộ dụng cụ làm việc, thiết bị bảo hộ, vật tư hỗ trợ thi công, tài nguyên dùng chung và phụ kiện tùy chọn, trừ khi khách yêu cầu mua chính chúng. Không tự thêm công đoạn ngoài phạm vi, kể cả điều kiện chưa được xác nhận. Áp dụng cho mọi lĩnh vực, không suy diễn là xây dựng. Không tính số lượng, đơn giá hoặc chi phí. Chỉ trả JSON." },
    { role: "user", content: inputs.description ?? "" },
  ]));
  const candidates = shortlistCatalog(plan, catalog);
  const audit = await askCustomerQuoteAi([
    { role: "system", content: "Kiểm tra độc lập phạm vi hàng khách cần mua hoặc dịch vụ khách cần thuê. Trả JSON {approvedNeeds:[string],approvedSkus:[string]}. approvedNeeds chỉ gồm nhu cầu thật sự cần thiết, kể cả khi chưa có SKU; loại công cụ thi công, đồ bảo hộ, vật tư phụ trợ, tài nguyên dùng chung và mặt hàng ngoài phạm vi trừ khi khách yêu cầu mua chính chúng. Nếu hai need cùng công dụng, chỉ giữ một need; tên gọi khác nhau không tạo thêm hàng thiếu. approvedSkus là SKU ứng viên đáp ứng đúng công dụng, kể cả tên khác. Không chọn chỉ vì trùng từ. Sao chép chính xác tên need và SKU từ đầu vào. Không tính số lượng, giá hoặc chi phí. Chỉ trả JSON." },
    { role: "user", content: JSON.stringify({ request: inputs.description, scope: plan.scope, needs: plan.needs, candidates: candidates.available.map((item) => ({ sku: item.sku, name: item.name, description: item.description?.slice(0, 120), unit: item.unit })) }) },
  ], true);
  if (!Array.isArray(audit.approvedNeeds) || !Array.isArray(audit.approvedSkus)) throw new Error("AI chưa xác nhận được phạm vi hạng mục.");
  const approvedNames = new Set(audit.approvedNeeds.filter((name): name is string => typeof name === "string").map(normalize));
  const approvedSkus = new Set(audit.approvedSkus.filter((sku): sku is string => typeof sku === "string"));
  const auditedPlan = { ...plan, needs: plan.needs.filter((need) => approvedNames.has(normalize(need.name))) };
  const selection = await askCustomerQuoteAi([
    { role: "system", content: "Lập danh sách sản phẩm khách cần mua theo đúng yêu cầu. Trả JSON {decisions:[{need:string,status:string,skus:string[]}]}. Xét TỪNG need và trả đúng một quyết định: found nếu SKU trong catalog đáp ứng đúng công dụng, missing CHỈ nếu đây là loại hàng bắt buộc phải mua mà toàn bộ catalog không có sản phẩm thay thế tương đương, not_required nếu là tên khác của need đã đáp ứng, dụng cụ làm việc, đồ bảo hộ, vật tư hỗ trợ, tài nguyên dùng chung hoặc công việc ngoài phạm vi. Không báo thiếu một tên khác của sản phẩm đã chọn; ví dụ laptop và máy tính xách tay là cùng một loại hàng. Một SKU có thể đáp ứng nhiều need đồng nghĩa. Xét tên, mô tả và công dụng của toàn bộ catalog, không chọn vì chỉ trùng từ. Ưu tiên SKU đã kiểm tra trước. Không tính số lượng, giá hay chi phí. Sao chép chính xác need và SKU từ đầu vào. Chỉ trả JSON." },
    { role: "user", content: JSON.stringify({ request: inputs.description, scope: auditedPlan.scope, needs: auditedPlan.needs.map((need) => need.name), preferredSkus: [...approvedSkus], catalog: catalog.map((item) => ({ sku: item.sku, name: item.name, description: item.description?.slice(0, 100) })) }) },
  ], true);
  if (!Array.isArray(selection.decisions)) throw new Error("AI chưa đối chiếu được danh sách sản phẩm.");
  const catalogBySku = new Map(catalog.map((item) => [item.sku, item]));
  const selectedSkus = new Set<string>();
  const missingProducts: string[] = [];
  const decidedNames = new Set<string>();
  for (const entry of selection.decisions.slice(0, auditedPlan.needs.length * 2)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.need !== "string" || !approvedNames.has(normalize(row.need))) continue;
    const needName = row.need;
    const name = auditedPlan.needs.find((need) => normalize(need.name) === normalize(needName))!.name;
    if (decidedNames.has(normalize(name))) continue;
    decidedNames.add(normalize(name));
    const skus: string[] = Array.isArray(row.skus) ? row.skus.filter((sku: unknown): sku is string => typeof sku === "string" && catalogBySku.has(sku)) : [];
    if (row.status === "found" && skus.length) {
      for (const sku of skus) selectedSkus.add(sku);
    } else if (row.status === "missing") {
      missingProducts.push(name);
    }
  }
  if (decidedNames.size !== auditedPlan.needs.length) throw new Error("AI chưa đối chiếu đủ các sản phẩm cần dùng. Vui lòng thử lại.");
  let confirmedMissing = missingProducts;
  if (missingProducts.length) {
    const review = await askCustomerQuoteAi([
      { role: "system", content: "Rà soát lần cuối các tên sản phẩm bị báo thiếu. Trả JSON {confirmedMissing:[string]}. Chỉ giữ tên của loại hàng hoặc dịch vụ THẬT SỰ CẦN để đáp ứng yêu cầu khách, không có sản phẩm tương đương trong catalog và chưa được sản phẩm đã chọn đáp ứng. Loại mọi tên đồng nghĩa với sản phẩm đã chọn, phụ kiện tùy chọn, công cụ làm việc, đồ bảo hộ, vật tư hỗ trợ, tài nguyên dùng chung và hạng mục chỉ cần trong điều kiện khách chưa nêu. Đánh giá độc lập từng tên dựa trên yêu cầu thực tế; không mặc định lĩnh vực. Sao chép chính xác tên từ missingCandidates, không thêm tên mới. Chỉ trả JSON." },
      { role: "user", content: JSON.stringify({ request: inputs.description, scope: auditedPlan.scope, missingCandidates: missingProducts, selectedProducts: catalog.filter((item) => selectedSkus.has(item.sku)).map((item) => ({ sku: item.sku, name: item.name, description: item.description?.slice(0, 100) })), catalog: catalog.map((item) => ({ sku: item.sku, name: item.name, description: item.description?.slice(0, 100) })) }) },
    ]);
    if (!Array.isArray(review.confirmedMissing)) throw new Error("AI chưa xác nhận được sản phẩm còn thiếu. Vui lòng thử lại.");
    const confirmedNames = new Set(review.confirmedMissing.filter((name): name is string => typeof name === "string").map(normalize));
    confirmedMissing = missingProducts.filter((name) => confirmedNames.has(normalize(name)));
  }
  return {
    items: catalog.filter((item) => selectedSkus.has(item.sku)).map((item) => ({ catalogItemId: String(item._id), quantity: 1, unit: item.unit, reason: "Phù hợp yêu cầu" })),
    pending: [], missingProducts: [...new Set(confirmedMissing)].slice(0, 20), questions: [], notes: [],
  };
}
