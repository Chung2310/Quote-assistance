import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { api, formatMoney } from "./api";
import { formatVndInputValue, parseVndInputValue, updateVndInput } from "./money-input";
import type { AcceptanceRecord, Contract, Quote } from "./types";
import "./document-dialogs.css";

type CompanyPrefill = { name: string; address: string; taxId: string; representativeName: string; phone: string; email: string };
type Notify = (message: string, kind?: "success" | "error") => void;
type ContractTemplateOption = { id: string; name: string; originalFilename: string; extension: string; mode: "pdf-reference" | "pdf-ai" | "docx" | "docx-ai" };

async function loadContractTemplates() {
  return (await api<{ templates: ContractTemplateOption[] }>("/api/contract-templates")).templates;
}

export function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function ContractCreationDialog({ quote, onClose, onCreated, notify }: {
  quote: Quote; onClose: () => void; onCreated: (id: string) => void; notify: Notify;
}) {
  const [company, setCompany] = useState<CompanyPrefill>({ name: "", address: "", taxId: "", representativeName: "", phone: "", email: "" });
  const [templates, setTemplates] = useState<ContractTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateError, setTemplateError] = useState("");
  const [customerName, setCustomerName] = useState(quote.customerName);
  const [customerEmail, setCustomerEmail] = useState(quote.customerEmail);
  const [customerPhone, setCustomerPhone] = useState(quote.customerPhone ?? "");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [customerRepresentative, setCustomerRepresentative] = useState("");
  const [scope, setScope] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const isVnd = quote.currency.toUpperCase() === "VND";
  const [depositAmountText, setDepositAmountText] = useState("");
  const [otherCurrencyDeposit, setOtherCurrencyDeposit] = useState(0);
  const depositInputRef = useRef<HTMLInputElement>(null);
  const depositAmount = isVnd ? Number(depositAmountText.replace(/\D/g, "")) || 0 : otherCurrencyDeposit;
  const changeDepositAmount = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.currentTarget.value;
    const digitsBeforeCursor = raw.slice(0, event.currentTarget.selectionStart ?? raw.length).replace(/\D/g, "").length;
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (digits.length > 15) return;
    const formatted = digits ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(digits)) : "";
    setDepositAmountText(formatted);
    requestAnimationFrame(() => {
      const input = depositInputRef.current;
      if (!input || document.activeElement !== input) return;
      let cursor = 0;
      let count = 0;
      while (cursor < formatted.length && count < digitsBeforeCursor) {
        if (/\d/.test(formatted[cursor])) count += 1;
        cursor += 1;
      }
      input.setSelectionRange(cursor, cursor);
    });
  };
  const [bankDetails, setBankDetails] = useState("");
  const [otherTerms, setOtherTerms] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [signingPlace, setSigningPlace] = useState("");
  const [signedDate, setSignedDate] = useState(todayLocal());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ company: CompanyPrefill }>("/api/contracts/prefill")
      .then(({ company: value }) => { if (live) setCompany(value); })
      .catch((error) => { if (live) notify(error instanceof Error ? error.message : "Không tải được hồ sơ doanh nghiệp.", "error"); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [notify]);
  useEffect(() => {
    let live = true;
    loadContractTemplates().then((items) => {
      if (!live) return;
      setTemplates(items);
      setTemplateId(items[0]?.id ?? "");
    }).catch((error) => { if (live) setTemplateError(error instanceof Error ? error.message : "Không tải được mẫu hợp đồng."); })
      .finally(() => { if (live) setTemplatesLoading(false); });
    return () => { live = false; };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || templatesLoading || templateError) return;
    if (depositAmount > quote.total) {
      notify(`Tiền đặt cọc không được vượt quá ${formatMoney(quote.total, quote.currency)}.`, "error");
      depositInputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const { contract } = await api<{ contract: Contract }>("/api/contracts", {
        method: "POST",
        body: JSON.stringify({
          quoteId: quote._id, templateId: templateId || undefined, customerName, customerEmail, customerPhone, customerAddress, customerTaxId,
          customerRepresentative, companyName: company.name, companyAddress: company.address,
          companyTaxId: company.taxId, companyRepresentative: company.representativeName,
          companyPhone: company.phone, companyEmail: company.email,
          scope, projectName, projectAddress, deliverables, depositAmount, bankDetails, otherTerms,
          paymentTerms, deliveryTerms, signingPlace, signedDate,
        }),
      });
      onCreated(contract._id);
    } catch (error) { notify(error instanceof Error ? error.message : "Không tạo được hợp đồng.", "error"); }
    finally { setBusy(false); }
  };
  return <div className="document-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="document-dialog" role="dialog" aria-modal="true" aria-labelledby="contract-create-title">
      <div className="document-dialog-head"><div><h2 id="contract-create-title">Tạo hợp đồng từ dự toán</h2><p>{quote.quoteNumber} · {formatMoney(quote.total, quote.currency)} · {quote.lines.length} hạng mục</p></div><div className="document-dialog-head-actions"><button type="button" aria-label="Đóng" onClick={onClose} disabled={busy}>×</button></div></div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="document-dialog-body">
          <h3>Mẫu hợp đồng</h3>
          {templatesLoading ? <p className="document-dialog-note">Đang tải mẫu hợp đồng…</p> : templateError ? <p className="document-dialog-note" role="alert">{templateError}</p> : <label>Chọn mẫu hợp đồng<select value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={busy || templates.length === 0}>{templates.length ? templates.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.mode === "pdf-reference" ? "Word dựng theo PDF" : item.mode === "pdf-ai" ? "AI điền PDF" : item.mode === "docx-ai" ? "AI điền Word" : "Word có trường dữ liệu"})</option>) : <option value="">Mẫu Word mặc định</option>}</select></label>}
          {!!templates.length && <p className="document-dialog-note">AI nhận diện vị trí dữ liệu trên mẫu Word hoặc PDF chưa có trường điền. Mẫu PDF khác sẽ xuất thành PDF để giữ bố cục.</p>}
          <h3>Bên A · Khách hàng</h3>
          <div className="document-dialog-grid"><label>Tên khách hàng *<input required maxLength={250} value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label><label>Người đại diện *<input required maxLength={250} value={customerRepresentative} onChange={(event) => setCustomerRepresentative(event.target.value)} /></label><label>Địa chỉ *<input required maxLength={250} value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} /></label><label>Mã số thuế<input maxLength={250} value={customerTaxId} onChange={(event) => setCustomerTaxId(event.target.value)} /></label><label>Điện thoại<input maxLength={250} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></label><label>Email<input type="email" maxLength={250} value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></label></div>
          <h3>Bên B · Đơn vị thực hiện</h3>
          {loading ? <p>Đang tải hồ sơ doanh nghiệp…</p> : <div className="document-dialog-grid"><label>Tên doanh nghiệp *<input required maxLength={250} value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} /></label><label>Người đại diện *<input required maxLength={250} value={company.representativeName} onChange={(event) => setCompany({ ...company, representativeName: event.target.value })} /></label><label>Địa chỉ *<input required maxLength={250} value={company.address} onChange={(event) => setCompany({ ...company, address: event.target.value })} /></label><label>Mã số thuế<input maxLength={250} value={company.taxId} onChange={(event) => setCompany({ ...company, taxId: event.target.value })} /></label><label>Điện thoại<input maxLength={250} value={company.phone} onChange={(event) => setCompany({ ...company, phone: event.target.value })} /></label><label>Email<input type="email" maxLength={250} value={company.email} onChange={(event) => setCompany({ ...company, email: event.target.value })} /></label></div>}
          <h3>Điều khoản và thời gian</h3>
          <div className="document-dialog-grid"><label>Tên công trình / dự án *<input required maxLength={250} value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label>Địa điểm thực hiện *<input required maxLength={250} value={projectAddress} onChange={(event) => setProjectAddress(event.target.value)} /></label></div>
          <div className="document-dialog-grid"><label>Ngày ký dự kiến *<input type="date" required value={signedDate} onChange={(event) => setSignedDate(event.target.value)} /></label><label>Địa điểm ký *<input required maxLength={250} value={signingPlace} onChange={(event) => setSigningPlace(event.target.value)} /></label></div>
          <label>Phạm vi công việc *<textarea required maxLength={4000} rows={3} value={scope} onChange={(event) => setScope(event.target.value)} /></label>
          <label>Hồ sơ / sản phẩm bàn giao *<textarea required maxLength={4000} rows={3} value={deliverables} onChange={(event) => setDeliverables(event.target.value)} placeholder="Ví dụ: danh mục bản vẽ, định dạng, số bộ bàn giao" /></label>
          <div className="document-dialog-grid"><label>Tiền đặt cọc / tạm ứng ({quote.currency}){isVnd ? <span className="document-dialog-money-field"><input ref={depositInputRef} type="text" inputMode="numeric" autoComplete="off" maxLength={22} value={depositAmountText} onChange={changeDepositAmount} placeholder="0" /><span aria-hidden="true">₫</span></span> : <input ref={depositInputRef} type="number" min="0" max={quote.total} step="any" value={otherCurrencyDeposit} onChange={(event) => setOtherCurrencyDeposit(Number(event.target.value))} />}</label><label>Thông tin tài khoản nhận thanh toán<input maxLength={1000} value={bankDetails} onChange={(event) => setBankDetails(event.target.value)} /></label></div>
          <label>Điều khoản thanh toán *<textarea required maxLength={4000} rows={3} value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} /></label>
          <label>Tiến độ và bàn giao *<textarea required maxLength={4000} rows={3} value={deliveryTerms} onChange={(event) => setDeliveryTerms(event.target.value)} /></label>
          <label>Điều khoản bổ sung<textarea maxLength={10000} rows={4} value={otherTerms} onChange={(event) => setOtherTerms(event.target.value)} placeholder="Quyền và nghĩa vụ, bất khả kháng, giải quyết tranh chấp…" /></label>
          <p className="document-dialog-note">Hạng mục, đơn giá và tổng tiền được sao chép từ dự toán đã duyệt.</p>
        </div>
        <div className="document-dialog-actions"><button type="button" className="button button-soft" onClick={onClose} disabled={busy}>Hủy</button><button type="submit" className="button button-primary" disabled={busy || loading || templatesLoading || Boolean(templateError)}>{busy ? "Đang tạo…" : "Tạo hợp đồng"}</button></div>
      </form>
    </section>
  </div>;
}

export function AcceptanceCreationDialog({ contract, onClose, onCreated, notify }: {
  contract: Contract; onClose: () => void; onCreated: (id: string) => void; notify: Notify;
}) {
  const [templates, setTemplates] = useState<ContractTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templateError, setTemplateError] = useState("");
  const [acceptedDate, setAcceptedDate] = useState(() => contract.signedDate && contract.signedDate > todayLocal() ? contract.signedDate : todayLocal());
  const [location, setLocation] = useState(contract.signingPlace ?? "");
  const [result, setResult] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [handoverDetails, setHandoverDetails] = useState("");
  const [qualityAssessment, setQualityAssessment] = useState("");
  const isVnd = contract.currency.toUpperCase() === "VND";
  const [settlementAmountText, setSettlementAmountText] = useState(() => isVnd ? formatVndInputValue(contract.total) : String(contract.total));
  const [amountPaidText, setAmountPaidText] = useState(() => isVnd ? formatVndInputValue(contract.depositAmount) : String(contract.depositAmount));
  const settlementAmount = isVnd ? parseVndInputValue(settlementAmountText) : Number(settlementAmountText) || 0;
  const amountPaid = isVnd ? parseVndInputValue(amountPaidText) : Number(amountPaidText) || 0;
  const [paymentDueDays, setPaymentDueDays] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState(contract.lines.map((line) => line.quantity));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ templates: ContractTemplateOption[] }>("/api/acceptance-templates")
      .then(({ templates: items }) => {
        if (!live) return;
        setTemplates(items);
        setTemplateId(items[0]?.id ?? "");
      })
      .catch((error) => { if (live) setTemplateError(error instanceof Error ? error.message : "Không tải được mẫu nghiệm thu."); })
      .finally(() => { if (live) setTemplatesLoading(false); });
    return () => { live = false; };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || templatesLoading || templateError || !quantities.some((quantity) => quantity > 0)) return;
    setBusy(true);
    try {
      const { record } = await api<{ record: AcceptanceRecord }>("/api/acceptance-records", {
        method: "POST", body: JSON.stringify({ contractId: contract._id, templateId: templateId || undefined, acceptedDate, location, result, notes,
          startTime, endTime, handoverDetails, qualityAssessment,
          settlementAmount, amountPaid,
          paymentDueDays: paymentDueDays === "" ? null : Number(paymentDueDays),
          lines: quantities.map((acceptedQuantity, lineIndex) => ({ lineIndex, acceptedQuantity })),
        }),
      });
      onCreated(record._id);
    } catch (error) { notify(error instanceof Error ? error.message : "Không tạo được nghiệm thu.", "error"); }
    finally { setBusy(false); }
  };
  return <div className="document-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="document-dialog" role="dialog" aria-modal="true" aria-labelledby="acceptance-create-title">
      <div className="document-dialog-head"><div><h2 id="acceptance-create-title">Tạo biên bản nghiệm thu</h2><p>Từ hợp đồng {contract.contractNumber}</p></div><div className="document-dialog-head-actions"><button type="button" aria-label="Đóng" onClick={onClose} disabled={busy}>×</button></div></div>
      <form onSubmit={(event) => void submit(event)}><div className="document-dialog-body">
        <h3>Mẫu nghiệm thu</h3>
        {templatesLoading ? <p className="document-dialog-note">Đang tải mẫu nghiệm thu…</p> : templateError ? <p className="document-dialog-note" role="alert">{templateError}</p> : <label>Chọn mẫu dùng khi xuất<select value={templateId} onChange={(event) => setTemplateId(event.target.value)} disabled={busy || templates.length === 0}>{templates.length ? templates.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.mode === "pdf-ai" ? "AI đọc PDF → Word" : item.mode === "docx-ai" ? "AI điền Word" : item.mode === "docx" ? "Word có trường dữ liệu" : "Word dựng theo PDF"})</option>) : <option value="">Mẫu Word mặc định</option>}</select></label>}
        {!!templates.length && <p className="document-dialog-note">AI sẽ tìm vị trí ngày nghiệm thu, kết quả, khối lượng và quyết toán trong mẫu. Mẫu PDF được điền rồi chuyển sang file Word.</p>}
        <div className="document-dialog-grid"><label>Ngày nghiệm thu *<input type="date" required min={contract.signedDate ?? undefined} value={acceptedDate} onChange={(event) => setAcceptedDate(event.target.value)} /></label><label>Địa điểm nghiệm thu *<input required maxLength={250} value={location} onChange={(event) => setLocation(event.target.value)} /></label></div>
        <div className="document-dialog-grid"><label>Giờ bắt đầu *<input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label>Giờ kết thúc *<input type="time" required min={startTime} value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></div>
        <label>Hồ sơ / sản phẩm đã bàn giao *<textarea required maxLength={4000} rows={3} value={handoverDetails} onChange={(event) => setHandoverDetails(event.target.value)} placeholder={contract.deliverables || "Danh mục hồ sơ, định dạng và số lượng"} /></label>
        <label>Đánh giá chất lượng *<textarea required maxLength={2000} rows={3} value={qualityAssessment} onChange={(event) => setQualityAssessment(event.target.value)} /></label>
        <label>Kết quả nghiệm thu *<textarea required maxLength={2000} rows={3} value={result} onChange={(event) => setResult(event.target.value)} placeholder="Đạt yêu cầu, cần bổ sung, hoặc kết luận khác" /></label>
        <h3>Khối lượng nghiệm thu</h3>
        <div className="document-dialog-lines">{contract.lines.map((line, index) => <label key={index}><span>{line.name}<small>Hợp đồng: {line.quantity} {line.unit}</small></span><input type="number" required min="0" max={line.quantity} step="any" value={quantities[index]} onChange={(event) => setQuantities((current) => current.map((value, i) => i === index ? Number(event.target.value) : value))} /></label>)}</div>
        <h3>Giá trị quyết toán</h3>
        <div className="document-dialog-grid"><label>Giá trị quyết toán *{isVnd ? <span className="document-dialog-money-field"><input type="text" required inputMode="numeric" autoComplete="off" maxLength={22} value={settlementAmountText} onChange={(event) => updateVndInput(event, setSettlementAmountText)} placeholder={`Tối đa ${formatMoney(contract.total, contract.currency)}`} /><span aria-hidden="true">₫</span></span> : <input type="number" required min="0" max={contract.total} step="any" value={settlementAmountText} onChange={(event) => setSettlementAmountText(event.target.value)} placeholder={`Tối đa ${formatMoney(contract.total, contract.currency)}`} />}</label><label>Đã thực nhận / đặt cọc *{isVnd ? <span className="document-dialog-money-field"><input type="text" required inputMode="numeric" autoComplete="off" maxLength={22} value={amountPaidText} onChange={(event) => updateVndInput(event, setAmountPaidText)} placeholder="Nhập số tiền đã nhận thực tế" /><span aria-hidden="true">₫</span></span> : <input type="number" required min="0" max={settlementAmount || undefined} step="any" value={amountPaidText} onChange={(event) => setAmountPaidText(event.target.value)} placeholder="Nhập số tiền đã nhận thực tế" />}</label><label>Thời hạn thanh toán còn lại (ngày)<input type="number" min="0" max="3650" step="1" value={paymentDueDays} onChange={(event) => setPaymentDueDays(event.target.value)} /></label><div className="document-dialog-balance">Còn phải thanh toán <strong>{settlementAmountText !== "" && amountPaidText !== "" ? formatMoney(Math.max(0, settlementAmount - amountPaid), contract.currency) : "—"}</strong></div></div>
        <label>Ghi chú / tồn tại<textarea maxLength={4000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {!quantities.some((quantity) => quantity > 0) && <p className="document-dialog-note">Cần nghiệm thu ít nhất một hạng mục có khối lượng lớn hơn 0.</p>}
      </div><div className="document-dialog-actions"><button type="button" className="button button-soft" disabled={busy} onClick={onClose}>Hủy</button><button type="submit" className="button button-primary" disabled={busy || templatesLoading || Boolean(templateError) || !quantities.some((quantity) => quantity > 0)}>{busy ? "Đang tạo…" : "Tạo biên bản"}</button></div></form>
    </section>
  </div>;
}
