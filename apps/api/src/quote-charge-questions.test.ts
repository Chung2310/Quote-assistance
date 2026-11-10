import assert from "node:assert/strict";
import test from "node:test";
import { isAnsweredQuoteChargeQuestion } from "./quote-terms.js";

const confirmed = { taxRate: .08, taxRateConfirmed: true, shippingFee: 275000, shippingFeeConfirmed: true };
const vatQuestion = "Câu hỏi bổ sung: Áp dụng VAT 8% hay 10%?";
const shippingQuestion = "Câu hỏi bổ sung: Xác nhận phí vận chuyển là bao nhiêu?";

test("confirmed form fields answer supplemental questions asking only for VAT or the shipping amount", () => {
  for (const field of [vatQuestion, shippingQuestion, "Câu hỏi bổ sung: VAT?", "Câu hỏi bổ sung: Phí vận chuyển?", " CAU HOI BO SUNG: Shipping fee?", "Câu hỏi bổ sung: Xác nhận VAT và phí vận chuyển?"]) {
    assert.equal(isAnsweredQuoteChargeQuestion(field, confirmed), true, field);
  }
  assert.equal(isAnsweredQuoteChargeQuestion(vatQuestion, { ...confirmed, taxRateConfirmed: false }), false);
  assert.equal(isAnsweredQuoteChargeQuestion(shippingQuestion, { ...confirmed, shippingFeeConfirmed: false }), false);
});

test("confirmed zero VAT and free shipping are values; zero without confirmation is not an answer", () => {
  const zero = { taxRate: 0, taxRateConfirmed: true, shippingFee: 0, shippingFeeConfirmed: true };
  assert.equal(isAnsweredQuoteChargeQuestion(vatQuestion, zero), true);
  assert.equal(isAnsweredQuoteChargeQuestion(shippingQuestion, zero), true);
  assert.equal(isAnsweredQuoteChargeQuestion(vatQuestion, { ...zero, taxRateConfirmed: false }), false);
  assert.equal(isAnsweredQuoteChargeQuestion(shippingQuestion, { ...zero, shippingFeeConfirmed: false }), false);
  assert.equal(isAnsweredQuoteChargeQuestion(shippingQuestion, { ...zero, shippingFee: null }), false);
});

test("confirming charges does not resolve price inclusion, delivery scope, scheduling or mixed questions", () => {
  for (const field of [
    "Câu hỏi bổ sung: Đơn giá đã bao gồm VAT chưa?",
    "Câu hỏi bổ sung: Phí vận chuyển đã bao gồm bốc xếp chưa?",
    "Câu hỏi bổ sung: Địa chỉ giao hàng để tính phí vận chuyển?",
    "Câu hỏi bổ sung: Thời gian giao hàng và phí vận chuyển?",
    "Câu hỏi bổ sung: VAT 8% hay 10%, giao hàng vào ngày nào?",
    "Câu hỏi bổ sung: VAT và chiết khấu áp dụng thế nào?",
    "Câu hỏi bổ sung: Diện tích cần dùng bao nhiêu vật tư?",
    "Câu hỏi bổ sung: Is VAT included in the unit price?",
    "Câu hỏi bổ sung: Shipping fee and delivery address?",
    "Câu hỏi bổ sung: VAT có được hoàn lại không?",
    "Câu hỏi bổ sung: Phí vận chuyển phụ thuộc vào điều kiện nào?",
    "Sản phẩm cần bổ sung giá: Dịch vụ vận chuyển",
  ]) assert.equal(isAnsweredQuoteChargeQuestion(field, confirmed), false, field);
});

test("a combined VAT and shipping question needs both fields confirmed and valid", () => {
  const question = "Câu hỏi bổ sung: VAT và phí vận chuyển áp dụng bao nhiêu?";
  assert.equal(isAnsweredQuoteChargeQuestion(question, confirmed), true);
  for (const terms of [{ ...confirmed, taxRateConfirmed: false }, { ...confirmed, shippingFeeConfirmed: false }, { ...confirmed, taxRate: NaN }, { ...confirmed, taxRate: 2 }, { ...confirmed, shippingFee: -1 }]) assert.equal(isAnsweredQuoteChargeQuestion(question, terms), false);
});
