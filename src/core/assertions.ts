import type { ApiAssertion, AssertionResult } from "./types";

export type ApiResponseValue = { status: number; durationMs: number; headers: Record<string, string>; body: unknown };

function valueAt(body: unknown, path: string): unknown {
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  return parts.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, body);
}

export function evaluateApiAssertions(assertions: ApiAssertion[], response: ApiResponseValue): AssertionResult[] {
  return assertions.map((assertion) => {
    let actual: unknown; let expected: unknown; let passed = false; let label: string = assertion.type;
    if (assertion.type === "status") { actual = response.status; expected = assertion.equals; passed = actual === expected; label = `status equals ${expected}`; }
    if (assertion.type === "json-path") { actual = valueAt(response.body, assertion.path); expected = assertion.equals; passed = JSON.stringify(actual) === JSON.stringify(expected); label = `${assertion.path} equals ${JSON.stringify(expected)}`; }
    if (assertion.type === "exists") { actual = valueAt(response.body, assertion.path); expected = "defined"; passed = actual !== undefined; label = `${assertion.path} exists`; }
    if (assertion.type === "duration") { actual = response.durationMs; expected = assertion.lessThanMs; passed = response.durationMs < assertion.lessThanMs; label = `duration < ${assertion.lessThanMs} ms`; }
    if (assertion.type === "content-type") { actual = response.headers["content-type"] ?? ""; expected = assertion.includes; passed = String(actual).includes(assertion.includes); label = `Content-Type includes ${assertion.includes}`; }
    return { assertion, status: passed ? "passed" : "failed", message: label, expected, actual };
  });
}
