function normalizedText(value: string) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

export function isSupplementalQuestion(value: string) {
  return normalizedText(value).trim().startsWith("cau hoi bo sung:");
}

export function isGenericMissingPriceWarning(value: string) {
  const text = normalizedText(value);
  const saysPriceIsMissing = /\b(khong co|chua co|khong tim thay|khong xac dinh|thieu|missing|not found|no|without|unavailable)\b/.test(text) && /\b(don gia|gia|price|pricing)\b/.test(text);
  const refersToEveryLine = /\b(tung dong|moi dong|tat ca dong|tung hang muc|moi hang muc|tat ca hang muc|tung san pham|moi san pham|tat ca san pham|tung mat hang|moi mat hang|tat ca mat hang|each line|every line|any line|all lines|each item|every item|any item|all items)\b/.test(text);
  return saysPriceIsMissing && refersToEveryLine;
}

export function isResolvedQuoteTermWarning(value: string, terms: { validityDays?: number | null; completionDate?: string | null }) {
  if (!/xác nhận|confirm/i.test(value)) return false;
  const asksValidity = /hiệu lực|thời hạn|validity/i.test(value);
  const asksCompletion = /hoàn thành|bàn giao|completion|delivery date/i.test(value);
  if (!asksValidity && !asksCompletion) return false;
  return (!asksValidity || terms.validityDays != null) && (!asksCompletion || terms.completionDate != null);
}

export function cleanMissingInformation(fields: string[], hasPricedItems: boolean) {
  return [...new Set(fields.map((field) => field.trim()).filter(Boolean))]
    .filter((field) => !(hasPricedItems && isGenericMissingPriceWarning(field)))
    .slice(0, 30);
}

export function isTaxInformation(value: string) {
  if (normalizedText(value).startsWith("cau hoi bo sung:")) return false;
  return /\b(vat|thue|tax)\b/.test(normalizedText(value));
}

export function isShippingInformation(value: string) {
  const text = normalizedText(value);
  if (text.startsWith("cau hoi bo sung:")) return false;
  return /\b(van chuyen|shipping|delivery fee|phi giao hang)\b/.test(text);
}

/** A confirmed charge answers amount/rate questions, not questions about its scope or tax-inclusive prices. */
export function isAnsweredQuoteChargeQuestion(value: string, terms: { taxRate: number; taxRateConfirmed?: boolean; shippingFee?: number | null; shippingFeeConfirmed?: boolean }) {
  if (!isSupplementalQuestion(value)) return false;
  const question = normalizedText(value).trim().replace(/^cau hoi bo sung:\s*/, "");
  const tax = isTaxInformation(question);
  const shipping = isShippingInformation(question);
  if (!tax && !shipping) return false;
  const asksAmount = /\b(xac nhan|chot|thue suat|ty le|muc|bao nhieu|so tien|rate|amount|confirm)\b|\d\s*%/.test(question);
  const bareCharge = /^(?:(?:muc|thue suat)\s+)?(?:vat|thue(?:\s+gtgt)?|tax(?:\s+rate)?|(?:phi\s+)?van chuyen|phi giao hang|shipping(?:\s+fee)?|delivery fee)(?:\s+ap dung)?\s*[?.!:]*$/.test(question);
  if (!asksAmount && !bareCharge) return false;
  if (/\b(don gia|gia ban|gia san pham|bao gom|da gom|chua gom|truoc thue|sau thue|hoa don|ma so thue|khau tru|tung san pham|tung hang muc|thoi gian|thoi diem|ngay|gio|dia chi|dia diem|khu vuc|dia ban|dia hinh|khoang cach|quang duong|phuong thuc|hinh thuc|phuong tien|don vi van chuyen|ben nao|ai chiu|boc xep|van chuyen len|so luong|khoi luong|dinh muc|mau sac|vat lieu|kich thuoc|dien tich|chiet khau|giam gia|bao hanh|bao tri|dat coc|tam ung|thanh toan|tien do|unit price|inclusive|including|included|excluding|excluded|gross|net|invoice|address|location|when|time|date|distance|who|unloading|quantity|coverage|color|dimensions|size|discount|warranty|deposit|payment)\b/.test(question)) return false;
  return (!tax || terms.taxRateConfirmed === true && Number.isFinite(terms.taxRate) && terms.taxRate >= 0 && terms.taxRate <= 1)
    && (!shipping || terms.shippingFeeConfirmed === true && typeof terms.shippingFee === "number" && Number.isFinite(terms.shippingFee) && terms.shippingFee >= 0);
}

export function isSupplementalProductInformation(value: string) {
  const text = normalizedText(value);
  if (text.startsWith("cau hoi bo sung:")) return false;
  return /\b(san pham|mat hang|hang muc|nhan cong|vat tu|don gia|gia|ma hang|ma san pham|product|item|labor|material|sku|price|pricing|mosaic|op lat|gach|trang tri|decoration|finishing|installation|thi cong|lap dat)\b/.test(text);
}

export function extractQuoteTerms(requestText: string) {
  const validityMatch = /(?:hieu luc|thoi han)[^\d]{0,30}(\d{1,3})\s*ngay/i.exec(normalizedText(requestText));
  const dateMatch = /(?:truoc\s*(?:ngay)?|hoan thanh\s*(?:truoc\s*)?(?:ngay)?|ban giao\s*(?:truoc\s*)?(?:ngay)?)\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/i.exec(normalizedText(requestText));
  let completionDate: string | undefined;
  if (dateMatch) {
    const [, dayText, monthText, yearText] = dateMatch;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      completionDate = `${yearText}-${monthText!.padStart(2, "0")}-${dayText!.padStart(2, "0")}`;
    }
  }
  return {
    ...(validityMatch ? { validityDays: Number(validityMatch[1]) } : {}),
    ...(completionDate ? { completionDate } : {}),
  };
}

export function extractQuoteCharges(requestText: string, currency = "VND"): { taxRate?: number; shippingFee?: number; taxQuestion?: string; shippingQuestion?: string } {
  const text = normalizedText(requestText);
  const result: { taxRate?: number; shippingFee?: number; taxQuestion?: string; shippingQuestion?: string } = {};
  const taxClauses = [...text.matchAll(/\b(?:vat|thue(?:\s+(?:gtgt|gia tri gia tang))?)\b/g)]
    .map((match) => text.slice(match.index, match.index! + 90).split(/[;\n]/)[0]!.split(/(?<=%)\s*[,.;]/)[0]!);
  if (taxClauses.length) {
    const rates = [...new Set(taxClauses.flatMap((clause) => [...clause.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((match) => Number(match[1]!.replace(",", ".")) / 100)))];
    const priceIncludesTax = /\b(?:don gia|gia)[^;\n]{0,45}\b(?:da (?:bao )?gom|bao gom|gom)[^;\n]{0,15}\b(?:vat|thue)\b/.test(text);
    if (rates.length === 1 && rates[0]! >= 0 && rates[0]! <= 1 && !priceIncludesTax) result.taxRate = rates[0];
    else result.taxQuestion = priceIncludesTax ? "VAT: cần xác nhận đơn giá trước thuế vì yêu cầu nêu giá đã bao gồm thuế." : "VAT: cần xác nhận một thuế suất cụ thể từ 0 đến 100%.";
  }
  const shipping = /\b(?:phi\s+van chuyen|van chuyen|phi\s+giao hang|shipping(?:\s+fee)?)\b/;
  if (shipping.test(text)) {
    const matches = [...text.matchAll(/\b(?:phi\s+van chuyen|van chuyen|phi\s+giao hang|shipping(?:\s+fee)?)\s*(?:(?:co dinh|la|:|=|tam tinh|khoang)\s*)*([+-]?\d[\d.,]*(?:\s+\d{3})*)(?:\s*(vnd|dong|trieu|nghin|ngan|usd|eur|k|d)(?![a-z]))?/g)];
    const amounts = matches.map((match) => {
      let value = match[1]!.replace(/\s/g, "");
      const suffix = match[2];
      if (["usd", "eur"].includes(suffix ?? "") && suffix!.toUpperCase() !== currency) return NaN;
      if (["vnd", "dong", "d", "trieu", "nghin", "ngan", "k"].includes(suffix ?? "") && currency !== "VND") return NaN;
      if (/^[+-]?\d{1,3}(?:[.,]\d{3})+$/.test(value)) value = value.replace(/[.,]/g, "");
      else if (value.includes(".") && value.includes(",")) {
        const decimal = value.lastIndexOf(",") > value.lastIndexOf(".") ? "," : ".";
        value = value.replaceAll(decimal === "," ? "." : ",", "").replace(decimal, ".");
      } else value = value.replace(",", ".");
      return Number(value) * (suffix === "trieu" ? 1_000_000 : ["nghin", "ngan", "k"].includes(suffix ?? "") ? 1000 : 1);
    });
    if (/\b(?:mien phi (?:van chuyen|giao hang)|khong co phi van chuyen)\b/.test(text)) amounts.push(0);
    const unique = [...new Set(amounts)];
    if (unique.length === 1 && Number.isFinite(unique[0]) && unique[0]! >= 0 && unique[0]! <= 1e12) result.shippingFee = unique[0];
    else result.shippingQuestion = "Phí vận chuyển: cần xác nhận một số tiền cụ thể theo đơn vị tiền tệ của dự toán.";
  }
  return result;
}
