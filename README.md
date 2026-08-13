# Baekstage

Branching Playwright journeys become an interactive graph with runnable scenarios,
node-scoped screenshots, failure paths, and Playwright Trace snapshots.

## Install

```bash
npm install baekstage
```

```tsx
import { ScenarioViewer, defineSuite } from "baekstage";
import "baekstage/style.css";

export function TestsPage() {
  return <ScenarioViewer suite={defineSuite({
    name: "Checkout",
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
  })}/>;
}
```

React 18.3+ and React 19 are supported. Next.js App Router consumers must render
`ScenarioViewer` from a `"use client"` component.

## Optional test runner

The viewer is static by default. Add the optional Vite adapter to execute scenarios,
collect marked screenshots, and serve Playwright Trace Viewer locally.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { baekstagePlugin } from "baekstage/vite";

export default defineConfig({
  plugins: [baekstagePlugin({
    projectRoot: "./",
    resultRoot: ".scenario-results",
  })],
});
```

The runner is intended for trusted development environments. Do not expose its POST
endpoint to the public internet without authentication and command isolation.

## Documentation

- [Getting started](docs/getting-started.md)
- [Playwright screenshots and node IDs](docs/playwright-integration.md)
- [Runner configuration and HTTP contract](docs/runner.md)
- [Public API reference](docs/api.md)
- [Package publishing](docs/publishing.md)

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

Set `PLAYWRIGHT_PROJECT_ROOT` to use the demo with another Playwright repository.
The default demo path is `../demo_workspace_platform/web-app`. When that directory is not
present, the graph demo still starts in static mode and the Run button stays disconnected.

## License

MIT
