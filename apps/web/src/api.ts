export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : undefined;
  if (!response.ok) throw new ApiError(body?.error ?? "Không thể kết nối tới máy chủ.", response.status);
  return body as T;
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
