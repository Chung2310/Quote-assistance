import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, api } from "./api";
import { TaskProgress } from "./Feedback";
import { listCustomerExcelTemplates, type CustomerExcelTemplate } from "./customer-quote-templates";
import type { CatalogItem, Quote, QuoteStatus } from "./types";
import "./customer-quotes.css";

type Selection = { catalogItemId: string; quantity: number; unit: string; reason?: string };

const statusLabels: Record<QuoteStatus, string> = {
  draft: "Bản nháp",
  needs_info: "Cần bổ sung",
  pending_review: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Cần chỉnh sửa",
};

const statusStyles: Record<QuoteStatus, string> = {
  draft: "neutral",
  needs_info: "amber",
  pending_review: "blue",
  approved: "green",
  rejected: "rose",
};

export default function CustomerQuotes({
  onOpen,
  onCreated,
  onQuotaExceeded,
  onAiUsed,
}: {
  onOpen: (id: string) => void;
  onCreated: () => void;
  onQuotaExceeded: () => void;
  onAiUsed: () => void;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);

  // Filters & search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    let live = true;
    setLoading(true);
    api<{ quotes: Quote[] }>("/api/quotes?kind=customer")
      .then(({ quotes }) => {
        if (live) setQuotes(quotes);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : "Không tải được danh sách báo giá khách.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reload]);

  // KPI Calculations
  const stats = useMemo(() => {
    const total = quotes.length;
    const approved = quotes.filter((q) => q.status === "approved").length;
    const pending = quotes.filter((q) => q.status === "pending_review").length;
    const drafts = quotes.filter((q) => ["draft", "needs_info", "rejected"].includes(q.status)).length;
    return { total, approved, pending, drafts };
  }, [quotes]);

  // Filtered quotes
  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      if (statusFilter !== "all" && quote.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const term = search.toLowerCase();
      const matchNumber = quote.quoteNumber.toLowerCase().includes(term);
      const matchCustomer = quote.customerName.toLowerCase().includes(term);
      const matchPhone = (quote.customerPhone || "").toLowerCase().includes(term);
      const matchEmail = (quote.customerEmail || "").toLowerCase().includes(term);
      return matchNumber || matchCustomer || matchPhone || matchEmail;
    });
  }, [quotes, statusFilter, search]);

  return (
    <div className="customer-quotes-page">
      {/* Header Banner */}
      <section className="cq-header-banner">
        <div className="cq-header-copy">
          <h1>Quản lý Báo giá Khách hàng</h1>
        </div>
        <div className="cq-header-actions">
          <button type="button" className="cq-create-btn" onClick={() => setCreating(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Tạo báo giá khách mới</span>
          </button>
        </div>
      </section>

      {error && (
        <div className="quote-setup-notice" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {/* KPI Summary Grid */}
      <section className="cq-kpi-grid">
        <div className="cq-kpi-card">
          <div className="cq-kpi-top">
            <span className="cq-kpi-label">Tổng báo giá</span>
            <div className="cq-kpi-icon tone-blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
          </div>
          <div className="cq-kpi-body">
            <span className="cq-kpi-value">{stats.total}</span>
            <span className="cq-kpi-sub">Danh sách sản phẩm khách cần</span>
          </div>
        </div>

        <div className="cq-kpi-card">
          <div className="cq-kpi-top">
            <span className="cq-kpi-label">Đã phê duyệt</span>
            <div className="cq-kpi-icon tone-green">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          </div>
          <div className="cq-kpi-body">
            <span className="cq-kpi-value" style={{ color: "#16a34a" }}>{stats.approved}</span>
            <span className="cq-kpi-sub">Sẵn sàng gửi khách</span>
          </div>
        </div>

        <div className="cq-kpi-card">
          <div className="cq-kpi-top">
            <span className="cq-kpi-label">Đang chờ duyệt</span>
            <div className="cq-kpi-icon tone-amber">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          </div>
          <div className="cq-kpi-body">
            <span className="cq-kpi-value" style={{ color: "#d97706" }}>{stats.pending}</span>
            <span className="cq-kpi-sub">Cần người quản lý duyệt</span>
          </div>
        </div>

        <div className="cq-kpi-card">
          <div className="cq-kpi-top">
            <span className="cq-kpi-label">Nháp & Cần sửa</span>
            <div className="cq-kpi-icon tone-purple">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
          </div>
          <div className="cq-kpi-body">
            <span className="cq-kpi-value" style={{ color: "#7c3aed" }}>{stats.drafts}</span>
            <span className="cq-kpi-sub">Đang soạn thảo hoặc cần cập nhật</span>
          </div>
        </div>
      </section>

      {/* Main Table Card */}
      <section className="cq-content-card">
        {/* Toolbar */}
        <div className="cq-toolbar">
          <div className="cq-search-box">
            <svg className="cq-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="cq-search-input"
              placeholder="Tìm theo mã báo giá, tên khách hàng, số điện thoại..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="cq-filter-pills">
            <button
              type="button"
              className={`cq-filter-btn ${statusFilter === "all" ? "active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              Tất cả <span className="cq-filter-count">{quotes.length}</span>
            </button>
            <button
              type="button"
              className={`cq-filter-btn ${statusFilter === "draft" ? "active" : ""}`}
              onClick={() => setStatusFilter("draft")}
            >
              Bản nháp <span className="cq-filter-count">{quotes.filter((q) => q.status === "draft").length}</span>
            </button>
            <button
              type="button"
              className={`cq-filter-btn ${statusFilter === "pending_review" ? "active" : ""}`}
              onClick={() => setStatusFilter("pending_review")}
            >
              Chờ duyệt <span className="cq-filter-count">{quotes.filter((q) => q.status === "pending_review").length}</span>
            </button>
            <button
              type="button"
              className={`cq-filter-btn ${statusFilter === "approved" ? "active" : ""}`}
              onClick={() => setStatusFilter("approved")}
            >
              Đã duyệt <span className="cq-filter-count">{quotes.filter((q) => q.status === "approved").length}</span>
            </button>
            <button
              type="button"
              className={`cq-filter-btn ${statusFilter === "rejected" ? "active" : ""}`}
              onClick={() => setStatusFilter("rejected")}
            >
              Cần sửa <span className="cq-filter-count">{quotes.filter((q) => q.status === "rejected").length}</span>
            </button>
          </div>
        </div>

        {/* Quotes List Table */}
        <div className="cq-table-responsive">
          {loading ? (
            <div className="cq-loading-state">
              <div className="spinner spinner-dark" />
              <span>Đang tải danh sách báo giá khách hàng…</span>
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div className="cq-empty-state">
              <div className="cq-empty-icon">
                <img src="/images/quote-empty-3d.svg" alt="" />
              </div>
              <h3>
                {quotes.length === 0 ? "Chưa có bản báo giá khách hàng nào" : "Không tìm thấy báo giá phù hợp"}
              </h3>
              <p>
                {quotes.length === 0
                  ? "Bắt đầu tạo bản báo giá đầu tiên gửi khách hàng từ danh mục sản phẩm và bảng giá của doanh nghiệp."
                  : "Thử tìm kiếm với từ khóa khác hoặc thay đổi bộ lọc trạng thái."}
              </p>
              {quotes.length === 0 && (
                <button type="button" className="cq-create-btn" onClick={() => setCreating(true)} style={{ marginTop: 8 }}>
                  + Tạo báo giá khách đầu tiên
                </button>
              )}
            </div>
          ) : (
            <table className="cq-table">
              <thead>
                <tr>
                  <th>Mã báo giá</th>
                  <th>Khách hàng</th>
                  <th>Hạng mục</th>
                  <th>Ngày tạo</th>
                  <th>Trạng thái</th>
                  <th style={{ textAlign: "right" }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => {
                  const initials = quote.customerName
                    ? quote.customerName
                      .split(" ")
                      .filter(Boolean)
                      .slice(-2)
                      .map((n) => n[0].toUpperCase())
                      .join("")
                    : "KH";
                  return (
                    <tr key={quote._id} onClick={() => onOpen(quote._id)}>
                      <td>
                        <span className="cq-number-badge">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          </svg>
                          {quote.quoteNumber}
                        </span>
                      </td>

                      <td>
                        <div className="cq-customer-cell">
                          <div className="cq-avatar">{initials}</div>
                          <div className="cq-customer-info">
                            <span className="cq-customer-name">{quote.customerName}</span>
                            <span className="cq-customer-contact">
                              {quote.customerPhone || quote.customerEmail || "Chưa có thông tin liên hệ"}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <span className="cq-items-chip">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                          </svg>
                          {quote.lines.length} sản phẩm
                        </span>
                      </td>


                      <td>
                        <span className="cq-date-cell">
                          {new Date(quote.createdAt).toLocaleDateString("vi-VN", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </span>
                      </td>

                      <td>
                        <span className={`status-pill ${statusStyles[quote.status]}`}>
                          <span className="status-dot" />
                          {statusLabels[quote.status]}
                        </span>
                      </td>

                      <td className="cq-action-cell">
                        <button
                          type="button"
                          className="cq-view-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(quote._id);
                          }}
                        >
                          <span>Xem chi tiết</span>
                          <span aria-hidden="true">→</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Create Dialog */}
      {creating && (
        <CustomerQuoteDialog
          onClose={() => setCreating(false)}
          onQuotaExceeded={onQuotaExceeded}
          onAiUsed={onAiUsed}
          onCreated={(id) => {
            setCreating(false);
            setReload((value) => value + 1);
            onCreated();
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function CustomerQuoteDialog({
  onClose,
  onCreated,
  onQuotaExceeded,
  onAiUsed,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onQuotaExceeded: () => void;
  onAiUsed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [templates, setTemplates] = useState<CustomerExcelTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Selection[]>([]);
  const [prompt, setPrompt] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [missingProducts, setMissingProducts] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node.close();
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    let live = true;
    api<{ items: CatalogItem[] }>("/api/catalog")
      .then((products) => {
        if (!live) return;
        setCatalog(products.items);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : "Không tải được bảng giá sản phẩm.");
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    listCustomerExcelTemplates().then(({ templates: options, defaultTemplateId }) => {
      if (!live) return;
      setTemplates(options);
      if (options.some((entry) => entry.id === defaultTemplateId)) setTemplateId(defaultTemplateId!);
    }).catch(() => { /* Có thể tạo báo giá và xuất Excel thường khi chưa có mẫu. */ });
    return () => { live = false; };
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const available = useMemo(
    () =>
      catalog.filter(
        (item) => item.active && (!item.effectiveFrom || item.effectiveFrom <= today) && (!item.effectiveTo || item.effectiveTo >= today)
      ),
    [catalog, today]
  );

  const visible = available
    .filter((item) => `${item.sku} ${item.name} ${item.description}`.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")))
    .slice(0, 100);

  const selectedRows = selected.flatMap((row) => {
    const item = available.find((product) => product._id === row.catalogItemId);
    return item ? [{ ...row, item }] : [];
  });

  const addItem = (item: CatalogItem) =>
    setSelected((rows) =>
      rows.some((row) => row.catalogItemId === item._id)
        ? rows
        : [...rows, { catalogItemId: item._id, quantity: 1, unit: item.unit }]
    );

  const removeItem = (catalogItemId: string) => {
    setSelected((rows) => rows.filter((r) => r.catalogItemId !== catalogItemId));
  };

  const suggest = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setAiLoading(true);
    setError("");
    try {
      const result = await api<{ items: Selection[]; missingProducts: string[]; questions: string[]; notes: string[] }>("/api/customer-quotes/suggest", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      onAiUsed();
      setSelected(result.items);
      setMissingProducts(result.missingProducts);
      setQuestions(result.questions);
      setNotes(result.notes);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) onAiUsed();
      setError(cause instanceof Error ? cause.message : "Không tạo được đề xuất từ AI.");
    } finally {
      setAiLoading(false);
      setBusy(false);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.length && !missingProducts.length) {
      setError("Hãy chọn hoặc gợi ý ít nhất một sản phẩm.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { quote } = await api<{ quote: Quote }>("/api/customer-quotes", {
        method: "POST",
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim(),
          ...(templateId ? { templateId } : {}),
          idempotencyKey,
          missingProducts,
          items: selected.map(({ catalogItemId, quantity, unit }) => ({
            catalogItemId,
            quantity: quantity || 1,
            unit,
          })),
        }),
      });
      onCreated(quote._id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) onQuotaExceeded();
      setError(cause instanceof Error ? cause.message : "Không tạo được báo giá khách hàng.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="customer-quote-dialog"
      aria-labelledby="customer-quote-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="cq-dialog-header">
        <div className="cq-dialog-title">
          <div className="cq-dialog-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <div>
            <h2 id="customer-quote-title">Tạo báo giá khách</h2>
          </div>
        </div>
        <button type="button" className="cq-dialog-close" aria-label="Đóng" disabled={busy} onClick={onClose}>
          ✕
        </button>
      </div>

      <form onSubmit={(event) => void create(event)} style={{ display: "contents" }}>
        <div className="cq-dialog-body">
          {error && (
            <div className="quote-setup-notice" role="alert" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c", margin: 0 }}>
              {error}
            </div>
          )}

          {/* Section 1: Customer Info */}
          <div className="cq-form-section">
            <div className="cq-section-label">
              <span>1. Thông tin khách hàng</span>
            </div>
            <div className="cq-field-row">
              <div className="cq-input-group">
                <label>Tên khách hàng *</label>
                <div className="cq-input-wrapper">
                  <svg className="cq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M5 21a7 7 0 0 1 14 0" />
                  </svg>
                  <input
                    required
                    maxLength={250}
                    placeholder="Tên khách hoặc công ty"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                  />
                </div>
              </div>

              <div className="cq-input-group">
                <label>Email</label>
                <div className="cq-input-wrapper">
                  <svg className="cq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                  <input
                    type="email"
                    maxLength={250}
                    placeholder="khachhang@example.com"
                    value={customerEmail}
                    onChange={(event) => setCustomerEmail(event.target.value)}
                  />
                </div>
              </div>

              <div className="cq-input-group">
                <label>Điện thoại</label>
                <div className="cq-input-wrapper">
                  <svg className="cq-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <input
                    maxLength={50}
                    placeholder="0912 345 678"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="cq-form-section">
            <div className="cq-section-label"><span>Mẫu Excel</span></div>
            <div className="cq-input-group">
              <div className="cq-input-wrapper">
                <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} aria-label="Mẫu Excel báo giá khách">
                  <option value="">Excel thường</option>
                  {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || entry.originalFilename}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Section 2: Mode selection */}
          <div className="cq-form-section">
            <div className="cq-section-label">
              <span>2. Chọn cách lập báo giá</span>
            </div>
            <div className="cq-mode-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "manual"}
                className={`cq-mode-tab ${mode === "manual" ? "active" : ""}`}
                disabled={busy}
                onClick={() => setMode("manual")}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                <span>Chọn sản phẩm</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "ai"}
                className={`cq-mode-tab ${mode === "ai" ? "active" : ""}`}
                disabled={busy}
                onClick={() => setMode("ai")}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
                </svg>
                <span>AI gợi ý</span>
              </button>
            </div>
          </div>

          {/* Mode AI Form */}
          {mode === "ai" && (
            <div className="cq-ai-box" aria-busy={aiLoading}>
              <div className="cq-ai-header">
                <strong>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
                  </svg>
                  Mô tả yêu cầu
                </strong>
              </div>
              <div className="cq-input-group">
                <label htmlFor="customer-quote-prompt">Bạn cần sản phẩm gì?</label>
                <div className="cq-input-wrapper">
                  <textarea
                    id="customer-quote-prompt"
                    className="cq-prompt-input"
                    rows={5}
                    maxLength={3000}
                    value={prompt}
                    disabled={busy}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Ví dụ: Lát nền phòng bằng gạch porcelain, cần vật tư và nhân công phù hợp."
                  />
                </div>
              </div>

              <button
                type="button"
                className="cq-ai-suggest-btn"
                title="Mỗi lần gợi ý trừ 1 lượt AI"
                disabled={busy || !prompt.trim()}
                onClick={() => void suggest()}
              >
                {aiLoading ? <span className="spinner" /> : "⚡"}
                <span>{aiLoading ? "AI đang phân tích…" : "Gợi ý hạng mục"}</span>
              </button>

              {aiLoading && <TaskProgress label="AI đang tạo gợi ý hạng mục" detail="Đang phân tích mô tả và tìm sản phẩm phù hợp trong bảng giá…" />}

              {notes.length > 0 && (
                <div className="quote-setup-notice" role="status" style={{ background: "#ecfeff", borderColor: "#a5e5ed", color: "#155e75" }}>
                  {notes.map((note, idx) => (
                    <p key={idx} style={{ margin: "2px 0" }}>
                      💡 {note}
                    </p>
                  ))}
                </div>
              )}
              {questions.length > 0 && (
                <div className="cq-ai-followup" role="status">
                  <strong>AI cần thêm thông tin</strong>
                  <ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul>
                  <small>Chỉnh mô tả theo câu trả lời rồi chạy lại AI.</small>
                </div>
              )}
              {missingProducts.length > 0 && (
                <div className="cq-missing-products" role="status">
                  <strong>Chưa có trong bảng giá</strong>
                  <ul>{missingProducts.map((name) => <li key={name}>{name}</li>)}</ul>
                  <small>Các sản phẩm này chưa có trong danh mục.</small>
                </div>
              )}
            </div>
          )}

          {/* Section 3: Selected products list */}
          <div className="cq-form-section">
            <div className="cq-section-label" style={{ justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>3. Hạng mục đã chọn</span>
                <span className="cq-section-badge">{selectedRows.length} hạng mục</span>
              </div>
              <button
                type="button"
                className="button button-soft"
                style={{ height: 32, fontSize: 12, padding: "0 12px" }}
                onClick={() => setPickerOpen(true)}
              >
                + Thêm sản phẩm
              </button>
            </div>

            <div className="cq-selected-container">
              {selectedRows.length === 0 ? (
                <div style={{ padding: "30px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                  Chưa có hạng mục. Chọn sản phẩm hoặc dùng AI gợi ý.
                </div>
              ) : (
                selectedRows.map((row) => (
                  <div key={row.catalogItemId} className="cq-selected-row">
                    <div className="cq-selected-left">
                      <span className="cq-selected-name">{row.item.name}</span>
                    </div>

                    <div className="cq-selected-right">
                      <button
                        type="button"
                        className="cq-remove-btn"
                        aria-label={`Bỏ ${row.item.name}`}
                        onClick={() => removeItem(row.catalogItemId)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Dialog Footer */}
        <div className="cq-dialog-footer">
          <div className="cq-footer-summary">{selectedRows.length + missingProducts.length} sản phẩm cần dùng</div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button type="button" className="button button-soft" disabled={busy} onClick={onClose}>
              Hủy
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || !customerName.trim() || (!selectedRows.length && !missingProducts.length)}
            >
              {aiLoading ? "AI đang gợi ý…" : busy ? "Đang tạo…" : "Tạo báo giá"}
            </button>
          </div>
        </div>
      </form>

      {/* Product Picker Modal */}
      {pickerOpen && (
        <div
          className="customer-product-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Chọn sản phẩm từ bảng giá"
        >
          <div className="customer-product-picker">
            <div className="cq-picker-header">
              <h3>Chọn sản phẩm</h3>
              <button
                type="button"
                className="cq-dialog-close"
                aria-label="Đóng danh sách"
                onClick={() => setPickerOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="cq-picker-search-bar">
              <input
                autoFocus
                className="cq-search-input"
                aria-label="Tìm sản phẩm"
                placeholder="Tìm tên hoặc mã sản phẩm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <div className="customer-product-results">
              {visible.map((item) => {
                const isSelected = selected.some((row) => row.catalogItemId === item._id);
                return (
                  <button
                    type="button"
                    key={item._id}
                    className="cq-picker-item"
                    onClick={() => addItem(item)}
                    disabled={isSelected}
                  >
                    <div className="cq-picker-item-left">
                      <span className="cq-picker-item-name">{item.name}</span>
                      <span className="cq-picker-item-sub">{item.sku}</span>
                    </div>

                    <div>
                      {isSelected ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}>✓ Đã chọn</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}

              {!visible.length && (
                <div style={{ padding: "40px 20px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                  Không tìm thấy sản phẩm.
                </div>
              )}
            </div>

            <div className="cq-picker-footer">
              <button type="button" className="button button-primary" onClick={() => setPickerOpen(false)}>
                Xong ({selectedRows.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
