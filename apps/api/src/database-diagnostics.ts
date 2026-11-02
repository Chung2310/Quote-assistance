// Emit only known diagnostic codes, never connection strings or driver messages.
const knownCodes = new Set([
  "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET",
  "EHOSTUNREACH", "ENETUNREACH", "EPIPE", "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export function databaseConnectionDiagnostics(error: unknown) {
  const codes = new Set<string>();
  const seen = new Set<object>();
  const queue: unknown[] = [error];
  for (let index = 0; index < queue.length && index < 64; index++) {
    const current = queue[index];
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const item = current as Record<string, unknown>;
    if (typeof item.code === "string" && knownCodes.has(item.code)) codes.add(item.code);
    if (item.code === 18) codes.add("AUTHENTICATION_FAILED");
    if (item.code === 13) codes.add("UNAUTHORIZED");
    queue.push(item.cause, item.reason, item.error);
    if (item.servers instanceof Map) queue.push(...Array.from(item.servers.values()).slice(0, 32));
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 32));
  }
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    connectionCodes: [...codes],
  };
}
