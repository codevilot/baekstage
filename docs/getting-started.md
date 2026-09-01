# Getting started

Baekstage is a scenario-centered workspace: Map connects test layers, Catalog
connects OpenAPI operations back to scenarios, and API Workbench executes linked API
nodes. Existing Playwright-only configs remain valid.

## Requirements

- Node.js 20 or newer
- React and React DOM 18.3 or newer
- A client-rendered browser environment

Playwright and Vite are optional. They are needed only for screenshot marking and the
development runner respectively.

To add an OpenAPI source and API node, continue with [OpenAPI sources](openapi.md) and
[API Workbench](api-workbench.md). API execution requires the connected CLI/Vite
mode; static embedded viewers can still receive a normalized `catalog` prop.

## Standalone workspace

The recommended first experience is the CLI. Create `baekstage.config.ts` using
`defineConfig`, then run `npx baekstage --open`. See the [CLI reference](cli.md) for
configuration and options.

## Define a scenario

The default convention discovers both legacy `*.baekstage.ts` definitions and the
semantic feature-folder convention below. The feature directory owns the feature name;
each file makes its Baekstage role explicit:

```text
tests/baekstage/checkout/
  baekstage.scenario.ts
  baekstage.spec.ts
```

```ts
import { defineScenario } from "baekstage";

export const checkout = defineScenario({
  id: "checkout-card",
  title: "Checkout with a card",
  execution: {
    adapter: "playwright",
    source: "./baekstage.spec.ts",
    grep: "card checkout",
  },
  nodes: [
    { id: "cart", title: "Cart ready", kind: "fixture" },
    { id: "review", title: "Review order", kind: "screen" },
    { id: "submit", title: "Submit payment", kind: "action" },
    { id: "complete", title: "Order complete", kind: "outcome" },
  ],
  edges: [
    { id: "cart-review", source: "cart", target: "review" },
    { id: "review-submit", source: "review", target: "submit" },
    { id: "submit-complete", source: "submit", target: "complete" },
  ],
});
```

Node IDs are project-defined stable identifiers. Screenshot `nodeId` values must match
these IDs. Titles may change without breaking artifact links.

## Render the viewer

```tsx
"use client";

import { ScenarioViewer, defineSuite } from "baekstage";
import "baekstage/style.css";
import { checkout } from "./checkout-scenario";

export default function TestGraph() {
  return <ScenarioViewer
    suite={defineSuite({ name: "Web journeys", scenarios: [checkout] })}
    options={{
      runnerEndpoint: "/api/scenarios",
      traceViewerEndpoint: "/trace-viewer",
    }}
  />;
}
```

`facets` and `metadata` are intentionally project-defined. Roles, browsers, tenants,
services, routes, or request IDs can be represented without changing the library.

## Static and connected modes

- Static mode needs only a `ScenarioSuite`. Graph navigation works without a server.
- Connected mode uses `runnerEndpoint` to fetch results and start Playwright runs.
- The repository demo contains only neutral, generated checkout fixtures. Connect a
  private project through its own `baekstage.config.ts`; project paths and scenarios
  do not need to be committed to this repository.
- Trace viewing uses `traceViewerEndpoint`; it defaults to `/trace-viewer`.

The included Vite adapter implements both endpoints in development. Other frameworks
can implement the documented HTTP contract.
