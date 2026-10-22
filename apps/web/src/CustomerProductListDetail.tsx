import { useEffect, useMemo, useState } from "react";
import { api, formatDate, formatMoney } from "./api";
import { listCustomerExcelTemplates, type CustomerExcelTemplate } from "./customer-quote-templates";
import type { ConfirmOptions, Notify } from "./Feedback";
import type { Quote } from "./types";
import "./customer-quote-detail.css";

export default function CustomerProductListDetail({
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
  const [templates, setTemplates] = useState<CustomerExcelTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    const result = await api<{ quote: Quote }>("/api/quotes/" + id);
    if (result.quote.kind !== "customer") throw new Error("Không tìm thấy danh sách sản phẩm khách.");
    setQuote(result.quote);
  };

  useEffect(() => {
    let active = true;
    api<{ quote: Quote }>("/api/quotes/" + id)
      .then(({ quote: value }) => {
        if (!active) return;
        if (value.kind !== "customer") throw new Error("Không tìm thấy danh sách sản phẩm khách.");
        setQuote(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Không mở được danh sách sản phẩm.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    listCustomerExcelTemplates()
      .then(({ templates: options, defaultTemplateId }) => {
        if (!active) return;
        setTemplates(options);
        setTemplateId(
          (current) =>
            current || (options.some((entry) => entry.id === defaultTemplateId) ? defaultTemplateId! : "")
        );
      })
      .catch(() => {
        /* Excel thường vẫn tải được khi không có mẫu. */
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (quote?.template && templates.some((entry) => entry.id === quote.template?.id)) {
      setTemplateId(quote.template.id);
    }
  }, [quote?.template?.id, templates]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật danh sách sản phẩm.");
    } finally {
      setBusy(false);
    }
  };

  const copyText = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    onToast(`Đã sao chép ${label}.`, "success");
  };

  const approve = () =>
    void run(async () => {
      if (
        !quote ||
        !(await confirm({
          title: "Duyệt danh sách sản phẩm?",
          message:
            quote.quoteNumber +
            " · " +
            quote.customerName +
            "\n" +
            (quote.lines.length + (quote.missingProducts?.length ?? 0)) +
            " sản phẩm cần dùng",
          confirmLabel: "Duyệt danh sách",
        }))
      )
        return;
      await api("/api/quotes/" + id + "/approve", { method: "POST" });
      await reload();
      onChanged();
      onToast("Đã duyệt danh sách sản phẩm thành công.", "success");
    });

  const download = () =>
    void run(async () => {
      if (!quote) return;
      const params = new URLSearchParams({ templateId: templateId || "none" });
      if (quote.status !== "approved") params.set("draft", "1");
      const response = await fetch("/api/quotes/" + id + "/export?" + params, { credentials: "include" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Không tải được danh sách sản phẩm.");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${quote.quoteNumber}-san-pham.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onToast("Đã xuất file Excel danh sách sản phẩm.", "success");
    });

  // Selected template name
  const selectedTemplateName = useMemo(() => {
    if (!templateId) return "Excel mặc định";
    const found = templates.find((t) => t.id === templateId);
    return found ? found.name || found.originalFilename : "Excel mặc định";
  }, [templateId, templates]);

  if (loading) {
    return (
      <div className="customer-detail-page" style={{ padding: "60px 0", textAlign: "center" }}>
        <div className="spinner spinner-dark" style={{ margin: "0 auto 12px" }} />
        <p className="muted">Đang mở chi tiết báo giá khách hàng…</p>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="customer-detail-page">
        <button type="button" className="cqd-back-btn" onClick={onBack}>
          ← Danh sách báo giá khách
        </button>
        <div className="quote-setup-notice" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c", marginTop: 14 }}>
          {error || "Không tìm thấy thông tin báo giá khách hàng."}
        </div>
      </div>
    );
  }

  const totalItemsCount = quote.lines.length + (quote.missingProducts?.length ?? 0);
  const isApproved = quote.status === "approved";

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
        </div>
      </div>

      {error && (
        <div className="quote-setup-notice" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c", margin: 0 }}>
          {error}
        </div>
      )}

      {/* Header Banner Card */}
      <section className="cqd-header-card">
        <div className="cqd-header-main">
          <div className="cqd-header-info">
            <div className="cqd-eyebrow-row">
              <span className="cqd-eyebrow">Báo giá sản phẩm khách hàng</span>
              <span className={`status-pill ${isApproved ? "green" : "neutral"}`}>
                <span className="status-dot" />
                {isApproved ? "Đã duyệt" : "Nháp"}
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
                <span>Khách hàng: <strong>{quote.customerName}</strong></span>
              </span>

              {quote.customerPhone && (
                <>
                  <span>·</span>
                  <span className="cqd-meta-chip">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <span>SĐT: <strong>{quote.customerPhone}</strong></span>
                  </span>
                </>
              )}

              {quote.customerEmail && (
                <>
                  <span>·</span>
                  <span className="cqd-meta-chip">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    <span>Email: <strong>{quote.customerEmail}</strong></span>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="cqd-actions-toolbar">
            {!isApproved && (
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={approve}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Duyệt</span>
              </button>
            )}

            {/* Template Selector */}
            <select
              value={templateId}
              disabled={busy}
              onChange={(event) => setTemplateId(event.target.value)}
              aria-label="Mẫu Excel xuất báo giá"
              className="customer-product-template-select"
            >
              <option value="">Excel mặc định</option>
              {templates.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name || entry.originalFilename}
                </option>
              ))}
            </select>

            {/* Download Button */}
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={download}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>{quote.status === "approved" ? "Xuất Excel" : "Xuất Excel nháp"}</span>
            </button>

            {/* Delete Quote */}
            <button
              type="button"
              className="button button-soft"
              disabled={busy}
              onClick={() => onDeleteQuote(quote)}
              title="Xóa danh sách này"
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

      </section>

      {/* KPI Cards Strip */}
      <section className="cqd-kpi-grid">
        <div className="cqd-kpi-box highlight">
          <span className="cqd-kpi-box-title">Tổng sản phẩm cần dùng</span>
          <span className="cqd-kpi-box-value">{totalItemsCount}</span>
          <span className="cqd-kpi-box-sub">Tất cả hạng mục trong yêu cầu</span>
        </div>

        <div className="cqd-kpi-box">
          <span className="cqd-kpi-box-title">Có trong danh mục</span>
          <span className="cqd-kpi-box-value" style={{ color: "#16a34a" }}>
            {quote.lines.length}
          </span>
          <span className="cqd-kpi-box-sub">Đã khớp với bảng giá doanh nghiệp</span>
        </div>

        <div className="cqd-kpi-box">
          <span className="cqd-kpi-box-title">Chưa có trong danh mục</span>
          <span
            className="cqd-kpi-box-value"
            style={{ color: (quote.missingProducts?.length ?? 0) > 0 ? "#ea580c" : "#64748b" }}
          >
            {quote.missingProducts?.length ?? 0}
          </span>
          <span className="cqd-kpi-box-sub">
            {(quote.missingProducts?.length ?? 0) > 0 ? "Cần bổ sung vào bảng giá" : "Đã đủ toàn bộ sản phẩm"}
          </span>
        </div>

        <div className="cqd-kpi-box">
          <span className="cqd-kpi-box-title">Mẫu Excel xuất bản</span>
          <span
            className="cqd-kpi-box-value"
            style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={selectedTemplateName}
          >
            {selectedTemplateName}
          </span>
          <span className="cqd-kpi-box-sub">Có thể chọn mẫu khác ở thanh trên</span>
        </div>
      </section>

      {/* Section 1: Products in catalog */}
      <section className="cqd-card">
        <div className="cqd-card-header">
          <div className="cqd-card-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <h2>Sản phẩm có trong danh mục</h2>
          </div>
          <span className="cqd-card-title">
            <span style={{ fontWeight: 700, color: "#16a34a" }}>{quote.lines.length} sản phẩm</span>
          </span>
        </div>

        <div className="cqd-table-wrap">
          <table className="cqd-table customer-product-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: 48, textAlign: "center" }}>STT</th>
                <th scope="col">Tên sản phẩm / Dịch vụ</th>
                <th scope="col">Mã SKU</th>
                <th scope="col">ĐVT</th>
                <th scope="col" style={{ textAlign: "right" }}>Đơn giá niêm yết</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line, index) => (
                <tr key={`${line.catalogItemId}-${index}`}>
                  <td style={{ textAlign: "center", color: "#94a3b8", fontWeight: 700 }}>
                    {index + 1}
                  </td>
                  <td>
                    <div className="cqd-product-cell">
                      <strong>{line.name}</strong>
                      {line.description && <small>{line.description}</small>}
                    </div>
                  </td>
                  <td>
                    {line.sku ? (
                      <span className="cqd-sku-tag">{line.sku}</span>
                    ) : (
                      <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, color: "#475569" }}>{line.unit || "—"}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {line.priceUnavailable ? (
                      <span className="cqd-price-unavailable">Chưa có giá</span>
                    ) : (
                      <span className="cqd-price-tag">
                        {formatMoney(line.unitPrice, line.currency || quote.currency || "VND")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Missing products not in catalog */}
      {!!quote.missingProducts?.length && (
        <section className="cqd-missing-card">
          <div className="cqd-missing-header">
            <h2>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Sản phẩm chưa có trong danh mục ({quote.missingProducts.length})</span>
            </h2>
            <p>Khách hàng cần các sản phẩm này nhưng chưa có đơn giá trong bảng giá doanh nghiệp</p>
          </div>

          <div className="cqd-missing-chips">
            {quote.missingProducts.map((name, i) => (
              <span key={i} className="cqd-missing-chip">
                <span>📦</span>
                <span>{name}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
