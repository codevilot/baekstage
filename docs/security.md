# Security

Baekstage's runners execute local commands and proxy HTTP requests. Run them only on
a trusted developer machine or protected internal environment. They are not a
public, authenticated API gateway.

The API runner accepts only registered source/environment IDs and normalized
operation IDs. The server builds the URL from the configured base URL and documented
path; it does not accept an arbitrary target URL. It validates methods, path/query
parameters, limits responses (1 MB by default), times out after 10 seconds by
default, and blocks redirects.

`Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, and
`API-Key` values are redacted. Request headers and bodies are used for one execution
and are not stored in API result manifests or artifacts. Copied curl commands replace
sensitive header values with `[REDACTED]`.

Replay manifests contain redacted response bodies only for JSON/text content within
the size limit. Binary bodies are not retained. Playwright network observation omits
request bodies by default and limits captured JSON responses. External schema
references are not fetched.

Configure tighter limits when needed:

```ts
defineConfig({
  api: { timeoutMs: 5000, maxResponseBytes: 250_000 },
  security: { redactKeys: ["password", "token", "accessToken", "refreshToken", "secret"] },
  results: { root: ".baekstage/results", maxRunsPerNode: 50 },
  suite,
})
```

Keys are compared case-insensitively across camelCase, snake_case, and kebab-case.
Redaction runs during attachment collection, reporter import, history writing/reading,
UI display, and curl generation. It reduces accidental persistence but cannot identify
every application-specific secret in arbitrary free-form text. Keep request-body
capture disabled unless it is explicitly needed.

Before any shared deployment, add authentication, authorization, audit logging,
process isolation, concurrency limits, DNS/network egress policy, and retention.
