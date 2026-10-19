import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, apiUploadWithProgress, formatDate } from "./api";
import FilePreview, { type PreviewFile } from "./FilePreview";
import { TaskProgress, useAppNotification, type TaskProgressState } from "./Feedback";

export interface TemplateDetails {
  id: string;
  name: string;
  originalFilename: string;
  extension: string;
  bytes: number;
  createdAt: string;
}

interface TemplatePage { templates: TemplateDetails[]; defaultTemplateId: string | null; nextCursor: string | null }

export function QuoteTemplatePanel({ canManage, onContinue, onManage, templateUsage, usageLoading = false, usageError = false, onRefreshUsage, onUsageChanged }: { canManage: boolean; onContinue?: (template: TemplateDetails) => void; onManage?: () => void; templateUsage?: { used: number; limit: number | null; remaining: number | null } | null; usageLoading?: boolean; usageError?: boolean; onRefreshUsage?: () => void; onUsageChanged?: () => void }) {
  const [template, setTemplate] = useState<TemplateDetails | null>(null);
  const [templates, setTemplates] = useState<TemplateDetails[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selecting = Boolean(onContinue);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const notify = useAppNotification();
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const templateLimitReached = Boolean(templateUsage && templateUsage.limit !== null && (templateUsage.remaining ?? 0) <= 0);
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
    }
    catch (cause) { setLoadFailed(true); notify(cause instanceof Error ? cause.message : "Không tải được mẫu báo giá.", "error"); }
    finally { setLoading(false); }
  }, [selecting, notify]);
  useEffect(() => { void load(); }, [load]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api<TemplatePage>(`/api/quote-templates?cursor=${encodeURIComponent(nextCursor)}`);
      setTemplates((current) => [...current, ...result.templates.filter((entry) => !current.some((existing) => existing.id === entry.id))]);
      setDefaultTemplateId(result.defaultTemplateId);
      setNextCursor(result.nextCursor);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Không tải thêm được mẫu báo giá.", "error"); }
    finally { setLoadingMore(false); }
  };
  return <section className={`content-card email-settings-card quote-template-panel ${!loading && templates.length === 0 ? "is-empty" : ""}`}>
    <div className="settings-card-heading"><div><h2>{onContinue ? "Mẫu được tự động chọn" : "Mẫu đã khai báo"}</h2>{canManage && !onContinue && templateUsage && <p className="template-usage-count">Đã dùng {templateUsage.used.toLocaleString("vi-VN")}{templateUsage.limit === null ? " mẫu · không giới hạn" : ` / ${templateUsage.limit.toLocaleString("vi-VN")} mẫu`}</p>}</div>{canManage && !onContinue && <button className="button button-primary template-create-button" disabled={loading || loadingMore || uploadBlocked} title={uploadBlocked ? uploadBlockedMessage : undefined} onClick={() => setCreating(true)}>Tạo mẫu</button>}</div>
    {canManage && !onContinue && uploadBlocked && <div className="quota-blocked-notice" role="status">{uploadBlockedMessage}{usageError && onRefreshUsage && <button type="button" className="text-button" onClick={onRefreshUsage}>Tải lại hạn mức</button>}</div>}
    {loading ? <TaskProgress label="Đang tải mẫu báo giá" detail="Đang đọc danh sách mẫu…" /> : templates.length ? <div className="quote-template-grid" role="region" aria-label="Danh sách mẫu báo giá" tabIndex={0}>
      {templates.map((template) => <article key={template.id} className={`quote-template-card format-${template.extension}`}>
        <div className="quote-template-card-top"><span className="quote-template-format">{template.extension.toLowerCase()}</span>{template.id === defaultTemplateId && <span className="quote-template-badge">Mặc định</span>}</div>
        <div className="quote-template-art" aria-hidden="true"><div className="quote-template-paper"><span/><i/><i/><div className="quote-template-paper-table"/><i/></div></div>
        <div className="quote-template-card-content"><h3>{template.name || template.originalFilename}</h3><p className="quote-template-filename" title={template.originalFilename}>{template.originalFilename}</p><p className="quote-template-meta">{(template.bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} KB · {formatDate(template.createdAt)}</p></div>
        <button type="button" className="button button-soft quote-template-download" onClick={() => setPreview({ name: template.originalFilename, url: `/api/quote-template/${template.id}/file?preview=1` })}>Xem trước mẫu</button>
        <a className="text-button quote-template-download-link" href={`/api/quote-template/${template.id}/file`}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3" /></svg>Tải mẫu gốc</a>
      </article>)}
    </div> : <div className="empty-state template-empty-state setup-empty-state"><span className="empty-icon"><img src="/images/template-empty-3d.svg" alt="" /></span><h3>{canManage ? "Bắt đầu với mẫu báo giá đầu tiên" : "Chưa có mẫu báo giá"}</h3><p>{canManage ? "Tải mẫu lên để sử dụng khi tạo báo giá cho khách hàng." : "Liên hệ quản trị hệ thống để được hỗ trợ."}</p>{canManage && !onContinue && <button type="button" className="button button-primary template-empty-cta" onClick={() => setCreating(true)}>Tạo mẫu báo giá</button>}</div>}
    {!onContinue && nextCursor && <div className="preview-actions"><button className="button button-soft" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Đang tải…" : "Xem thêm mẫu"}</button></div>}
    {loadFailed && <div className="preview-actions"><button className="button button-soft" disabled={loading || loadingMore} onClick={() => void load()}>Tải lại mẫu</button></div>}
    <FilePreview file={preview} onClose={() => setPreview(null)} />
    {canManage && onContinue && onManage && <button className="button button-soft" onClick={onManage}>Quản lý mẫu báo giá</button>}
    {onContinue && <div className="preview-actions"><button className="button button-primary" disabled={!template || loading || loadFailed} onClick={() => template && onContinue(template)}>Tiếp tục tạo báo giá</button></div>}
    {creating && canManage && !onContinue && !uploadBlocked && (
      <CreateTemplateDialog
        onClose={() => setCreating(false)}
        onQuotaExceeded={() => onUsageChanged?.()}
        onSaved={() => { setCreating(false); notify("Đã lưu mẫu báo giá.", "success"); void load(); onUsageChanged?.(); }}
      />
    )}
  </section>;
}

function CreateTemplateDialog({ onClose, onSaved, onQuotaExceeded }: { onClose: () => void; onSaved: (template: TemplateDetails) => void; onQuotaExceeded?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgressState | null>(null);
  const notify = useAppNotification();
  const setError = useCallback((message: string) => { if (message) notify(message, "error"); }, [notify]);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);
  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !file) return;
    if (!name.trim()) { setError("Vui lòng nhập tên mẫu báo giá."); return; }
    if (!/\.(docx|xlsx|pdf)$/i.test(file.name)) { setError("Hãy chọn file Word (.docx), Excel (.xlsx) hoặc PDF."); return; }
    if (!file.size || file.size > 10 * 1024 * 1024) { setError("File mẫu phải có nội dung và không vượt quá 10 MB."); return; }
    setBusy(true);
    setError("");
    setTaskProgress({ label: "Đang tải mẫu báo giá lên", detail: "Tiến độ gửi file" });
    try {
      const result = await apiUploadWithProgress<{ template: TemplateDetails }>("/api/quote-template", file, {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-Template-Name": encodeURIComponent(name.trim()),
      }, (progress) => setTaskProgress(progress >= 100
        ? { label: "Đang kiểm tra và lưu mẫu", detail: "Đang xử lý file trên máy chủ…" }
        : { label: "Đang tải mẫu báo giá lên", progress, detail: "Tiến độ gửi file" }));
      onSaved(result.template);
    } catch (cause) { if (cause instanceof ApiError && cause.status === 429) onQuotaExceeded?.(); setError(cause instanceof Error ? cause.message : "Không lưu được mẫu báo giá."); }
    finally { setBusy(false); setTaskProgress(null); }
  };
  return <dialog ref={dialog} className="template-dialog template-upload-dialog" aria-labelledby="create-template-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="settings-card-heading"><h2 id="create-template-title">Tạo mẫu báo giá</h2><button type="button" className="icon-button" aria-label="Đóng popup" disabled={busy} onClick={onClose}>×</button></div>
    <form className="email-settings-form" onSubmit={(event) => void upload(event)} aria-busy={busy}>
      <label>Tên mẫu<input autoFocus type="text" value={name} maxLength={200} required disabled={busy} placeholder="Nhập tên mẫu báo giá" onChange={(event) => setName(event.target.value)}/></label>
      <label className="template-upload-label">File mẫu báo giá<input className="template-upload-input" type="file" accept=".docx,.xlsx,.pdf" required disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }}/><span className="template-upload-control"><span className="template-upload-trigger">Chọn file</span><span className="template-upload-name">{file?.name ?? "Chưa chọn file"}</span></span></label>
      {file && <button type="button" className="text-button" onClick={() => setPreviewFile({ name: file.name, file })}>Xem trước file đã chọn</button>}
      {taskProgress && <TaskProgress {...taskProgress} />}
      <div className="preview-actions"><button type="button" className="button button-soft" disabled={busy} onClick={onClose}>Hủy</button><button type="submit" className="button button-primary" disabled={!name.trim() || !file || busy}>{busy ? "Đang lưu…" : "Lưu mẫu"}</button></div>
    </form>
    <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
  </dialog>;
}
