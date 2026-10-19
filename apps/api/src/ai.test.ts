import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import { analyzeRequest } from "./ai.js";
import { config } from "./config.js";
import type { CatalogItem } from "./types.js";

function catalogItem(id: string, sku: string, name: string, unit: string): CatalogItem {
  const now = new Date("2026-10-19T00:00:00.000Z");
  return {
    _id: new ObjectId(id),
    companyId: "company-a",
    sku,
    name,
    description: "",
    unit,
    price: 1000,
    currency: "VND",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

test("recovers explicit catalog lines when AI incorrectly returns not_found", async (t) => {
  const previousKey = config.openRouterApiKey;
  const previousTaxRate = config.taxRate;
  config.openRouterApiKey = "test-only";
  config.taxRate = 0;
  t.after(() => { config.openRouterApiKey = previousKey; config.taxRate = previousTaxRate; });
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ status: "not_found", items: [], missingFields: [], suggestedProducts: [] }) } }],
  }), { status: 200 }));

  const candidates = [
    catalogItem("6ad2d3294b41809344e1baaf", "AP-GACH-LAT-600", "Gạch porcelain lát nền 600x600", "m²"),
    catalogItem("6ad2d3294b41809344e1bab4", "AP-KEO-CHA-01", "Keo chà ron chống thấm", "gói"),
    catalogItem("6ad2d2f74b41809344e1ba2d", "AP-NC-LAT-GACH", "Nhân công lát gạch nền", "m²"),
    catalogItem("6ad2d3294b41809344e1bab1", "AP-GACH-OP-300", "Gạch ceramic ốp tường 300x600", "m²"),
    catalogItem("6ad2d3294b41809344e1bab2", "AP-GACH-MOSAIC", "Gạch mosaic thủy tinh", "m²"),
    catalogItem("6ad2d2f74b41809344e1ba2e", "AP-NC-OP-GACH", "Nhân công ốp gạch tường", "m²"),
    catalogItem("6ad2d3294b41809344e1baba", "AP-THACH-CAO-09", "Tấm thạch cao tiêu chuẩn 9 mm", "tấm"),
    catalogItem("6ad2d3294b41809344e1babb", "AP-KHUNG-TRAN-01", "Khung xương trần thạch cao", "m²"),
    catalogItem("6ad2d2f74b41809344e1ba31", "AP-NC-TRAN-THACH-CAO", "Nhân công lắp trần thạch cao phẳng", "m²"),
    catalogItem("6ad2d3294b41809344e1bab5", "AP-SON-LOT-18", "Sơn lót kháng kiềm nội thất", "thùng"),
    catalogItem("6ad2d3294b41809344e1bab7", "AP-SON-PHU-18", "Sơn phủ nội thất lau chùi", "thùng"),
    catalogItem("6ad2d2f74b41809344e1ba2f", "AP-NC-SON-NOI", "Nhân công sơn nước nội thất", "m²"),
    catalogItem("6ad2d3294b41809344e1bac7", "AP-DEN-LED-9W", "Đèn LED âm trần 9W", "cái"),
    catalogItem("6ad2d2f74b41809344e1ba36", "AP-NC-LAP-DEN", "Nhân công lắp đèn chiếu sáng", "cái"),
    catalogItem("6ad2d2f74b41809344e1ba3c", "AP-DV-VAN-CHUYEN", "Vận chuyển vật liệu nội thành", "chuyến"),
  ];
  const request = `Cần báo giá cải tạo căn hộ tại TP. Thủ Đức. Vui lòng tách riêng từng dòng vật tư và nhân công, giữ nguyên đơn vị và đơn giá theo bảng giá đã tải lên. Không gộp thành gói và không tự đoán giá.

1. Lát nền phòng khách và phòng ngủ:
- Gạch porcelain lát nền 600x600: 74 m²
- Keo chà ron chống thấm: 15 gói
- Nhân công lát gạch nền: 74 m²

2. Ốp tường và trang trí khu vực lavabo:
- Gạch ceramic ốp tường 300x600: 24 m²
- Gạch mosaic thủy tinh làm mảng trang trí: 5 m²
- Nhân công ốp gạch tường: 24 m²
- Nếu bảng giá có nhân công ốp mosaic riêng: 20 m²

3. Làm trần phòng khách và hành lang:
- Tấm thạch cao tiêu chuẩn 9 mm: 20 tấm
- Khung xương trần thạch cao: 48 m²
- Nhân công lắp trần thạch cao phẳng: 48 m²

4. Sơn nội thất diện tích 200 m²:
- Sơn lót kháng kiềm nội thất: 2 thùng
- Sơn phủ nội thất lau chùi: 4 thùng
- Nhân công sơn nước nội thất: 200 m²

5. Chiếu sáng:
- Đèn LED âm trần 9W: 16 cái
- Nhân công lắp đèn chiếu sáng: 16 cái

Vui lòng báo riêng phí vận chuyển và VAT nếu có đơn giá trong bảng giá; nếu chưa có thì liệt kê là thông tin cần xác nhận. Báo giá có hiệu lực 30 ngày. Dự kiến hoàn thành trước ngày 30/11/2026.`;

  const result = await analyzeRequest(request, candidates);

  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.items.map(({ catalogItemId, quantity, unit }) => ({ catalogItemId, quantity, unit })), [
    { catalogItemId: String(candidates[0]!._id), quantity: 74, unit: "m²" },
    { catalogItemId: String(candidates[1]!._id), quantity: 15, unit: "gói" },
    { catalogItemId: String(candidates[2]!._id), quantity: 74, unit: "m²" },
    { catalogItemId: String(candidates[3]!._id), quantity: 24, unit: "m²" },
    { catalogItemId: String(candidates[4]!._id), quantity: 5, unit: "m²" },
    { catalogItemId: String(candidates[5]!._id), quantity: 24, unit: "m²" },
    { catalogItemId: String(candidates[6]!._id), quantity: 20, unit: "tấm" },
    { catalogItemId: String(candidates[7]!._id), quantity: 48, unit: "m²" },
    { catalogItemId: String(candidates[8]!._id), quantity: 48, unit: "m²" },
    { catalogItemId: String(candidates[9]!._id), quantity: 2, unit: "thùng" },
    { catalogItemId: String(candidates[10]!._id), quantity: 4, unit: "thùng" },
    { catalogItemId: String(candidates[11]!._id), quantity: 200, unit: "m²" },
    { catalogItemId: String(candidates[12]!._id), quantity: 16, unit: "cái" },
    { catalogItemId: String(candidates[13]!._id), quantity: 16, unit: "cái" },
  ]);
  assert.equal(result.items.some((item) => item.catalogItemId === String(candidates[14]!._id)), false);
  assert.deepEqual(result.missingFields, ["Xác nhận phí vận chuyển", "Xác nhận mức VAT áp dụng"]);
});
