import { createHash, randomBytes } from "node:crypto";
import { Binary, MongoClient, ObjectId, type Db } from "mongodb";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { config } from "./config.js";
import { hashPassword } from "./password.js";
import type { CatalogItem, Company, QuoteRequest, UserAccount } from "./types.js";
import type { PriceList } from "./price-list.js";
import type { QuoteTemplate } from "./quote-template.js";

interface DemoProduct {
  sku: string;
  name: string;
  description: string;
  unit: string;
  price: number;
}

interface DemoRequest {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  requestText: string;
  daysAgo: number;
  preanalyzedItems?: Array<{ sku: string; quantity: number }>;
}

interface DemoCompany {
  slug: string;
  name: string;
  taxId: string;
  address: string;
  phone: string;
  businessEmail: string;
  representativeName: string;
  adminName: string;
  adminEmail: string;
  products: DemoProduct[];
  requests: DemoRequest[];
}

const demoCompanies: DemoCompany[] = [
  {
    slug: "anh-duong-van-phong",
    name: "Công ty Demo Thiết bị Văn phòng Ánh Dương",
    taxId: "DEMO-VP-001",
    address: "12 Đường Mẫu, Phường Demo, TP. Hồ Chí Minh",
    phone: "028 0000 0101",
    businessEmail: "vanphong@example.test",
    representativeName: "Nguyễn Minh Anh",
    adminName: "Nguyễn Minh Anh",
    adminEmail: "anhduong.demo@example.test",
    products: [
      { sku: "VP-GIAY-A4-80", name: "Giấy in A4 80gsm, 500 tờ/ream", description: "Giấy in văn phòng định lượng 80gsm", unit: "ream", price: 82000 },
      { sku: "VP-GIAY-A3-80", name: "Giấy in A3 80gsm, 500 tờ/ream", description: "Giấy in khổ A3 định lượng 80gsm", unit: "ream", price: 168000 },
      { sku: "VP-MAY-IN-LASER", name: "Máy in laser trắng đen A4 hai mặt", description: "Máy in văn phòng, in hai mặt tự động, kết nối mạng", unit: "cái", price: 5480000 },
      { sku: "VP-MUC-LASER-2600", name: "Hộp mực laser tương thích 2.600 trang", description: "Hộp mực thay thế dùng cho máy in laser văn phòng", unit: "hộp", price: 590000 },
      { sku: "VP-BIA-CONG", name: "Bìa còng khổ A4, gáy 7 cm", description: "Bìa hồ sơ văn phòng, gáy rộng 7 cm", unit: "cái", price: 42000 },
      { sku: "VP-GHE-ERGONOMIC", name: "Ghế văn phòng lưng lưới công thái học", description: "Ghế lưng lưới, nâng hạ chiều cao, bánh xe", unit: "cái", price: 2850000 },
    ],
    requests: [
      { customerName: "Công ty Demo Sao Mai", customerEmail: "muahang@saomai.example.test", customerPhone: "090 000 1001", requestText: "Báo giá giúp 10 ream giấy in A4 80gsm, giao trong tuần này.", daysAgo: 1, preanalyzedItems: [{ sku: "VP-GIAY-A4-80", quantity: 10 }] },
      { customerName: "Trung tâm Demo Hướng Dương", customerEmail: "hanhchinh@huongduong.example.test", customerPhone: "090 000 1002", requestText: "Bên tôi cần 2 máy in laser trắng đen khổ A4, in hai mặt tự động và 2 hộp mực dự phòng. Vui lòng báo giá riêng từng mặt hàng.", daysAgo: 3 },
      { customerName: "Cửa hàng Demo Bình Minh", customerEmail: "vanphong@binhminh.example.test", customerPhone: "090 000 1003", requestText: "Xin báo giá 6 ghế văn phòng lưng lưới công thái học, giao đến Quận 3. Cho biết thời gian giao hàng và phí vận chuyển.", daysAgo: 6 },
    ],
  },
  {
    slug: "lam-son-dien-lanh",
    name: "Công ty Demo Điện lạnh Lam Sơn",
    taxId: "DEMO-DL-002",
    address: "28 Đường Thử Nghiệm, Phường Mẫu, TP. Đà Nẵng",
    phone: "0236 0000 0202",
    businessEmail: "dienlanh@example.test",
    representativeName: "Trần Quốc Bảo",
    adminName: "Trần Quốc Bảo",
    adminEmail: "lamson.demo@example.test",
    products: [
      { sku: "DL-MAYLANH-15", name: "Máy điều hòa inverter 1.5 HP", description: "Máy lạnh inverter dùng cho phòng có diện tích khoảng 15–20 m²", unit: "bộ", price: 10900000 },
      { sku: "DL-MAYLANH-20", name: "Máy điều hòa inverter 2.0 HP", description: "Máy lạnh inverter dùng cho phòng có diện tích khoảng 20–30 m²", unit: "bộ", price: 15900000 },
      { sku: "DL-LAPDAT-STD", name: "Nhân công lắp đặt máy lạnh tiêu chuẩn", description: "Lắp đặt cơ bản, chưa gồm vật tư phát sinh", unit: "bộ", price: 450000 },
      { sku: "DL-ONGDONG-6", name: "Ống đồng máy lạnh phi 6.35 mm", description: "Ống đồng cuộn, tính theo mét", unit: "mét", price: 165000 },
      { sku: "DL-ONGDONG-10", name: "Ống đồng máy lạnh phi 9.52 mm", description: "Ống đồng cuộn, tính theo mét", unit: "mét", price: 210000 },
      { sku: "DL-VE-SINH", name: "Vệ sinh và bảo trì máy lạnh treo tường", description: "Vệ sinh lưới lọc, dàn lạnh và kiểm tra vận hành", unit: "máy", price: 280000 },
    ],
    requests: [
      { customerName: "Văn phòng Demo Hải Âu", customerEmail: "admin@haiau.example.test", customerPhone: "090 000 2001", requestText: "Báo giá 2 máy điều hòa inverter 1.5 HP và công lắp đặt tiêu chuẩn cho văn phòng.", daysAgo: 1, preanalyzedItems: [{ sku: "DL-MAYLANH-15", quantity: 2 }, { sku: "DL-LAPDAT-STD", quantity: 2 }] },
      { customerName: "Công ty Demo Biển Xanh", customerEmail: "facility@bienxanh.example.test", customerPhone: "090 000 2002", requestText: "Cần 3 máy lạnh inverter 2 HP, lắp đặt tại tầng 2. Dự kiến mỗi máy dùng khoảng 8 mét ống đồng phi 9.52, vui lòng tách vật tư và nhân công.", daysAgo: 4 },
      { customerName: "Nhà hàng Demo Bếp Việt", customerEmail: "quanly@bepviet.example.test", customerPhone: "090 000 2003", requestText: "Xin báo giá vệ sinh, bảo trì định kỳ 8 máy lạnh treo tường. Có thể thực hiện ngoài giờ mở cửa không?", daysAgo: 7 },
    ],
  },
  {
    slug: "song-xanh-bao-bi",
    name: "Công ty Demo Bao bì Sông Xanh",
    taxId: "DEMO-BB-003",
    address: "45 Đường Sáng Tạo, Phường Mẫu, TP. Cần Thơ",
    phone: "0292 0000 0303",
    businessEmail: "baobi@example.test",
    representativeName: "Lê Thu Hà",
    adminName: "Lê Thu Hà",
    adminEmail: "songxanh.demo@example.test",
    products: [
      { sku: "BB-CARTON-5L-604040", name: "Thùng carton 5 lớp 60 x 40 x 40 cm", description: "Thùng carton 5 lớp, kích thước phủ bì 60 x 40 x 40 cm", unit: "cái", price: 24500 },
      { sku: "BB-CARTON-3L-403030", name: "Thùng carton 3 lớp 40 x 30 x 30 cm", description: "Thùng carton 3 lớp, kích thước phủ bì 40 x 30 x 30 cm", unit: "cái", price: 8900 },
      { sku: "BB-BANGKEO-48-100", name: "Băng keo trong 48 mm x 100 yard", description: "Cuộn băng keo đóng gói rộng 48 mm", unit: "cuộn", price: 17500 },
      { sku: "BB-MANG-PE-50", name: "Màng PE quấn hàng khổ 50 cm, 2 kg", description: "Màng quấn pallet trong suốt", unit: "cuộn", price: 118000 },
      { sku: "BB-XOP-PE-1M", name: "Cuộn xốp PE foam khổ 1 m", description: "Xốp PE foam bảo vệ hàng hóa, tính theo mét dài", unit: "mét", price: 12000 },
      { sku: "BB-TUI-ZIP-20", name: "Túi zipper trong 20 x 30 cm", description: "Túi zipper trong suốt, đóng gói theo túi 100 cái", unit: "túi 100 cái", price: 68000 },
    ],
    requests: [
      { customerName: "Cửa hàng Demo Mộc Miên", customerEmail: "kho@mocmien.example.test", customerPhone: "090 000 3001", requestText: "Báo giá 500 thùng carton 5 lớp kích thước 60 x 40 x 40 cm, giao một lần.", daysAgo: 1, preanalyzedItems: [{ sku: "BB-CARTON-5L-604040", quantity: 500 }] },
      { customerName: "Công ty Demo Nông sản Miền Tây", customerEmail: "muahang@nongsan.example.test", customerPhone: "090 000 3002", requestText: "Cần 50 cuộn băng keo trong khổ 48 mm và 20 cuộn màng PE quấn pallet khổ 50 cm. Xin báo riêng từng loại.", daysAgo: 3 },
      { customerName: "Xưởng Demo Gốm Nhà", customerEmail: "sanxuat@gom-nha.example.test", customerPhone: "090 000 3003", requestText: "Xin báo giá thùng carton 3 lớp 40 x 30 x 30 cm, in logo hai màu, số lượng khoảng 1.000 cái. Báo giúp chi phí làm khuôn in nếu có.", daysAgo: 6 },
    ],
  },
];

function stableObjectId(key: string) {
  return new ObjectId(createHash("sha256").update(`bao-gia-demo:${key}`).digest("hex").slice(0, 24));
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wordParagraph(text: string, options: { bold?: boolean; size?: number; align?: "center" | "right" } = {}) {
  const paragraphProperties = options.align ? `<w:pPr><w:jc w:val="${options.align}"/></w:pPr>` : "";
  const runProperties = `${options.bold ? "<w:b/>" : ""}${options.size ? `<w:sz w:val="${options.size}"/>` : ""}`;
  return `<w:p>${paragraphProperties}<w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function wordCell(text: string, width: number, bold = false) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${wordParagraph(text, { bold })}</w:tc>`;
}

function makeQuoteTemplate(company: DemoCompany) {
  const widths = [1100, 3700, 700, 1000, 1600, 2000];
  const row = (cells: string[], bold = false) => `<w:tr>${cells.map((text, index) => wordCell(text, widths[index]!, bold)).join("")}</w:tr>`;
  const table = `<w:tbl><w:tblPr><w:tblW w:w="10100" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="AAB8B2"/><w:left w:val="single" w:sz="4" w:color="AAB8B2"/><w:bottom w:val="single" w:sz="4" w:color="AAB8B2"/><w:right w:val="single" w:sz="4" w:color="AAB8B2"/><w:insideH w:val="single" w:sz="4" w:color="D5DDD9"/><w:insideV w:val="single" w:sz="4" w:color="D5DDD9"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${row(["Mã hàng", "Tên sản phẩm / dịch vụ", "SL", "Đơn vị", "Đơn giá", "Thành tiền"], true)}${row(["DEMO-001", "Mặt hàng mẫu — thay bằng sản phẩm được báo giá", "1", "cái", "0", "0"])}</w:tbl>`;
  const body = [
    wordParagraph(company.name, { bold: true, size: 28, align: "center" }),
    wordParagraph(`MST: ${company.taxId}  |  ${company.address}`, { align: "center" }),
    wordParagraph(`Điện thoại: ${company.phone}  |  Email: ${company.businessEmail}`, { align: "center" }),
    wordParagraph("BÁO GIÁ", { bold: true, size: 36, align: "center" }),
    wordParagraph("Số báo giá: [Số báo giá]                         Ngày lập: [Ngày lập]"),
    wordParagraph("THÔNG TIN KHÁCH HÀNG", { bold: true, size: 24 }),
    wordParagraph("Khách hàng: [Tên khách hàng]"),
    wordParagraph("Email: [Email khách hàng]                         Điện thoại: [Số điện thoại]"),
    wordParagraph("NỘI DUNG BÁO GIÁ", { bold: true, size: 24 }),
    table,
    wordParagraph("Tạm tính: [Tạm tính]"),
    wordParagraph("Thuế: [Thuế]"),
    wordParagraph("TỔNG CỘNG: [Tổng cộng]", { bold: true, size: 24 }),
    wordParagraph("Điều khoản: Giá có hiệu lực trong 15 ngày kể từ ngày lập báo giá."),
    wordParagraph("Cảm ơn Quý khách đã quan tâm. Vui lòng liên hệ doanh nghiệp nếu cần thêm thông tin."),
    wordParagraph(`ĐẠI DIỆN ${company.name.toLocaleUpperCase("vi")}`, { bold: true, align: "right" }),
    wordParagraph(company.representativeName, { align: "right" }),
  ].join("");
  const zip = new PizZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style></w:styles>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="425" w:footer="425" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

function makePriceList(company: DemoCompany, effectiveFrom: string) {
  const workbook = XLSX.utils.book_new();
  const rows = company.products.map((product) => ({
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    price: product.price,
    currency: "VND",
    description: product.description,
    effectiveFrom,
  }));
  const sheet = XLSX.utils.json_to_sheet(rows, { header: ["sku", "name", "unit", "price", "currency", "description", "effectiveFrom"] });
  sheet["!cols"] = [{ wch: 24 }, { wch: 44 }, { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 52 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(workbook, sheet, "Bang gia demo");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function randomDemoPassword() {
  return `${randomBytes(18).toString("base64url")}!A7`;
}

async function seedCompany(db: Db, companyData: DemoCompany, now: Date, effectiveFrom: string) {
  const demoCode = `demo-${companyData.slug}`;
  const normalizedName = companyData.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
  const companies = db.collection<Company>("companies");
  let company = await companies.findOne({ code: demoCode });
  if (!company) {
    const nameConflict = await companies.findOne({ normalizedName });
    if (nameConflict) throw new Error(`Company name already exists and is not demo data: ${companyData.name}`);
    await companies.insertOne({
      code: demoCode,
      name: companyData.name,
      normalizedName,
      taxId: companyData.taxId,
      address: companyData.address,
      phone: companyData.phone,
      businessEmail: companyData.businessEmail,
      representativeName: companyData.representativeName,
      createdAt: now,
      updatedAt: now,
    });
    company = await companies.findOne({ code: demoCode });
  } else {
    await companies.updateOne({ _id: company._id }, { $set: {
      name: companyData.name,
      normalizedName,
      taxId: companyData.taxId,
      address: companyData.address,
      phone: companyData.phone,
      businessEmail: companyData.businessEmail,
      representativeName: companyData.representativeName,
      updatedAt: now,
    } });
    company = await companies.findOne({ _id: company._id });
  }
  if (!company?._id) throw new Error(`Could not create demo company: ${companyData.name}`);
  const companyId = company._id.toHexString();

  const users = db.collection<UserAccount>("users");
  const accountId = `demo-${companyData.slug}-admin`;
  const email = companyData.adminEmail.toLowerCase();
  const previousUser = await users.findOne({ email });
  if (previousUser && (previousUser.id !== accountId || previousUser.companyId !== companyId)) {
    throw new Error(`Demo email is already owned by a different account: ${email}`);
  }
  const password = previousUser?.passwordHash ? undefined : randomDemoPassword();
  const account: UserAccount = {
    id: accountId,
    email,
    name: companyData.adminName,
    role: "admin",
    platformAdmin: false,
    passwordHash: previousUser?.passwordHash ?? hashPassword(password!),
    companyId,
    active: true,
    authVersion: previousUser?.authVersion ?? 0,
    createdAt: previousUser?.createdAt ?? now,
    updatedAt: now,
  };
  await users.updateOne({ email }, { $set: account }, { upsert: true });

  const catalogItems = companyData.products.map((product) => ({
    _id: stableObjectId(`${companyData.slug}:catalog:${product.sku}`),
    companyId,
    ...product,
    currency: "VND",
    active: true,
    effectiveFrom,
    createdAt: now,
    updatedAt: now,
  } satisfies CatalogItem));
  const catalog = db.collection<CatalogItem>("catalogItems");
  for (const item of catalogItems) {
    const { _id, createdAt, ...fields } = item;
    const conflict = await catalog.findOne({ _id });
    if (conflict && conflict.companyId !== companyId) throw new Error(`Demo catalog id collision: ${item.sku}`);
    await catalog.updateOne({ _id }, { $set: fields, $setOnInsert: { createdAt } }, { upsert: true });
  }

  const priceListId = stableObjectId(`${companyData.slug}:price-list`);
  const priceListFilename = `bang-gia-${companyData.slug}.xlsx`;
  const priceListBytes = makePriceList(companyData, effectiveFrom);
  const priceList: PriceList & { _id: ObjectId } = {
    _id: priceListId,
    companyId,
    originalFilename: priceListFilename,
    bytes: priceListBytes.length,
    data: new Binary(priceListBytes),
    uploadedBy: account.id,
    updatedAt: now,
  };
  await db.collection<PriceList>("priceLists").replaceOne({ _id: priceListId }, priceList, { upsert: true });

  const templateId = stableObjectId(`${companyData.slug}:quote-template`);
  const templateFilename = `mau-bao-gia-${companyData.slug}.docx`;
  const templateBytes = makeQuoteTemplate(companyData);
  const template: QuoteTemplate & { _id: ObjectId } = {
    _id: templateId,
    companyId,
    name: `Mẫu báo giá ${companyData.name}`,
    originalFilename: templateFilename,
    extension: "docx",
    bytes: templateBytes.length,
    data: new Binary(templateBytes),
    createdAt: now,
    uploadedBy: account.id,
  };
  await db.collection<QuoteTemplate>("quoteTemplates").replaceOne({ _id: templateId }, template, { upsert: true });
  await companies.updateOne({ _id: company._id }, { $set: { quoteTemplateId: templateId.toHexString(), updatedAt: now } });

  const requests = db.collection<QuoteRequest>("quoteRequests");
  const productsBySku = new Map(catalogItems.map((item) => [item.sku, item]));
  for (const [index, demoRequest] of companyData.requests.entries()) {
    const requestId = stableObjectId(`${companyData.slug}:request:${index + 1}`);
    const preanalyzed = demoRequest.preanalyzedItems?.map(({ sku, quantity }) => {
      const product = productsBySku.get(sku);
      if (!product?._id) throw new Error(`Unknown demo SKU ${sku} in ${companyData.slug}`);
      return { product, quantity };
    });
    const createdAt = new Date(now.getTime() - demoRequest.daysAgo * 24 * 60 * 60 * 1000);
    const request: QuoteRequest = {
      _id: requestId,
      companyId,
      template: { id: templateId.toHexString(), name: template.name, originalFilename: templateFilename },
      priceListId: priceListId.toHexString(),
      priceListFilename,
      idempotencyKey: `demo-${companyData.slug}-${index + 1}`,
      customerName: demoRequest.customerName,
      customerEmail: demoRequest.customerEmail,
      customerPhone: demoRequest.customerPhone,
      requestText: demoRequest.requestText,
      status: preanalyzed ? "matched" : "not_found",
      items: preanalyzed?.map(({ product, quantity }) => ({
        catalogItemId: product._id!.toHexString(),
        quantity,
        unit: product.unit,
        attributes: {},
        evidence: `Yêu cầu demo; đối chiếu ${priceListFilename}, sheet Bang gia demo.`,
      })) ?? [],
      ...(preanalyzed ? { candidates: preanalyzed.map(({ product }) => product), analyzedAt: createdAt } : {}),
      missingFields: [],
      createdBy: account.id,
      createdAt,
    };
    await requests.replaceOne({ _id: requestId }, request, { upsert: true });
  }

  return {
    companyName: companyData.name,
    adminEmail: email,
    password,
    productCount: catalogItems.length,
    requestCount: companyData.requests.length,
    priceListFilename,
    templateFilename,
  };
}

async function main() {
  if (!process.argv.includes("--apply")) {
    console.log("No data written. Run with --apply to seed three demo companies into the configured MongoDB database.");
    return;
  }
  const client = new MongoClient(config.mongoUri, {
    appName: "bao-gia-demo-seed",
    authSource: config.mongoAuthSource,
    ...(config.mongoUser && config.mongoPassword ? { auth: { username: config.mongoUser, password: config.mongoPassword } } : {}),
  });
  await client.connect();
  try {
    const db = client.db(config.mongoDatabase);
    const effectiveFrom = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const results = [];
    for (const company of demoCompanies) results.push(await seedCompany(db, company, now, effectiveFrom));
    console.log("Demo data is ready. All companies, customers, prices, and documents are synthetic test data.");
    for (const result of results) {
      console.log(`\n${result.companyName}`);
      console.log(`  Login: ${result.adminEmail}`);
      console.log(result.password ? `  Password: ${result.password}` : "  Password: retained from previous seed run");
      console.log(`  Catalog: ${result.productCount} products; requests: ${result.requestCount}`);
      console.log(`  Files: ${result.priceListFilename}; ${result.templateFilename}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo data seeding failed.");
  process.exitCode = 1;
});
