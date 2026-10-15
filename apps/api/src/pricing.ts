import { config } from "./config.js";
import type { CatalogItem, QuoteLine } from "./types.js";

export function calculateQuote(items: CatalogItem[], requested: Array<{
  catalogItemId: string;
  quantity: number;
  unit: string;
  attributes?: Record<string, string>;
}>) {
  const byId = new Map(items.map((item) => [String(item._id), item]));
  const lines: QuoteLine[] = requested.map((requestedLine) => {
    const item = byId.get(requestedLine.catalogItemId);
    if (!item || !item.active) throw new Error("Một mặt hàng không còn trong danh mục đang hoạt động.");
    if (!Number.isFinite(requestedLine.quantity) || requestedLine.quantity <= 0 || requestedLine.quantity > 1_000_000) {
      throw new Error("Số lượng phải lớn hơn 0 và không vượt quá 1.000.000.");
    }
    if (requestedLine.unit.trim() !== item.unit) {
      throw new Error(`Đơn vị của ${item.sku} phải là ${item.unit}.`);
    }
    const lineTotal = roundMoney(item.price * requestedLine.quantity);
    return {
      catalogItemId: String(item._id),
      sku: item.sku,
      name: item.name,
      quantity: requestedLine.quantity,
      unit: item.unit,
      unitPrice: item.price,
      currency: item.currency,
      attributes: requestedLine.attributes ?? {},
      lineTotal,
    };
  });
  if (lines.length === 0) throw new Error("Báo giá cần có ít nhất một mặt hàng.");
  const currencies = new Set(lines.map((line) => line.currency));
  if (currencies.size !== 1) throw new Error("Các mặt hàng trong một báo giá phải cùng tiền tệ.");
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const taxAmount = roundMoney(subtotal * config.taxRate);
  return { lines, subtotal, taxRate: config.taxRate, taxAmount, total: roundMoney(subtotal + taxAmount), currency: lines[0].currency };
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function recalculateSnapshot(lines: QuoteLine[], requested: Array<{ catalogItemId: string; quantity: number }>, taxRate: number) {
  const existing = new Map(lines.map((line) => [line.catalogItemId, line]));
  const updatedLines = requested.map(({ catalogItemId, quantity }) => {
    const previous = existing.get(catalogItemId);
    if (!previous) throw new Error("Không thể thêm mặt hàng chưa có trong báo giá.");
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
      throw new Error("Số lượng phải lớn hơn 0 và không vượt quá 1.000.000.");
    }
    return { ...previous, quantity, lineTotal: roundMoney(previous.unitPrice * quantity) };
  });
  if (updatedLines.length === 0) throw new Error("Báo giá cần có ít nhất một mặt hàng.");
  const subtotal = roundMoney(updatedLines.reduce((sum, line) => sum + line.lineTotal, 0));
  const taxAmount = roundMoney(subtotal * taxRate);
  return { lines: updatedLines, subtotal, taxRate, taxAmount, total: roundMoney(subtotal + taxAmount), currency: lines[0].currency };
}
