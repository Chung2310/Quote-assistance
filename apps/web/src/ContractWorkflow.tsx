import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, downloadGeneratedFile, getLatestGeneratedFile, formatDate, formatMoney, type GeneratedFileRef } from "./api";
import { formatVndInputValue, parseVndInputValue, updateVndInput } from "./money-input";
import type { AcceptanceRecord, Contract, Quote } from "./types";
import { AcceptanceCreationDialog, ApprovedEstimatePickerDialog, ContractCreationDialog } from "./DocumentDialogs";
import "./contract-workflow.css";

type View = "contracts" | "acceptances";
type Confirm = (options: { title: string; message: string; confirmLabel: string }) => Promise<boolean>;

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function ContractWorkflow({ view, id, navigate, openQuote, notify, confirm }: {
  view: View;
  id: string | null;
  navigate: (view: View, id?: string) => void;
  openQuote: (id: string) => void;
  notify: (message: string, kind?: "success" | "error") => void;
  confirm: Confirm;
}) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [records, setRecords] = useState<AcceptanceRecord[]>([]);
  const [contract, setContract] = useState<Contract | null>(null);
  const [record, setRecord] = useState<AcceptanceRecord | null>(null);
  const [scope, setScope] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [depositAmount, setDepositAmount] = useState(0);
  const [bankDetails, setBankDetails] = useState("");
  const [otherTerms, setOtherTerms] = useState("");
  const [signingPlace, setSigningPlace] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [signedDate, setSignedDate] = useState(localDate());
  const [acceptedDate, setAcceptedDate] = useState(localDate());
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [result, setResult] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [handoverDetails, setHandoverDetails] = useState("");
  const [qualityAssessment, setQualityAssessment] = useState("");
  const [settlementAmountText, setSettlementAmountText] = useState("");
  const [amountPaidText, setAmountPaidText] = useState("");
  const [paymentDueDaysText, setPaymentDueDaysText] = useState("");
  const [showAcceptanceDialog, setShowAcceptanceDialog] = useState(false);
  const [showEstimatePicker, setShowEstimatePicker] = useState(false);
  const [contractSourceQuote, setContractSourceQuote] = useState<Quote | null>(null);
  const [quantities, setQuantities] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [savedWordFile, setSavedWordFile] = useState<GeneratedFileRef | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!id) {
        if (view === "contracts") setContracts((await api<{ contracts: Contract[] }>("/api/contracts")).contracts);
        else { const [{ records: nextRecords }, { contracts: linkedContracts }] = await Promise.all([api<{ records: AcceptanceRecord[] }>("/api/acceptance-records"), api<{ contracts: Contract[] }>("/api/contracts")]); setRecords(nextRecords); setContracts(linkedContracts); }
        setContract(null);
        setRecord(null);
      } else if (view === "contracts") {
        const { contract: next } = await api<{ contract: Contract }>(`/api/contracts/${id}`);
        setContract(next);
        setScope(next.scope);
        setProjectName(next.projectName ?? "");
        setProjectAddress(next.projectAddress ?? "");
        setDeliverables(next.deliverables ?? "");
        setDepositAmount(next.depositAmount ?? 0);
        setBankDetails(next.bankDetails ?? "");
        setOtherTerms(next.otherTerms ?? "");
        setSigningPlace(next.signingPlace ?? "");
        setPaymentTerms(next.paymentTerms);
        setDeliveryTerms(next.deliveryTerms);
        setSignedDate(next.signedDate ?? localDate());
      } else {
        const data = await api<{ record: AcceptanceRecord; contract: Contract }>(`/api/acceptance-records/${id}`);
        setRecord(data.record);
        setContract(data.contract);
        setAcceptedDate(data.record.acceptedDate);
        setNotes(data.record.notes);
        setLocation(data.record.location ?? "");
        setResult(data.record.result ?? "");
        setStartTime(data.record.startTime ?? "");
        setEndTime(data.record.endTime ?? "");
        setHandoverDetails(data.record.handoverDetails ?? "");
        setQualityAssessment(data.record.qualityAssessment ?? "");
        const isVnd = data.contract.currency.toUpperCase() === "VND";
        const settlementValue = data.record.settlementAmount ?? data.contract.total;
        const paidValue = data.record.amountPaid ?? data.contract.depositAmount ?? 0;
        setSettlementAmountText(isVnd ? formatVndInputValue(settlementValue) : String(settlementValue));
        setAmountPaidText(isVnd ? formatVndInputValue(paidValue) : String(paidValue));
        setPaymentDueDaysText(data.record.paymentDueDays == null ? "" : String(data.record.paymentDueDays));
        setQuantities(data.record.lines.map((line) => line.acceptedQuantity));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tải được dữ liệu.", "error");
    } finally { setLoading(false); }
  }, [view, id, notify]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!id) { setSavedWordFile(null); return; }
    let active = true;
    const wordKind = view === "contracts" ? "contract" : "acceptance";
    void getLatestGeneratedFile(id, wordKind).then(({ file }) => {
      if (!active) return;
      setSavedWordFile(file);
    }).catch(() => {
      if (!active) return;
      setSavedWordFile(null);
    });
    return () => { active = false; };
  }, [view, id]);

  const isVnd = contract?.currency.toUpperCase() === "VND";
  const settlementAmount = isVnd ? parseVndInputValue(settlementAmountText) : Number(settlementAmountText) || 0;
  const amountPaid = isVnd ? parseVndInputValue(amountPaidText) : Number(amountPaidText) || 0;

  const contractPayload = () => ({ scope, projectName, projectAddress, deliverables, depositAmount, bankDetails,
    otherTerms, paymentTerms, deliveryTerms, signingPlace, signedDate });

  const saveContract = async (event: FormEvent) => {
    event.preventDefault();
    if (!contract || busy) return;
    setBusy(true);
    try {
      const data = await api<{ contract: Contract }>(`/api/contracts/${contract._id}`, {
        method: "PATCH", body: JSON.stringify(contractPayload()),
      });
      setContract(data.contract);
      notify("Đã lưu hợp đồng.", "success");
    } catch (error) { notify(error instanceof Error ? error.message : "Không lưu được hợp đồng.", "error"); }
    finally { setBusy(false); }
  };

  const signContract = async () => {
    if (!contract || busy || !signedDate) return;
    if (!await confirm({ title: "Xác nhận hợp đồng đã ký?", message: `${contract.contractNumber} sẽ được khóa nội dung và có thể lập nghiệm thu. Hãy kiểm tra các điều khoản trước khi xác nhận.`, confirmLabel: "Xác nhận đã ký" })) return;
    setBusy(true);
    try {
      await api(`/api/contracts/${contract._id}`, { method: "PATCH", body: JSON.stringify(contractPayload()) });
      const data = await api<{ contract: Contract }>(`/api/contracts/${contract._id}/sign`, { method: "POST", body: JSON.stringify({ signedDate }) });
      setContract(data.contract);
      notify("Đã xác nhận hợp đồng.", "success");
    } catch (error) { notify(error instanceof Error ? error.message : "Không xác nhận được hợp đồng.", "error"); }
    finally { setBusy(false); }
  };

  const createAcceptance = async (source: Contract) => {
    if (busy) return;
    setBusy(true);
    try {
      const { records: saved } = await api<{ records: AcceptanceRecord[] }>("/api/acceptance-records");
      const existing = saved.find((item) => item.contractId === source._id);
      if (existing) navigate("acceptances", existing._id);
      else {
        const { contract: latest } = await api<{ contract: Contract }>(`/api/contracts/${source._id}`);
        setContract(latest);
        setShowAcceptanceDialog(true);
      }
    } catch (error) { notify(error instanceof Error ? error.message : "Không tạo được nghiệm thu.", "error"); }
    finally { setBusy(false); }
  };

  const saveAcceptance = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!record || !contract || busy) return false;
    setBusy(true);
    try {
      const { record: next } = await api<{ record: AcceptanceRecord }>(`/api/acceptance-records/${record._id}`, {
        method: "PATCH", body: JSON.stringify({ acceptedDate, location, result, notes, startTime, endTime, handoverDetails,
          qualityAssessment, settlementAmount, amountPaid, paymentDueDays: paymentDueDaysText === "" ? null : Number(paymentDueDaysText),
          lines: quantities.map((acceptedQuantity, lineIndex) => ({ lineIndex, acceptedQuantity })),
        }),
      });
      setRecord(next);
      notify("Đã lưu biên bản nghiệm thu.", "success");
      return true;
    } catch (error) { notify(error instanceof Error ? error.message : "Không lưu được nghiệm thu.", "error"); return false; }
    finally { setBusy(false); }
  };

  const completeAcceptance = async () => {
    if (!record || !contract || busy) return;
    if (!await confirm({ title: "Hoàn tất nghiệm thu?", message: `${record.acceptanceNumber} sẽ được khóa sau khi hoàn tất.`, confirmLabel: "Hoàn tất" })) return;
    const saved = await saveAcceptance();
    if (!saved) return;
    setBusy(true);
    try {
      const { record: next } = await api<{ record: AcceptanceRecord }>(`/api/acceptance-records/${record._id}/complete`, { method: "POST" });
      setRecord(next);
      notify("Đã hoàn tất nghiệm thu.", "success");
    } catch (error) { notify(error instanceof Error ? error.message : "Không hoàn tất được nghiệm thu.", "error"); }
    finally { setBusy(false); }
  };

  const downloadSavedDocument = async (file: GeneratedFileRef | null) => {
    if (downloading) return;
    if (!file) { notify("Chưa có file đã lưu để tải. Hãy tạo file trước.", "error"); return; }
    setDownloading(true);
    try {
      await downloadGeneratedFile(file.id);
      notify("Đã tải file đã lưu từ Cloudinary.", "success");
    } catch (error) { notify(error instanceof Error ? error.message : "Không tải được file đã lưu.", "error"); }
    finally { setDownloading(false); }
  };

  if (loading) return <div className="workflow-page"><div className="workflow-loading"><span className="spinner spinner-dark" />Đang tải dữ liệu…</div></div>;
  const sectionHeader = <>
    <header className={`workflow-header${view === "contracts" && !id ? " workflow-contract-list-header" : ""}`}>
      <div className="workflow-header-copy"><span className="workflow-header-badge">{id ? view === "contracts" ? "CHI TIẾT HỢP ĐỒNG" : "CHI TIẾT NGHIỆM THU" : view === "contracts" ? "QUẢN LÝ HỢP ĐỒNG" : "QUẢN LÝ NGHIỆM THU"}</span><h1>{view === "contracts" ? "Hợp đồng" : "Nghiệm thu"}</h1><p>{view === "contracts" ? id ? "Nội dung và trạng thái hồ sơ hợp đồng." : "Theo dõi các hợp đồng được tạo từ dự toán đã duyệt." : id ? "Thông tin bàn giao, khối lượng và giá trị nghiệm thu." : "Theo dõi biên bản nghiệm thu từ các hợp đồng đã ký."}</p></div>
      {view === "contracts" && !id && <button type="button" className="button button-primary" onClick={() => setShowEstimatePicker(true)}>Tạo hợp đồng từ dự toán</button>}
    </header>
  </>;
  if (!id) return <div className="workflow-page">
    {sectionHeader}
    {view === "contracts" ? contracts.length ? <div className="workflow-cards-grid">{contracts.map((item) => <button className="workflow-card" key={item._id} onClick={() => navigate("contracts", item._id)}>
      <span className="workflow-card-header"><strong className="workflow-card-code">{item.contractNumber}</strong><span className={`workflow-status ${item.status === "signed" ? "is-complete" : "is-draft"}`}>{item.status === "signed" ? "Đã ký" : "Bản nháp"}</span></span>
      <span className="workflow-card-body"><span className="workflow-card-label">Khách hàng</span><strong className="workflow-card-title">{item.customerName}</strong><span className="workflow-card-contact">{[item.customerPhone, item.customerEmail].filter(Boolean).join(" · ") || "Chưa có thông tin liên hệ"}</span><span className="workflow-card-description">Từ dự toán {item.quoteNumber}{item.projectName ? ` · ${item.projectName}` : ""}</span></span>
      <span className="workflow-card-footer"><span className="workflow-card-total"><small>Giá trị hợp đồng</small><strong>{formatMoney(item.total, item.currency)}</strong></span><span className="workflow-card-open">Mở hồ sơ <span aria-hidden="true">→</span></span></span>
    </button>)}</div> : <div className="workflow-empty"><h2>Chưa có hợp đồng</h2><p>Chọn dự toán đã duyệt để bắt đầu tạo hợp đồng.</p></div>
      : records.length ? <div className="workflow-cards-grid">{records.map((item) => <button className="workflow-card" key={item._id} onClick={() => navigate("acceptances", item._id)}>
        <span className="workflow-card-header"><strong className="workflow-card-code">{item.acceptanceNumber}</strong><span className={`workflow-status ${item.status === "completed" ? "is-complete" : "is-draft"}`}>{item.status === "completed" ? "Hoàn tất" : "Bản nháp"}</span></span>
        <span className="workflow-card-body"><span className="workflow-card-label">Khách hàng</span><strong className="workflow-card-title">{contracts.find((linkedContract) => linkedContract._id === item.contractId)?.customerName || item.contractNumber}</strong><span className="workflow-card-contact">{[contracts.find((linkedContract) => linkedContract._id === item.contractId)?.customerPhone, contracts.find((linkedContract) => linkedContract._id === item.contractId)?.customerEmail].filter(Boolean).join(" · ") || "Chưa có thông tin liên hệ"}</span><span className="workflow-card-description">Biên bản {item.acceptanceNumber} · Tạo ngày {formatDate(item.createdAt)}</span></span>
        <span className="workflow-card-footer"><span className="workflow-card-total"><small>Mã biên bản</small><strong>{item.acceptanceNumber}</strong></span><span className="workflow-card-open">Mở hồ sơ <span aria-hidden="true">→</span></span></span>
      </button>)}</div> : <div className="workflow-empty"><h2>Chưa có biên bản nghiệm thu</h2><p>Mở hợp đồng đã ký và chọn “Tạo nghiệm thu”.</p></div>}
    {showEstimatePicker && <ApprovedEstimatePickerDialog contracts={contracts} notify={notify} onClose={() => setShowEstimatePicker(false)} onSelect={(quote) => { setShowEstimatePicker(false); setContractSourceQuote(quote); }} />}
    {contractSourceQuote && <ContractCreationDialog quote={contractSourceQuote} notify={notify} onClose={() => setContractSourceQuote(null)} onCreated={(createdId, fileError) => {
      setContractSourceQuote(null);
      navigate("contracts", createdId);
      notify(fileError ? `Đã tạo hợp đồng nhưng chưa tạo được file AI: ${fileError}` : "Đã tạo hợp đồng, AI đã điền mẫu và lưu file.", fileError ? "error" : "success");
    }} />}
  </div>;

  if (!contract || (view === "acceptances" && !record)) {
    return <div className="workflow-page">{sectionHeader}<button className="button button-soft" onClick={() => navigate(view)}>Quay lại</button><p>Không tìm thấy chứng từ.</p></div>;
  }

  if (view === "contracts") {
    const editable = contract.status === "draft";
    const contractStatus = contract.status === "signed" ? "Đã ký" : "Bản nháp";
    return <div className="workflow-page workflow-detail-page workflow-contract-detail">
      <header className="workflow-header workflow-contract-header">
        <div className="workflow-header-copy">
          <span className="workflow-header-badge">HỒ SƠ HỢP ĐỒNG</span>
          <h1>{contract.contractNumber}</h1>
          <p>{contract.customerName} · {projectName || "Chưa đặt tên công trình"} · Dự toán {contract.quoteNumber}</p>
        </div>
        <span className={"workflow-status " + (contract.status === "signed" ? "is-complete" : "is-draft")}>{contractStatus}</span>
      </header>

      <section className="workflow-detail-summary" aria-label="Tóm tắt hợp đồng">
        <div className="workflow-detail-summary-card"><small>Giá trị hợp đồng</small><strong>{formatMoney(contract.total, contract.currency)}</strong><span>Đã gồm VAT và vận chuyển</span></div>
        <div className="workflow-detail-summary-card"><small>Đặt cọc / tạm ứng</small><strong>{formatMoney(depositAmount, contract.currency)}</strong><span>{contract.status === "signed" ? "Theo hợp đồng đã ký" : "Giá trị dự kiến"}</span></div>
        <div className="workflow-detail-summary-card"><small>Hạng mục hợp đồng</small><strong>{contract.lines.length}</strong><span>{projectName || "Chưa đặt tên công trình"}</span></div>
      </section>

      <div className="workflow-toolbar">
        <button className="button button-soft" onClick={() => navigate("contracts")}>← Danh sách hợp đồng</button>
        <div className="workflow-toolbar-actions">
          <button className="button button-primary" type="button" disabled={downloading || !savedWordFile} onClick={() => void downloadSavedDocument(savedWordFile)}>Tải file</button>
          {contract.status === "signed" && <button className="button button-soft" disabled={busy} onClick={() => void createAcceptance(contract)}>Tạo nghiệm thu</button>}
        </div>
      </div>

      <article className="workflow-document workflow-contract-document">
        <div className="workflow-document-top">
          <div><strong>{contract.companyName || "BÊN CUNG CẤP"}</strong><p>{contract.companyAddress}</p><p>Mã số thuế: {contract.companyTaxId || "—"}</p></div>
          <div><strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><p>Độc lập - Tự do - Hạnh phúc</p></div>
        </div>
        <div className="workflow-title">
          <h1>HỢP ĐỒNG</h1>
          <strong>Số: {contract.contractNumber}</strong>
          {editable && <p>BẢN NHÁP</p>}
          <p>Căn cứ dự toán {contract.quoteNumber}</p>
          <p>{editable ? "Ngày ký dự kiến" : "Ngày ký"}: {contract.signedDate ?? "Chưa ký"} · Địa điểm ký: {signingPlace || "—"}</p>
        </div>
        {contract.template && <p className="workflow-template-source">Mẫu hợp đồng: {contract.template.name}</p>}

        <section className="workflow-detail-section">
          <div className="workflow-detail-section-heading"><h2>Các bên tham gia</h2><span>Thông tin pháp lý và liên hệ trong hợp đồng</span></div>
          <div className="workflow-parties">
            <div><h2>Bên A · Khách hàng</h2><p><b>{contract.customerName}</b></p><p>Đại diện: {contract.customerRepresentative || "—"}</p><p>Địa chỉ: {contract.customerAddress || "—"} · MST: {contract.customerTaxId || "—"}</p><p>Email: {contract.customerEmail || "—"} · Điện thoại: {contract.customerPhone || "—"}</p></div>
            <div><h2>Bên B · Đơn vị thực hiện</h2><p><b>{contract.companyName || "—"}</b></p><p>Đại diện: {contract.companyRepresentative || "—"}</p><p>Địa chỉ: {contract.companyAddress || "—"} · MST: {contract.companyTaxId || "—"}</p><p>Email: {contract.companyEmail || "—"} · Điện thoại: {contract.companyPhone || "—"}</p></div>
          </div>
        </section>

        <section className="workflow-project workflow-contract-project">
          <h2>Công trình / dự án</h2>
          <p><b>{projectName || "—"}</b> · {projectAddress || "—"}</p>
        </section>

        <form className="workflow-form workflow-contract-form" onSubmit={(event) => void saveContract(event)}>
          <h2>Phạm vi và điều khoản thực hiện</h2>
          <div className="workflow-two-fields">
            <label>Tên công trình / dự án{editable ? <input required maxLength={250} value={projectName} onChange={(event) => setProjectName(event.target.value)} /> : <p className="workflow-text-value">{projectName || "—"}</p>}</label>
            <label>Địa điểm thực hiện{editable ? <input required maxLength={250} value={projectAddress} onChange={(event) => setProjectAddress(event.target.value)} /> : <p className="workflow-text-value">{projectAddress || "—"}</p>}</label>
          </div>
          <label>Địa điểm ký{editable ? <input required maxLength={250} value={signingPlace} onChange={(event) => setSigningPlace(event.target.value)} /> : <p className="workflow-text-value">{signingPlace || "—"}</p>}</label>
          <label>Phạm vi công việc{editable ? <textarea required value={scope} onChange={(event) => setScope(event.target.value)} maxLength={4000} rows={3} placeholder="Mô tả phạm vi thực hiện" /> : <p className="workflow-text-value">{scope || "—"}</p>}</label>
          <label>Hồ sơ / sản phẩm bàn giao{editable ? <textarea required value={deliverables} onChange={(event) => setDeliverables(event.target.value)} maxLength={4000} rows={3} /> : <p className="workflow-text-value">{deliverables || "—"}</p>}</label>
          <div className="workflow-two-fields">
            <label>Tiền đặt cọc / tạm ứng{editable ? <input type="number" min="0" max={contract.total} step="any" value={depositAmount} onChange={(event) => setDepositAmount(Number(event.target.value))} /> : <p className="workflow-text-value">{formatMoney(depositAmount, contract.currency)}</p>}</label>
            <label>Thông tin tài khoản{editable ? <input maxLength={1000} value={bankDetails} onChange={(event) => setBankDetails(event.target.value)} /> : <p className="workflow-text-value">{bankDetails || "—"}</p>}</label>
          </div>
          <label>Điều khoản thanh toán{editable ? <textarea required value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} maxLength={4000} rows={3} placeholder="Các đợt và hình thức thanh toán" /> : <p className="workflow-text-value">{paymentTerms || "—"}</p>}</label>
          <label>Tiến độ và bàn giao{editable ? <textarea required value={deliveryTerms} onChange={(event) => setDeliveryTerms(event.target.value)} maxLength={4000} rows={3} placeholder="Thời gian và điều kiện bàn giao" /> : <p className="workflow-text-value">{deliveryTerms || "—"}</p>}</label>
          <label>Điều khoản bổ sung{editable ? <textarea value={otherTerms} onChange={(event) => setOtherTerms(event.target.value)} maxLength={10000} rows={4} /> : <p className="workflow-text-value">{otherTerms || "—"}</p>}</label>
          {editable && <button className="button button-soft" type="submit" disabled={busy}>Lưu nội dung hợp đồng</button>}
        </form>

        <section className="workflow-detail-section">
          <div className="workflow-detail-section-heading"><h2>Hạng mục trong hợp đồng</h2><span>{contract.lines.length} hạng mục</span></div>
          <div className="workflow-table-wrap">
            <table>
              <thead><tr><th>STT</th><th>Hạng mục</th><th>ĐVT</th><th>Khối lượng</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
              <tbody>{contract.lines.map((line, index) => <tr key={index}>
                <td>{index + 1}</td><td><strong>{line.name}</strong>{line.description && <small>{line.description}</small>}</td><td>{line.unit}</td><td>{line.quantity}</td><td>{formatMoney(line.unitPrice, contract.currency)}</td><td>{formatMoney(line.lineTotal, contract.currency)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="workflow-totals">
            <p>Tạm tính: <b>{formatMoney(contract.subtotal, contract.currency)}</b></p>
            <p>VAT ({contract.taxRate * 100}%): <b>{formatMoney(contract.taxAmount, contract.currency)}</b></p>
            <p>Vận chuyển: <b>{formatMoney(contract.shippingFee, contract.currency)}</b></p>
            <strong>Tổng giá trị hợp đồng: {formatMoney(contract.total, contract.currency)}</strong>
          </div>
        </section>
        <div className="workflow-signatures"><div><b>ĐẠI DIỆN BÊN A</b><span>Ký, ghi rõ họ tên</span></div><div><b>ĐẠI DIỆN BÊN B</b><span>Ký, ghi rõ họ tên</span></div></div>
      </article>

      <div className="workflow-footer">
        <span>{contract.status === "signed" ? "Đã ký ngày " + contract.signedDate : "Hợp đồng đang ở bản nháp"}</span>
        {editable && <div><input aria-label="Ngày ký hợp đồng" type="date" value={signedDate} onChange={(event) => setSignedDate(event.target.value)} /><button className="button button-primary" disabled={busy || !signedDate || !scope.trim() || !projectName.trim() || !projectAddress.trim() || !deliverables.trim() || !signingPlace.trim() || !paymentTerms.trim() || !deliveryTerms.trim()} onClick={() => void signContract()}>Xác nhận đã ký</button></div>}
      </div>
      <div className="workflow-origin"><button className="text-button" onClick={() => openQuote(contract.quoteId)}>Xem dự toán gốc {contract.quoteNumber} →</button></div>
      {showAcceptanceDialog && <AcceptanceCreationDialog contract={contract} onClose={() => setShowAcceptanceDialog(false)} onCreated={(nextId) => { setShowAcceptanceDialog(false); navigate("acceptances", nextId); notify("Đã tạo biên bản nghiệm thu.", "success"); }} notify={notify} />}
    </div>;
  }

  const acceptance = record!;
  const editable = acceptance.status === "draft";
  const acceptedValue = contract.lines.reduce((sum, line, index) => sum + Math.round((quantities[index] ?? 0) * line.unitPrice * 100) / 100, 0);
  const selectedItemCount = quantities.filter((quantity) => quantity > 0).length;
  const outstandingAmount = Math.max(0, settlementAmount - amountPaid);

  return <div className="workflow-page workflow-detail-page workflow-acceptance-detail">
    <header className="workflow-header workflow-acceptance-header">
      <div className="workflow-header-copy">
        <span className="workflow-header-badge">BIÊN BẢN NGHIỆM THU</span>
        <h1>{acceptance.acceptanceNumber}</h1>
        <p>{contract.customerName} · Hợp đồng {contract.contractNumber}</p>
      </div>
      <span className={"workflow-status " + (acceptance.status === "completed" ? "is-complete" : "is-draft")}>{acceptance.status === "completed" ? "Hoàn tất" : "Bản nháp"}</span>
    </header>

    <section className="workflow-detail-summary" aria-label="Tóm tắt nghiệm thu">
      <div className="workflow-detail-summary-card acceptance-summary-value"><small>Giá trị hạng mục nghiệm thu</small><strong>{formatMoney(acceptedValue, contract.currency)}</strong><span>{selectedItemCount} hạng mục được chọn</span></div>
      <div className="workflow-detail-summary-card"><small>Ngày nghiệm thu</small><strong>{formatDate(acceptance.acceptedDate)}</strong><span>{acceptance.startTime}–{acceptance.endTime}</span></div>
      <div className="workflow-detail-summary-card"><small>Còn phải thanh toán</small><strong>{formatMoney(outstandingAmount, contract.currency)}</strong><span>Quyết toán {formatMoney(settlementAmount, contract.currency)}</span></div>
    </section>

    <div className="workflow-toolbar">
      <button className="button button-soft" onClick={() => navigate("acceptances")}>← Danh sách nghiệm thu</button>
      <div className="workflow-toolbar-actions">
        <button className="button button-primary" type="button" disabled={downloading || !savedWordFile} onClick={() => void downloadSavedDocument(savedWordFile)}>Tải file</button>
        <button className="button button-soft" onClick={() => navigate("contracts", contract._id)}>Xem hợp đồng</button>
      </div>
    </div>

    <article className="workflow-document workflow-acceptance-document">
      <div className="workflow-document-top">
        <div><strong>{contract.companyName || "BÊN CUNG CẤP"}</strong><p>{contract.companyAddress}</p><p>Mã số thuế: {contract.companyTaxId || "—"}</p></div>
        <div><strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><p>Độc lập - Tự do - Hạnh phúc</p></div>
      </div>
      <div className="workflow-title">
        <h1>BIÊN BẢN NGHIỆM THU</h1>
        <strong>Số: {acceptance.acceptanceNumber}</strong>
        {editable && <p>BẢN NHÁP</p>}
        <p>Nghiệm thu theo hợp đồng {contract.contractNumber}</p>
        <p>Ngày {formatDate(acceptance.acceptedDate)} · Địa điểm {acceptance.location || "—"}</p>
      </div>
      {acceptance.template && <p className="workflow-template-source">Mẫu nghiệm thu: {acceptance.template.name}</p>}

      <section className="workflow-acceptance-reference">
        <div className="workflow-detail-section-heading"><h2>Hợp đồng được nghiệm thu</h2><span>{contract.status === "signed" ? "Đã ký " + (contract.signedDate ?? "") : "Bản nháp"}</span></div>
        <div className="workflow-reference-grid">
          <div><small>Khách hàng</small><strong>{contract.customerName}</strong><span>{contract.customerEmail || "—"} · {contract.customerPhone || "—"}</span></div>
          <div><small>Công trình / dự án</small><strong>{contract.projectName || "—"}</strong><span>{contract.projectAddress || "—"}</span></div>
          <div><small>Giá trị hợp đồng</small><strong>{formatMoney(contract.total, contract.currency)}</strong><span>Dự toán {contract.quoteNumber}</span></div>
        </div>
      </section>

      <section className="workflow-detail-section">
        <div className="workflow-detail-section-heading"><h2>Khối lượng nghiệm thu</h2><span>{selectedItemCount} / {contract.lines.length} hạng mục</span></div>
        <div className="workflow-table-wrap workflow-acceptance-table-wrap">
          <table>
            <thead><tr><th>STT</th><th>Sản phẩm / hạng mục</th><th>ĐVT</th><th>Số lượng theo hợp đồng</th><th>Chọn</th><th>Số lượng nghiệm thu</th><th>Đơn giá</th><th>Giá trị NT</th></tr></thead>
            <tbody>{contract.lines.length ? contract.lines.map((line, index) => {
              const acceptedQuantity = quantities[index] ?? 0;
              const lineTotal = Math.round(acceptedQuantity * line.unitPrice * 100) / 100;
              return <tr key={index}>
                <td>{index + 1}</td><td><strong>{line.name}</strong>{line.description && <small>{line.description}</small>}</td><td>{line.unit}</td><td>{line.quantity}</td>
                <td><input type="checkbox" aria-label={"Chọn hạng mục " + line.name + " để nghiệm thu"} checked={acceptedQuantity > 0} disabled={!editable} onChange={(event) => { const checked = event.currentTarget.checked; setQuantities((current) => current.map((value, i) => i === index ? checked ? line.quantity : 0 : value)); }} /></td>
                <td><input aria-label={"Khối lượng nghiệm thu " + line.name} type="number" min="0" max={line.quantity} step="any" disabled={!editable || acceptedQuantity <= 0} value={acceptedQuantity} onChange={(event) => setQuantities((current) => current.map((value, i) => i === index ? Number(event.target.value) : value))} /></td>
                <td>{formatMoney(line.unitPrice, contract.currency)}</td><td>{formatMoney(lineTotal, contract.currency)}</td>
              </tr>;
            }) : <tr><td colSpan={8}>Hợp đồng chưa có sản phẩm hoặc hạng mục để đối soát.</td></tr>}</tbody>
          </table>
        </div>
        <div className="workflow-totals"><strong>Giá trị các hạng mục đã nghiệm thu: {formatMoney(acceptedValue, contract.currency)}</strong></div>
      </section>

      <div className="workflow-parties workflow-acceptance-parties">
        <div><h2>Bên A · Khách hàng</h2><p><b>{contract.customerName}</b></p><p>Đại diện: {contract.customerRepresentative || "—"}</p><p>Địa chỉ: {contract.customerAddress || "—"} · MST: {contract.customerTaxId || "—"}</p></div>
        <div><h2>Bên B · Đơn vị thực hiện</h2><p><b>{contract.companyName || "—"}</b></p><p>Đại diện: {contract.companyRepresentative || "—"}</p><p>Địa chỉ: {contract.companyAddress || "—"} · MST: {contract.companyTaxId || "—"}</p></div>
      </div>

      <form className="workflow-form workflow-acceptance-form" onSubmit={(event) => void saveAcceptance(event)}>
        <h2>Biên bản nghiệm thu</h2>
        <div className="workflow-two-fields">
          <label>Ngày nghiệm thu{editable ? <input type="date" required min={contract.signedDate ?? undefined} value={acceptedDate} onChange={(event) => setAcceptedDate(event.target.value)} /> : <p className="workflow-text-value">{formatDate(acceptance.acceptedDate)}</p>}</label>
          <label>Địa điểm nghiệm thu{editable ? <input required maxLength={250} value={location} onChange={(event) => setLocation(event.target.value)} /> : <p className="workflow-text-value">{location || "—"}</p>}</label>
        </div>
        <div className="workflow-two-fields">
          <label>Giờ bắt đầu{editable ? <input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /> : <p className="workflow-text-value">{startTime || "—"}</p>}</label>
          <label>Giờ kết thúc{editable ? <input type="time" required min={startTime} value={endTime} onChange={(event) => setEndTime(event.target.value)} /> : <p className="workflow-text-value">{endTime || "—"}</p>}</label>
        </div>
        <label>Hồ sơ / sản phẩm đã bàn giao{editable ? <textarea required maxLength={4000} rows={3} value={handoverDetails} onChange={(event) => setHandoverDetails(event.target.value)} /> : <p className="workflow-text-value">{handoverDetails || "—"}</p>}</label>
        <div className="workflow-two-fields">
          <label>Đánh giá chất lượng{editable ? <textarea required maxLength={2000} rows={3} value={qualityAssessment} onChange={(event) => setQualityAssessment(event.target.value)} /> : <p className="workflow-text-value">{qualityAssessment || "—"}</p>}</label>
          <label>Kết quả nghiệm thu{editable ? <textarea required value={result} onChange={(event) => setResult(event.target.value)} maxLength={2000} rows={3} /> : <p className="workflow-text-value">{result || "—"}</p>}</label>
        </div>
        <h2>Quyết toán và thanh toán</h2>
        <div className="workflow-two-fields">
          <label>Giá trị quyết toán{editable ? isVnd ? <span className="workflow-money-field"><input type="text" required inputMode="numeric" autoComplete="off" maxLength={22} value={settlementAmountText} onChange={(event) => updateVndInput(event, setSettlementAmountText)} /> <span aria-hidden="true">₫</span></span> : <input type="number" required min="0" max={contract.total} step="any" value={settlementAmountText} onChange={(event) => setSettlementAmountText(event.target.value)} /> : <p className="workflow-text-value">{formatMoney(settlementAmount, contract.currency)}</p>}</label>
          <label>Đã thanh toán{editable ? isVnd ? <span className="workflow-money-field"><input type="text" required inputMode="numeric" autoComplete="off" maxLength={22} value={amountPaidText} onChange={(event) => updateVndInput(event, setAmountPaidText)} /> <span aria-hidden="true">₫</span></span> : <input type="number" required min="0" max={settlementAmount} step="any" value={amountPaidText} onChange={(event) => setAmountPaidText(event.target.value)} /> : <p className="workflow-text-value">{formatMoney(amountPaid, contract.currency)}</p>}</label>
        </div>
        <div className="workflow-payment-balance"><span>Còn phải thanh toán</span><strong>{formatMoney(outstandingAmount, contract.currency)}</strong></div>
        <label>Thời hạn thanh toán còn lại (ngày){editable ? <input type="number" min="0" max="3650" step="1" value={paymentDueDaysText} onChange={(event) => setPaymentDueDaysText(event.target.value)} /> : <p className="workflow-text-value">{paymentDueDaysText || "—"}</p>}</label>
        <label>Ghi chú / tồn tại{editable ? <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} rows={3} placeholder="Ghi nhận tồn tại và hướng xử lý" /> : <p className="workflow-text-value">{notes || "—"}</p>}</label>
        {editable && <button className="button button-soft" type="submit" disabled={busy}>Lưu biên bản</button>}
      </form>

      <div className="workflow-signatures"><div><b>ĐẠI DIỆN BÊN A</b><span>Ký, ghi rõ họ tên</span></div><div><b>ĐẠI DIỆN BÊN B</b><span>Ký, ghi rõ họ tên</span></div></div>
    </article>

    <div className="workflow-footer">
      <span>{acceptance.status === "completed" ? "Biên bản đã hoàn tất ngày " + formatDate(acceptance.updatedAt) : "Biên bản nghiệm thu đang ở bản nháp"}</span>
      {editable && <button className="button button-primary" disabled={busy || !quantities.some((quantity) => quantity > 0)} onClick={() => void completeAcceptance()}>Hoàn tất nghiệm thu</button>}
    </div>
    <div className="workflow-origin"><button className="text-button" onClick={() => navigate("contracts", contract._id)}>Xem hợp đồng {contract.contractNumber} →</button><button className="text-button" onClick={() => openQuote(contract.quoteId)}>Xem dự toán gốc {contract.quoteNumber} →</button></div>
  </div>;
}
