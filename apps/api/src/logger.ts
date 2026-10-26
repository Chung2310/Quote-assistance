export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface AiProviderFailureContext {
  stage: string;
  model: string;
  requestId?: string;
  contentTypes?: string[];
}

function write(level: LogLevel, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    event,
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function providerErrorMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    try { return providerErrorMessage(JSON.parse(value)); } catch { return undefined; }
  }
  if (!isRecord(value)) return undefined;
  const error = isRecord(value.error) ? value.error : value;
  if (typeof error.message === "string") return error.message;
  return undefined;
}

function safeLogText(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.replace(/[\r\n\t]+/g, " ").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted]").slice(0, 800);
}

export async function logAiProviderFailure(response: Response, context: AiProviderFailureContext) {
  let payload: unknown;
  const reader = response.body?.getReader();
  if (reader) {
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const readPayload = async () => {
      const decoder = new TextDecoder();
      let text = "";
      while (text.length <= 64 * 1024) {
        const { value, done } = await reader.read();
        if (done) {
          text += decoder.decode();
          return JSON.parse(text) as unknown;
        }
        text += decoder.decode(value, { stream: true });
      }
      await reader.cancel().catch(() => undefined);
      return undefined;
    };
    try {
      payload = await Promise.race([
        readPayload(),
        new Promise<undefined>((resolve) => { timeout = setTimeout(() => { timedOut = true; resolve(undefined); }, 2_000); }),
      ]);
    } catch {
      payload = undefined;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (timedOut) await reader.cancel().catch(() => undefined);
    }
  }
  const body = isRecord(payload) ? payload : {};
  const error = isRecord(body.error) ? body.error : {};
  const metadata = isRecord(error.metadata) ? error.metadata : {};
  const nestedMessage = providerErrorMessage(metadata.raw) ?? providerErrorMessage(metadata.error);
  logger.error("ai.provider_request_failed", {
    requestId: context.requestId,
    stage: context.stage,
    provider: "openrouter",
    providerName: typeof metadata.provider_name === "string" ? metadata.provider_name : undefined,
    model: context.model,
    contentTypes: context.contentTypes?.join(","),
    responseFormat: "json_schema",
    statusCode: response.status,
    providerCode: typeof error.code === "string" || typeof error.code === "number" ? error.code : undefined,
    providerType: typeof error.type === "string" ? error.type : undefined,
    providerParam: typeof error.param === "string" ? error.param : undefined,
    providerMessage: safeLogText(error.message),
    providerDetail: safeLogText(nestedMessage),
    providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("x-openrouter-request-id") ?? undefined,
  });
}
