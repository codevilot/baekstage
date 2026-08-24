const sensitive = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i;
const defaultRedactKeys = ["password", "token", "accessToken", "refreshToken", "secret", "authorization", "cookie", "apiKey"];
const canonical = (value: string) => value.replace(/[-_\s]/g, "").toLowerCase();

export function isSensitiveHeader(name: string) { return sensitive.test(name.trim()); }

export function redactHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, isSensitiveHeader(name) ? "[REDACTED]" : value]));
}

export function redactUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) if (/token|secret|password|api[-_]?key/i.test(key)) url.searchParams.set(key, "[REDACTED]");
  return url.toString();
}

export function redactValue(value: unknown, redactKeys = defaultRedactKeys): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, redactKeys));
  if (!value || typeof value !== "object") return value;
  const keys = new Set(redactKeys.map(canonical));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, keys.has(canonical(key)) || [...keys].some((candidate) => canonical(key).endsWith(candidate)) ? "[REDACTED]" : redactValue(item, redactKeys)]));
}

export function redactEvidence<T>(value: T, redactKeys?: string[]): T { return redactValue(value, redactKeys) as T; }

export function redactText(value: string) {
  return value.replace(/(authorization|cookie|token|password|secret|api[-_]?key)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]");
}
