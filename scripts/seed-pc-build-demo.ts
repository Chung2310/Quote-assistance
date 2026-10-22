import "dotenv/config";
import { createHash } from "node:crypto";
import { Binary, MongoClient, ObjectId } from "mongodb";
import * as XLSX from "xlsx";
import { config } from "../apps/api/src/config.js";
import { hashPassword, verifyPassword } from "../apps/api/src/password.js";
import type { CatalogItem, Company, UserAccount } from "../apps/api/src/types.js";
import type { PriceList } from "../apps/api/src/price-list.js";

const email = "pcbuild.demo@example.test";
const companyCode = "demo-pc-build";
const accountId = "demo-pc-build-user";
const companyName = "PC Build Demo";
type Row = [name: string, description: string, price: number];

// Sản phẩm và giá hoàn toàn minh họa, dùng để thử luồng báo giá build PC.
const groups: Array<[code: string, category: string, rows: Row[]]> = [
  ["CPU", "Bộ xử lý", [
    ["CPU AM5 6 nhân 65W", "Socket AM5; 6 nhân 12 luồng; DDR5; phù hợp văn phòng và gaming phổ thông", 4_500_000],
    ["CPU AM5 8 nhân 65W", "Socket AM5; 8 nhân 16 luồng; DDR5; đa nhiệm và gaming", 6_800_000],
    ["CPU AM5 8 nhân 105W", "Socket AM5; 8 nhân 16 luồng; DDR5; hiệu năng cao", 8_400_000],
    ["CPU AM5 12 nhân 120W", "Socket AM5; 12 nhân 24 luồng; DDR5; dựng hình và render", 11_900_000],
    ["CPU LGA1700 4 nhân 65W", "Socket LGA1700; 4 nhân 8 luồng; làm việc văn phòng", 2_200_000],
    ["CPU LGA1700 6 nhân 65W", "Socket LGA1700; 6 nhân 12 luồng; làm việc và gaming", 3_700_000],
    ["CPU LGA1700 10 nhân 65W", "Socket LGA1700; 10 nhân 16 luồng; đa nhiệm", 5_600_000],
    ["CPU LGA1700 16 nhân 125W", "Socket LGA1700; 16 nhân 24 luồng; đồ họa và render", 9_800_000],
  ]],
  ["MB", "Bo mạch chủ", [
    ["Mainboard AM5 A620 mATX", "Socket AM5; RAM DDR5; kích thước mATX; M.2 NVMe", 2_200_000],
    ["Mainboard AM5 B650 mATX", "Socket AM5; RAM DDR5; kích thước mATX; 2 khe M.2", 3_400_000],
    ["Mainboard AM5 B650 ATX Wi-Fi", "Socket AM5; RAM DDR5; kích thước ATX; Wi-Fi tích hợp", 4_600_000],
    ["Mainboard AM5 X670 ATX", "Socket AM5; RAM DDR5; kích thước ATX; mở rộng cao", 6_800_000],
    ["Mainboard LGA1700 H610 mATX DDR4", "Socket LGA1700; RAM DDR4; kích thước mATX", 1_700_000],
    ["Mainboard LGA1700 B760 mATX DDR4", "Socket LGA1700; RAM DDR4; kích thước mATX; M.2 NVMe", 2_600_000],
    ["Mainboard LGA1700 B760 ATX DDR5", "Socket LGA1700; RAM DDR5; kích thước ATX; 2 khe M.2", 3_900_000],
    ["Mainboard LGA1700 Z790 ATX DDR5", "Socket LGA1700; RAM DDR5; kích thước ATX; mở rộng cao", 6_200_000],
  ]],
  ["RAM", "Bộ nhớ RAM", [
    ["RAM DDR4 8GB 3200", "1 thanh 8GB; DDR4 3200; máy bàn", 550_000],
    ["RAM DDR4 16GB 3200", "1 thanh 16GB; DDR4 3200; máy bàn", 950_000],
    ["RAM DDR4 32GB 3200", "1 thanh 32GB; DDR4 3200; máy bàn", 1_750_000],
    ["RAM DDR4 32GB kit 2x16GB", "Bộ 2 thanh 16GB; tổng 32GB; DDR4 3200", 1_950_000],
    ["RAM DDR5 8GB 4800", "1 thanh 8GB; DDR5 4800; máy bàn", 750_000],
    ["RAM DDR5 16GB 5600", "1 thanh 16GB; DDR5 5600; máy bàn", 1_250_000],
    ["RAM DDR5 32GB 5600", "1 thanh 32GB; DDR5 5600; máy bàn", 2_350_000],
    ["RAM DDR5 32GB kit 2x16GB 6000", "Bộ 2 thanh 16GB; tổng 32GB; DDR5 6000", 2_650_000],
  ]],
  ["SSD", "Ổ lưu trữ", [
    ["SSD SATA 240GB 2.5 inch", "Ổ SSD SATA 2.5 inch; 240GB; lưu hệ điều hành", 480_000],
    ["SSD SATA 480GB 2.5 inch", "Ổ SSD SATA 2.5 inch; 480GB", 750_000],
    ["SSD SATA 1TB 2.5 inch", "Ổ SSD SATA 2.5 inch; 1TB", 1_400_000],
    ["SSD NVMe PCIe 3.0 500GB", "Ổ M.2 NVMe PCIe 3.0; 500GB", 850_000],
    ["SSD NVMe PCIe 3.0 1TB", "Ổ M.2 NVMe PCIe 3.0; 1TB", 1_400_000],
    ["SSD NVMe PCIe 4.0 500GB", "Ổ M.2 NVMe PCIe 4.0; 500GB", 1_050_000],
    ["SSD NVMe PCIe 4.0 1TB", "Ổ M.2 NVMe PCIe 4.0; 1TB", 1_850_000],
    ["SSD NVMe PCIe 4.0 2TB", "Ổ M.2 NVMe PCIe 4.0; 2TB", 3_400_000],
  ]],
  ["GPU", "Card đồ họa", [
    ["Card đồ họa 4GB tiết kiệm điện", "GPU rời 4GB; xuất hình đa màn hình; nguồn đề xuất 450W", 2_900_000],
    ["Card đồ họa 6GB phổ thông", "GPU rời 6GB; gaming cơ bản; nguồn đề xuất 500W", 4_200_000],
    ["Card đồ họa 8GB 1080p", "GPU rời 8GB; gaming 1080p; nguồn đề xuất 550W", 6_300_000],
    ["Card đồ họa 8GB 1440p", "GPU rời 8GB; gaming 1440p; nguồn đề xuất 650W", 8_900_000],
    ["Card đồ họa 12GB 1440p", "GPU rời 12GB; gaming 1440p; nguồn đề xuất 650W", 10_800_000],
    ["Card đồ họa 16GB dựng hình", "GPU rời 16GB; đồ họa và dựng hình; nguồn đề xuất 750W", 15_500_000],
    ["Card đồ họa 16GB gaming cao cấp", "GPU rời 16GB; gaming độ phân giải cao; nguồn đề xuất 750W", 18_900_000],
    ["Card đồ họa 24GB workstation", "GPU rời 24GB; render và AI; nguồn đề xuất 850W", 32_000_000],
  ]],
  ["PSU", "Nguồn máy tính", [
    ["Nguồn ATX 450W", "Công suất 450W; chuẩn ATX; đầu cấp nguồn cơ bản", 850_000],
    ["Nguồn ATX 500W 80 Plus Bronze", "Công suất 500W; chứng nhận 80 Plus Bronze", 1_150_000],
    ["Nguồn ATX 550W 80 Plus Bronze", "Công suất 550W; chứng nhận 80 Plus Bronze", 1_350_000],
    ["Nguồn ATX 650W 80 Plus Bronze", "Công suất 650W; chứng nhận 80 Plus Bronze", 1_650_000],
    ["Nguồn ATX 650W 80 Plus Gold", "Công suất 650W; chứng nhận 80 Plus Gold", 2_100_000],
    ["Nguồn ATX 750W 80 Plus Gold", "Công suất 750W; chứng nhận 80 Plus Gold", 2_500_000],
    ["Nguồn ATX 850W 80 Plus Gold", "Công suất 850W; chứng nhận 80 Plus Gold", 3_100_000],
    ["Nguồn ATX 1000W 80 Plus Gold", "Công suất 1000W; chứng nhận 80 Plus Gold", 4_200_000],
  ]],
  ["CASE", "Vỏ máy tính", [
    ["Case mini tower mATX cơ bản", "Vỏ máy hỗ trợ mainboard mATX; không kèm nguồn", 650_000],
    ["Case mini tower mATX thoáng khí", "Vỏ máy hỗ trợ mATX; mặt trước lưới", 900_000],
    ["Case mATX kính cường lực", "Vỏ máy hỗ trợ mATX; hông kính; không kèm nguồn", 1_050_000],
    ["Case mATX kèm 3 quạt", "Vỏ máy hỗ trợ mATX; kèm 3 quạt", 1_250_000],
    ["Case mid tower ATX cơ bản", "Vỏ máy hỗ trợ ATX và mATX; không kèm nguồn", 950_000],
    ["Case mid tower ATX airflow", "Vỏ máy hỗ trợ ATX và mATX; mặt trước lưới", 1_350_000],
    ["Case mid tower ATX kèm 4 quạt", "Vỏ máy hỗ trợ ATX và mATX; kèm 4 quạt", 1_850_000],
    ["Case full tower ATX", "Vỏ máy lớn hỗ trợ ATX; dành cho nhiều ổ và GPU dài", 2_900_000],
  ]],
  ["COOL", "Tản nhiệt", [
    ["Tản nhiệt khí socket AM5 cơ bản", "Tản nhiệt CPU khí; tương thích socket AM5; CPU tối đa 65W", 450_000],
    ["Tản nhiệt khí socket AM5 120mm", "Tản nhiệt CPU khí; tương thích AM5; quạt 120mm", 850_000],
    ["Tản nhiệt khí socket AM5 2 tháp", "Tản nhiệt CPU khí hai tháp; tương thích AM5; CPU hiệu năng cao", 1_500_000],
    ["Tản nhiệt nước AIO 240mm AM5", "Tản nhiệt CPU nước khép kín 240mm; tương thích AM5; cần case hỗ trợ", 2_300_000],
    ["Tản nhiệt khí socket LGA1700 cơ bản", "Tản nhiệt CPU khí; tương thích LGA1700; CPU tối đa 65W", 450_000],
    ["Tản nhiệt khí socket LGA1700 120mm", "Tản nhiệt CPU khí; tương thích LGA1700; quạt 120mm", 850_000],
    ["Tản nhiệt khí socket LGA1700 2 tháp", "Tản nhiệt CPU khí hai tháp; tương thích LGA1700; CPU hiệu năng cao", 1_500_000],
    ["Tản nhiệt nước AIO 240mm LGA1700", "Tản nhiệt CPU nước khép kín 240mm; tương thích LGA1700; cần case hỗ trợ", 2_300_000],
  ]],
  ["MON", "Màn hình", [
    ["Màn hình 22 inch Full HD 75Hz", "Màn hình 22 inch; Full HD; 75Hz; HDMI", 2_100_000],
    ["Màn hình 24 inch Full HD 75Hz", "Màn hình 24 inch; Full HD; 75Hz; HDMI", 2_450_000],
    ["Màn hình 24 inch Full HD 100Hz", "Màn hình 24 inch; Full HD; 100Hz; HDMI", 2_850_000],
    ["Màn hình 24 inch Full HD 165Hz", "Màn hình 24 inch; Full HD; 165Hz; HDMI và DisplayPort", 3_700_000],
    ["Màn hình 27 inch Full HD 100Hz", "Màn hình 27 inch; Full HD; 100Hz; HDMI", 3_500_000],
    ["Màn hình 27 inch QHD 75Hz", "Màn hình 27 inch; QHD 2560x1440; 75Hz", 4_800_000],
    ["Màn hình 27 inch QHD 165Hz", "Màn hình 27 inch; QHD 2560x1440; 165Hz", 6_500_000],
    ["Màn hình 32 inch 4K 60Hz", "Màn hình 32 inch; 4K; 60Hz; dùng cho đồ họa", 9_500_000],
  ]],
  ["KB", "Bàn phím", [
    ["Bàn phím USB văn phòng", "Bàn phím có dây USB; bố cục đầy đủ", 180_000],
    ["Bàn phím không dây văn phòng", "Bàn phím không dây; bố cục đầy đủ", 390_000],
    ["Bàn phím cơ 87 phím", "Bàn phím cơ TKL 87 phím; kết nối USB", 850_000],
    ["Bàn phím cơ full size", "Bàn phím cơ đủ phím; kết nối USB", 1_150_000],
    ["Bàn phím cơ 75% không dây", "Bàn phím cơ 75%; kết nối không dây", 1_350_000],
    ["Bàn phím cơ low profile", "Bàn phím cơ mỏng; dùng văn phòng", 1_500_000],
    ["Bàn phím gaming RGB", "Bàn phím gaming có đèn RGB; USB", 980_000],
    ["Bàn phím công thái học", "Bàn phím chia vùng; hỗ trợ tư thế gõ", 1_800_000],
  ]],
  ["MOUSE", "Chuột", [
    ["Chuột USB văn phòng", "Chuột quang có dây USB", 120_000],
    ["Chuột không dây văn phòng", "Chuột không dây 2.4GHz", 280_000],
    ["Chuột Bluetooth gọn nhẹ", "Chuột Bluetooth cho làm việc", 420_000],
    ["Chuột gaming có dây", "Chuột gaming USB; cảm biến quang", 590_000],
    ["Chuột gaming không dây", "Chuột gaming không dây; độ trễ thấp", 1_100_000],
    ["Chuột công thái học đứng", "Chuột đứng hỗ trợ tư thế cổ tay", 750_000],
    ["Chuột công thái học không dây", "Chuột không dây dáng công thái học", 1_250_000],
    ["Chuột đa thiết bị", "Chuột chuyển đổi giữa nhiều thiết bị", 890_000],
  ]],
  ["HEAD", "Tai nghe", [
    ["Tai nghe có dây 3.5mm", "Tai nghe chụp tai; mic đàm thoại; jack 3.5mm", 320_000],
    ["Tai nghe USB văn phòng", "Tai nghe chụp tai; mic; USB", 480_000],
    ["Tai nghe không dây văn phòng", "Tai nghe Bluetooth; mic; dùng họp trực tuyến", 950_000],
    ["Tai nghe chống ồn ANC", "Tai nghe Bluetooth; chống ồn chủ động ANC; mic", 1_850_000],
    ["Tai nghe gaming 7.1 USB", "Tai nghe gaming USB; âm thanh giả lập 7.1; mic", 1_250_000],
    ["Tai nghe gaming không dây", "Tai nghe gaming không dây; mic", 2_100_000],
    ["Tai nghe kiểm âm", "Tai nghe chụp tai cho biên tập âm thanh", 1_650_000],
    ["Tai nghe họp có mic lọc ồn", "Tai nghe USB; mic lọc tiếng ồn cho họp trực tuyến", 1_350_000],
  ]],
  ["ACC", "Phụ kiện lắp ráp", [
    ["Quạt case 120mm", "Quạt làm mát vỏ máy tính 120mm; đầu PWM", 180_000],
    ["Keo tản nhiệt CPU", "Tuýp keo tản nhiệt cho bề mặt CPU và tản nhiệt", 190_000],
    ["Card Wi-Fi PCIe", "Bộ thu phát Wi-Fi gắn khe PCIe cho máy bàn", 650_000],
    ["Cáp HDMI 2m", "Cáp tín hiệu HDMI dài 2 mét nối máy tính với màn hình", 150_000],
  ]],
];

const products = groups.flatMap(([code, category, rows]) => rows.map(([name, description, price], index) => ({
  sku: `PC-${code}-${String(index + 1).padStart(2, "0")}`,
  name,
  description,
  attributes: { "Nhóm sản phẩm": category, "Giá": "Minh họa" },
  unit: "cái",
  price,
})));

function stableId(value: string) {
  return new ObjectId(createHash("sha256").update(value).digest("hex").slice(0, 24));
}

function workbookBytes() {
  const rows = [["Mã hàng", "Tên sản phẩm", "Nhóm sản phẩm", "Mô tả", "Đơn vị", "Đơn giá (VND)"],
    ...products.map((product) => [product.sku, product.name, product.attributes["Nhóm sản phẩm"], product.description, product.unit, product.price])];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Linh kiện PC");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function main() {
  if (products.length !== 100 || new Set(products.map((product) => product.sku)).size !== 100) throw new Error("Danh mục mẫu phải có đúng 100 SKU duy nhất.");
  if (!process.argv.includes("--apply")) {
    console.log(`Sẵn sàng tạo ${products.length} sản phẩm mẫu cho ${email}. Chạy với --apply và PC_BUILD_DEMO_PASSWORD để nạp vào MongoDB.`);
    return;
  }
  const password = process.env.PC_BUILD_DEMO_PASSWORD ?? "";
  if (password.length < 7 || password.length > 200) throw new Error("PC_BUILD_DEMO_PASSWORD phải dài 7–200 ký tự.");
  const client = new MongoClient(config.mongoUri, {
    appName: "bao-gia-pc-build-demo-seed",
    authSource: config.mongoAuthSource,
    ...(config.mongoUser && config.mongoPassword ? { auth: { username: config.mongoUser, password: config.mongoPassword } } : {}),
  });
  await client.connect();
  try {
    const db = client.db(config.mongoDatabase);
    const companies = db.collection<Company>("companies");
    const users = db.collection<UserAccount>("users");
    const catalog = db.collection<CatalogItem>("catalogItems");
    const normalizedName = companyName.toLowerCase();
    const existingCompany = await companies.findOne({ code: companyCode });
    const existingUser = await users.findOne({ email });
    if (existingCompany && existingCompany.normalizedName !== normalizedName) throw new Error("Mã doanh nghiệp mẫu đã được sử dụng.");
    if (existingUser && (existingUser.id !== accountId || existingUser.companyId !== existingCompany?._id?.toHexString())) throw new Error("Email mẫu đã được sử dụng bởi tài khoản khác.");
    const now = new Date();
    const companyId = existingCompany?._id ?? stableId(`${companyCode}:company`);
    if (!existingCompany) await companies.insertOne({ _id: companyId, code: companyCode, name: companyName, normalizedName, planCode: "free", createdAt: now, updatedAt: now });
    if (!existingUser) await users.insertOne({ id: accountId, email, name: "Nhân viên báo giá PC", role: "user", passwordHash: hashPassword(password), companyId: companyId.toHexString(), active: true, authVersion: 0, createdAt: now, updatedAt: now });
    else if (!verifyPassword(password, existingUser.passwordHash)) throw new Error("Tài khoản đã tồn tại với mật khẩu khác; không tự đặt lại mật khẩu.");
    const effectiveFrom = now.toISOString().slice(0, 10);
    for (const product of products) {
      const id = stableId(`${companyCode}:catalog:${product.sku}`);
      const collision = await catalog.findOne({ _id: id });
      if (collision && collision.companyId !== companyId.toHexString()) throw new Error(`Trùng mã sản phẩm ${product.sku} với doanh nghiệp khác.`);
      await catalog.updateOne({ _id: id, companyId: companyId.toHexString() }, {
        $set: { ...product, companyId: companyId.toHexString(), currency: "VND", active: true, effectiveFrom, updatedAt: now },
        $setOnInsert: { createdAt: now },
      }, { upsert: true });
    }
    const data = workbookBytes();
    const fileId = stableId(`${companyCode}:price-list`);
    await db.collection<PriceList>("priceLists").updateOne({ _id: fileId, companyId: companyId.toHexString() }, {
      $set: { originalFilename: "bang-gia-pc-build-demo.xlsx", bytes: data.length, data: new Binary(data), uploadedBy: accountId, updatedAt: now, productCount: products.length, skippedRows: 0 },
      $setOnInsert: { companyId: companyId.toHexString() },
    }, { upsert: true });
    const count = await catalog.countDocuments({ companyId: companyId.toHexString(), active: true });
    console.log(JSON.stringify({ email, company: companyName, catalogProducts: count, priceList: "bang-gia-pc-build-demo.xlsx", database: config.mongoDatabase }));
  } finally {
    await client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Không thể nạp danh mục PC mẫu.");
  process.exitCode = 1;
});
