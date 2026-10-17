import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

const outputDir = resolve("docs");
const company = "CÔNG TY TNHH XÂY DỰNG AN PHÁT (DOANH NGHIỆP MẪU)";
const effectiveDate = "17/10/2026";

const files = [
  {
    filename: "01-vat-lieu-ket-cau.xlsx",
    title: "BẢNG GIÁ VẬT LIỆU KẾT CẤU VÀ PHẦN THÔ",
    products: [
      ["AP-XM-PC40-01", "Xi măng bao PCB40 Hà Tiên", "Bao 50 kg; dùng cho bê tông và xây tô", "bao", 102000],
      ["AP-XM-PC40-02", "Xi măng bao PCB40 INSEE", "Bao 50 kg; đóng bao mới", "bao", 108000],
      ["AP-XM-PC30-01", "Xi măng bao PCB30 FICO", "Bao 50 kg; dùng cho xây tô", "bao", 92000],
      ["AP-THEP-D6", "Thép cuộn CB240T D6", "Thép cuộn đường kính danh nghĩa 6 mm", "kg", 16700],
      ["AP-THEP-D8", "Thép cuộn CB240T D8", "Thép cuộn đường kính danh nghĩa 8 mm", "kg", 16600],
      ["AP-THEP-D10", "Thép thanh vằn CB400V D10", "Cây dài 11,7 m; đường kính 10 mm", "cây", 128000],
      ["AP-THEP-D12", "Thép thanh vằn CB400V D12", "Cây dài 11,7 m; đường kính 12 mm", "cây", 184000],
      ["AP-THEP-D14", "Thép thanh vằn CB400V D14", "Cây dài 11,7 m; đường kính 14 mm", "cây", 251000],
      ["AP-THEP-D16", "Thép thanh vằn CB400V D16", "Cây dài 11,7 m; đường kính 16 mm", "cây", 328000],
      ["AP-THEP-D18", "Thép thanh vằn CB400V D18", "Cây dài 11,7 m; đường kính 18 mm", "cây", 414000],
      ["AP-LUOI-A6", "Lưới thép hàn D6 ô 150x150", "Tấm 2,0 x 6,0 m; thép CB240T", "tấm", 735000],
      ["AP-DAY-KEM-01", "Dây kẽm buộc đen 1 ly", "Cuộn 5 kg", "cuộn", 108000],
      ["AP-CAT-VANG", "Cát vàng bê tông", "Hạt trung; giao theo khối lượng", "m³", 485000],
      ["AP-CAT-XAY", "Cát xây tô", "Cát sạch sàng; giao theo khối lượng", "m³", 365000],
      ["AP-DA-10X20", "Đá 1x2 xanh", "Đá xây dựng cỡ hạt 10-20 mm", "m³", 525000],
      ["AP-DA-04X06", "Đá 4x6", "Đá xây dựng cỡ hạt 40-60 mm", "m³", 490000],
      ["AP-DA-MI", "Đá mi sàng", "Đá mi sàng dùng làm nền và cấp phối", "m³", 385000],
      ["AP-GACH-ONG-01", "Gạch ống 8 lỗ", "Kích thước 8x8x18 cm; loại A", "viên", 1250],
      ["AP-GACH-TH-01", "Gạch thẻ đặc", "Kích thước 4x8x18 cm; loại A", "viên", 1450],
      ["AP-GACH-BLOCK-10", "Gạch block bê tông 10 cm", "Kích thước 10x20x40 cm", "viên", 12500],
      ["AP-BT-M250", "Bê tông thương phẩm M250", "Độ sụt 10±2 cm; chưa gồm bơm", "m³", 1480000],
      ["AP-BT-M300", "Bê tông thương phẩm M300", "Độ sụt 10±2 cm; chưa gồm bơm", "m³", 1560000],
      ["AP-BT-M350", "Bê tông thương phẩm M350", "Độ sụt 10±2 cm; chưa gồm bơm", "m³", 1650000],
      ["AP-VUA-XAY-M75", "Vữa xây trộn sẵn M75", "Bao 40 kg; dùng cho tường gạch", "bao", 72000],
      ["AP-VUA-TO-M75", "Vữa tô trộn sẵn M75", "Bao 40 kg; dùng cho tô tường trong nhà", "bao", 76000],
      ["AP-VAN-PHIM-12", "Ván phủ phim 12 mm", "Kích thước 1,22 x 2,44 m", "tấm", 385000],
      ["AP-GO-4X8", "Gỗ cốp pha 4x8 cm", "Gỗ thông; chiều dài 3,0 m", "cây", 54000],
      ["AP-ONG-PVC-90", "Ống PVC thoát nước D90", "Độ dày 2,2 mm; cây dài 4 m", "cây", 112000],
      ["AP-TON-DECK-75", "Tôn sàn deck H75", "Tôn mạ kẽm dày 0,75 mm", "m²", 198000],
      ["AP-LUOI-BAO-01", "Lưới bao che công trình", "Cuộn 2 x 100 m; màu xanh", "cuộn", 465000],
    ],
  },
  {
    filename: "02-hoan-thien-dien-nuoc.xlsx",
    title: "BẢNG GIÁ VẬT TƯ HOÀN THIỆN, ĐIỆN VÀ NƯỚC",
    products: [
      ["AP-GACH-LAT-600", "Gạch porcelain lát nền 600x600", "Men matt; đóng thùng 4 viên", "m²", 245000],
      ["AP-GACH-LAT-800", "Gạch porcelain lát nền 800x800", "Men bóng; đóng thùng 3 viên", "m²", 385000],
      ["AP-GACH-OP-300", "Gạch ceramic ốp tường 300x600", "Men bóng; màu trắng vân mây", "m²", 218000],
      ["AP-GACH-MOSAIC", "Gạch mosaic thủy tinh", "Vỉ 300x300 mm; dùng ốp trang trí", "m²", 425000],
      ["AP-KEO-GACH-01", "Keo dán gạch nội thất", "Bao 25 kg; màu xám", "bao", 138000],
      ["AP-KEO-CHA-01", "Keo chà ron chống thấm", "Gói 1 kg; màu trắng", "gói", 49000],
      ["AP-SON-LOT-18", "Sơn lót kháng kiềm nội thất", "Thùng 18 lít; màu trắng", "thùng", 1280000],
      ["AP-SON-LOT-NGOAI-18", "Sơn lót kháng kiềm ngoại thất", "Thùng 18 lít; màu trắng", "thùng", 1780000],
      ["AP-SON-PHU-18", "Sơn phủ nội thất lau chùi", "Thùng 18 lít; màu trắng", "thùng", 1680000],
      ["AP-SON-PHU-NGOAI-18", "Sơn phủ ngoại thất chống thấm", "Thùng 18 lít; màu trắng", "thùng", 3280000],
      ["AP-BOT-BA-40", "Bột bả nội thất", "Bao 40 kg", "bao", 285000],
      ["AP-THACH-CAO-09", "Tấm thạch cao tiêu chuẩn 9 mm", "Kích thước 1,22 x 2,44 m", "tấm", 92000],
      ["AP-KHUNG-TRAN-01", "Khung xương trần thạch cao", "Bộ khung cho 1 m² trần phẳng", "m²", 68500],
      ["AP-CHONG-THAM-18", "Chống thấm gốc xi măng hai thành phần", "Bộ 18 kg", "bộ", 895000],
      ["AP-CUA-NHOM-01", "Cửa nhôm kính hệ 55", "Kính cường lực 8 mm; chưa gồm phụ kiện đặc biệt", "m²", 1850000],
      ["AP-KINH-CUONG-LUC-10", "Kính cường lực 10 mm", "Gia công cạnh mài; đơn giá theo diện tích", "m²", 1120000],
      ["AP-CUA-GO-CN-01", "Cửa gỗ công nghiệp HDF", "Kích thước 900x2200 mm; gồm khung cơ bản", "bộ", 3650000],
      ["AP-THIET-BI-KHOA-01", "Bộ khóa cửa tay gạt inox", "Phù hợp cửa phòng; gồm ruột khóa", "bộ", 485000],
      ["AP-DAY-DIEN-15", "Dây điện đơn CV 1,5 mm²", "Cuộn 100 m; lõi đồng", "cuộn", 485000],
      ["AP-DAY-DIEN-25", "Dây điện đơn CV 2,5 mm²", "Cuộn 100 m; lõi đồng", "cuộn", 765000],
      ["AP-CAP-DIEN-2X25", "Cáp điện CVV 2x2,5 mm²", "Cuộn 100 m; ruột đồng", "cuộn", 1980000],
      ["AP-ONG-LUON-20", "Ống luồn dây điện PVC D20", "Cây dài 2,9 m; loại đàn hồi", "cây", 18500],
      ["AP-CB-2P-20A", "Aptomat tép 2P 20A", "Dòng cắt 6 kA; lắp ray DIN", "cái", 185000],
      ["AP-TU-DIEN-12", "Tủ điện âm tường 12 module", "Vỏ thép sơn tĩnh điện; chưa gồm CB", "cái", 485000],
      ["AP-DEN-LED-9W", "Đèn LED âm trần 9W", "Ánh sáng trung tính 4000K", "cái", 128000],
      ["AP-ONG-PPR-20", "Ống PPR cấp nước D20", "PN20; cây dài 4 m", "cây", 42000],
      ["AP-ONG-PPR-25", "Ống PPR cấp nước D25", "PN20; cây dài 4 m", "cây", 58500],
      ["AP-ONG-PVC-60", "Ống PVC thoát nước D60", "Độ dày 2,0 mm; cây dài 4 m", "cây", 68500],
      ["AP-VAN-BI-20", "Van bi đồng D20", "Ren trong; tay gạt bọc nhựa", "cái", 125000],
      ["AP-VOI-RUA-01", "Vòi lavabo nóng lạnh", "Thân đồng mạ chrome; gồm dây cấp", "bộ", 685000],
    ],
  },
  {
    filename: "03-nhan-cong-thi-cong.xlsx",
    title: "BẢNG GIÁ NHÂN CÔNG VÀ DỊCH VỤ THI CÔNG",
    products: [
      ["AP-NC-DAO-MONG", "Nhân công đào đất móng thủ công", "Đất cấp II; chưa gồm vận chuyển đất", "m³", 185000],
      ["AP-NC-DAP-DAT", "Nhân công đắp đất và đầm chặt", "Độ chặt yêu cầu K95; chưa gồm đất", "m³", 145000],
      ["AP-NC-COPPHA-MONG", "Lắp dựng và tháo dỡ cốp pha móng", "Tính theo diện tích tiếp xúc bê tông", "m²", 185000],
      ["AP-NC-COPPHA-SAN", "Lắp dựng và tháo dỡ cốp pha sàn", "Chiều cao tầng đến 3,6 m", "m²", 215000],
      ["AP-NC-GIA-CONG-THEP", "Gia công và lắp dựng cốt thép", "Cắt, uốn, buộc theo bản vẽ", "kg", 4800],
      ["AP-NC-DO-BT-MONG", "Nhân công đổ bê tông móng", "Đổ bằng bơm; chưa gồm bê tông", "m³", 285000],
      ["AP-NC-DO-BT-SAN", "Nhân công đổ bê tông sàn", "Đổ bằng bơm; chưa gồm bê tông", "m³", 325000],
      ["AP-NC-XAY-TUONG-100", "Nhân công xây tường gạch 100 mm", "Gạch ống; chưa gồm vật liệu", "m²", 165000],
      ["AP-NC-XAY-TUONG-200", "Nhân công xây tường gạch 200 mm", "Gạch ống; chưa gồm vật liệu", "m²", 235000],
      ["AP-NC-TO-TRONG", "Nhân công tô tường trong nhà", "Tô phẳng; chiều dày trung bình 15 mm", "m²", 92000],
      ["AP-NC-TO-NGOAI", "Nhân công tô tường ngoài nhà", "Tô phẳng; chưa gồm giàn giáo cao tầng", "m²", 118000],
      ["AP-NC-CAN-NEN", "Nhân công cán nền xi măng", "Chiều dày trung bình 30 mm", "m²", 68000],
      ["AP-NC-LAT-GACH", "Nhân công lát gạch nền", "Khổ gạch đến 800x800 mm; chưa gồm vật liệu", "m²", 145000],
      ["AP-NC-OP-GACH", "Nhân công ốp gạch tường", "Khổ gạch đến 300x600 mm; chưa gồm vật liệu", "m²", 158000],
      ["AP-NC-SON-NOI", "Nhân công sơn nước nội thất", "Bả 2 lớp, sơn lót 1 lớp, phủ 2 lớp", "m²", 58000],
      ["AP-NC-SON-NGOAI", "Nhân công sơn nước ngoại thất", "Sơn lót 1 lớp, phủ 2 lớp", "m²", 72000],
      ["AP-NC-TRAN-THACH-CAO", "Nhân công lắp trần thạch cao phẳng", "Bao gồm khung xương và tấm; chưa gồm vật liệu", "m²", 125000],
      ["AP-NC-CHONG-THAM", "Nhân công chống thấm sàn vệ sinh", "Thi công 2 lớp; thử nước sau thi công", "m²", 95000],
      ["AP-NC-LAP-CUA-NHOM", "Nhân công lắp cửa nhôm kính", "Lắp đặt, căn chỉnh và bơm keo hoàn thiện", "m²", 185000],
      ["AP-NC-LAP-CUA-GO", "Nhân công lắp cửa gỗ", "Lắp cánh, bản lề và khóa cơ bản", "bộ", 385000],
      ["AP-NC-DIEN-AM", "Nhân công đi ống và kéo dây điện âm", "Chưa gồm thiết bị điện và vật tư", "điểm", 95000],
      ["AP-NC-LAP-DEN", "Nhân công lắp đèn chiếu sáng", "Lắp đặt và đấu nối đèn dân dụng", "cái", 65000],
      ["AP-NC-LAP-TU-DIEN", "Nhân công lắp tủ điện căn hộ", "Lắp CB, đấu nối và đánh dấu mạch", "tủ", 485000],
      ["AP-NC-LAP-ONG-CAP", "Nhân công lắp đường ống cấp nước", "Ống PPR D20-D32; thử áp sau lắp", "m", 58000],
      ["AP-NC-LAP-ONG-THOAT", "Nhân công lắp đường ống thoát nước", "Ống PVC D60-D114; thử kín mối nối", "m", 68000],
      ["AP-NC-LAP-SAN-VS", "Nhân công lắp thiết bị vệ sinh", "Bồn cầu, lavabo và vòi; thiết bị tính riêng", "bộ", 685000],
      ["AP-DV-BOM-BT", "Dịch vụ bơm bê tông cần", "Ca tối thiểu 4 giờ; tầm với đến 32 m", "ca", 3850000],
      ["AP-DV-VAN-CHUYEN", "Vận chuyển vật liệu nội thành", "Xe tải 2 tấn; chuyến tối đa 2 giờ", "chuyến", 1250000],
      ["AP-DV-GIAN-GIAO", "Thuê giàn giáo khung", "Bộ 1,7 m; đơn giá thuê theo tháng", "bộ/tháng", 38000],
      ["AP-DV-VE-SINH", "Vệ sinh công trình sau xây dựng", "Vệ sinh bàn giao căn hộ đến 100 m²", "căn", 1850000],
    ],
  },
];

mkdirSync(outputDir, { recursive: true });

for (const file of files) {
  const rows = [
    [company],
    ["Địa chỉ: Khu vực An Phú, Thành phố Hồ Chí Minh (thông tin hư cấu)"],
    ["Dữ liệu và đơn giá giả lập, chỉ dùng để thử nghiệm chức năng nhập bảng giá."],
    [file.title],
    [`Ngày áp dụng: ${effectiveDate}; Đơn giá tham khảo, chưa gồm VAT và phí vận chuyển nếu chưa ghi rõ.`],
    [],
    ["Mã hàng", "Tên sản phẩm", "Quy cách / thông số", "Đơn vị", "Đơn giá (VND)"],
    ...file.products,
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [
    { wch: 20 }, { wch: 40 }, { wch: 56 }, { wch: 14 }, { wch: 20 },
  ];
  sheet["!autofilter"] = { ref: `A7:E${7 + file.products.length}` };
  XLSX.utils.book_append_sheet(workbook, sheet, "Bảng giá");
  XLSX.writeFile(workbook, resolve(outputDir, file.filename));
  process.stdout.write(`${file.filename}: ${file.products.length} sản phẩm\n`);
}
