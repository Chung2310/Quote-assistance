function normalizedText(value: string) {
  return value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
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
  return /\b(vat|thue|tax)\b/.test(normalizedText(value));
}

export function isShippingInformation(value: string) {
  const text = normalizedText(value);
  return /\b(van chuyen|shipping|delivery fee|phi giao hang)\b/.test(text);
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
