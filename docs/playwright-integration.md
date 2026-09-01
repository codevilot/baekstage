# Playwright integration

## Observe API evidence

```ts
import { observeApiScenario } from "baekstage/playwright";

test("retry failed job", async ({ page }, testInfo) => {
  const observe = observeApiScenario(page, testInfo, {
    scenarioId: "retry-failed-export",
  });
  await page.getByRole("button", { name: "Retry" }).click();
  await observe.flush();
});
```

The runner matches method, configured source origin, and templated OpenAPI path. One
match links evidence, multiple matches remain ambiguous, and no match is undocumented.
Trace ZIP internals are not parsed. Request bodies are omitted by default.

`flush()` removes listeners and waits briefly for responses already in flight. Call it
in `finally`. For automatic teardown, extend the existing test object:

```ts
import { test as base } from "@playwright/test";
import { createBaekstageTest } from "baekstage/playwright";

export const test = createBaekstageTest(base, {
  scenarioIdFromTest: ({ title }) => title,
  include: [{ sourceId: "task-runner" }],
  exclude: ["**/analytics/**", "**/health", "**/events"],
});

test("retry-failed-export", async ({ page, baekstage }) => {
  await baekstage.step({
    id: "click-retry",
    fromNodeId: "retry-button",
    toNodeId: "retry-request",
    edgeId: "retry-button-to-request",
    caseId: "already-running",
  }, () => page.getByRole("button", { name: "Retry" }).click());
});
```

Only requests started inside an explicit `step()` receive that marker, and one step may
own multiple requests. A completed `step()` also records a passed or failed result for
the non-API graph node identified by `toNodeId`, or by `id` when `toNodeId` is omitted.
This includes terminal UI, assertion, and outcome nodes with no outgoing edge or API
request. API nodes still require observed network evidence. Excluded requests are
ignored. Hints narrow matching; multiple remaining candidates stay ambiguous.
`markNode()` can label requests collected since the previous mark, but does not record
step completion, so `step()` is preferred.

The observer covers only the supplied page. Popups/new pages need a separate observer.
Service-worker attribution, WebSocket, SSE stream bodies, and Trace ZIP network
extraction are not supported. Redirects are captured as separate Playwright requests.
Applying the observer is explicit; existing tests are not captured automatically.

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

Use `markElementScreenshot` for a total card, table, dialog, or other focused region.
`target` is descriptive metadata and can hold the locator used by the test.

```ts
import { markElementScreenshot } from "baekstage/playwright";

await test.step("Scenario node: total after discount", async () => {
  await markElementScreenshot(page.getByTestId("order-total"), testInfo, {
    scenarioId: "apply-discount",
    nodeId: "after",
    label: "Discounted order total",
    category: "After result",
    target: "[data-testid=order-total]",
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
