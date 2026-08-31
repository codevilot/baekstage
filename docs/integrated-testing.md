# Integrated testing and visual review

Baekstage keeps the existing Suite → Scenario → Step graph and Playwright result
flow intact. Component and visual testing are added as engine-neutral results,
not as a replacement execution model.

## Architecture

- `ScenarioExecution` remains the adapter boundary for Playwright and API runs.
- `TestResult` is the UI-facing result shared by E2E, API, component, and visual
  engines. A node may expose `testResults` and `relatedStories`.
- `StorybookVisualPlatform` discovers Storybook stories from `index.json`, takes
  deterministic Playwright screenshots, and performs pixel comparison.
- `MetadataStore` and `ObjectStore` isolate durable metadata and binary artifact
  persistence. The local implementation uses `.baekstage`; server deployments
  can replace it without changing the viewer.
- The Vite integration exposes Storybook, visual, review, annotation, and safe
  worktree endpoints alongside the existing scenario and OpenAPI endpoints.

## Configuration

```ts
import { defineConfig } from "baekstage/config";

export default defineConfig({
  suite,
  playwright: { projectRoot: "." },
  sources: {
    storybook: [
      { id: "main", title: "main", branch: "main", url: "http://127.0.0.1:6006" },
      { id: "feature-login", title: "feature/login", branch: "feature/login", url: "http://127.0.0.1:6007" },
    ],
  },
  visual: {
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    threshold: 0.1,
  },
});
```

An existing Storybook process is reused through its configured URL. Baekstage
validates it by reading `index.json`. Install `@playwright/test` and its Chromium
browser in projects that use visual capture.

## Baselines and review

Artifacts use this local-first layout:

```text
.baekstage/
  baselines/<branch>/<story-id>.png
  builds/<build-id>/
    metadata.json
    stories/<story-id>/
      baseline.png
      current.png
      diff.png
      result.json
  reviews.json
```

The first capture creates a baseline. If a base branch was selected and its
baseline exists, the feature branch inherits that baseline. Later captures
never update it automatically: only **Approve baseline** copies `current.png`
to the branch baseline. Reject records the decision without modifying images.

## Worktree safety

Baekstage only creates worktrees below `.baekstage/worktrees`. Removal is
refused for user-created worktrees and for any worktree with uncommitted changes.
No reset, clean, forced checkout, or forced removal is used. Package manager
detection supports pnpm, npm, Yarn, and Bun; Storybook start is refused when the
worktree dependencies are not installed.

## Linking E2E steps to stories

```ts
{
  id: "login-submit",
  title: "Submit",
  kind: "action",
  relatedStories: ["login-form--default", "login-form--error"],
  testResults: [
    { id: "login-e2e", type: "e2e", status: "passed", stepId: "login-submit" },
    { id: "login-visual", type: "visual", status: "changed", stepId: "login-submit", metadata: { diffRatio: 0.014 } },
  ],
}
```

The graph and step Inspector display these results, and related stories open in
the Component/Visual/Review workspace.
