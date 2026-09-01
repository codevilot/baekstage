# Changelog

- Visualize semantic schema changes as an interactive impact graph with Table-centered object clusters, Foreign Key arrows, status colors, and click-through Before/After details.
- Classify invalid schema sources, references, missing dumps, and unsupported dumps with stable API errors instead of generic failures.
- Preserve dirty, locked, or uninspectable managed worktrees, surface cleanup warnings, and reject stale or revision-mismatched detached previews.
- Add a Schema workspace that compares semantic PostgreSQL objects across the working tree, branches, and commits without creating worktrees.
- Create revision previews as detached worktrees so Baekstage does not lock branches needed by ordinary `git switch` workflows, and safely release clean legacy branch locks.
- Apply scoped viewer styles to screenshot hover previews and full-screen lightboxes by rendering them inside the portal scope root.
- Open marked screenshots in an image lightbox first and expose the Playwright interactive trace as a separate action.
- Add semantic `baekstage.scenario.*` discovery, configurable include globs, and definition-relative Playwright sources for feature-folder scenarios.
- Publish CommonJS entry points alongside ESM so Playwright can import `baekstage/playwright` from ordinary `.spec.ts` files.
- Allow managed web servers and services to use an automatically allocated internal port, and avoid duplicate binds when an existing HTTP server returns a 5xx response.
- Prepare branch Storybook worktrees with the primary checkout's dependencies, matching revision previews.

## 0.3.9

- Add sidebar batch execution with missing-only, rerun-all, and per-scenario confirmation policies.
- Show batch progress, failures, skipped scenarios, and a stop action.
- Display the language switch in English-then-Korean order.

## 0.3.7

- Resolve React, React DOM, and Baekstage through Vite-compatible package imports in the standalone CLI.
- Add configurable scenario discovery roots, directory exclusions, and permission-error handling.

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
