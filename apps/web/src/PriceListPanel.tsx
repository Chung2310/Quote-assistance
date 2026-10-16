import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, formatDate } from "./api";

interface StoredPriceList { _id: string; originalFilename: string; bytes: number; updatedAt: string }
export default function PriceListPanel({ onToast }: { onToast: (message: string) => void }) {
  const [files, setFiles] = useState<StoredPriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api<{ files: StoredPriceList[] }>("/api/price-list").then(({ files }) => setFiles(files)).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, []);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) return;
    setError("");
    setBusy(true);
    const errors: string[] = [];
    let savedCount = 0;
    try {
      for (const selected of selectedFiles) {
        if (selected.size > 5 * 1024 * 1024) { errors.push(`${selected.name}: File không được vượt quá 5 MB.`); continue; }
        try {
          const result = await api<{ file: StoredPriceList }>("/api/price-list", { method: "POST", body: selected, headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(selected.name) } });
          setFiles((current) => [result.file, ...current]);
          savedCount++;
        } catch (cause) { errors.push(`${selected.name}: ${cause instanceof Error ? cause.message : "Không thể lưu bảng giá."}`); }
      }
      if (savedCount) onToast(`Đã lưu thêm ${savedCount} bảng giá.`);
      setError(errors.join(" "));
    }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  return <div className="page-stack">
    <section className="page-heading-row"><div><h1>Bảng giá{!loading && ` (${files.length})`}</h1><p className="muted"></p></div><button className="button button-primary" disabled={busy || loading} onClick={() => input.current?.click()}>{busy ? "Đang lưu…" : "Thêm bảng giá"}</button><input ref={input} type="file" hidden multiple disabled={busy} accept=".csv,.xlsx,.xls" onChange={(event) => void upload(event)} /></section>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {loading ? <p role="status">Đang tải bảng giá…</p> : files.length ? <div className="quote-template-grid">
      {files.map((file) => <article className="quote-template-card" key={file._id}>
        <div className="quote-template-card-top"><span className="quote-template-format">{file.originalFilename.split(".").pop()?.toUpperCase()}</span><span className="quote-template-badge">Đã lưu</span></div>
        <div className="quote-template-art" aria-hidden="true"><div className="quote-template-paper"><span /><i /><div className="quote-template-paper-table" /><div className="quote-template-paper-table" /></div></div>
        <div className="quote-template-card-content"><h3>{file.originalFilename}</h3><p className="quote-template-filename">Có thể chọn khi tạo báo giá</p><p className="quote-template-meta">{(file.bytes / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} KB · Cập nhật {formatDate(file.updatedAt)}</p></div>
      </article>)}
    </div> : <section className="content-card detail-card"><h2>Chưa có file bảng giá</h2><p>Tải file CSV, XLSX hoặc XLS của doanh nghiệp lên để AI sử dụng.</p></section>}
    <p className="catalog-note">CSV / XLSX / XLS · Tối đa 5 MB mỗi file · Có thể chọn nhiều file cùng lúc.</p>
  </div>;
}
