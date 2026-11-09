import { userMessage } from "./user-message";
import { aiProgress, aiRequestDescription, exportTaskDescription, type AiTaskHandle } from "./ai-progress";

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
  const description = aiRequestDescription(url, options.method?.toUpperCase() ?? "GET", options.body);
  const task = description ? backgroundExports.get(description.key ?? "")?.task ?? aiProgress.begin(description) : undefined;
  try {
    const response = await request(url, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    if (response.status === 204) {
      task?.complete();
      if (new URL(url, "http://app.local").pathname === "/api/auth/logout") resetAiProgressTracking();
      return undefined as T;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json().catch(() => undefined) : undefined;
    if (!response.ok) throw new ApiError(body?.error ?? "Không thể kết nối tới máy chủ.", response.status);
    if (task && (!body || typeof body !== "object" || Array.isArray(body))) throw new ApiError("Chưa nhận được kết quả xử lý. Vui lòng thử lại.", response.status);
    if (task && new URL(url, "http://app.local").pathname === "/api/customer-quotes") {
      if (typeof body?.quote?._id !== "string" || !body.quote._id) throw new ApiError("Chưa nhận được báo giá đã tạo. Vui lòng thử lại.", response.status);
      watchCustomerQuoteExport(body.quote._id, task);
    } else if (task && /\/quotes\/([^/]+)\/export\/retry(?:\?|$)/.test(url)) {
      if (!body?.jobId) throw new ApiError("Chưa thể bắt đầu tạo file. Vui lòng thử lại.", response.status);
      watchCustomerQuoteExport(/\/quotes\/([^/]+)\//.exec(url)![1], task);
    } else task?.complete();
    if (new URL(url, "http://app.local").pathname === "/api/auth/logout") resetAiProgressTracking();
    return body as T;
  } catch (error) { task?.fail(error); throw error; }
}

export type GeneratedFileRef = { id: string; filename: string; mimeType?: string; createdAt?: string };
export type GeneratedExportStatus = { id: string; status: "queued" | "running" | "completed" | "failed"; error?: string; filename?: string; createdAt?: string; updatedAt?: string };

export async function createGeneratedExport(url: string, timeoutMs = 15 * 60_000): Promise<GeneratedFileRef> {
  const task = aiProgress.begin({ ...exportTaskDescription(url), detail: "Đang chuẩn bị nội dung và mẫu tài liệu…" });
  try {
    const response = await request(url, { credentials: "include" });
    if (response.status !== 202) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(userMessage(body?.error, "Chưa thể bắt đầu tạo file. Vui lòng thử lại."));
    }
    const queued = await response.json().catch(() => null) as { jobId?: string } | null;
    if (!queued?.jobId) throw new Error("Chưa thể bắt đầu tạo file. Vui lòng thử lại.");
    task.update(12, "Yêu cầu đã được tiếp nhận, đang chuẩn bị tạo file…");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      const statusResponse = await request(`/api/export-jobs/${encodeURIComponent(queued.jobId)}`, { credentials: "include" });
      const statusBody = await statusResponse.json().catch(() => null) as { error?: string; job?: { status?: string; fileId?: string; filename?: string; error?: string } } | null;
      if (!statusResponse.ok || !statusBody?.job) throw new Error(userMessage(statusBody?.error, "Chưa kiểm tra được tiến độ tạo file. Vui lòng thử lại."));
      if (statusBody.job.status === "failed") throw new Error(userMessage(statusBody.job.error, "Chưa tạo được file theo mẫu đã chọn. Vui lòng thử lại."));
      if (statusBody.job.status === "running") task.update(30, "AI đang điền nội dung và hoàn thiện file theo mẫu…");
      if (statusBody.job.status === "completed") {
        if (!statusBody.job.fileId) throw new Error("File chưa sẵn sàng để tải. Vui lòng thử lại sau.");
        task.complete();
        return { id: statusBody.job.fileId, filename: statusBody.job.filename || "file-da-tao" };
      }
    }
    throw new Error("Tác vụ vẫn đang xử lý. Bạn có thể thử tải lại sau ít phút.");
  } catch (error) { task.fail(error); throw error; }
}

const backgroundExports = new Map<string, { controller: AbortController; task: AiTaskHandle }>();

/** Customer quote creation returns before its AI export; keep the popup alive through the saved result. */
function watchCustomerQuoteExport(sourceId: string, initialTask?: AiTaskHandle) {
  const key = `export:customer_quote:${sourceId}`;
  if (backgroundExports.has(key)) return;
  const task = initialTask ?? aiProgress.begin({ key, label: "Đang tạo file báo giá khách" });
  const controller = new AbortController();
  const watcher = { controller, task };
  backgroundExports.set(key, watcher);
  void (async () => {
    const deadline = Date.now() + 15 * 60_000;
    try {
      while (!controller.signal.aborted && Date.now() < deadline) {
        const response = await request(`/api/generated-export-files/latest?sourceId=${encodeURIComponent(sourceId)}&kind=customer_quote`, { credentials: "include", signal: controller.signal });
        const result = await response.json().catch(() => null) as { error?: string; file?: GeneratedFileRef; job?: GeneratedExportStatus } | null;
        if (!response.ok || !result) throw new Error(userMessage(result?.error, "Chưa kiểm tra được tiến độ tạo file."));
        if (result.job?.status === "failed") throw new Error(userMessage(result.job.error, "Chưa tạo được file báo giá. Vui lòng thử lại."));
        if (result.file?.id && (!result.job || result.job.status === "completed")) { task.complete(); return; }
        if (result.job?.status === "completed") throw new Error("File chưa sẵn sàng để tải. Vui lòng thử lại sau.");
        task.update(result.job?.status === "running" ? 30 : 12, result.job?.status === "running" ? "AI đang điền nội dung và hoàn thiện file theo mẫu…" : "Yêu cầu đã được tiếp nhận, đang chuẩn bị tạo file…");
        await new Promise<void>((resolve) => {
          const finish = () => { globalThis.clearTimeout(timer); controller.signal.removeEventListener("abort", finish); resolve(); };
          const timer = globalThis.setTimeout(finish, 2_000);
          controller.signal.addEventListener("abort", finish, { once: true });
          if (controller.signal.aborted) finish();
        });
      }
      if (!controller.signal.aborted) throw new Error("Tác vụ vẫn đang xử lý. Bạn có thể kiểm tra lại sau ít phút.");
    } catch (error) { if (!controller.signal.aborted) task.fail(error); }
    finally { if (backgroundExports.get(key) === watcher) backgroundExports.delete(key); }
  })();
}

export function resetAiProgressTracking() {
  backgroundExports.forEach(({ controller }) => controller.abort());
  backgroundExports.clear();
  aiProgress.reset();
}

export async function getLatestGeneratedFile(sourceId: string, kind: string) {
  const params = new URLSearchParams({ sourceId, kind });
  const result = await api<{ file: GeneratedFileRef | null; job: GeneratedExportStatus | null }>(`/api/generated-export-files/latest?${params.toString()}`);
  if (result.job?.error) result.job.error = userMessage(result.job.error);
  if (kind === "customer_quote" && (result.job?.status === "queued" || result.job?.status === "running")) watchCustomerQuoteExport(sourceId);
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
  const description = aiRequestDescription(url, "POST") ?? (url === "/api/quote-template" ? { label: "Đang tải và kiểm tra mẫu tài liệu" }
    : url === "/api/request-files" ? { label: "Đang tải file yêu cầu" }
    : url === "/api/price-list/preview" ? { label: "Đang đọc bảng giá" } : null);
  const task = description ? aiProgress.begin({ ...description, detail: "Đang gửi file lên…" }) : undefined;
  return new Promise<T>((resolve, reject) => {
    const fail = (error: ApiError) => { task?.fail(error); reject(error); };
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.withCredentials = true;
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        const progress = Math.min(100, Math.round(event.loaded / event.total * 100));
        onProgress(progress);
        task?.update(Math.round(progress * .35), progress < 100 ? `Đang gửi file lên (${progress}%)…` : "Đang đọc, xử lý và lưu nội dung file…");
      }
    });
    request.upload.addEventListener("load", () => task?.update(35, "Đang đọc, xử lý và lưu nội dung file…"));
    request.addEventListener("error", () => fail(new ApiError("Không thể kết nối tới máy chủ.", 0)));
    request.addEventListener("abort", () => fail(new ApiError("Tải file đã bị hủy.", 0)));
    request.addEventListener("timeout", () => fail(new ApiError("Xử lý lâu hơn dự kiến. Vui lòng thử lại.", 0)));
    request.addEventListener("load", () => {
      if (request.status === 204) { task?.complete(); resolve(undefined as T); return; }
      const contentType = request.getResponseHeader("content-type") ?? "";
      let body: { error?: string } | undefined;
      if (contentType.includes("application/json")) {
        try { body = JSON.parse(request.responseText) as { error?: string }; }
        catch { body = undefined; }
      }
      if (request.status < 200 || request.status >= 300) {
        fail(new ApiError(body?.error ?? "Không thể kết nối tới máy chủ.", request.status));
        return;
      }
      if (task && !body) { fail(new ApiError("Chưa nhận được kết quả xử lý file. Vui lòng thử lại.", request.status)); return; }
      task?.complete();
      resolve(body as T);
    });
    try { request.send(file); } catch (error) { fail(new ApiError(userMessage(error), 0)); }
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
