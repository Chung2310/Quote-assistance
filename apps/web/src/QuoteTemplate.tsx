import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ApiError, api, apiUploadWithProgress, formatDate } from "./api";
import FilePreview, { type PreviewFile } from "./FilePreview";
import { TaskProgress, useAppNotification, type ConfirmOptions, type TaskProgressState } from "./Feedback";
import "./quote-template.css";

export interface TemplateDetails {
  id: string;
  name: string;
  originalFilename: string;
  extension: string;
  bytes: number;
  createdAt: string;
}

interface TemplatePage {
  templates: TemplateDetails[];
  defaultTemplateId: string | null;
  nextCursor: string | null;
}

export function QuoteTemplatePanel({
  canManage,
  confirm,
  onContinue,
  onManage,
  templateUsage,
  usageLoading = false,
  usageError = false,
  onRefreshUsage,
  onUsageChanged,
}: {
  canManage: boolean;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onContinue?: (template: TemplateDetails) => void;
  onManage?: () => void;
  templateUsage?: { used: number; limit: number | null; remaining: number | null } | null;
  usageLoading?: boolean;
  usageError?: boolean;
  onRefreshUsage?: () => void;
  onUsageChanged?: () => void;
}) {
  const [template, setTemplate] = useState<TemplateDetails | null>(null);
  const [templates, setTemplates] = useState<TemplateDetails[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selecting = Boolean(onContinue);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const notify = useAppNotification();
  const [preview, setPreview] = useState<PreviewFile | null>(null);

  // Search & Filter
  const [search, setSearch] = useState("");
  const [filterFormat, setFilterFormat] = useState<string>("all");

  const templateLimitReached = Boolean(
    templateUsage && templateUsage.limit !== null && (templateUsage.remaining ?? 0) <= 0
  );
  const uploadBlocked = usageLoading || usageError || !templateUsage || templateLimitReached;
  const uploadBlockedMessage = usageError
    ? "Không thể kiểm tra hạn mức mẫu. Hãy tải lại để tiếp tục."
    : templateLimitReached && templateUsage
    ? `Gói hiện tại đã dùng hết ${templateUsage.limit} mẫu báo giá.`
    : "Đang kiểm tra hạn mức mẫu…";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      if (selecting) {
        const result = await api<{ template: TemplateDetails | null }>("/api/quote-template");
        setTemplate(result.template);
        setTemplates(result.template ? [result.template] : []);
        setDefaultTemplateId(result.template?.id ?? null);
        setNextCursor(null);
      } else {
        const result = await api<TemplatePage>("/api/quote-templates");
        setTemplates(result.templates);
        setDefaultTemplateId(result.defaultTemplateId);
        setNextCursor(result.nextCursor);
      }
    } catch (cause) {
      setLoadFailed(true);
      notify(cause instanceof Error ? cause.message : "Không tải được mẫu báo giá.", "error");
    } finally {
      setLoading(false);
    }
  }, [selecting, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api<TemplatePage>(`/api/quote-templates?cursor=${encodeURIComponent(nextCursor)}`);
      setTemplates((current) => [
        ...current,
        ...result.templates.filter((entry) => !current.some((existing) => existing.id === entry.id)),
      ]);
      setDefaultTemplateId(result.defaultTemplateId);
      setNextCursor(result.nextCursor);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Không tải thêm được mẫu báo giá.", "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const deleteTemplate = async (entry: TemplateDetails) => {
    if (
      deletingId ||
      !(await confirm({
        title: "Xóa mẫu báo giá?",
        message: `Mẫu “${entry.name || entry.originalFilename}” sẽ không còn dùng cho báo giá mới. Các báo giá đã tạo vẫn giữ mẫu này.`,
        confirmLabel: "Xóa mẫu",
        tone: "danger",
      }))
    )
      return;
    setDeletingId(entry.id);
    try {
      await api(`/api/quote-template/${entry.id}`, { method: "DELETE" });
      setPreview(null);
      await load();
      onUsageChanged?.();
      notify("Đã xóa mẫu báo giá thành công.", "success");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Không xóa được mẫu báo giá.", "error");
    } finally {
      setDeletingId(null);
    }
  };

  // KPI Calculations
  const stats = useMemo(() => {
    const total = templates.length;
    const docxCount = templates.filter((t) => t.extension.toLowerCase() === "docx").length;
    const xlsxCount = templates.filter((t) => t.extension.toLowerCase() === "xlsx").length;
    const pdfCount = templates.filter((t) => t.extension.toLowerCase() === "pdf").length;
    const defaultItem = templates.find((t) => t.id === defaultTemplateId);
    return { total, docxCount, xlsxCount, pdfCount, defaultItem };
  }, [templates, defaultTemplateId]);

  // Filtered Templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((item) => {
      const ext = item.extension.toLowerCase();
      if (filterFormat === "default" && item.id !== defaultTemplateId) return false;
      if (filterFormat !== "all" && filterFormat !== "default" && ext !== filterFormat) return false;

      if (!search.trim()) return true;
      const term = search.toLowerCase();
      const matchName = (item.name || "").toLowerCase().includes(term);
      const matchFile = item.originalFilename.toLowerCase().includes(term);
      return matchName || matchFile;
    });
  }, [templates, filterFormat, search, defaultTemplateId]);

  return (
    <div className="templates-page">
      {/* Header Hero Banner */}
      <section className="qt-header-banner">
        <div className="qt-header-copy">
          <span className="qt-header-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Mẫu Báo Giá Doanh Nghiệp
          </span>
          <h1>Quản lý Mẫu Báo Giá</h1>
          <p>
            Khai báo và tùy biến mẫu báo giá chuẩn (Word, Excel, PDF). Hệ thống sẽ tự động điền danh mục sản phẩm, đơn giá và thông tin khách hàng vào mẫu khi xuất file.
          </p>
        </div>

        {canManage && !onContinue && (
          <div className="qt-header-actions">
            <button
              type="button"
              className="qt-create-btn"
              disabled={loading || loadingMore || uploadBlocked}
              title={uploadBlocked ? uploadBlockedMessage : undefined}
              onClick={() => setCreating(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>+ Tải lên mẫu mới</span>
            </button>
          </div>
        )}
      </section>

      {/* Quota Blocked Notice */}
      {canManage && !onContinue && uploadBlocked && (
        <div className="quota-blocked-notice" role="status" style={{ margin: 0 }}>
          <span>{uploadBlockedMessage}</span>
          {usageError && onRefreshUsage && (
            <button type="button" className="text-button" onClick={onRefreshUsage}>
              Tải lại hạn mức
            </button>
          )}
        </div>
      )}

      {/* KPI Metrics Grid */}
      <section className="qt-kpi-grid">
        <div className="qt-kpi-card">
          <div className="qt-kpi-top">
            <span className="qt-kpi-label">Tổng số mẫu</span>
            <div className="qt-kpi-icon tone-blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
          </div>
          <div className="qt-kpi-body">
            <span className="qt-kpi-value">{stats.total}</span>
            <span className="qt-kpi-sub">Mẫu báo giá đã khai báo</span>
          </div>
        </div>

        <div className="qt-kpi-card">
          <div className="qt-kpi-top">
            <span className="qt-kpi-label">Hạn mức gói</span>
            <div className="qt-kpi-icon tone-green">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
          </div>
          <div className="qt-kpi-body">
            <span className="qt-kpi-value" style={{ color: "#16a34a" }}>
              {templateUsage
                ? `${templateUsage.used.toLocaleString("vi-VN")}${
                    templateUsage.limit === null ? " / ∞" : ` / ${templateUsage.limit.toLocaleString("vi-VN")}`
                  }`
                : `${stats.total}`}
            </span>
            <span className="qt-kpi-sub">
              {templateUsage?.limit
                ? `Còn lại ${templateUsage.remaining ?? 0} lượt tải mẫu`
                : "Không giới hạn số lượng mẫu"}
            </span>
            {templateUsage?.limit && (
              <div className="qt-quota-progress">
                <div
                  className="qt-quota-progress-bar"
                  style={{
                    width: `${Math.min(100, Math.round((templateUsage.used / templateUsage.limit) * 100))}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="qt-kpi-card">
          <div className="qt-kpi-top">
            <span className="qt-kpi-label">Mẫu mặc định</span>
            <div className="qt-kpi-icon tone-amber">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
          </div>
          <div className="qt-kpi-body">
            <span className="qt-kpi-value" style={{ fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {stats.defaultItem ? stats.defaultItem.name || stats.defaultItem.originalFilename : "Chưa đặt"}
            </span>
            <span className="qt-kpi-sub">
              {stats.defaultItem ? `Định dạng .${stats.defaultItem.extension.toUpperCase()}` : "Tự động chọn mẫu đầu tiên"}
            </span>
          </div>
        </div>

        <div className="qt-kpi-card">
          <div className="qt-kpi-top">
            <span className="qt-kpi-label">Định dạng hỗ trợ</span>
            <div className="qt-kpi-icon tone-purple">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                <polyline points="16 16 12 12 8 16" />
              </svg>
            </div>
          </div>
          <div className="qt-kpi-body">
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <span className="qt-format-pill docx">Word ({stats.docxCount})</span>
              <span className="qt-format-pill xlsx">Excel ({stats.xlsxCount})</span>
              <span className="qt-format-pill pdf">PDF ({stats.pdfCount})</span>
            </div>
            <span className="qt-kpi-sub" style={{ marginTop: 6 }}>
              Tương thích hoàn toàn các mẫu văn phòng
            </span>
          </div>
        </div>
      </section>

      {/* Main Content Card: Search, Filter & Grid */}
      <section className="qt-content-card">
        {/* Toolbar */}
        <div className="qt-toolbar">
          <div className="qt-search-box">
            <svg className="qt-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="qt-search-input"
              placeholder="Tìm theo tên mẫu báo giá hoặc tên file..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="qt-filter-pills">
            <button
              type="button"
              className={`qt-filter-btn ${filterFormat === "all" ? "active" : ""}`}
              onClick={() => setFilterFormat("all")}
            >
              Tất cả <span className="qt-filter-count">{templates.length}</span>
            </button>
            <button
              type="button"
              className={`qt-filter-btn ${filterFormat === "default" ? "active" : ""}`}
              onClick={() => setFilterFormat("default")}
            >
              Mặc định <span className="qt-filter-count">{defaultTemplateId ? 1 : 0}</span>
            </button>
            <button
              type="button"
              className={`qt-filter-btn ${filterFormat === "docx" ? "active" : ""}`}
              onClick={() => setFilterFormat("docx")}
            >
              Word (.docx) <span className="qt-filter-count">{stats.docxCount}</span>
            </button>
            <button
              type="button"
              className={`qt-filter-btn ${filterFormat === "xlsx" ? "active" : ""}`}
              onClick={() => setFilterFormat("xlsx")}
            >
              Excel (.xlsx) <span className="qt-filter-count">{stats.xlsxCount}</span>
            </button>
            <button
              type="button"
              className={`qt-filter-btn ${filterFormat === "pdf" ? "active" : ""}`}
              onClick={() => setFilterFormat("pdf")}
            >
              PDF (.pdf) <span className="qt-filter-count">{stats.pdfCount}</span>
            </button>
          </div>
        </div>

        {/* Templates Grid */}
        {loading ? (
          <div style={{ padding: "60px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div className="spinner spinner-dark" />
            <span style={{ fontSize: 13, color: "#64748b" }}>Đang tải danh sách mẫu báo giá…</span>
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="qt-empty-state">
            <div className="qt-empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <h3>{templates.length === 0 ? "Bắt đầu với mẫu báo giá đầu tiên" : "Không tìm thấy mẫu báo giá phù hợp"}</h3>
            <p>
              {templates.length === 0
                ? "Tải lên file mẫu Word (.docx), Excel (.xlsx) hoặc PDF theo quy chuẩn của doanh nghiệp để tự động xuất báo giá cho khách."
                : "Thử tìm kiếm với từ khóa khác hoặc chuyển sang chế độ xem tất cả định dạng."}
            </p>
            {templates.length === 0 && canManage && !onContinue && !uploadBlocked && (
              <button
                type="button"
                className="qt-create-btn"
                onClick={() => setCreating(true)}
                style={{ marginTop: 8 }}
              >
                + Tải lên mẫu báo giá đầu tiên
              </button>
            )}
          </div>
        ) : (
          <div className="qt-templates-grid">
            {filteredTemplates.map((item) => {
              const ext = item.extension.toLowerCase();
              const isDefault = item.id === defaultTemplateId;

              return (
                <article key={item.id} className={`qt-card ${ext}`}>
                  {/* Card Top */}
                  <div className="qt-card-top">
                    <span className={`qt-format-pill ${ext}`}>
                      {ext === "docx" ? "Word" : ext === "xlsx" ? "Excel" : "PDF"} .{ext}
                    </span>

                    {isDefault && (
                      <span className="qt-default-badge">
                        <span>★</span>
                        <span>Mặc định</span>
                      </span>
                    )}
                  </div>

                  {/* Visual Art Box */}
                  <div className="qt-art-box" aria-hidden="true">
                    <svg className="qt-art-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      {ext === "docx" && (
                        <>
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <line x1="10" y1="9" x2="8" y2="9" />
                        </>
                      )}
                      {ext === "xlsx" && (
                        <>
                          <rect x="8" y="12" width="8" height="6" />
                          <line x1="12" y1="12" x2="12" y2="18" />
                          <line x1="8" y1="15" x2="16" y2="15" />
                        </>
                      )}
                      {ext === "pdf" && (
                        <>
                          <circle cx="12" cy="14" r="3" />
                        </>
                      )}
                    </svg>
                  </div>

                  {/* Card Content */}
                  <div className="qt-card-info">
                    <h3 className="qt-card-title" title={item.name || item.originalFilename}>
                      {item.name || item.originalFilename}
                    </h3>

                    <span className="qt-card-filename" title={item.originalFilename}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                      </svg>
                      {item.originalFilename}
                    </span>

                    <span className="qt-card-meta">
                      {(item.bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} KB · {formatDate(item.createdAt)}
                    </span>
                  </div>

                  {/* Card Actions */}
                  <div className="qt-card-actions">
                    <button
                      type="button"
                      className="qt-card-btn-preview"
                      onClick={() =>
                        setPreview({
                          name: item.originalFilename,
                          url: `/api/quote-template/${item.id}/file?preview=1`,
                        })
                      }
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      <span>Xem trước mẫu</span>
                    </button>

                    <div className="qt-card-sub-actions">
                      <a
                        className="qt-card-btn-download"
                        href={`/api/quote-template/${item.id}/file`}
                        title="Tải file mẫu về máy"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>Tải mẫu</span>
                      </a>

                      {canManage && !selecting && (
                        <button
                          type="button"
                          className="qt-card-btn-delete"
                          disabled={Boolean(deletingId)}
                          onClick={() => void deleteTemplate(item)}
                          title="Xóa mẫu này"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span>{deletingId === item.id ? "Đang xóa…" : "Xóa"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Load more & reload buttons */}
        {!onContinue && nextCursor && (
          <div style={{ padding: "0 24px 20px", display: "flex", justifyContent: "center" }}>
            <button className="button button-soft" disabled={loading || loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Đang tải thêm…" : "Xem thêm mẫu khác"}
            </button>
          </div>
        )}

        {loadFailed && (
          <div style={{ padding: "0 24px 20px", display: "flex", justifyContent: "center" }}>
            <button className="button button-soft" disabled={loading || loadingMore} onClick={() => void load()}>
              Tải lại danh sách
            </button>
          </div>
        )}
      </section>

      {/* File Preview Modal */}
      <FilePreview file={preview} onClose={() => setPreview(null)} />

      {/* Selection flow continue button */}
      {onContinue && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {canManage && onManage && (
            <button className="button button-soft" onClick={onManage}>
              Quản lý mẫu báo giá
            </button>
          )}
          <button
            className="button button-primary"
            disabled={!template || loading || loadFailed}
            onClick={() => template && onContinue(template)}
          >
            Tiếp tục tạo báo giá
          </button>
        </div>
      )}

      {/* Create / Upload Template Dialog */}
      {creating && canManage && !onContinue && !uploadBlocked && (
        <CreateTemplateDialog
          onClose={() => setCreating(false)}
          onQuotaExceeded={() => onUsageChanged?.()}
          onSaved={() => {
            setCreating(false);
            notify("Đã lưu mẫu báo giá thành công.", "success");
            void load();
            onUsageChanged?.();
          }}
        />
      )}
    </div>
  );
}

function CreateTemplateDialog({
  onClose,
  onSaved,
  onQuotaExceeded,
}: {
  onClose: () => void;
  onSaved: (template: TemplateDetails) => void;
  onQuotaExceeded?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const notify = useAppNotification();

  const setError = useCallback(
    (message: string) => {
      if (message) notify(message, "error");
    },
    [notify]
  );

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const handleFileChange = (selected: File | null) => {
    if (!selected) return;
    setFile(selected);
    if (!name.trim()) {
      // Suggest clean template name from file name without extension
      const cleanName = selected.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      setName(cleanName.charAt(0).toUpperCase() + cleanName.slice(1));
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !file) return;
    if (!name.trim()) {
      setError("Vui lòng nhập tên mẫu báo giá.");
      return;
    }
    if (!/\.(docx|xlsx|pdf)$/i.test(file.name)) {
      setError("Hãy chọn file Word (.docx), Excel (.xlsx) hoặc PDF.");
      return;
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setError("File mẫu phải có dung lượng từ 1 byte đến tối đa 10 MB.");
      return;
    }

    setBusy(true);
    setTaskProgress({ label: "Đang tải mẫu báo giá lên", detail: "Tiến độ gửi file" });
    try {
      const result = await apiUploadWithProgress<{ template: TemplateDetails }>(
        "/api/quote-template",
        file,
        {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "X-Template-Name": encodeURIComponent(name.trim()),
        },
        (progress) =>
          setTaskProgress(
            progress >= 100
              ? { label: "Đang kiểm tra và lưu mẫu", detail: "Đang xử lý file trên máy chủ…" }
              : { label: "Đang tải mẫu báo giá lên", progress, detail: "Tiến độ gửi file" }
          )
      );
      onSaved(result.template);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) onQuotaExceeded?.();
      setError(cause instanceof Error ? cause.message : "Không lưu được mẫu báo giá.");
    } finally {
      setBusy(false);
      setTaskProgress(null);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="qt-dialog"
      aria-labelledby="create-template-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="qt-dialog-header">
        <div className="qt-dialog-title">
          <div className="qt-dialog-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <div>
            <h2 id="create-template-title">Tải Lên Mẫu Báo Giá Mới</h2>
            <p>Hỗ trợ tài liệu Word (.docx), bảng tính Excel (.xlsx) hoặc tài liệu PDF</p>
          </div>
        </div>

        <button type="button" className="qt-dialog-close" aria-label="Đóng popup" disabled={busy} onClick={onClose}>
          ✕
        </button>
      </header>

      <form onSubmit={(event) => void upload(event)} aria-busy={busy} style={{ display: "contents" }}>
        <div className="qt-dialog-body">
          {/* File Dropzone */}
          <div className="qt-form-group">
            <label>
              <span>1. File mẫu báo giá *</span>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>(Tối đa 10 MB)</span>
            </label>

            {!file ? (
              <div
                className={`qt-dropzone ${dragOver ? "dragover" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept=".docx,.xlsx,.pdf"
                  required
                  disabled={busy}
                  onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                />
                <div className="qt-dropzone-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="qt-dropzone-text">
                  <strong>Kéo thả file mẫu vào đây, hoặc bấm để duyệt file</strong>
                  <span>Chọn file Word (.docx), Excel (.xlsx) hoặc PDF từ máy tính của bạn</span>
                </div>
                <div className="qt-dropzone-badges">
                  <span className="qt-format-pill docx">.DOCX</span>
                  <span className="qt-format-pill xlsx">.XLSX</span>
                  <span className="qt-format-pill pdf">.PDF</span>
                </div>
              </div>
            ) : (
              <div className="qt-file-selected-box">
                <div className="qt-file-selected-info">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00ADFC" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div>
                    <strong>{file.name}</strong>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {(file.size / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} KB
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    className="button button-soft button-compact"
                    onClick={() => setPreviewFile({ name: file.name, file })}
                  >
                    Xem trước
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    style={{ color: "#dc2626" }}
                    onClick={() => setFile(null)}
                  >
                    Đổi file khác
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Template Name */}
          <div className="qt-form-group">
            <label htmlFor="template-name-input">
              <span>2. Tên gợi nhớ của mẫu *</span>
            </label>
            <div className="qt-input-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <input
                id="template-name-input"
                type="text"
                value={name}
                maxLength={200}
                required
                disabled={busy}
                placeholder="Ví dụ: Mẫu Báo Giá Chuẩn Doanh Nghiệp 2026"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>

          {/* Guidelines box */}
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
            <strong style={{ color: "#0f172a", display: "block", marginBottom: 4 }}>
              💡 Lưu ý về cơ chế điền mẫu tự động:
            </strong>
            Hệ thống AI sẽ tự động phân tích bảng và các trường văn bản trong file mẫu của bạn để điền Tên khách hàng, Mã báo giá, Ngày tạo, Bảng danh mục sản phẩm, Đơn giá và Tổng tiền khi người dùng bấm xuất báo giá.
          </div>

          {taskProgress && <TaskProgress {...taskProgress} />}
        </div>

        <div className="qt-dialog-footer">
          <button type="button" className="button button-soft" disabled={busy} onClick={onClose}>
            Hủy bỏ
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={!name.trim() || !file || busy}
          >
            {busy ? <span className="spinner" /> : "✓"}
            <span>{busy ? "Đang xử lý & lưu…" : "Lưu mẫu báo giá"}</span>
          </button>
        </div>
      </form>

      <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </dialog>
  );
}
