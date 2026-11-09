import { roundMoney } from "./pricing.js";
import type { AcceptanceRecord, Contract, Quote } from "./types.js";

/** Reuse the agreed tax and shipping only when they reconcile with the saved settlement. */
export function acceptanceFinancials(contract: Contract, record: AcceptanceRecord, acceptedSubtotal: number) {
  const taxAmount = roundMoney(acceptedSubtotal * contract.taxRate);
  const reconciles = roundMoney(acceptedSubtotal + taxAmount + contract.shippingFee) === roundMoney(record.settlementAmount);
  return {
    subtotal: acceptedSubtotal,
    taxRate: reconciles ? contract.taxRate : 0,
    taxAmount: reconciles ? taxAmount : 0,
    taxRateConfirmed: reconciles,
    shippingFee: reconciles ? contract.shippingFee : null,
    shippingFeeConfirmed: reconciles,
    total: record.settlementAmount,
  };
}

export function settlementContractContext(contract: Contract): NonNullable<Quote["settlement"]>["contract"] {
  return {
    contractNumber: contract.contractNumber, signedDate: contract.signedDate,
    customerName: contract.customerName, customerAddress: contract.customerAddress, customerRepresentative: contract.customerRepresentative,
    customerTaxId: contract.customerTaxId, customerEmail: contract.customerEmail, customerPhone: contract.customerPhone,
    companyName: contract.companyName, companyAddress: contract.companyAddress, companyRepresentative: contract.companyRepresentative,
    companyTaxId: contract.companyTaxId, companyEmail: contract.companyEmail, companyPhone: contract.companyPhone,
    scope: contract.scope, deliverables: contract.deliverables, paymentTerms: contract.paymentTerms, deliveryTerms: contract.deliveryTerms,
    subtotal: contract.subtotal, taxRate: contract.taxRate, taxAmount: contract.taxAmount, shippingFee: contract.shippingFee,
    total: contract.total, currency: contract.currency, depositAmount: contract.depositAmount,
  };
}
