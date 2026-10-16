import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, formatDate } from "./api";

export interface TemplateDetails {
  id: string;
  name: string;
  originalFilename: string;
  extension: string;
  bytes: number;
  createdAt: string;
}

interface TemplatePage { templates: TemplateDetails[]; defaultTemplateId: string | null; nextCursor: string | null }

export function QuoteTemplatePanel({ canManage, onContinue, onManage }: { canManage: boolean; onContinue?: (template: TemplateDetails) => void; onManage?: () => void }) {
  const [template, setTemplate] = useState<TemplateDetails | null>(null);
  const [templates, setTemplates] = useState<TemplateDetails[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selecting = Boolean(onContinue);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
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
    catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được mẫu báo giá."); }
    finally { setLoading(false); }
  }, [selecting]);
  useEffect(() => { void load(); }, [load]);
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true); setError("");
    try {
      const result = await api<TemplatePage>(`/api/quote-templates?cursor=${encodeURIComponent(nextCursor)}`);
      setTemplates((current) => [...current, ...result.templates.filter((entry) => !current.some((existing) => existing.id === entry.id))]);
      setDefaultTemplateId(result.defaultTemplateId);
      setNextCursor(result.nextCursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải thêm được mẫu báo giá."); }
    finally { setLoadingMore(false); }
  };
  return <section className="content-card email-settings-card">
    <div className="settings-card-heading"><div><span className="eyebrow">MẪU BÁO GIÁ DOANH NGHIỆP</span><h2>{onContinue ? "Mẫu được tự động chọn" : "Mẫu đã khai báo"}</h2></div>{canManage && !onContinue && <button className="button button-primary" disabled={loading || loadingMore} onClick={() => setCreating(true)}>Tạo mẫu</button>}</div>
    {loading ? <p role="status">Đang tải mẫu doanh nghiệp…</p> : templates.length ? <div className="quote-template-grid" role="region" aria-label="Danh sách mẫu báo giá" tabIndex={0}>
      {templates.map((template) => <article key={template.id} className={`quote-template-card format-${template.extension}`}>
        <div className="quote-template-card-top"><span className="quote-template-format">{template.extension.toUpperCase()}</span>{template.id === defaultTemplateId && <span className="quote-template-badge">Mặc định</span>}</div>
        <div className="quote-template-art" aria-hidden="true"><div className="quote-template-paper"><span/><i/><i/><div className="quote-template-paper-table"/><i/></div></div>
        <div className="quote-template-card-content"><h3>{template.name || template.originalFilename}</h3><p className="quote-template-filename" title={template.originalFilename}>{template.originalFilename}</p><p className="quote-template-meta">{(template.bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} KB · {formatDate(template.createdAt)}</p></div>
        <a className="button button-soft quote-template-download" href={`/api/quote-template/${template.id}/file`} aria-label={`Tải mẫu ${template.name || template.originalFilename}`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></svg>Tải mẫu</a>
      </article>)}
    </div> : <p>Doanh nghiệp chưa có mẫu báo giá. {canManage ? "Hãy tải mẫu lên trước khi tạo báo giá đầu tiên." : "Vui lòng nhờ quản trị viên doanh nghiệp bổ sung mẫu."}</p>}
    {!onContinue && nextCursor && <div className="preview-actions"><button className="button button-soft" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Đang tải…" : "Xem thêm mẫu"}</button></div>}
    {error && <div className="inline-error" role="alert">{error} <button className="text-button" disabled={loading || loadingMore} onClick={() => void load()}>Tải lại mẫu</button></div>}
    {canManage && onContinue && onManage && <button className="button button-soft" onClick={onManage}>Quản lý mẫu báo giá</button>}
    {onContinue && <div className="preview-actions"><button className="button button-primary" disabled={!template || loading || Boolean(error)} onClick={() => template && onContinue(template)}>Tiếp tục tạo báo giá</button></div>}
    {creating && canManage && !onContinue && <CreateTemplateDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }}/>}
  </section>;
}

function CreateTemplateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (template: TemplateDetails) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    try {
      const result = await api<{ template: TemplateDetails }>("/api/quote-template", {
        method: "POST", body: file,
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-Template-Name": encodeURIComponent(name.trim()) },
      });
      onSaved(result.template);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được mẫu báo giá."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="template-dialog" aria-labelledby="create-template-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="settings-card-heading"><h2 id="create-template-title">Tạo mẫu báo giá</h2><button type="button" className="icon-button" aria-label="Đóng popup" disabled={busy} onClick={onClose}>×</button></div>
    <form className="email-settings-form" onSubmit={(event) => void upload(event)} aria-busy={busy}>
      <label>Tên mẫu<input autoFocus type="text" value={name} maxLength={200} required disabled={busy} placeholder="Nhập tên mẫu báo giá" onChange={(event) => setName(event.target.value)}/></label>
      <label>File mẫu báo giá<input type="file" accept=".docx,.xlsx,.pdf" required disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }}/></label>
      {error && <div className="inline-error" role="alert">{error}</div>}
      {busy && <p role="status">Đang kiểm tra và lưu mẫu…</p>}
      <div className="preview-actions"><button type="button" className="button button-soft" disabled={busy} onClick={onClose}>Hủy</button><button type="submit" className="button button-primary" disabled={!name.trim() || !file || busy}>{busy ? "Đang lưu…" : "Lưu mẫu"}</button></div>
    </form>
  </dialog>;
}
