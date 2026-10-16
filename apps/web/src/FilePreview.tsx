import { useEffect, useRef, useState } from "react";

export interface PreviewFile { name: string; url?: string; file?: File }
interface PreviewContent { url?: string; html?: string; text?: string; sheets?: Array<{ name: string; rows: unknown[][] }> }

export default function FilePreview({ file, onClose }: { file: PreviewFile | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [content, setContent] = useState<PreviewContent>({});
  const [activeSheet, setActiveSheet] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element || !file) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => { if (element.open) element.close(); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [file]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    setContent({}); setActiveSheet(0); setError(""); setBusy(true);
    const load = async () => {
      try {
        const response = file.file ? undefined : await fetch(file.url!, { credentials: "include" });
        if (response && !response.ok) {
          const body = await response.json().catch(() => undefined);
          throw new Error(body?.error || "Không tải được file để xem trước.");
        }
        const mimeType = file.file?.type || response?.headers.get("content-type") || "application/octet-stream";
        const blob = file.file ?? await response!.blob();
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (mimeType.includes("text/html")) {
          const html = await blob.text();
          if (!cancelled) setContent({ html });
        } else if (["xlsx", "xls", "csv"].includes(extension)) {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
          const sheets = workbook.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, { header: 1, defval: "", blankrows: false, raw: false }).slice(0, 1000) }));
          if (!cancelled) setContent({ sheets });
        } else if (extension === "txt") {
          const text = await blob.text();
          if (!cancelled) setContent({ text });
        } else {
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setContent({ url: objectUrl });
        }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Không xem trước được file."); }
      finally { if (!cancelled) setBusy(false); }
    };
    void load();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file]);

  const close = () => { dialog.current?.close(); onClose(); };
  const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";
  const sheet = content.sheets?.[activeSheet];
  return <dialog ref={dialog} className="file-preview-dialog" aria-label={file ? `Xem trước ${file.name}` : "Xem trước file"} onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="file-preview-shell">
      <header className="file-preview-heading"><div><span className="eyebrow">XEM TRƯỚC FILE</span><h2 title={file?.name}>{file?.name}</h2></div><button type="button" className="icon-button" onClick={close} aria-label="Đóng xem trước">×</button></header>
      {content.sheets && <nav className="file-preview-tabs" aria-label="Trang tính">{content.sheets.map((entry, index) => <button type="button" key={`${entry.name}-${index}`} className={activeSheet === index ? "active" : ""} onClick={() => setActiveSheet(index)}>{entry.name}</button>)}</nav>}
      <main className="file-preview-content">
        {busy ? <p role="status">Đang tải file…</p> : error ? <div className="inline-error" role="alert">{error}</div> : content.html ? <iframe className="file-preview-frame" sandbox="" srcDoc={content.html} title={`Nội dung ${file?.name}`} /> : sheet ? <div className="file-preview-table-wrap"><table className="file-preview-table"><tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell == null ? "" : String(cell)}</td>)}</tr>)}</tbody></table></div> : content.text !== undefined ? <pre className="file-preview-text">{content.text}</pre> : content.url && extension === "pdf" ? <iframe className="file-preview-frame" src={content.url} title={`PDF ${file?.name}`} /> : content.url && ["png", "jpg", "jpeg", "webp", "gif"].includes(extension) ? <img className="file-preview-image" src={content.url} alt={file?.name} /> : content.url ? <div className="file-preview-fallback"><p>Trình duyệt chưa hỗ trợ xem trước định dạng này.</p><a className="button button-primary" href={content.url} download={file?.name}>Tải file</a></div> : null}
      </main>
      {!busy && !error && content.url && <footer className="file-preview-footer"><a className="text-button" href={content.url} download={file?.name}>Tải file gốc</a><span>{extension.toUpperCase()}</span></footer>}
    </div>
  </dialog>;
}
