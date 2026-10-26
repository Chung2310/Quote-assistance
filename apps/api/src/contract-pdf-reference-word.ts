import PizZip from "pizzip";
import type { Contract } from "./types.js";

// Editable Word reconstruction of the six-page architecture contract PDF supplied by the user.
// The PDF is retained as the selected source template; all party, scope and money values come from the contract.
function escapeXml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

type ParagraphOptions = { bold?: boolean; center?: boolean; size?: number; before?: number; after?: number; keepNext?: boolean; italic?: boolean; pageBreakBefore?: boolean };
function p(value: unknown, options: ParagraphOptions = {}) {
  const text = String(value ?? "").split(/\r?\n/).map((line, index) => `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/>${options.bold ? "<w:b/>" : ""}${options.italic ? "<w:i/>" : ""}<w:sz w:val="${options.size ?? 24}"/><w:lang w:val="vi-VN"/></w:rPr>${index ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`).join("");
  return `<w:p><w:pPr><w:jc w:val="${options.center ? "center" : "left"}"/><w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 110}" w:line="300" w:lineRule="auto"/>${options.keepNext ? "<w:keepNext/>" : ""}${options.pageBreakBefore ? "<w:pageBreakBefore/>" : ""}</w:pPr>${text}</w:p>`;
}

function heading(value: string) { return p(value, { bold: true, before: 220, after: 130, keepNext: true }); }
function money(value: number, currency: string) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(value)} ${currency === "VND" ? "VNĐ" : currency}`;
}
export function words(value: number, currency: string) {
  if (currency !== "VND" || !Number.isSafeInteger(Math.round(value))) return "";
  const digit = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  const readGroup = (value: number, full: boolean) => {
    const hundreds = Math.floor(value / 100);
    const tens = Math.floor(value / 10) % 10;
    const units = value % 10;
    const parts: string[] = [];
    if (hundreds || full) parts.push(`${digit[hundreds]} trăm`);
    if (tens > 1) parts.push(`${digit[tens]} mươi`);
    else if (tens === 1) parts.push("mười");
    else if (units && (hundreds || full)) parts.push("lẻ");
    if (units) parts.push(tens > 1 && units === 1 ? "mốt" : tens > 0 && units === 5 ? "lăm" : digit[units]);
    return parts.join(" ");
  };
  const rounded = Math.round(value);
  if (rounded === 0) return "Không đồng chẵn";
  const groups: number[] = [];
  for (let rest = rounded; rest > 0; rest = Math.floor(rest / 1000)) groups.unshift(rest % 1000);
  const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
  const result = groups.map((group, index) => {
    if (!group) return "";
    const position = groups.length - index - 1;
    return `${readGroup(group, index > 0 && group < 100)} ${units[position] ?? ""}`.trim();
  }).filter(Boolean).join(" ");
  return `${result.charAt(0).toUpperCase()}${result.slice(1)} đồng chẵn`;
}

function priceTable(contract: Contract) {
  const widths = [550, 3510, 840, 1100, 1840, 2266];
  const header = ["STT", "Nội dung", "ĐVT", "Khối lượng", "Đơn giá", "Thành tiền"];
  const rows = [header, ...contract.lines.map((line, index) => [String(index + 1), line.name, line.unit, String(line.quantity), money(line.unitPrice, contract.currency), money(line.lineTotal, contract.currency)])];
  const rowXml = rows.map((row, rowIndex) => `<w:tr><w:trPr><w:cantSplit/>${rowIndex === 0 ? "<w:tblHeader/>" : ""}</w:trPr>${row.map((cell, index) => `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>${p(cell, { bold: rowIndex === 0, center: index !== 1, size: 20, after: 0 })}</w:tc>`).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="10106" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="6"/><w:left w:val="single" w:sz="6"/><w:bottom w:val="single" w:sz="6"/><w:right w:val="single" w:sz="6"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rowXml}</w:tbl>`;
}

function signatures() {
  return `<w:tbl><w:tblPr><w:tblW w:w="10106" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="5053"/><w:gridCol w:w="5053"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${["ĐẠI DIỆN BÊN A", "ĐẠI DIỆN BÊN B"].map((label) => `<w:tc><w:tcPr><w:tcW w:w="5053" w:type="dxa"/></w:tcPr>${p(label, { bold: true, center: true, after: 80 })}${p("(Ký, ghi rõ họ tên)", { italic: true, center: true, after: 700 })}</w:tc>`).join("")}</w:tr></w:tbl>`;
}

function makePackage(contract: Contract, body: string[]) {
  const zip = new PizZip();
  const company = contract.companyName.toUpperCase();
  const header = `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p(company, { bold: true, center: true, size: 19, after: 45 })}${p(`Địa chỉ: ${contract.companyAddress} · ĐT: ${contract.companyPhone || "—"} · Email: ${contract.companyEmail || "—"}`, { center: true, size: 16, after: 0 })}</w:hdr>`;
  const footer = `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p("", { after: 0 })}<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr="PAGE"/></w:p></w:ftr>`;
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
  zip.folder("_rels")!.file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.folder("word")!.file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`);
  zip.folder("word")!.file("header1.xml", header);
  zip.folder("word")!.file("footer1.xml", footer);
  zip.folder("word")!.folder("_rels")!.file("document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
  zip.folder("word")!.file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join("")}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1550" w:right="850" w:bottom="1100" w:left="850" w:header="540" w:footer="540"/></w:sectPr></w:body></w:document>`);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export function makePdfReferenceContractWord(contract: Contract): Buffer {
  const date = contract.signedDate ? new Date(`${contract.signedDate}T00:00:00Z`) : null;
  const dateText = date ? `ngày ${date.getUTCDate()} tháng ${date.getUTCMonth() + 1} năm ${date.getUTCFullYear()}` : "ngày … tháng … năm …";
  const balance = Math.max(0, contract.total - contract.depositAmount);
  const body: string[] = [];
  body.push(p("HỢP ĐỒNG TƯ VẤN THIẾT KẾ", { center: true, bold: true, size: 36, before: 1100, after: 170 }));
  body.push(p(`Số: ${contract.contractNumber}`, { center: true, italic: true, size: 26, after: 480 }));
  if (contract.status === "draft") body.push(p("BẢN NHÁP", { center: true, bold: true, after: 300 }));
  body.push(p(`CÔNG TRÌNH: ${contract.projectName.toUpperCase()}`, { bold: true, size: 27, after: 160 }));
  body.push(p(`HẠNG MỤC: ${contract.scope.toUpperCase()}`, { bold: true, size: 25, after: 150 }));
  body.push(p(`ĐỊA ĐIỂM XÂY DỰNG: ${contract.projectAddress.toUpperCase()}`, { bold: true, size: 25, after: 150 }));
  body.push(p(`CHỦ ĐẦU TƯ: ${contract.customerName.toUpperCase()}`, { bold: true, size: 25, after: 920 }));
  body.push(p(`${contract.signingPlace.toUpperCase()}, ${dateText.toUpperCase()}`, { center: true, bold: true, size: 23, after: 0 }));
  body.push(p("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", { center: true, bold: true, pageBreakBefore: true, after: 70 }));
  body.push(p("Độc lập – Tự do – Hạnh phúc", { center: true, after: 180 }));
  body.push(p("-------o0o-------", { center: true, after: 170 }));
  body.push(p("HỢP ĐỒNG TƯ VẤN THIẾT KẾ", { center: true, bold: true, size: 30, after: 80 }));
  body.push(p(`Số: ${contract.contractNumber}`, { center: true, after: 200 }));
  if (contract.status === "draft") body.push(p("BẢN NHÁP", { center: true, bold: true, after: 160 }));
  body.push(p("Căn cứ vào Bộ Luật Dân sự số 91/2015/QH13 ngày 24/11/2015, có hiệu lực từ ngày 01/01/2017."));
  body.push(p("Căn cứ Luật Thương mại số 36/2005/QH11 ngày 14/06/2005."));
  body.push(p("Căn cứ Luật Xây dựng số 50/2014/QH13 ngày 18/06/2014."));
  body.push(p("Căn cứ vào khả năng và nhu cầu hai bên."));
  body.push(p(`Hôm nay, ${dateText}, tại ${contract.signingPlace}, chúng tôi gồm các bên dưới đây:`));
  body.push(heading("BÊN A: CHỦ ĐẦU TƯ"));
  body.push(p(`Tên: ${contract.customerName}`));
  body.push(p(`Đại diện: ${contract.customerRepresentative} · Địa chỉ: ${contract.customerAddress}`));
  body.push(p(`Mã số thuế: ${contract.customerTaxId || "—"} · Điện thoại: ${contract.customerPhone || "—"} · Email: ${contract.customerEmail || "—"}`));
  body.push(heading("BÊN B: ĐƠN VỊ THIẾT KẾ"));
  body.push(p(contract.companyName.toUpperCase(), { bold: true }));
  body.push(p(`Địa chỉ: ${contract.companyAddress} · MST: ${contract.companyTaxId || "—"}`));
  body.push(p(`Đại diện: ${contract.companyRepresentative} · Điện thoại: ${contract.companyPhone || "—"}`));
  body.push(p(`Tài khoản: ${contract.bankDetails || "—"}`));
  body.push(p("Sau khi bàn bạc, hai bên thống nhất ký hợp đồng với các điều khoản như sau:"));
  body.push(heading("ĐIỀU 1: NỘI DUNG CÔNG VIỆC"));
  body.push(p(`1.1. Bên A giao cho Bên B thực hiện ${contract.scope} tại ${contract.projectAddress} theo yêu cầu của Bên A.`));
  body.push(p(`1.2. Thời gian thiết kế và tiến độ thực hiện: ${contract.deliveryTerms}`));
  body.push(p("1.3. Gia hạn thời gian thiết kế: Bên B được phép đề nghị gia hạn thời gian hoàn thành hồ sơ thiết kế nếu có sự thay đổi phạm vi công việc theo yêu cầu của Chủ đầu tư làm ảnh hưởng tới tiến độ thực hiện hợp đồng, hoặc do trường hợp bất khả kháng như động đất, bão, lũ, lụt, lốc, sóng thần, chiến tranh, dịch bệnh."));
  body.push(p(`1.4. Nội dung hồ sơ thiết kế, sản phẩm bàn giao: ${contract.deliverables}`));
  body.push(p(`1.5. Phương thức bàn giao: ${contract.deliveryTerms}`));
  body.push(heading("ĐIỀU 2: GIÁ TRỊ HỢP ĐỒNG"));
  body.push(p(`Tổng giá trị hợp đồng: ${money(contract.total, contract.currency)}${contract.currency === "VND" ? ` (Bằng chữ: ${words(contract.total, contract.currency)}.)` : ""}`, { bold: true }));
  body.push(p("CHI TIẾT NHƯ SAU", { bold: true, center: true, before: 180, after: 100 }));
  body.push(priceTable(contract));
  body.push(p(`Tạm tính: ${money(contract.subtotal, contract.currency)}`, { after: 65 }));
  body.push(p(`Thuế VAT (${contract.taxRate * 100}%): ${money(contract.taxAmount, contract.currency)} · Vận chuyển: ${money(contract.shippingFee, contract.currency)}`, { after: 65 }));
  body.push(p(`GIÁ TRỊ HỢP ĐỒNG (ĐÃ BAO GỒM THUẾ): ${money(contract.total, contract.currency)}`, { bold: true, after: 80 }));
  if (contract.currency === "VND") body.push(p(`Bằng chữ: ${words(contract.total, contract.currency)}.`, { italic: true }));
  body.push(heading("ĐIỀU 3: TẠM ỨNG VÀ THANH TOÁN"));
  body.push(p(`3.1. Phương thức và điều khoản thanh toán: ${contract.paymentTerms}`));
  body.push(p(`3.2. Lần 1: Bên A đặt cọc cho Bên B ${money(contract.depositAmount, contract.currency)}${contract.currency === "VND" ? ` (Bằng chữ: ${words(contract.depositAmount, contract.currency)}.)` : ""} sau khi hai bên ký hợp đồng.`));
  body.push(p(`Lần 2: Bên A thanh toán số tiền còn lại ${money(balance, contract.currency)}${contract.currency === "VND" ? ` (Bằng chữ: ${words(balance, contract.currency)}.)` : ""} theo điều khoản thanh toán đã thống nhất.`));
  body.push(heading("ĐIỀU 4: QUYỀN HẠN VÀ NGHĨA VỤ CỦA HAI BÊN"));
  body.push(p("4.1. Quyền và nghĩa vụ của Bên A", { bold: true }));
  body.push(p("- Bên A cung cấp đầy đủ tài liệu, hồ sơ pháp lý, chỉ dẫn khu vực mặt bằng liên quan đến việc thực hiện công việc trong hợp đồng của Bên B."));
  body.push(p("- Chủ trì, phối hợp với các bên liên quan giải quyết kịp thời những vướng mắc phát sinh trong quá trình thiết kế, phê duyệt và xây dựng công trình."));
  body.push(p("- Nghiệm thu, thanh toán khối lượng công việc cho Bên B theo đúng cam kết trong hợp đồng."));
  body.push(p("4.2. Quyền và nghĩa vụ của Bên B", { bold: true }));
  body.push(p("- Thực hiện các nội dung trong hợp đồng, bảo đảm chất lượng, yêu cầu kỹ thuật theo quy định hiện hành và tiến độ hợp đồng."));
  body.push(p("- Chịu trách nhiệm về chất lượng hồ sơ thiết kế của đơn vị mình và tiến độ bàn giao theo Điều 1 của hợp đồng."));
  body.push(p("- Không tiết lộ thông tin, tài liệu liên quan đến việc thiết kế, xây dựng do mình đảm nhận khi chưa được phép của Bên A hoặc người có thẩm quyền."));
  body.push(p("- Xem xét, giải quyết kịp thời đề nghị của Chủ đầu tư về những bất hợp lý trong thiết kế; phối hợp với Bên A tham gia nghiệm thu công việc đã thực hiện."));
  body.push(heading("ĐIỀU 5: BẤT KHẢ KHÁNG"));
  body.push(p("- Sự kiện bất khả kháng gồm các hiện tượng tự nhiên xảy ra ngoài tầm kiểm soát của các bên hoặc các thảm họa khác chưa lường hết được."));
  body.push(p("- Một bên không hoàn thành nghĩa vụ do sự kiện bất khả kháng không phải là cơ sở để bên kia chấm dứt hợp đồng; các bên có nghĩa vụ áp dụng biện pháp hợp lý để hạn chế tối đa ảnh hưởng."));
  body.push(p("- Khi xảy ra sự kiện bất khả kháng, các bên thông báo cho nhau để kịp thời phối hợp giải quyết."));
  body.push(p("- Thời gian thực hiện hợp đồng được kéo dài tương ứng với thời gian bị ảnh hưởng bởi sự kiện bất khả kháng."));
  body.push(heading("ĐIỀU 6: TRANH CHẤP VÀ GIẢI QUYẾT TRANH CHẤP"));
  body.push(p("- Trong quá trình thực hiện, nếu xảy ra tranh chấp hợp đồng, hai bên có trách nhiệm giải quyết bằng phương pháp thương lượng."));
  body.push(p("- Nếu không giải quyết được bằng thương lượng, tranh chấp được đưa ra tòa án hoặc cơ quan nhà nước có thẩm quyền để giải quyết; lệ phí và chi phí phát sinh được xử lý theo quyết định của cơ quan có thẩm quyền."));
  body.push(heading("ĐIỀU 7: TẠM DỪNG VÀ HỦY BỎ HỢP ĐỒNG"));
  body.push(p("7.1. Tạm dừng hợp đồng", { bold: true }));
  body.push(p("- Do lỗi của Bên A hoặc Bên B, do điều kiện bất khả kháng hoặc do thỏa thuận của hai bên."));
  body.push(p("- Khi xảy ra sự kiện bất khả kháng, hai bên thông báo kịp thời cho nhau; thời gian và mức đền bù tạm dừng do hai bên thỏa thuận."));
  body.push(p("- Bên B có quyền dừng hợp đồng nếu Bên A không tạm ứng theo Điều 3 của hợp đồng."));
  body.push(p("7.2. Hủy bỏ hợp đồng", { bold: true }));
  body.push(p("- Một bên tự ý hủy bỏ hợp đồng đã ký phải chịu phạt 5% tổng giá trị hợp đồng."));
  body.push(p("- Bên muốn hủy bỏ phải thông báo cho bên còn lại và thanh toán đầy đủ khối lượng công việc đã nghiệm thu."));
  body.push(heading("ĐIỀU 8: CHẤM DỨT HỢP ĐỒNG"));
  body.push(p("Hợp đồng chấm dứt khi các bên hoàn thành đầy đủ nghĩa vụ; các bên thỏa thuận chấm dứt trước hạn; sự kiện bất khả kháng kéo dài quá 30 ngày liên tục; hoặc một bên bị giải thể, phá sản theo quy định pháp luật."));
  body.push(heading("ĐIỀU 9: ĐIỀU KHOẢN CHUNG"));
  body.push(p("- Hợp đồng có hiệu lực kể từ ngày ký và tự động thanh lý khi hai bên hoàn thành nghĩa vụ."));
  body.push(p("- Hợp đồng và các tài liệu liên quan được các bên quản lý, bảo mật theo quy định hiện hành; hai bên thống nhất thực hiện đúng và đủ các điều khoản hợp đồng."));
  body.push(p("- Hợp đồng được lập thành 02 (hai) bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản để làm căn cứ thực hiện."));
  if (contract.otherTerms) body.push(p(`Điều khoản bổ sung: ${contract.otherTerms}`));
  body.push(signatures());
  body.push(p("TẠM ỨNG VÀ THANH TOÁN HỢP ĐỒNG", { center: true, bold: true, size: 28, pageBreakBefore: true, after: 250 }));
  body.push(heading("1. TẠM ỨNG HỢP ĐỒNG"));
  body.push(p(`Hôm nay, ${dateText}, Bên A đặt cọc cho Bên B số tiền ${money(contract.depositAmount, contract.currency)}.`));
  if (contract.currency === "VND") body.push(p(`Bằng chữ: ${words(contract.depositAmount, contract.currency)}.`));
  body.push(signatures());
  body.push(heading("2. THANH TOÁN HỢP ĐỒNG"));
  body.push(p(`Bên A thanh toán cho Bên B số tiền còn lại sau khi trừ tạm ứng: ${money(balance, contract.currency)}.`));
  if (contract.currency === "VND") body.push(p(`Bằng chữ: ${words(balance, contract.currency)}.`));
  body.push(signatures());
  return makePackage(contract, body);
}
