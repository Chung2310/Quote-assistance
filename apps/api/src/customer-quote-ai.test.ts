import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { config } from "./config.js";
import { calculateSuggestedQuantity, parseCustomerQuotePrompt, shortlistCatalog, suggestCustomerQuote } from "./customer-quote-ai.js";
import type { CatalogItem } from "./types.js";

test("không đưa mặt hàng không liên quan vào gợi ý xây nhà từ móng", () => {
  const catalog = [
    { sku: "VL-01", name: "Thép xây dựng", description: "", unit: "kg" },
    { sku: "DV-01", name: "Nhân công đào móng", description: "", unit: "công" },
    { sku: "KH-01", name: "Máy pha cà phê", description: "", unit: "cái" },
  ] as CatalogItem[];
  const plan = { scope: "Làm móng", needs: [{ name: "Thép xây dựng", searchTerms: ["thép xây dựng"] }, { name: "Nhân công đào móng", searchTerms: ["đào móng"] }], questions: [] };
  assert.deepEqual(shortlistCatalog(plan, catalog).available.map((item) => item.sku), ["VL-01", "DV-01"]);
  assert.deepEqual(shortlistCatalog(plan, [catalog[2]!]).missing, ["Thép xây dựng", "Nhân công đào móng"]);
});

test("trích xuất số đo được nêu rõ trong prompt tiếng Việt", () => {
  assert.deepEqual(parseCustomerQuotePrompt("Xây nhà 2 tầng, diện tích 80 m² mỗi tầng, dài 10m, rộng 8m, cao 3,5m; ngân sách 1 tỷ."), {
    description: "Xây nhà 2 tầng, diện tích 80 m² mỗi tầng, dài 10m, rộng 8m, cao 3,5m; ngân sách 1 tỷ.",
    floors: 2,
    area: 80,
    length: 10,
    width: 8,
    height: 3.5,
  });
});

test("sửa phòng 6m x 6m chỉ gợi ý lát nền, không gợi ý móng", () => {
  const inputs = parseCustomerQuotePrompt("Sửa phòng sử dụng gạch lát nền xịn. Diên tích 6mx6m, chi phí có thể bỏ ra là 100 triệu.");
  assert.equal(inputs.area, 36);
  assert.equal(inputs.length, 6);
  assert.equal(inputs.width, 6);
  const catalog = [
    { sku: "GACH-01", name: "Gạch lát nền cao cấp", description: "", unit: "m²" },
    { sku: "MONG-01", name: "Nhân công đào móng", description: "", unit: "công" },
    { sku: "BT-01", name: "Bê tông móng", description: "", unit: "m³" },
  ] as CatalogItem[];
  const roomPlan = { scope: "Lát nền phòng", needs: [{ name: "Gạch lát nền cao cấp", searchTerms: ["gạch", "gạch lát nền"] }], questions: [] };
  assert.deepEqual(shortlistCatalog(roomPlan, catalog).available.map((item) => item.sku), ["GACH-01"]);
  assert.equal(calculateSuggestedQuantity("m²", inputs, 1, "floor_area"), 36);
  const foundationPlan = { scope: "Sửa móng nhà", needs: [{ name: "Nhân công đào móng", searchTerms: ["đào móng"] }], questions: [] };
  assert.equal(shortlistCatalog(foundationPlan, catalog).available.some((item) => item.sku === "MONG-01"), true);
});

test("nhận 'mét vuông' và 6×6 m, yêu cầu xác nhận khi diện tích mâu thuẫn", () => {
  const inputs = parseCustomerQuotePrompt("Lát nền phòng 6×6 m bằng Gạch porcelain lát nền, diện tích là 50 mét vuông. chỉ phí có thể bỏ ra là 50 triệu");
  assert.equal(inputs.area, 50);
  assert.equal(inputs.length, 6);
  assert.equal(inputs.width, 6);
  assert.equal(Number.isNaN(calculateSuggestedQuantity("m²", inputs, 1, "floor_area")), true);
  assert.equal(parseCustomerQuotePrompt("Lát nền phòng 6×6 m").area, 36);
});

test("luồng AI giữ đúng phạm vi, hỏi thông tin thiếu và ghi rõ sản phẩm chưa có", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  const responses = [
    { scope: "Lát nền phòng", needs: [{ name: "Gạch lát nền cao cấp", searchTerms: ["gạch", "gạch lát nền"] }, { name: "Keo dán gạch", searchTerms: ["keo dán gạch"] }, { name: "Sàn", searchTerms: [] }], questions: [] },
    { approvedNeeds: ["Gạch lát nền cao cấp", "Keo dán gạch", "Sàn"], approvedSkus: ["GACH-01"], questions: ["Bạn cần bao nhiêu hộp keo dán gạch?", "Bạn có muốn chọn màu gạch không?"] },
    { decisions: [{ need: "Gạch lát nền cao cấp", status: "found", skus: ["GACH-01"] }, { need: "Keo dán gạch", status: "missing", skus: [] }, { need: "Sàn", status: "not_required", skus: [] }] },
    { confirmedMissing: ["Keo dán gạch"] },
  ];
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }), { status: 200 });
  };
  try {
    const catalog = [
      { _id: new ObjectId(), sku: "GACH-01", name: "Gạch lát nền cao cấp", description: "", unit: "m²", price: 100, active: true },
      { _id: new ObjectId(), sku: "MONG-01", name: "Nhân công đào móng", description: "", unit: "công", price: 100, active: true },
    ] as CatalogItem[];
    const result = await suggestCustomerQuote(parseCustomerQuotePrompt("Sửa phòng, lát nền 6mx6m"), catalog);
    assert.equal(requests.length, 4);
    assert.deepEqual(result.items.map((item) => item.catalogItemId), [String(catalog[0]!._id)]);
    assert.equal(result.items[0]!.quantity, 1);
    assert.deepEqual(result.pending, []);
    assert.deepEqual(result.missingProducts, ["Keo dán gạch"]);
    assert.deepEqual(result.questions, []);
  } finally {
    globalThis.fetch = previousFetch;
    config.openRouterApiKey = previousKey;
  }
});

test("đề xuất sản phẩm không cần tính diện tích khi 6×6 m và 50 m² mâu thuẫn", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  const responses = [
    { scope: "Lát nền", needs: [{ name: "Gạch porcelain lát nền", searchTerms: ["gạch porcelain"] }], questions: [] },
    { approvedNeeds: ["Gạch porcelain lát nền"], approvedSkus: ["GACH-01"], questions: ["Bạn cần bao nhiêu m² gạch porcelain?", "Bạn cần bao nhiêu bao keo dán gạch?"] },
    { decisions: [{ need: "Gạch porcelain lát nền", status: "found", skus: ["GACH-01"] }] },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }), { status: 200 });
  try {
    const catalog = [{ _id: new ObjectId(), sku: "GACH-01", name: "Gạch porcelain lát nền", description: "", unit: "m²", price: 100, active: true }] as CatalogItem[];
    const result = await suggestCustomerQuote(parseCustomerQuotePrompt("Lát nền phòng 6×6 m bằng Gạch porcelain lát nền, diện tích là 50 mét vuông. chỉ phí có thể bỏ ra là 50 triệu"), catalog);
    assert.deepEqual(result.items.map((item) => ({ catalogItemId: item.catalogItemId, quantity: item.quantity })), [{ catalogItemId: String(catalog[0]!._id), quantity: 1 }]);
    assert.deepEqual(result.pending, []);
    assert.deepEqual(result.questions, []);
    assert.deepEqual(result.notes, []);
  } finally {
    globalThis.fetch = previousFetch;
    config.openRouterApiKey = previousKey;
  }
});

test("vữa chà ron được đối chiếu với keo chà ron có trong danh mục", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  const responses = [
    { scope: "Lát nền", needs: [{ name: "Vữa chà ron", searchTerms: ["chà ron"] }, { name: "Ron gạch", searchTerms: ["ron gạch"] }], questions: [] },
    { approvedNeeds: ["Vữa chà ron", "Ron gạch"], approvedSkus: ["AP-KEO-CHA-01"], questions: [] },
    { decisions: [{ need: "Vữa chà ron", status: "found", skus: ["AP-KEO-CHA-01"] }, { need: "Ron gạch", status: "found", skus: ["AP-KEO-CHA-01"] }] },
  ];
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }), { status: 200 });
  };
  try {
    const catalog = [
      { _id: new ObjectId(), sku: "AP-KEO-CHA-01", name: "Keo chà ron chống thấm", description: "Gói 1 kg", unit: "gói", price: 49000, active: true },
      { _id: new ObjectId(), sku: "AP-GACH-LAT-600", name: "Gạch porcelain lát nền 600x600", description: "", unit: "m²", price: 245000, active: true },
    ] as CatalogItem[];
    const result = await suggestCustomerQuote(parseCustomerQuotePrompt("Lát lại nền phòng ngủ bằng gạch porcelain. Cần các sản phẩm và vật tư để lát nền, không làm móng hay sơn tường."), catalog);
    assert.equal(requests.length, 3);
    assert.deepEqual(result.items.map((item) => item.catalogItemId), [String(catalog[0]!._id)]);
    assert.deepEqual(result.missingProducts, []);
  } finally {
    globalThis.fetch = previousFetch;
    config.openRouterApiKey = previousKey;
  }
});

test("đối chiếu tên tương đương ở danh mục ngoài xây dựng và báo đúng mục còn thiếu", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = config.openRouterApiKey;
  config.openRouterApiKey = "test-key";
  const responses = [
    { scope: "Trang bị văn phòng", needs: [{ name: "Laptop cho nhân viên", searchTerms: ["laptop"] }, { name: "Tai nghe chống ồn", searchTerms: ["tai nghe chống ồn"] }, { name: "Máy in tem mã vạch", searchTerms: ["máy in tem"] }, { name: "Hub USB", searchTerms: ["hub usb"] }], questions: [] },
    { approvedNeeds: ["Laptop cho nhân viên", "Tai nghe chống ồn", "Máy in tem mã vạch", "Hub USB"], approvedSkus: [] },
    { decisions: [{ need: "Laptop cho nhân viên", status: "found", skus: ["MTXT-01"] }, { need: "Tai nghe chống ồn", status: "found", skus: ["HEADSET-01"] }, { need: "Máy in tem mã vạch", status: "missing", skus: [] }, { need: "Hub USB", status: "missing", skus: [] }] },
    { confirmedMissing: ["Máy in tem mã vạch"] },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }), { status: 200 });
  try {
    const catalog = [
      { _id: new ObjectId(), sku: "MTXT-01", name: "Máy tính xách tay", description: "Thiết bị làm việc di động", unit: "cái", price: 100, active: true },
      { _id: new ObjectId(), sku: "HEADSET-01", name: "Headset ANC", description: "Khử tiếng ồn chủ động", unit: "cái", price: 100, active: true },
      { _id: new ObjectId(), sku: "CAFE-01", name: "Máy pha cà phê", description: "", unit: "cái", price: 100, active: true },
    ] as CatalogItem[];
    const result = await suggestCustomerQuote(parseCustomerQuotePrompt("Mua laptop và tai nghe chống ồn cho nhân viên, thêm máy in tem mã vạch."), catalog);
    assert.deepEqual(result.items.map((item) => item.catalogItemId), [String(catalog[0]!._id), String(catalog[1]!._id)]);
    assert.deepEqual(result.missingProducts, ["Máy in tem mã vạch"]);
  } finally {
    globalThis.fetch = previousFetch;
    config.openRouterApiKey = previousKey;
  }
});

test("không tự suy đoán số đo từ yêu cầu chung", () => {
  assert.deepEqual(parseCustomerQuotePrompt("Tôi cần báo giá xây nhà, ngân sách 1 tỷ đồng."), {
    description: "Tôi cần báo giá xây nhà, ngân sách 1 tỷ đồng.",
    floors: undefined,
    area: undefined,
    length: undefined,
    width: undefined,
    height: undefined,
  });
});

test("tính diện tích, chu vi và thể tích theo hình học công trình", () => {
  const inputs = { length: 10, width: 8, height: 3, floors: 2 };
  assert.equal(calculateSuggestedQuantity("m²", inputs, 1, "floor_area"), 160);
  assert.equal(calculateSuggestedQuantity("m²", inputs, 1, "wall_area"), 216);
  assert.equal(calculateSuggestedQuantity("m³", inputs, 1, "volume"), 480);
  assert.equal(calculateSuggestedQuantity("m", inputs, 1, "perimeter"), 72);
  assert.equal(calculateSuggestedQuantity("bộ", inputs, 4, "count"), 4);
});

test("không tính hạng mục hình học khi thiếu số đo", () => {
  assert.equal(Number.isNaN(calculateSuggestedQuantity("m²", { area: 80 }, 1, "wall_area")), true);
  assert.equal(Number.isNaN(calculateSuggestedQuantity("m³", { length: 10, width: 8 }, 1, "volume")), true);
});
