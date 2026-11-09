import { userMessage } from "./user-message";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(userMessage(message));
    this.status = status;
  }
}

async function request(url: string, options: RequestInit = {}) {
  try { return await fetch(url, options); }
  catch (cause) { throw new ApiError(userMessage(cause), 0); }
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await request(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json().catch(() => undefined) : undefined;
  if (!response.ok) throw new ApiError(body?.error ?? "Không thể kết nối tới máy chủ.", response.status);
  return body as T;
}

export type GeneratedFileRef = { id: string; filename: string; mimeType?: string; createdAt?: string };
export type GeneratedExportStatus = { id: string; status: "queued" | "running" | "completed" | "failed"; error?: string; filename?: string; createdAt?: string; updatedAt?: string };

export async function createGeneratedExport(url: string, timeoutMs = 15 * 60_000): Promise<GeneratedFileRef> {
  const response = await request(url, { credentials: "include" });
  if (response.status !== 202) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(userMessage(body?.error, "Chưa thể bắt đầu tạo file. Vui lòng thử lại."));
  }
  const queued = await response.json().catch(() => null) as { jobId?: string } | null;
  if (!queued?.jobId) throw new Error("Chưa thể bắt đầu tạo file. Vui lòng thử lại.");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    const statusResponse = await request(`/api/export-jobs/${encodeURIComponent(queued.jobId)}`, { credentials: "include" });
    const statusBody = await statusResponse.json().catch(() => null) as { error?: string; job?: { status?: string; fileId?: string; filename?: string; error?: string } } | null;
    if (!statusResponse.ok || !statusBody?.job) throw new Error(userMessage(statusBody?.error, "Chưa kiểm tra được tiến độ tạo file. Vui lòng thử lại."));
    if (statusBody.job.status === "failed") throw new Error(userMessage(statusBody.job.error, "Chưa tạo được file theo mẫu đã chọn. Vui lòng thử lại."));
    if (statusBody.job.status === "completed") {
      if (!statusBody.job.fileId) throw new Error("File chưa sẵn sàng để tải. Vui lòng thử lại sau.");
      return { id: statusBody.job.fileId, filename: statusBody.job.filename || "file-da-tao" };
    }
  }
  throw new Error("Tác vụ vẫn đang xử lý. Bạn có thể thử tải lại sau ít phút.");
}

export async function getLatestGeneratedFile(sourceId: string, kind: string) {
  const params = new URLSearchParams({ sourceId, kind });
  const result = await api<{ file: GeneratedFileRef | null; job: GeneratedExportStatus | null }>(`/api/generated-export-files/latest?${params.toString()}`);
  if (result.job?.error) result.job.error = userMessage(result.job.error);
  return result;
}

export async function downloadGeneratedFile(fileId: string) {
  const response = await request(`/api/files/${encodeURIComponent(fileId)}/download`, { credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(userMessage(body?.error, "Không tải được file đã lưu. Vui lòng thử lại."));
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const quotedFilename = /filename="([^"]+)"/i.exec(disposition);
  const filename = filenameMatch ? decodeURIComponent(filenameMatch[1]) : quotedFilename?.[1] ?? "file-da-luu";
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function apiUploadWithProgress<T>(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress: (percentage: number) => void,
) {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.withCredentials = true;
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
    });
    request.addEventListener("error", () => reject(new ApiError("Không thể kết nối tới máy chủ.", 0)));
    request.addEventListener("abort", () => reject(new ApiError("Tải file đã bị hủy.", 0)));
    request.addEventListener("load", () => {
      if (request.status === 204) { resolve(undefined as T); return; }
      const contentType = request.getResponseHeader("content-type") ?? "";
      let body: { error?: string } | undefined;
      if (contentType.includes("application/json")) {
        try { body = JSON.parse(request.responseText) as { error?: string }; }
        catch { body = undefined; }
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new ApiError(body?.error ?? "Không thể kết nối tới máy chủ.", request.status));
        return;
      }
      resolve(body as T);
    });
    request.send(file);
  });
}

export async function responseBlobWithProgress(response: Response, onProgress: (percentage: number | null) => void) {
  const encoded = response.headers.get("content-encoding");
  const rawLength = Number(response.headers.get("content-length"));
  const total = !encoded && Number.isFinite(rawLength) && rawLength > 0 ? rawLength : null;
  if (!response.body) {
    onProgress(null);
    return response.blob();
  }
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let loaded = 0;
  onProgress(total ? 0 : null);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk.buffer);
      loaded += value.byteLength;
      onProgress(total ? Math.min(100, Math.round(loaded / total * 100)) : null);
    }
  }
  if (total) onProgress(100);
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("vi-VN").format(amount)} ${currency}`;
  }
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
