# Runner and server integration

## Vite adapter

The runner now uses small execution adapters. `PlaywrightExecutionAdapter` preserves
the existing scenario endpoint, while `ApiExecutionAdapter` powers Workbench. They
return the same `ScenarioRunResult`/`ScenarioNodeResult` model.

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
  maxRunsPerNode: 50,
});
```

`projectRoot` is required and may be absolute or relative to the process working
directory. No machine-specific path is built into the published adapter.

The adapter adds `--reporter=json`, `--trace=on`, the scenario source, and optional
`--grep` arguments. Override `command` and `commandArgs` for pnpm, yarn, or a custom
test harness.

## HTTP contract

Frameworks other than Vite can implement the same API.

### Read the OpenAPI Catalog

```http
GET /api/catalog
```

### Run a registered API operation

```http
POST /api/operations/run
Content-Type: application/json

{"sourceId":"task-runner","operationId":"openapi:task-runner:POST:/jobs/{id}/retry","scenarioId":"retry","nodeId":"retry-request","path":{"id":"abc"},"headers":{"Authorization":"Bearer …"}}
```

The server ignores arbitrary URLs because none are accepted in this contract. See
[Security](security.md) for limits and secret handling.

Each response includes a stable `runId`, origin, node result, matched OpenAPI response
branch, assertion results, and failure kind. Replay history is available from:

```http
GET /api/operations/history/:scenarioId/:nodeId
```

Observed Playwright evidence and replay results share this history. Writes use a
unique temporary file followed by atomic rename. A malformed JSON file is skipped.
Runs are sorted by `finishedAt`, and files beyond `maxRunsPerNode` are removed oldest
first. Scenario and node IDs are encoded as individual path segments.

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
