# Getting started

## Requirements

- Node.js 20 or newer
- React and React DOM 18.3 or newer
- A client-rendered browser environment

Playwright and Vite are optional. They are needed only for screenshot marking and the
development runner respectively.

## Define a scenario

```ts
import { defineScenario } from "baekstage";

export const checkout = defineScenario({
  id: "checkout-card",
  title: "Checkout with a card",
  source: "e2e/checkout.spec.ts",
  execution: { grep: "card checkout" },
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
- Trace viewing uses `traceViewerEndpoint`; it defaults to `/trace-viewer`.

The included Vite adapter implements both endpoints in development. Other frameworks
can implement the documented HTTP contract.
