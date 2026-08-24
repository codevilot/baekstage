# Changelog

## 0.3.1

- Add Storybook-style `webServer` lifecycle management to Baekstage config.
- Reuse healthy app servers and stop app processes started by the Baekstage CLI.
- Discover short `baekstage.js`, `baekstage.mjs`, and `baekstage.json` config names.
- Preserve app startup output so configuration failures are actionable.

## 0.3.0

- Connect OpenAPI operations, response branches, API cases, and assertions to Scenario nodes.
- Add the API Catalog and request/replay Workbench with redaction and guarded local execution.
- Capture Playwright network evidence and map observed requests and responses back to Scenario results.
- Add run history, observed/replay comparison, node-level results, and generalized artifacts.
- Improve Scenario navigation with Acts, result previews, a resizable sidebar, and runnable local demos.

## 0.2.0

- Add the `npx baekstage` standalone workspace CLI.
- Add TypeScript/JavaScript config discovery through `baekstage/config`.
- Add host, port, browser-open, Playwright command, environment, and result options.
- Scope all viewer CSS to Baekstage roots and portals.
- Keep browser, Playwright, Vite, config, and CLI entry points independently usable.

## 0.1.0

- Initial Baekstage scenario graph model and React viewer.
- Node-scoped and edge-scoped Playwright screenshot metadata.
- Scenario execution, result gallery, and Playwright Trace integration.
- Optional configurable Vite development runner.
- Separate browser, Playwright, and Vite package entries.
