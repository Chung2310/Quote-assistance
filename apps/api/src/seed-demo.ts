import { createHash, randomBytes } from "node:crypto";
import { Binary, MongoClient, ObjectId, type Db } from "mongodb";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { config } from "./config.js";
import { hashPassword } from "./password.js";
import type { CatalogItem, Company, QuoteRequest, UserAccount } from "./types.js";
import type { PriceList } from "./price-list.js";
import type { QuoteTemplate } from "./quote-template.js";
import { requestFileContent, type RequestFile } from "./request-file.js";

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
  requestedItems: Array<{ sku: string; quantity: number; note?: string }>;
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
      { customerName: "Công ty Demo Sao Mai", customerEmail: "muahang@saomai.example.test", customerPhone: "090 000 1001", requestText: "Báo giá giúp 10 ream giấy in A4 80gsm, giao trong tuần này.", daysAgo: 1, requestedItems: [{ sku: "VP-GIAY-A4-80", quantity: 10, note: "Giao trong tuần này." }] },
      { customerName: "Trung tâm Demo Hướng Dương", customerEmail: "hanhchinh@huongduong.example.test", customerPhone: "090 000 1002", requestText: "Bên tôi cần 2 máy in laser trắng đen khổ A4, in hai mặt tự động và 2 hộp mực dự phòng. Vui lòng báo giá riêng từng mặt hàng.", daysAgo: 3, requestedItems: [{ sku: "VP-MAY-IN-LASER", quantity: 2 }, { sku: "VP-MUC-LASER-2600", quantity: 2, note: "Báo giá riêng từng mặt hàng." }] },
      { customerName: "Cửa hàng Demo Bình Minh", customerEmail: "vanphong@binhminh.example.test", customerPhone: "090 000 1003", requestText: "Xin báo giá 6 ghế văn phòng lưng lưới công thái học, giao đến Quận 3. Cho biết thời gian giao hàng và phí vận chuyển.", daysAgo: 6, requestedItems: [{ sku: "VP-GHE-ERGONOMIC", quantity: 6, note: "Giao Quận 3; vui lòng báo thời gian giao và phí vận chuyển." }] },
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
      { customerName: "Văn phòng Demo Hải Âu", customerEmail: "admin@haiau.example.test", customerPhone: "090 000 2001", requestText: "Báo giá 2 máy điều hòa inverter 1.5 HP và công lắp đặt tiêu chuẩn cho văn phòng.", daysAgo: 1, requestedItems: [{ sku: "DL-MAYLANH-15", quantity: 2 }, { sku: "DL-LAPDAT-STD", quantity: 2 }] },
      { customerName: "Công ty Demo Biển Xanh", customerEmail: "facility@bienxanh.example.test", customerPhone: "090 000 2002", requestText: "Cần 3 máy lạnh inverter 2 HP, lắp đặt tại tầng 2. Dự kiến mỗi máy dùng khoảng 8 mét ống đồng phi 9.52, vui lòng tách vật tư và nhân công.", daysAgo: 4, requestedItems: [{ sku: "DL-MAYLANH-20", quantity: 3, note: "Lắp tầng 2." }, { sku: "DL-ONGDONG-10", quantity: 24, note: "Khoảng 8 mét cho mỗi máy; tách vật tư." }, { sku: "DL-LAPDAT-STD", quantity: 3, note: "Tách nhân công." }] },
      { customerName: "Nhà hàng Demo Bếp Việt", customerEmail: "quanly@bepviet.example.test", customerPhone: "090 000 2003", requestText: "Xin báo giá vệ sinh, bảo trì định kỳ 8 máy lạnh treo tường. Có thể thực hiện ngoài giờ mở cửa không?", daysAgo: 7, requestedItems: [{ sku: "DL-VE-SINH", quantity: 8, note: "Hỏi khả năng thực hiện ngoài giờ mở cửa." }] },
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
      { customerName: "Cửa hàng Demo Mộc Miên", customerEmail: "kho@mocmien.example.test", customerPhone: "090 000 3001", requestText: "Báo giá 500 thùng carton 5 lớp kích thước 60 x 40 x 40 cm, giao một lần.", daysAgo: 1, requestedItems: [{ sku: "BB-CARTON-5L-604040", quantity: 500, note: "Giao một lần." }] },
      { customerName: "Công ty Demo Nông sản Miền Tây", customerEmail: "muahang@nongsan.example.test", customerPhone: "090 000 3002", requestText: "Cần 50 cuộn băng keo trong khổ 48 mm và 20 cuộn màng PE quấn pallet khổ 50 cm. Xin báo riêng từng loại.", daysAgo: 3, requestedItems: [{ sku: "BB-BANGKEO-48-100", quantity: 50 }, { sku: "BB-MANG-PE-50", quantity: 20, note: "Báo giá riêng từng loại." }] },
      { customerName: "Xưởng Demo Gốm Nhà", customerEmail: "sanxuat@gom-nha.example.test", customerPhone: "090 000 3003", requestText: "Xin báo giá thùng carton 3 lớp 40 x 30 x 30 cm, in logo hai màu, số lượng khoảng 1.000 cái. Báo giúp chi phí làm khuôn in nếu có.", daysAgo: 6, requestedItems: [{ sku: "BB-CARTON-3L-403030", quantity: 1000, note: "In logo hai màu. Báo riêng phí khuôn in nếu có trong bảng giá." }] },
    ],
  },
];

function stableObjectId(key: string) {
  return new ObjectId(createHash("sha256").update(`bao-gia-demo:${key}`).digest("hex").slice(0, 24));
}

function makeQuoteTemplate(company: DemoCompany) {
  const rows: string[][] = Array.from({ length: 28 }, () => Array(13).fill(""));
  const set = (row: number, column: number, value: string) => { rows[row - 1]![column - 1] = value; };
  set(1, 1, company.name);
  set(2, 1, `MST: ${company.taxId}  |  ${company.address}`);
  set(3, 1, `Điện thoại: ${company.phone}  |  Email: ${company.businessEmail}`);
  set(4, 1, "BẢNG BÁO GIÁ / DỰ TOÁN");
  set(6, 1, "Số báo giá"); set(6, 3, "[Số báo giá]"); set(6, 5, "Ngày lập"); set(6, 7, "[Ngày lập]");
  set(7, 1, "Khách hàng"); set(7, 3, "[Tên khách hàng]"); set(7, 9, "Điện thoại"); set(7, 11, "[Số điện thoại]");
  set(8, 1, "Email"); set(8, 3, "[Email khách hàng]");
  set(10, 1, "STT"); set(10, 2, "HÌNH ẢNH SP"); set(10, 3, "TÊN SẢN PHẨM");
  set(10, 4, "CHẤT LIỆU, QUY CÁCH SP"); set(11, 4, "Vật liệu / cấu hình"); set(11, 5, "Quy cách / xuất xứ");
  set(10, 6, "THÔNG SỐ"); set(11, 6, "Dài / rộng"); set(11, 7, "Sâu"); set(11, 8, "Cao");
  set(10, 9, "ĐVT"); set(10, 10, "SL"); set(10, 11, "ĐƠN GIÁ"); set(10, 12, "THÀNH TIỀN"); set(10, 13, "GHI CHÚ");
  set(12, 1, "DANH MỤC SẢN PHẨM MẪU");
  company.products.forEach((product, index) => {
    const row = index + 13;
    set(row, 1, String(index + 1)); set(row, 2, "Ảnh minh họa"); set(row, 3, product.name);
    set(row, 4, product.description); set(row, 5, "Quy cách theo yêu cầu khách hàng");
    set(row, 6, "—"); set(row, 7, "—"); set(row, 8, "—"); set(row, 9, product.unit);
    set(row, 10, "1"); set(row, 11, product.price.toLocaleString("vi-VN")); set(row, 12, product.price.toLocaleString("vi-VN"));
    set(row, 13, "Dữ liệu demo");
  });
  set(20, 1, "TẠM TÍNH"); set(20, 12, "[Tạm tính]");
  set(21, 1, "THUẾ VAT"); set(21, 12, "[Tiền thuế]");
  set(22, 1, "TỔNG CỘNG"); set(22, 12, "[Tổng cộng]");
  set(24, 1, "Điều khoản: Giá có hiệu lực trong 15 ngày kể từ ngày lập báo giá.");
  set(25, 1, "Thời gian giao hàng và điều kiện thanh toán sẽ được xác nhận khi chốt đơn.");
  set(26, 1, "Cảm ơn Quý khách đã quan tâm. Vui lòng liên hệ doanh nghiệp nếu cần thêm thông tin.");
  set(27, 10, `ĐẠI DIỆN ${company.name.toLocaleUpperCase("vi")}`);
  set(28, 10, company.representativeName);

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const merge = (range: string) => XLSX.utils.decode_range(range);
  sheet["!merges"] = [
    "A1:M1", "A2:M2", "A3:M3", "A4:M4", "A6:B6", "C6:D6", "E6:F6", "G6:H6", "I6:M6",
    "A7:B7", "C7:H7", "I7:J7", "K7:M7", "A8:B8", "C8:H8", "I8:M8",
    "A10:A11", "B10:B11", "C10:C11", "D10:E10", "F10:H10", "I10:I11", "J10:J11", "K10:K11", "L10:L11", "M10:M11",
    "A12:M12", "A20:K20", "L20:M20", "A21:K21", "L21:M21", "A22:K22", "L22:M22",
    "A24:M24", "A25:M25", "A26:M26", "J27:M27", "J28:M28",
  ].map(merge);
  sheet["!cols"] = [8, 14, 36, 29, 29, 12, 10, 10, 12, 10, 18, 18, 22].map((wch) => ({ wch }));
  sheet["!rows"] = Array.from({ length: 28 }, (_, index) => ({ hpt: index === 0 ? 28 : index === 3 ? 30 : index === 9 || index === 10 ? 25 : index >= 12 && index <= 17 ? 34 : 22 }));
  sheet["!pageSetup"] = { orientation: "landscape", paperSize: 9, fitToWidth: 1, fitToHeight: 0 };
  sheet["!margins"] = { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
  XLSX.utils.book_append_sheet(workbook, sheet, "Dự toán");
  const zip = new PizZip(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer);
  zip.file("xl/styles.xml", quoteTemplateStyles);
  const worksheet = zip.file("xl/worksheets/sheet1.xml");
  if (!worksheet) throw new Error("Could not create demo quote worksheet.");
  zip.file("xl/worksheets/sheet1.xml", worksheet.asText().replace(/<c\b[^>]*>/g, (cell) => {
    const address = cell.match(/\br="([A-Z]+)(\d+)"/);
    if (!address) return cell;
    const column = XLSX.utils.decode_col(address[1]!);
    const row = Number(address[2]);
    const style = row === 4 ? 1 : row <= 3 || row === 27 || row === 28 ? 2
      : row === 10 ? 3 : row === 11 ? 4 : row === 12 ? 5
        : row >= 13 && row <= 18 ? column === 10 || column === 11 ? 7 : 6
          : row >= 20 && row <= 22 ? row === 22 ? column <= 10 ? 11 : 12 : column <= 10 ? 8 : 9
            : row >= 24 && row <= 26 ? 10 : row >= 6 && row <= 8 ? 6 : 0;
    return /\bs="\d+"/.test(cell) ? cell.replace(/\bs="\d+"/, `s="${style}"`) : cell.replace(/\/?>(?=$)/, (end) => ` s="${style}"${end}`);
  }));
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

const quoteTemplateStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="6"><font><sz val="11"/><color rgb="FF27352C"/><name val="Arial"/></font><font><b/><sz val="18"/><color rgb="FF176B50"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF27352C"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><i/><sz val="9"/><color rgb="FF62756D"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF176B50"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3EF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F7F6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD5DDD9"/></left><right style="thin"><color rgb="FFD5DDD9"/></right><top style="thin"><color rgb="FFD5DDD9"/></top><bottom style="thin"><color rgb="FFD5DDD9"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="5" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/></styleSheet>`;

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

function makeRequestFile(company: DemoCompany, request: DemoRequest) {
  const productsBySku = new Map(company.products.map((product) => [product.sku, product]));
  const rows: unknown[][] = [
    ["YÊU CẦU BÁO GIÁ"],
    ["Khách hàng", request.customerName, "Email", request.customerEmail],
    ["Điện thoại", request.customerPhone],
    [],
    ["Nội dung yêu cầu", request.requestText],
    [],
    ["STT", "Sản phẩm / hạng mục khách yêu cầu", "Số lượng", "Đơn vị", "Thông tin thêm"],
    ...request.requestedItems.map(({ sku, quantity, note }, index) => {
      const product = productsBySku.get(sku);
      if (!product) throw new Error(`Unknown demo SKU ${sku} in ${company.slug}`);
      return [index + 1, product.name, quantity, product.unit, note ?? ""];
    }),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!merges"] = ["A1:E1", "B5:E5"].map((range) => XLSX.utils.decode_range(range));
  sheet["!cols"] = [{ wch: 12 }, { wch: 48 }, { wch: 13 }, { wch: 14 }, { wch: 56 }];
  sheet["!rows"] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 22 }, {}, { hpt: 48 }, {}, { hpt: 25 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Yêu cầu báo giá");
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
  const templateFilename = `mau-bao-gia-${companyData.slug}.xlsx`;
  const templateBytes = makeQuoteTemplate(companyData);
  const template: QuoteTemplate & { _id: ObjectId } = {
    _id: templateId,
    companyId,
    name: `Mẫu báo giá ${companyData.name}`,
    originalFilename: templateFilename,
    extension: "xlsx",
    bytes: templateBytes.length,
    data: new Binary(templateBytes),
    createdAt: now,
    uploadedBy: account.id,
  };
  await db.collection<QuoteTemplate>("quoteTemplates").replaceOne({ _id: templateId }, template, { upsert: true });
  await companies.updateOne({ _id: company._id }, { $set: { quoteTemplateId: templateId.toHexString(), updatedAt: now } });

  const requests = db.collection<QuoteRequest>("quoteRequests");
  const requestFiles = db.collection<RequestFile>("requestFiles");
  const requestFileFilenames: string[] = [];
  for (const [index, demoRequest] of companyData.requests.entries()) {
    const requestId = stableObjectId(`${companyData.slug}:request:${index + 1}`);
    const requestFileId = stableObjectId(`${companyData.slug}:request-file:${index + 1}`);
    const requestFileFilename = `yeu-cau-${companyData.slug}-${index + 1}.xlsx`;
    const requestFileBytes = makeRequestFile(companyData, demoRequest);
    const requestFile: RequestFile & { _id: ObjectId } = {
      _id: requestFileId,
      companyId,
      uploadedBy: account.id,
      originalFilename: requestFileFilename,
      bytes: requestFileBytes.length,
      data: new Binary(requestFileBytes),
      createdAt: new Date(now.getTime() - demoRequest.daysAgo * 24 * 60 * 60 * 1000),
    };
    await requestFileContent(requestFile);
    await requestFiles.replaceOne({ _id: requestFileId }, requestFile, { upsert: true });
    requestFileFilenames.push(requestFileFilename);
    const createdAt = new Date(now.getTime() - demoRequest.daysAgo * 24 * 60 * 60 * 1000);
    const request: QuoteRequest = {
      _id: requestId,
      companyId,
      template: { id: templateId.toHexString(), name: template.name, originalFilename: templateFilename },
      priceListId: priceListId.toHexString(),
      priceListFilename,
      requestFile: { id: requestFileId.toHexString(), originalFilename: requestFileFilename },
      idempotencyKey: `demo-${companyData.slug}-${index + 1}`,
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      requestText: "",
      status: "not_found",
      items: [],
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
    requestFileFilenames,
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
      console.log(`  Files: ${result.templateFilename}; ${result.priceListFilename}; ${result.requestFileFilenames.join(", ")}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Demo data seeding failed.");
  process.exitCode = 1;
});
