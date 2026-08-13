# Baekstage

Baekstage turns branching Playwright journeys into an interactive graph. Run it as a
standalone test workspace or embed the same viewer in an existing React application.

## Quick start

```bash
npm install --save-dev baekstage
```

Create `baekstage.config.ts` in the project root:

```ts
import { defineConfig } from "baekstage/config";
import { defineSuite } from "baekstage";

export default defineConfig({
  suite: defineSuite({
    name: "Checkout tests",
    scenarios: [{
      id: "card-payment",
      title: "Card payment",
      source: "e2e/card-payment.spec.ts",
      execution: { grep: "card succeeds" },
      nodes: [
        { id: "cart", title: "Cart", kind: "screen" },
        { id: "paid", title: "Payment complete", kind: "outcome" },
      ],
      edges: [{ id: "checkout", source: "cart", target: "paid" }],
    }],
  }),
  playwright: { projectRoot: "." },
});
```

Start the workspace:

```bash
npx baekstage --open
```

Baekstage opens at `http://127.0.0.1:4173`. Select a scenario to run Playwright and
review its node-scoped screenshots and Trace snapshots.

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

Config discovery supports `baekstage.config.ts`, `.mts`, `.js`, `.mjs`, and `.json`.
Results are stored in `.baekstage/results` unless configured otherwise.

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

await markElementScreenshot(page.getByTestId("kpi"), testInfo, {
  scenarioId: "sampling-review",
  nodeId: "kpi-after",
  label: "KPI after review",
  target: "[data-testid=kpi]",
  checkpoint: true,
});
```

## Documentation

- [Getting started and configuration](docs/getting-started.md)
- [CLI reference](docs/cli.md)
- [Playwright screenshots and node IDs](docs/playwright-integration.md)
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
