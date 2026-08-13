# Runner and server integration

## Vite adapter

```ts
import { baekstagePlugin } from "baekstage/vite";

baekstagePlugin({
  projectRoot: "../web-app",
  resultRoot: ".scenario-results",
  apiBase: "/api/scenarios",
  assetBase: "/scenario-results",
  traceViewerBase: "/trace-viewer",
  command: "npm",
  commandArgs: ["exec", "--", "playwright", "test"],
  env: { CI: "1" },
});
```

`projectRoot` is required and may be absolute or relative to the process working
directory. No machine-specific path is built into the published adapter.

The adapter adds `--reporter=json`, `--trace=on`, the scenario source, and optional
`--grep` arguments. Override `command` and `commandArgs` for pnpm, yarn, or a custom
test harness.

## HTTP contract

Frameworks other than Vite can implement the same API.

### Read the latest result

```http
GET /api/scenarios/:scenarioId
```

Return `null` when no result exists, otherwise:

```json
{
  "scenarioId": "checkout-card",
  "status": "passed",
  "screenshots": [],
  "traces": [],
  "output": "",
  "finishedAt": "2026-08-13T00:00:00.000Z"
}
```

### Run a scenario

```http
POST /api/scenarios/:scenarioId/run
Content-Type: application/json

{"source":"e2e/checkout.spec.ts","grep":"card checkout"}
```

The response uses the same result shape. Artifact URLs must be reachable from the
browser. Trace ZIP responses require CORS access when hosted on another origin.

## Security

The included adapter starts local commands and has no authentication. Use it only on a
trusted developer machine or protected internal environment. A production deployment
must authenticate users, authorize scenario IDs, queue executions, isolate processes,
limit concurrency, sanitize environment variables, and apply retention limits.
