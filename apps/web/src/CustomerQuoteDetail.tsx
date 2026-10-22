import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatDate, formatMoney, responseBlobWithProgress } from "./api";
import { TaskProgress, type ConfirmOptions, type Notify, type TaskProgressState } from "./Feedback";
import type { Quote, QuoteStatus } from "./types";
import "./customer-quote-detail.css";

const statusText: Record<QuoteStatus, string> = {
  draft: "Bản nháp",
  needs_info: "Cần bổ sung",
  pending_review: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Cần chỉnh sửa",
};

const statusStyle: Record<QuoteStatus, string> = {
  draft: "neutral",
  needs_info: "amber",
  pending_review: "blue",
  approved: "green",
  rejected: "rose",
};

type Draft = {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  validityDays: string;
  completionDate: string;
};

function draftFromQuote(quote: Quote): Draft {
  return {
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    customerPhone: quote.customerPhone ?? "",
    validityDays: quote.validityDays == null ? "" : String(quote.validityDays),
    completionDate: quote.completionDate ?? "",
  };
}

export default function CustomerQuoteDetail({
  id,
  onBack,
  onChanged,
  onToast,
  confirm,
  onDeleteQuote,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
  onToast: Notify;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onDeleteQuote: (quote: Quote) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<TaskProgressState | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const load = useCallback(async () => {
    const { quote: value } = await api<{ quote: Quote }>(`/api/quotes/${id}`);
    if (value.kind !== "customer") throw new Error("Đây không phải báo giá khách hàng.");
    setQuote(value);
    setDraft(draftFromQuote(value));
    setQuantities(
      Object.fromEntries(value.lines.map((line) => [line.catalogItemId, line.quantity || 1]))
    );
    return value;
  }, [id]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load()
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : "Không mở được báo giá khách hàng.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [load]);

  const editable = Boolean(quote && quote.status !== "approved");

  // Live Calculations
  const liveSubtotal = useMemo(() => {
    if (!quote) return 0;
    return quote.lines.reduce((sum, line) => {
      const qty = quantities[line.catalogItemId] ?? line.quantity ?? 1;
      return sum + line.unitPrice * qty;
    }, 0);
  }, [quote, quantities]);

  const liveTaxAmount = useMemo(() => {
    if (!quote || !quote.taxRate) return 0;
    return Math.round(liveSubtotal * quote.taxRate);
  }, [quote, liveSubtotal]);

  const liveTotal = useMemo(() => {
    return liveSubtotal + liveTaxAmount + (quote?.shippingFee || 0);
  }, [liveSubtotal, liveTaxAmount, quote]);

  // Dirty state checking
  const dirty = useMemo(() => {
    if (!quote || !draft) return false;
    const baseDraft = draftFromQuote(quote);
    const draftChanged = JSON.stringify(draft) !== JSON.stringify(baseDraft);
    const quantitiesChanged = quote.lines.some(
      (line) => (quantities[line.catalogItemId] ?? line.quantity ?? 1) !== (line.quantity || 1)
    );
    return draftChanged || quantitiesChanged;
  }, [quote, draft, quantities]);

  const setField = (name: keyof Draft, value: string) =>
    setDraft((current) => (current ? { ...current, [name]: value } : current));

  const changeQuantity = (catalogItemId: string, nextQty: number) => {
    if (!editable || busy || nextQty < 1 || nextQty > 1_000_000) return;
    setQuantities((prev) => ({ ...prev, [catalogItemId]: nextQty }));
  };

  const copyText = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    onToast(`Đã sao chép ${label}.`, "success");
  };

  const validate = () => {
    if (!quote || !draft) return "Báo giá chưa sẵn sàng.";
    if (!draft.customerName.trim()) return "Hãy nhập tên khách hàng.";
    if (
      draft.validityDays &&
      (!Number.isInteger(Number(draft.validityDays)) ||
        Number(draft.validityDays) < 1 ||
        Number(draft.validityDays) > 3650)
    )
      return "Thời hạn báo giá phải từ 1 đến 3.650 ngày.";
    return "";
  };

  const save = async () => {
    if (!quote || !draft) throw new Error("Báo giá chưa sẵn sàng.");
    const validation = validate();
    if (validation) throw new Error(validation);

    const { quote: updated } = await api<{ quote: Quote }>(`/api/quotes/${quote._id}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: quote.lines
          .filter((line) => line.source !== "supplemental")
          .map((line) => ({
            catalogItemId: line.catalogItemId,
            quantity: Number(quantities[line.catalogItemId]) || line.quantity || 1,
          })),
        customerName: draft.customerName.trim(),
        customerEmail: draft.customerEmail.trim(),
        customerPhone: draft.customerPhone.trim(),
        taxRate: quote.taxRate || 0,
        taxRateConfirmed: true,
        shippingFee: quote.shippingFee || 0,
        shippingFeeConfirmed: true,
        validityDays: draft.validityDays ? Number(draft.validityDays) : null,
        completionDate: draft.completionDate || null,
      }),
    });
    setQuote(updated);
    setDraft(draftFromQuote(updated));
    setQuantities(
      Object.fromEntries(updated.lines.map((line) => [line.catalogItemId, line.quantity || 1]))
    );
    onChanged();
    return updated;
  };

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setProgress({ label });
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật báo giá.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const submit = () =>
    void run("Đang gửi duyệt", async () => {
      if (!quote) return;
      const current = dirty || quote.status === "rejected" ? await save() : quote;
      await api(`/api/quotes/${current._id}/submit-review`, { method: "POST" });
      await load();
      onChanged();
      onToast("Đã gửi báo giá chờ phê duyệt.", "success");
    });

  const approve = () =>
    void run("Đang duyệt báo giá", async () => {
      if (
        !quote ||
        !(await confirm({
          title: "Duyệt báo giá gửi khách?",
          message: `${quote.quoteNumber} · ${quote.customerName}\nTổng cộng: ${formatMoney(
            liveTotal,
            quote.currency
          )}\n${quote.lines.length} sản phẩm, dịch vụ`,
          confirmLabel: "Duyệt báo giá",
        }))
      )
        return;
      const current = dirty ? await save() : quote;
      await api(`/api/quotes/${current._id}/approve`, { method: "POST" });
      await load();
      onChanged();
      onToast("Đã duyệt báo giá khách hàng thành công.", "success");
    });

  const reject = () =>
    void run("Đang trả báo giá", async () => {
      if (!quote || !rejectionReason.trim()) throw new Error("Hãy nhập lý do cần chỉnh sửa.");
      await api(`/api/quotes/${quote._id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      await load();
      onChanged();
      setRejecting(false);
      setRejectionReason("");
      onToast("Đã chuyển báo giá về trạng thái cần chỉnh sửa.", "success");
    });

  const download = () =>
    void run("Đang xuất file báo giá", async () => {
      if (!quote) return;
      const current = dirty && editable ? await save() : quote;
      const isDraft = current.status !== "approved";
      const response = await fetch(`/api/quotes/${current._id}/export${isDraft ? "?draft=1" : ""}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? "Không xuất được báo giá.");
      }
      const blob = await responseBlobWithProgress(response, (percent) =>
        setProgress({ label: "Đang tải file Excel báo giá", progress: percent })
      );
      const extension = "xlsx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${current.quoteNumber}${isDraft ? "-nhap" : ""}.${extension}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast("Đã tải file Excel báo giá thành công.", "success");
    });

  if (loading) {
    return (
      <div className="page-stack" style={{ padding: "60px 0", textAlign: "center" }}>
        <div className="spinner spinner-dark" style={{ margin: "0 auto 12px" }} />
        <p className="muted">Đang mở chi tiết báo giá khách hàng…</p>
      </div>
    );
  }

  if (!quote || !draft) {
    return (
      <div className="page-stack">
        <button type="button" className="cqd-back-btn" onClick={onBack}>
          ← Quay lại danh sách
        </button>
        <div className="quote-setup-notice" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }}>
          {error || "Không tìm thấy thông tin báo giá khách hàng."}
        </div>
      </div>
    );
  }

  return (
    <div className="customer-detail-page">
      {/* Top Navigation Bar */}
      <div className="cqd-top-nav">
        <button type="button" className="cqd-back-btn" onClick={onBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <span>Danh sách báo giá khách</span>
        </button>

        <div className="cqd-top-meta">
          <span>Ngày tạo: {formatDate(quote.createdAt)}</span>
          {editable && (
            dirty ? (
              <span className="cqd-unsaved-badge">● Có thay đổi chưa lưu</span>
            ) : (
              <span className="cqd-saved-badge">✓ Đã lưu</span>
            )
          )}
        </div>
      </div>

      {progress && <TaskProgress {...progress} />}
      {error && (
        <div className="quote-setup-notice" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {/* Header Banner Card */}
      <section className="cqd-header-card">
        <div className="cqd-header-main">
          <div className="cqd-header-info">
            <div className="cqd-eyebrow-row">
              <span className="cqd-eyebrow">Báo giá gửi khách hàng</span>
              <span className={`status-pill ${statusStyle[quote.status]}`}>
                <span className="status-dot" />
                {statusText[quote.status]}
              </span>
            </div>

            <div className="cqd-title-row">
              <h1 className="cqd-quote-number">{quote.quoteNumber}</h1>
              <button
                type="button"
                className="cqd-copy-btn"
                onClick={() => copyText(quote.quoteNumber, "mã báo giá")}
                title="Sao chép mã"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
                <span>Sao chép</span>
              </button>
            </div>

            <div className="cqd-header-meta-chips">
              <span className="cqd-meta-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 21a7 7 0 0 1 14 0" />
                </svg>
                <span>Khách hàng: <strong>{draft.customerName || quote.customerName}</strong></span>
              </span>
              <span>·</span>
              <span className="cqd-meta-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span>SĐT: <strong>{draft.customerPhone || "Chưa có"}</strong></span>
              </span>
              <span>·</span>
              <span className="cqd-meta-chip">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <span>Email: <strong>{draft.customerEmail || "Chưa có"}</strong></span>
              </span>
            </div>
          </div>

          <div className="cqd-actions-toolbar">
            {editable && (
              <button
                type="button"
                className={`button ${dirty ? "button-primary cqd-save-pulse" : "button-soft"}`}
                disabled={busy || !dirty}
                onClick={() =>
                  void run("Đang lưu báo giá", async () => {
                    await save();
                    onToast("Đã lưu các thay đổi báo giá khách.", "success");
                  })
                }
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{busy ? "Đang lưu…" : dirty ? "Lưu thay đổi *" : "Đã lưu"}</span>
              </button>
            )}

            <button
              type="button"
              className="button button-primary"
              disabled={busy || !quote.lines.length}
              onClick={download}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{quote.status === "approved" ? "Xuất Excel báo giá" : "Xuất Excel nháp"}</span>
            </button>

            {["draft", "rejected"].includes(quote.status) && (
              <button type="button" className="button button-soft" disabled={busy} onClick={submit}>
                <span>Gửi phê duyệt</span>
              </button>
            )}

            {quote.status === "pending_review" && (
              <>
                <button
                  type="button"
                  className="button button-soft"
                  disabled={busy}
                  onClick={() => setRejecting((prev) => !prev)}
                >
                  <span>Trả lại</span>
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={approve}
                  style={{ background: "#16a34a", borderColor: "#16a34a" }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Duyệt để gửi khách</span>
                </button>
              </>
            )}

            <button
              type="button"
              className="button button-soft"
              disabled={busy}
              onClick={() => onDeleteQuote(quote)}
              title="Xóa báo giá này"
              style={{ color: "#dc2626" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Xóa</span>
            </button>
          </div>
        </div>

        {/* Rejection Note if Rejected */}
        {quote.status === "rejected" && quote.rejectionReason && (
          <div className="cqd-rejection-banner">
            <strong>Yêu cầu chỉnh sửa:</strong>
            <span>{quote.rejectionReason}</span>
          </div>
        )}

        {/* Rejection Form Input */}
        {rejecting && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#991b1b" }}>
              Nhập lý do cần chỉnh sửa / trả lại:
            </label>
            <textarea
              rows={2}
              maxLength={1000}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Ví dụ: Cần cập nhật lại đơn giá hoặc bổ sung chi tiết số lượng..."
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 13, background: "#fff", boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="button button-soft" onClick={() => setRejecting(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="button button-primary"
                style={{ background: "#dc2626", borderColor: "#dc2626" }}
                disabled={busy || !rejectionReason.trim()}
                onClick={reject}
              >
                Xác nhận trả lại
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Stepper Pipeline */}
      <section className="cqd-stepper-card">
        <div className="cqd-stepper">
          <div className={`cqd-step-item ${quote.status === "draft" ? "active" : "done"}`}>
            <span className="cqd-step-icon">
              {quote.status === "draft" ? "1" : "✓"}
            </span>
            <div className="cqd-step-copy">
              <span className="cqd-step-title">1. Soạn thảo danh mục</span>
              <span className="cqd-step-sub">Khởi tạo sản phẩm & đơn giá</span>
            </div>
          </div>

          <div
            className={`cqd-step-item ${
              quote.status === "needs_info"
                ? "active"
                : ["pending_review", "approved"].includes(quote.status)
                ? "done"
                : ""
            }`}
          >
            <span className="cqd-step-icon">
              {["pending_review", "approved"].includes(quote.status) ? "✓" : "2"}
            </span>
            <div className="cqd-step-copy">
              <span className="cqd-step-title">2. Kiểm tra thông tin</span>
              <span className="cqd-step-sub">Khách hàng & thời hạn</span>
            </div>
          </div>

          <div
            className={`cqd-step-item ${
              quote.status === "rejected"
                ? "alert"
                : quote.status === "pending_review"
                ? "active"
                : quote.status === "approved"
                ? "done"
                : ""
            }`}
          >
            <span className="cqd-step-icon">
              {quote.status === "approved" ? "✓" : quote.status === "rejected" ? "!" : "3"}
            </span>
            <div className="cqd-step-copy">
              <span className="cqd-step-title">3. Phê duyệt báo giá</span>
              <span className="cqd-step-sub">
                {quote.status === "rejected"
                  ? "Cần chỉnh sửa lại"
                  : quote.status === "pending_review"
                  ? "Đang chờ duyệt"
                  : quote.status === "approved"
                  ? "Đã duyệt thành công"
                  : "Chờ gửi duyệt"}
              </span>
            </div>
          </div>

          <div className={`cqd-step-item ${quote.status === "approved" ? "done" : ""}`}>
            <span className="cqd-step-icon">
              {quote.status === "approved" ? "✓" : "4"}
            </span>
            <div className="cqd-step-copy">
              <span className="cqd-step-title">4. Xuất gửi khách</span>
              <span className="cqd-step-sub">File Excel theo mẫu chuẩn</span>
            </div>
          </div>
        </div>
      </section>

      {/* KPI Cards Strip */}
      <section className="cqd-kpi-grid">
        <div className="cqd-kpi-box highlight">
          <span className="cqd-kpi-box-title">Tổng tiền thanh toán</span>
          <span className="cqd-kpi-box-value">
            {formatMoney(liveTotal, quote.currency)}
          </span>
          <span className="cqd-kpi-box-sub">Đã bao gồm thuế & chi phí</span>
        </div>

        <div className="cqd-kpi-box">
          <span className="cqd-kpi-box-title">Tạm tính hàng hoá</span>
          <span className="cqd-kpi-box-value">
            {formatMoney(liveSubtotal, quote.currency)}
          </span>
          <span className="cqd-kpi-box-sub">{quote.lines.length} hạng mục</span>
        </div>

        <div className="cqd-kpi-box">
          <span className="cqd-kpi-box-title">Số lượng sản phẩm</span>
          <span className="cqd-kpi-box-value" style={{ color: "#0f172a" }}>
            {quote.lines.reduce((s, l) => s + (quantities[l.catalogItemId] ?? l.quantity ?? 1), 0)}
          </span>
          <span className="cqd-kpi-box-sub">{quote.lines.length} dòng hàng</span>
        </div>

        <div className="cqd-kpi-box">
          <span className="cqd-kpi-box-title">Thời hạn báo giá</span>
          <span className="cqd-kpi-box-value" style={{ color: "#d97706" }}>
            {draft.validityDays ? `${draft.validityDays} ngày` : "Chưa đặt"}
          </span>
          <span className="cqd-kpi-box-sub">
            {draft.completionDate ? `Hạn: ${draft.completionDate}` : "Chưa có ngày hẹn"}
          </span>
        </div>
      </section>

      {/* Main 2-Column Layout */}
      <div className="cqd-layout">
        {/* Left Column: Form & Tables */}
        <div className="cqd-main-col">
          {/* Card 1: Customer Information */}
          <section className="cqd-card">
            <div className="cqd-card-header">
              <div className="cqd-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ADFC" strokeWidth="2.2">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M5 21a7 7 0 0 1 14 0" />
                </svg>
                <h2>Thông tin khách hàng</h2>
              </div>
              <span className="cqd-card-title"><span>Hiển thị trên tiêu đề báo giá</span></span>
            </div>

            <div className="cqd-form-grid">
              <div className="cqd-field">
                <label>
                  <span>Tên khách hàng / Doanh nghiệp *</span>
                </label>
                <div className="cqd-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M5 21a7 7 0 0 1 14 0" />
                  </svg>
                  <input
                    value={draft.customerName}
                    maxLength={250}
                    disabled={!editable || busy}
                    placeholder="Tên khách hàng"
                    onChange={(event) => setField("customerName", event.target.value)}
                  />
                </div>
              </div>

              <div className="cqd-field">
                <label>
                  <span>Email nhận báo giá</span>
                </label>
                <div className="cqd-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <input
                    type="email"
                    value={draft.customerEmail}
                    maxLength={250}
                    disabled={!editable || busy}
                    placeholder="email@example.com"
                    onChange={(event) => setField("customerEmail", event.target.value)}
                  />
                </div>
              </div>

              <div className="cqd-field">
                <label>
                  <span>Số điện thoại</span>
                </label>
                <div className="cqd-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <input
                    value={draft.customerPhone}
                    maxLength={50}
                    disabled={!editable || busy}
                    placeholder="0912 345 678"
                    onChange={(event) => setField("customerPhone", event.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Products & Services Table */}
          <section className="cqd-card">
            <div className="cqd-card-header">
              <div className="cqd-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ADFC" strokeWidth="2.2">
                  <path d="m12 3 9 5-9 5-9-5 9-5Z" />
                  <path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9" />
                </svg>
                <h2>Danh sách sản phẩm & dịch vụ</h2>
              </div>
              <span className="cqd-card-title">
                <span>{quote.lines.length} hạng mục được chọn</span>
              </span>
            </div>

            <div className="cqd-table-wrap">
              <table className="cqd-table">
                <thead>
                  <tr>
                    <th style={{ width: 44, textAlign: "center" }}>STT</th>
                    <th>Sản phẩm / Dịch vụ</th>
                    <th>ĐVT</th>
                    <th style={{ textAlign: "right" }}>Đơn giá</th>
                    <th style={{ textAlign: "center", width: 130 }}>Số lượng</th>
                    <th style={{ textAlign: "right" }}>Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.lines.map((line, idx) => {
                    const currentQty = quantities[line.catalogItemId] ?? line.quantity ?? 1;
                    const lineTotal = line.unitPrice * currentQty;
                    return (
                      <tr key={line.catalogItemId}>
                        <td style={{ textAlign: "center", color: "#94a3b8", fontWeight: 700 }}>
                          {idx + 1}
                        </td>
                        <td>
                          <div className="cqd-product-cell">
                            <strong>{line.name}</strong>
                            <small>
                              Mã: {line.sku || "N/A"}
                              {line.description ? ` · ${line.description}` : ""}
                            </small>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600, color: "#475569" }}>{line.unit}</span>
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {formatMoney(line.unitPrice, quote.currency)}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <div className="cqd-qty-control">
                            <button
                              type="button"
                              className="cqd-qty-btn"
                              disabled={!editable || busy || currentQty <= 1}
                              onClick={() => changeQuantity(line.catalogItemId, currentQty - 1)}
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="1"
                              max="1000000"
                              className="cqd-qty-input"
                              disabled={!editable || busy}
                              value={currentQty}
                              onChange={(e) => changeQuantity(line.catalogItemId, Number(e.target.value) || 1)}
                            />
                            <button
                              type="button"
                              className="cqd-qty-btn"
                              disabled={!editable || busy}
                              onClick={() => changeQuantity(line.catalogItemId, currentQty + 1)}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span className="cqd-line-total">
                            {formatMoney(lineTotal, quote.currency)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Card 3: Terms & Validity */}
          <section className="cqd-card">
            <div className="cqd-card-header">
              <div className="cqd-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00ADFC" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <h2>Điều khoản & Hiệu lực báo giá</h2>
              </div>
            </div>

            <div className="cqd-form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="cqd-field">
                <label>Thời hạn hiệu lực (số ngày)</label>
                <div className="cqd-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    step="1"
                    placeholder="Ví dụ: 30"
                    value={draft.validityDays}
                    disabled={!editable || busy}
                    onChange={(event) => setField("validityDays", event.target.value)}
                  />
                </div>
              </div>

              <div className="cqd-field">
                <label>Ngày hoàn thành dự kiến</label>
                <div className="cqd-input-wrap">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  <input
                    type="date"
                    value={draft.completionDate}
                    disabled={!editable || busy}
                    onChange={(event) => setField("completionDate", event.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Financial Summary & Actions */}
        <div className="cqd-side-col">
          <section className="cqd-summary-card">
            <h3 className="cqd-summary-title">Tóm tắt thanh toán</h3>

            <div className="cqd-summary-list">
              <div className="cqd-summary-row">
                <span>Tạm tính tiền hàng:</span>
                <strong>{formatMoney(liveSubtotal, quote.currency)}</strong>
              </div>

              <div className="cqd-summary-row">
                <span>Thuế VAT ({Math.round((quote.taxRate || 0) * 100)}%):</span>
                <strong>{formatMoney(liveTaxAmount, quote.currency)}</strong>
              </div>

              <div className="cqd-summary-row">
                <span>Phí vận chuyển:</span>
                <strong>{quote.shippingFee ? formatMoney(quote.shippingFee, quote.currency) : "Miễn phí"}</strong>
              </div>

              <div className="cqd-summary-divider" />

              <div className="cqd-summary-total-row">
                <span className="cqd-summary-total-label">TỔNG CỘNG:</span>
                <span className="cqd-summary-total-value">
                  {formatMoney(liveTotal, quote.currency)}
                </span>
              </div>
            </div>
          </section>

          {/* Workflow Status Box */}
          <div className="cqd-workflow-box">
            <h3>Quy trình phê duyệt</h3>
            {quote.status === "draft" && (
              <p>
                Báo giá đang ở trạng thái <strong>Bản nháp</strong>. Bạn có thể chỉnh sửa số lượng, giá trị và thông tin khách hàng, sau đó bấm <strong>Gửi phê duyệt</strong>.
              </p>
            )}
            {quote.status === "pending_review" && (
              <p>
                Báo giá đang ở trạng thái <strong>Chờ duyệt</strong>. Người quản lý có thể kiểm tra và bấm <strong>Duyệt để gửi khách</strong> hoặc trả lại để điều chỉnh.
              </p>
            )}
            {quote.status === "approved" && (
              <p>
                Báo giá <strong>Đã duyệt</strong>. Bạn có thể tải file Excel chính thức để gửi trực tiếp cho khách hàng.
              </p>
            )}
            {quote.status === "rejected" && (
              <p style={{ color: "#b91c1c" }}>
                Báo giá bị trả lại để <strong>Cần chỉnh sửa</strong>. Vui lòng xem lý do bên trên, cập nhật lại và gửi duyệt lại.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              {editable && (
                <button
                  type="button"
                  className={`button ${dirty ? "button-primary" : "button-soft"}`}
                  disabled={busy || !dirty}
                  onClick={() =>
                    void run("Đang lưu báo giá", async () => {
                      await save();
                      onToast("Đã lưu báo giá khách hàng thành công.", "success");
                    })
                  }
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{dirty ? "Lưu thay đổi *" : "Đã lưu tất cả"}</span>
                </button>
              )}

              {["draft", "rejected"].includes(quote.status) && (
                <button type="button" className="button button-primary" disabled={busy} onClick={submit}>
                  <span>Gửi duyệt ngay</span>
                </button>
              )}

              {quote.status === "pending_review" && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy}
                  onClick={approve}
                  style={{ background: "#16a34a", borderColor: "#16a34a" }}
                >
                  <span>Duyệt báo giá</span>
                </button>
              )}

              <button
                type="button"
                className="button button-soft"
                disabled={busy || !quote.lines.length}
                onClick={download}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{quote.status === "approved" ? "Tải file Excel" : "Tải Excel nháp"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
