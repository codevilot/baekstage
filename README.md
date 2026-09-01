# Baekstage

Baekstage connects UI, API, server, database, and worker tests around a shared user
scenario. It shows validation coverage and failure location in one development and
test workspace while keeping Storybook, OpenAPI tooling, Playwright, and existing
test frameworks in their specialist roles.

Explore UI states like Storybook, browse and execute API operations like Swagger,
and run full user journeys with Playwright traces. Baekstage normalizes their results
into one scenario graph instead of replacing those tools.

## Quick start

```bash
npm install --save-dev baekstage
```

Create `baekstage.config.ts` in the project root for shared settings:

```ts
import { defineConfig } from "baekstage/config";

export default defineConfig({
  sources: { openapi: [{
    id: "shop-api",
    title: "Shop API",
    file: "./openapi.yaml",
    environments: { Local: "http://localhost:8080" },
  }] },
  suite: { name: "Checkout tests", scenarios: [] },
  playwright: { projectRoot: "." },
  webServer: {
    port: "auto",
    command: "npm run dev -- --port {port}",
    url: "http://127.0.0.1:{port}",
    reuseExistingServer: true,
  },
});
```

Scenarios are discovered recursively from legacy `*.baekstage.ts` files and semantic
feature folders by default:

```ts
// tests/baekstage/card-payment/baekstage.scenario.ts
import { defineScenario } from "baekstage";

export default defineScenario({
  id: "card-payment",
  title: "Card payment",
  execution: { adapter: "playwright", source: "./baekstage.spec.ts", grep: "card succeeds" },
  nodes: [
    { id: "cart", title: "Cart", kind: "screen" },
    { id: "paid", title: "Payment complete", kind: "outcome" },
  ],
  edges: [{ id: "checkout", source: "cart", target: "paid" }],
});
```

The `suite` entry is optional; its name then defaults to the project directory.
Configured and discovered scenarios are combined, and duplicate IDs fail at startup.
Discovery can be scoped when the project contains large or inaccessible directories:

```ts
discovery: {
  root: "./tests/baekstage",
  exclude: ["fixtures", "generated/scenarios"],
  ignorePermissionErrors: true,
},
```

For semantic feature folders, use names that make both files visibly Baekstage-owned:

```text
tests/baekstage/card-payment/
  baekstage.scenario.ts  # map and API contract
  baekstage.spec.ts      # Playwright execution and evidence
```

`baekstage.scenario.*` is discovered by default. Its Playwright source can be the
colocated `./baekstage.spec.ts`. Use `discovery.include` only when a project needs a
custom definition name.

Start the workspace:

```bash
npx baekstage --open
```

Baekstage opens at `http://127.0.0.1:4173`. Select a scenario to run Playwright and
review its node-scoped screenshots and Trace snapshots.
The optional `webServer` setting starts the app when needed, reuses an existing
healthy process, and stops processes started by Baekstage. Keep this setting in
Baekstage rather than duplicating it in the Playwright config.
Use `port: "auto"` with `{port}` in the command and URL to avoid app-port conflicts;
the browser-facing Baekstage `server.port` can remain fixed.
Use **Catalog** to search registered OpenAPI operations, inspect schemas, find linked
scenarios, and execute linked API nodes through the protected local proxy.
Expected error cases such as `404` or `409` can pass when their configured response
branch and assertions match. Branches without reproduction cases remain untested and
are not inserted into the Scenario graph automatically.

To use `npm run baekstage`, add an ordinary project script:

```json
{ "scripts": { "baekstage": "baekstage --open" } }
```

## CLI

```text
npx baekstage [options]

-c, --config <file>  Config file
-h, --host <host>    Host (default: 127.0.0.1)
-p, --port <port>    Port (default: 4173)
    --open            Open the browser
    --no-open         Do not open the browser
    --help            Show help
```

Config discovery supports `baekstage.config.ts`, `.mts`, `.js`, `.mjs`, and `.json`,
plus the short `baekstage.js`, `.mjs`, and `.json` names.
Results are stored in `.baekstage/results` unless configured otherwise.

Playwright network evidence is opt-in through `observeApiScenario()` or
`createBaekstageTest()` from `baekstage/playwright`. Baekstage does not automatically
inspect every existing test or parse network data from Trace ZIP files.

## Embed in React or Next.js

```tsx
"use client";

import { ScenarioViewer } from "baekstage";
import "baekstage/style.css";

export function TestGraphPage() {
  return <ScenarioViewer suite={suite}/>;
}
```

Baekstage styles are scoped to `.baekstage-root` and its portal, so importing the CSS
does not restyle the host application's `main`, `header`, buttons, or sidebars.

## Mark Playwright screenshots

```ts
import { markElementScreenshot } from "baekstage/playwright";

await markElementScreenshot(page.getByTestId("order-total"), testInfo, {
  scenarioId: "checkout-card",
  nodeId: "total-after",
  label: "Order total after discount",
  target: "[data-testid=order-total]",
  checkpoint: true,
});
```

## Documentation

- [Integrated testing and visual review](docs/integrated-testing.md)

- [Getting started and configuration](docs/getting-started.md)
- [CLI reference](docs/cli.md)
- [Playwright screenshots and node IDs](docs/playwright-integration.md)
- [OpenAPI sources and Catalog](docs/openapi.md)
- [API Workbench](docs/api-workbench.md)
- [Security model](docs/security.md)
- [Runner and HTTP contract](docs/runner.md)
- [Public API](docs/api.md)
- [Publishing](docs/publishing.md)

## Development

```bash
npm install
npm test
npm run build
npm pack --dry-run
```

## License

MIT
