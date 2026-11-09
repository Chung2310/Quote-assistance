const fallbackMessage = "Không thể hoàn tất yêu cầu lúc này. Vui lòng thử lại.";

/** Also handles old saved errors and browser failures when a server has not yet been updated. */
export function userMessage(value: unknown, fallback = fallbackMessage): string {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (!message.trim()) return fallback;
  if (/vẫn đang xử lý|still processing/i.test(message)) return "Yêu cầu vẫn đang xử lý. Bạn có thể kiểm tra lại sau ít phút.";
  if (/cloudinary/i.test(message)) return /download|tải (?:file|tệp) từ|xem trước/i.test(message) ? "Chưa tải được file đã lưu. Vui lòng thử lại." : "Chưa lưu được file. Vui lòng thử lại sau.";
  if (/open\s*router?|openai|anthropic|gemini|gpt-[\w.-]+|\bluna\b|insufficient (?:funds|credits?)|\bcredits?\b|max[_ ](?:output[_ ])?tokens?|provider/i.test(message)) return "Chức năng AI tạm thời chưa sẵn sàng. Vui lòng thử lại sau.";
  if (/ánh xạ|\b(?:binding|placeholder)\b/i.test(message)) return "Chưa điền được mẫu tài liệu. Hãy kiểm tra mẫu đã chọn và thử lại.";
  if (/\btimeout\b|timed?\s*out|quá thời gian chờ|(?:xử lý|AI|đọc mẫu|tạo file)[^.\n]{0,90}quá (?:thời gian|lâu)/i.test(message)) return "Xử lý lâu hơn dự kiến. Vui lòng thử lại sau.";
  if (/failed to fetch|fetch failed|network(?:error| request)|\b(?:ECONN\w*|ENOTFOUND|EAI_AGAIN)\b/i.test(message)) return "Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.";
  if (/cookie|https?\s+trên máy chủ/i.test(message)) return "Phiên đăng nhập chưa được lưu. Vui lòng đăng nhập lại.";
  if (/\b(?:XML|JSON|OpenXML|namespace|schema|Traceback|TypeError|SyntaxError|ReferenceError|Mongo\w*|ENOENT|EPERM|EACCES|E11000|stderr|stdout|sandbox|container_id|bodyKeys|shellCalls)\b|HTTP\s*[=:]?\s*\d{3}|\.env\b|\b(?:API[ _-]?key|api_secret)\b|(?:[A-Z]:\\|\/workspace\/|\/home\/|\/api\/|node_modules[\\/])|https?:\/\/|\bat\s+\S+\s*\([^\n]+:\d+:\d+\)|\b(?:contentType|bodyBytes|requestId|statusCode|response)\s*[=:]/i.test(message)) return fallback;
  if (!/[^\x00-\x7F]/.test(message)) return fallback;
  return message;
}
