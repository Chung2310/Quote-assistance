import "dotenv/config";
import { ObjectId } from "mongodb";
import type { CatalogItem } from "../apps/api/src/types.js";

async function main() {
const { parseCustomerQuotePrompt, suggestCustomerQuote } = await import("../apps/api/src/customer-quote-ai.js");
const providerFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await providerFetch(input, init);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) as { messages?: Array<{ content?: string }> } : {};
  if (response.ok && body.messages?.[0]?.content?.includes("Chỉ trả JSON")) {
    const data = await response.clone().json() as { choices?: Array<{ message?: { content?: string } }> };
    try {
      const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "") as { needs?: Array<{ name?: string }>; approvedNeeds?: string[]; approvedSkus?: string[]; decisions?: unknown[]; confirmedMissing?: string[] };
      process.stdout.write(`${parsed.needs ? "PLAN" : parsed.decisions ? "MATCH" : parsed.confirmedMissing ? "REVIEW" : "AUDIT"}: ${JSON.stringify(parsed.needs ? parsed.needs.map((need) => need.name) : parsed.decisions ?? parsed.confirmedMissing ?? { needs: parsed.approvedNeeds, skus: parsed.approvedSkus })}\n`);
    } catch { /* The application handles invalid AI responses. */ }
  }
  return response;
};

const products = [
  ["GACH-LAT-CAO-CAP", "Gạch lát nền cao cấp", "Gạch porcelain lát sàn", "m²", 480_000],
  ["KEO-DAN-GACH", "Keo dán gạch", "Keo dùng cho gạch lát nền", "bao", 220_000],
  ["AP-KEO-CHA-01", "Keo chà ron chống thấm", "Gói 1 kg; màu trắng", "gói", 49_000],
  ["NC-LAT-NEN", "Nhân công lát nền", "Thi công lát gạch nền", "m²", 180_000],
  ["BT-MONG", "Bê tông móng", "Bê tông dùng cho phần móng", "m³", 1_450_000],
  ["THEP-XAY-DUNG", "Thép xây dựng", "Thép cốt bê tông", "kg", 18_000],
  ["NC-DAO-MONG", "Nhân công đào móng", "Đào đất và thi công móng", "công", 450_000],
  ["SON-NOI-THAT", "Sơn nội thất", "Sơn tường trong nhà", "m²", 55_000],
  ["NC-SON-TUONG", "Nhân công sơn tường", "Thi công sơn tường", "m²", 45_000],
  ["MAY-LANH-15", "Máy lạnh inverter 1.5 HP", "Điều hòa cho phòng 15–20 m²", "bộ", 10_900_000],
  ["LAP-DAT-MAY-LANH", "Nhân công lắp đặt máy lạnh", "Lắp máy lạnh treo tường", "bộ", 450_000],
  ["ONG-DONG", "Ống đồng máy lạnh", "Ống đồng tính theo mét", "m", 165_000],
  ["GHE-VAN-PHONG", "Ghế văn phòng công thái học", "Ghế lưng lưới", "cái", 2_850_000],
  ["GIAY-A4", "Giấy in A4", "Giấy in 80gsm", "ream", 82_000],
  ["MTXT-01", "Máy tính xách tay", "Thiết bị làm việc di động", "cái", 18_000_000],
  ["HEADSET-01", "Headset ANC", "Tai nghe khử tiếng ồn chủ động", "cái", 2_000_000],
] as const;

const catalog = products.map(([sku, name, description, unit, price]) => ({
  _id: new ObjectId(), companyId: "smoke-test", sku, name, description, unit, price,
  currency: "VND", active: true, createdAt: new Date(), updatedAt: new Date(),
})) satisfies CatalogItem[];

const prompts = [
  "Sửa phòng sử dụng gạch lát nền xịn. Diên tích 6mx6m, chi phí có thể bỏ ra là 100 triệu.",
  "Xây nhà 2 tầng từ móng, diện tích 80 m² mỗi tầng, ngân sách 1,5 tỷ. Cần báo giá phần thô.",
  "Sơn lại phòng ngủ, diện tích sàn 20 m². Tôi chưa đo chiều cao và diện tích tường.",
  "Lắp 2 máy lạnh inverter 1.5 HP cho hai phòng khoảng 18 m², chưa biết chiều dài ống đồng.",
  "Mua 10 ghế văn phòng công thái học cho nhân viên, không cần giấy in hay vật tư khác.",
  "Lát nền phòng 6×6 m bằng Gạch porcelain lát nền, diện tích là 50 mét vuông. chỉ phí có thể bỏ ra là 50 triệu",
  "Lát lại nền phòng ngủ bằng gạch porcelain. Cần các sản phẩm và vật tư để lát nền, không làm móng hay sơn tường.",
  "Cần laptop và tai nghe chống ồn cho nhân viên văn phòng. Danh mục hiện có những sản phẩm nào phù hợp?",
  "Cần một máy in tem mã vạch cho kho hàng.",
];

for (const [index, prompt] of prompts.entries()) {
  if (process.argv[2] && Number(process.argv[2]) !== index + 1) continue;
  process.stdout.write(`CASE ${index + 1}: ${prompt}\n`);
  try {
    const result = await suggestCustomerQuote(parseCustomerQuotePrompt(prompt), catalog);
    process.stdout.write(`${JSON.stringify({
      items: result.items.map((item) => ({ name: catalog.find((product) => String(product._id) === item.catalogItemId)?.name, quantity: item.quantity })),
      pending: result.pending.map((item) => ({ name: item.name, reason: item.reason })),
      missingProducts: result.missingProducts,
      questions: result.questions,
      notes: result.notes,
    }, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
