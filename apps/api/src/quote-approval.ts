import { isShippingInformation, isSupplementalProductInformation, isSupplementalQuestion, isTaxInformation } from "./quote-terms.js";
import type { Quote } from "./types.js";

type ApprovalInformation = Pick<Quote, "informationNeeded" | "additionalInformation" | "lines" | "requiresAiRecalculation" | "taxRateConfirmed" | "shippingFeeConfirmed" | "shippingFee">;

export function quoteHasApprovalBlockers(quote: ApprovalInformation) {
  const taxConfirmed = quote.taxRateConfirmed ?? !quote.informationNeeded.some(isTaxInformation);
  const shippingConfirmed = quote.shippingFeeConfirmed ?? (quote.shippingFee != null || !quote.informationNeeded.some(isShippingInformation));
  return quote.requiresAiRecalculation === true || !taxConfirmed || !shippingConfirmed
    || quote.lines.some((line) => line.priceUnavailable)
    || quote.informationNeeded.some((field) => {
      if (isSupplementalQuestion(field)) return false;
      return isSupplementalProductInformation(field)
        ? !quote.lines.some((line) => line.source === "supplemental" && line.supplementalFor === field && !line.priceUnavailable)
        : !quote.additionalInformation?.[field]?.trim();
    });
}
