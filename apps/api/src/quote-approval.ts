import { isShippingInformation, isSupplementalProductInformation, isSupplementalQuestion, isTaxInformation } from "./quote-terms.js";
import type { Quote } from "./types.js";

type ApprovalInformation = Pick<Quote, "informationNeeded" | "additionalInformation" | "lines" | "requiresAiRecalculation" | "taxRateConfirmed" | "shippingFeeConfirmed" | "shippingFee">;

export function quoteApprovalBlockers(quote: ApprovalInformation): string[] {
  const taxConfirmed = quote.taxRateConfirmed ?? !quote.informationNeeded.some(isTaxInformation);
  const shippingConfirmed = quote.shippingFeeConfirmed ?? (quote.shippingFee != null || !quote.informationNeeded.some(isShippingInformation));
  const reasons: string[] = [];
  if (quote.requiresAiRecalculation === true) reasons.push("Có thông tin mới chưa được áp dụng. Hãy lưu và chạy lại dự toán trước khi duyệt.");
  if (!taxConfirmed) reasons.push("VAT chưa chốt. Hãy chọn 0% hoặc nhập thuế suất VAT.");
  if (!shippingConfirmed) reasons.push("Phí vận chuyển chưa chốt. Hãy chọn miễn phí hoặc nhập số tiền vận chuyển.");
  if (quote.lines.some((line) => line.priceUnavailable)) reasons.push("Cần bổ sung đơn giá cho các sản phẩm chưa có giá.");
  const missing = quote.informationNeeded.filter((field) => {
    if (isSupplementalQuestion(field)) return false;
    return isSupplementalProductInformation(field)
      ? !quote.lines.some((line) => line.source === "supplemental" && line.supplementalFor === field && !line.priceUnavailable)
      : !quote.additionalInformation?.[field]?.trim();
  });
  const otherMissing = missing.filter((field) => !(!taxConfirmed && isTaxInformation(field)) && !(!shippingConfirmed && isShippingInformation(field)));
  if (otherMissing.length) reasons.push(`Cần xác nhận thông tin bắt buộc: ${otherMissing.join("; ")}.`);
  return reasons;
}

export function quoteHasApprovalBlockers(quote: ApprovalInformation) {
  return quoteApprovalBlockers(quote).length > 0;
}
