export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: unknown;
}

interface StructuredAiOptions<T> {
  messages: AiChatMessage[];
  send: (messages: AiChatMessage[]) => Promise<Response>;
  decode: (response: Response) => Promise<T>;
  onHttpError: (response: Response) => Promise<never>;
  invalidResponseMessage: string;
}

export function responseContent(data: unknown): string {
  if (!data || typeof data !== "object") throw new Error("AI trả về dữ liệu không hợp lệ.");
  const choices = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("");
  }
  throw new Error("AI không trả về nội dung phân tích.");
}

export function parseJsonResponse(content: string): unknown {
  const withoutReasoning = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = withoutReasoning.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  for (const candidate of [fenced, withoutReasoning].filter((value): value is string => Boolean(value))) {
    try { return JSON.parse(candidate) as unknown; } catch { /* Try a wrapped JSON object below. */ }
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < candidate.length; index++) {
      const character = candidate[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') inString = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) {
        try { return JSON.parse(candidate.slice(start, index + 1)) as unknown; } catch { break; }
      }
    }
  }
  throw new Error("AI returned an invalid JSON response.");
}

export async function requestStructuredAi<T>(options: StructuredAiOptions<T>): Promise<T> {
  let lastDecodeError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = attempt === 0 ? options.messages : [...options.messages, {
      role: "user" as const,
      content: "Định dạng phản hồi trước đó không hợp lệ. Hãy sửa lỗi này và trả về duy nhất một đối tượng JSON đúng theo schema. Lỗi kiểm tra: " + (lastDecodeError instanceof Error ? lastDecodeError.message.slice(0, 300) : "cấu trúc dữ liệu không hợp lệ."),
    }];
    const response = await options.send(messages);
    if (!response.ok) await options.onHttpError(response);
    try {
      return await options.decode(response);
    } catch (error) {
      if (attempt === 1) throw new Error(options.invalidResponseMessage, { cause: error });
      lastDecodeError = error;
    }
  }

  throw new Error(options.invalidResponseMessage);
}
