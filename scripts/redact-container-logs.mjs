import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function redactLogs(input, environment) {
  const values = new Set();
  for (const [key, value] of Object.entries(environment)) {
    if (!value || /^(PATH|HOME|HOSTNAME|NODE_VERSION|YARN_VERSION|PORT|NODE_ENV|LANG|PWD|SHLVL|_)$/.test(key)) continue;
    if (value.length >= 4 || /password|secret|token|api_key/i.test(key)) values.add(value);
    if (/uri|url/i.test(key)) {
      try {
        const url = new URL(value);
        for (const part of [url.username, url.password]) {
          if (part) { values.add(part); values.add(decodeURIComponent(part)); }
        }
      } catch { /* Invalid URI is still redacted as a literal above. */ }
    }
  }
  for (const value of [...values]) {
    values.add(encodeURIComponent(value));
    values.add(JSON.stringify(value).slice(1, -1));
  }
  let result = input.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  for (const value of [...values].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(value).join("[REDACTED]");
  }
  result = result.replace(/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, "[MONGODB_URI]");
  // Prefix each line so untrusted log content cannot emit Actions commands.
  return result.split(/\r?\n/).map((line) => "[container] " + line).join("\n");
}

if (process.argv[1] === undefined || import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(redactLogs(readFileSync(0, "utf8"), process.env));
}
