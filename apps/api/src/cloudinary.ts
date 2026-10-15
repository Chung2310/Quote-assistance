import { createHash, randomUUID } from "node:crypto";
import type { CloudinaryConfig } from "./types.js";

export interface CloudinaryUploadResult {
  publicId: string;
  assetId: string;
  resourceType: "image" | "raw";
}

function uploadSignature(parameters: Record<string, string>, apiSecret: string) {
  const source = Object.entries(parameters)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${source}${apiSecret}`).digest("hex");
}

export async function uploadCompanyFile(
  bytes: Buffer,
  originalFilename: string,
  mimeType: string,
  companyId: string,
  settings: CloudinaryConfig,
): Promise<CloudinaryUploadResult> {
  if (!settings.cloudName || !settings.apiKey || !settings.apiSecret) {
    throw new Error("Cloudinary chưa được cấu hình trong biến môi trường của máy chủ.");
  }
  const resourceType = mimeType.startsWith("image/") ? "image" : "raw";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const publicId = randomUUID();
  const parameters = {
    folder: `bao-gia/${companyId}/files`,
    public_id: publicId,
    timestamp,
    type: "authenticated",
  };
  const signature = uploadSignature(parameters, settings.apiSecret);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), originalFilename);
  form.append("api_key", settings.apiKey);
  for (const [key, value] of Object.entries(parameters)) form.append(key, value);
  form.append("signature", signature);

  let response: Response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(settings.cloudName)}/${resourceType}/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("Không thể kết nối tới Cloudinary.");
  }
  const result = await response.json().catch(() => ({})) as { public_id?: unknown; asset_id?: unknown };
  if (!response.ok || typeof result.public_id !== "string" || typeof result.asset_id !== "string") {
    throw new Error("Cloudinary từ chối tệp. Hãy kiểm tra cấu hình và quyền tải tệp lên.");
  }
  return { publicId: result.public_id, assetId: result.asset_id, resourceType };
}
