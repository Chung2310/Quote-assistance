export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

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
