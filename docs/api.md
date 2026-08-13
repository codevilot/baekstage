# Public API

## Browser entry: `baekstage`

- `ScenarioViewer`: complete graph, scenario, run, screenshot, and Trace UI.
- `SuiteGalaxy`: graph canvas for custom compositions.
- `defineScenario`: validates node and edge references.
- `defineSuite`: validates all scenarios in a suite.
- `filterScenario`: filters nodes by project-defined facets.
- `mergeResult`: immutably applies node execution results.
- `validateScenario`: returns validation failures without rendering.

The browser entry also exports the scenario model types: `ScenarioSuite`,
`ScenarioGraph`, `ScenarioNode`, `ScenarioEdge`, `ScenarioArtifact`, and
`ScenarioViewerOptions`.

## Test entry: `baekstage/playwright`

- `markScreenshot(page, testInfo, mark)`: captures a page or full page.
- `markElementScreenshot(locator, testInfo, mark)`: captures locator bounds.
- `screenshotMarkName(mark)`: encodes metadata in an attachment name.
- `readScreenshotMark(name)`: decodes a marked attachment.

These helpers use structural interfaces, so importing them does not require React and
does not bundle Playwright into Baekstage.

## Server entry: `baekstage/vite`

- `baekstagePlugin(options)`: trusted-development Vite adapter.
- `BaekstagePluginOptions`: runner and route configuration.

## Config entry: `baekstage/config`

- `defineConfig(config)`: typed identity helper for `baekstage.config.ts`.
- `BaekstageConfig`: suite, Playwright runner, results, and standalone server options.

## Viewer options

```ts
type ScenarioViewerOptions = {
  connectBy?: string[];
  primaryFacet?: string;
  runnerEndpoint?: string;
  traceViewerEndpoint?: string;
};
```

Endpoints may be relative or absolute URLs. If an API is hosted on another origin,
configure CORS on JSON, screenshot, and Trace ZIP responses.
