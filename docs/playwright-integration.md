# Playwright integration

Import marker helpers from the lightweight Playwright entry. It does not load React or
the graph renderer into the test process.

```ts
import { test } from "@playwright/test";
import { markScreenshot } from "baekstage/playwright";

test("card checkout", async ({ page }, testInfo) => {
  await page.goto("/checkout");
  await markScreenshot(page, testInfo, {
    scenarioId: "checkout-card",
    nodeId: "review",
    label: "Order review",
    category: "Before state",
    important: true,
  });
});
```

## Capture one DOM element

Use `markElementScreenshot` for a Metric card, table, dialog, or other focused region.
`target` is descriptive metadata and can hold the locator used by the test.

```ts
import { markElementScreenshot } from "baekstage/playwright";

await test.step("Scenario node: Metric after", async () => {
  await markElementScreenshot(page.getByTestId("operator-metric"), testInfo, {
    scenarioId: "review-operator",
    nodeId: "operator-after",
    label: "Operator Metric after review",
    category: "After result",
    target: "[data-testid=operator-metric]",
    checkpoint: true,
  });
});
```

Wrapping a capture in `test.step` makes its location easier to find in Playwright Trace.
The trace currently opens at the test level; select the named step or Screenshot action
to inspect the exact DOM snapshot.

## Node and edge ownership

Use one of these mappings:

```ts
{ nodeId: "review" }
{ edgeId: "review-submit" }
{ fromNodeId: "review", toNodeId: "submit" }
```

- `scenarioId` prevents collisions when scenarios reuse node names.
- Multiple screenshots may use the same node ID.
- Prefer lowercase semantic IDs with hyphens.
- Unknown IDs are collected but cannot be attached to a graph node.
- `fullPage` applies to `markScreenshot`; element screenshots always use locator bounds.

## Suggested categories

Categories are not restricted. Common values are `Fixture`, `Before state`, `Action`,
`After result`, and `Failure evidence`. Set `important` or `checkpoint` for review-critical
captures.
