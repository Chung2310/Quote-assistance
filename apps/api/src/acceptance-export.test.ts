import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceFinancials, settlementContractContext } from "./acceptance-export.js";
import type { AcceptanceRecord, Contract } from "./types.js";

const contract = { contractNumber: "HD-TEST", taxRate: 0.08, shippingFee: 350_000, total: 24_015_500, companyName: "Bên bán hiện tại", customerName: "Bên mua hiện tại", signedDate: "2026-11-09" } as Contract;
const record = { settlementAmount: 17_382_950 } as AcceptanceRecord;

test("partial acceptance keeps agreed VAT and shipping when they reconcile with its confirmed total", () => {
  assert.deepEqual(acceptanceFinancials(contract, record, 15_771_250), {
    subtotal: 15_771_250, taxRate: 0.08, taxAmount: 1_261_700, taxRateConfirmed: true,
    shippingFee: 350_000, shippingFeeConfirmed: true, total: 17_382_950,
  });
});

test("a negotiated settlement preserves its saved total without inventing a tax breakdown", () => {
  const summary = acceptanceFinancials(contract, { ...record, settlementAmount: 16_000_000 }, 15_771_250);
  assert.equal(summary.total, 16_000_000);
  assert.equal(summary.taxRateConfirmed, false);
  assert.equal(summary.shippingFeeConfirmed, false);
  assert.equal(summary.shippingFee, null);
});

test("zero-tax, zero-shipping settlements remain supported", () => {
  const summary = acceptanceFinancials({ ...contract, taxRate: 0, shippingFee: 0 }, { ...record, settlementAmount: 6_720_000 }, 6_720_000);
  assert.equal(summary.taxRate, 0);
  assert.equal(summary.taxRateConfirmed, true);
  assert.equal(summary.shippingFee, 0);
  assert.equal(summary.shippingFeeConfirmed, true);
});

test("settlement context contains the actual parties and contract date, not template example values", () => {
  const context = settlementContractContext(contract)!;
  assert.equal(context.companyName, contract.companyName);
  assert.equal(context.customerName, contract.customerName);
  assert.equal(context.signedDate, contract.signedDate);
  assert.equal(context.total, contract.total);
});
