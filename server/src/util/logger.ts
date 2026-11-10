// Structured logging: `timestamp LEVEL [scope] message key=value ...`.
// grep one room's whole history with `code=ABCD`.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

type Fields = Record<string, unknown>;

function fmt(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s !== undefined && /[\s"=]/.test(s) ? JSON.stringify(s) : String(s);
}

function write(level: Level, scope: string, message: string, fields?: Fields): void {
  if (ORDER[level] < threshold) return;
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), `[${scope}]`, message];
  if (fields) for (const [k, v] of Object.entries(fields)) if (v !== undefined) parts.push(`${k}=${fmt(v)}`);
  const line = parts.join(" ");
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (scope: string, message: string, fields?: Fields) => write("debug", scope, message, fields),
  info: (scope: string, message: string, fields?: Fields) => write("info", scope, message, fields),
  warn: (scope: string, message: string, fields?: Fields) => write("warn", scope, message, fields),
  error: (scope: string, message: string, fields?: Fields) => write("error", scope, message, fields),
};
