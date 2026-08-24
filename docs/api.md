# Public API

## Browser entry: `baekstage`

- `ScenarioViewer`: complete graph, scenario, run, screenshot, and Trace UI.
- `SuiteGalaxy`: graph canvas for custom compositions.
- `defineScenario`: validates node and edge references.
- `defineSuite`: validates all scenarios in a suite.
- `filterScenario`: filters nodes by project-defined facets.
- `mergeResult`: immutably applies node execution results.
- `normalizeExecution`: converts legacy Playwright execution to the common model.
- `mergeNodeResults` / `applyRunResult`: apply normalized adapter results.
- `evaluateApiAssertions`: evaluates MVP HTTP assertions independently.
- `validateScenario`: returns validation failures without rendering.

The browser entry also exports the scenario model types: `ScenarioSuite`,
`ScenarioGraph`, `ScenarioNode`, `ScenarioEdge`, `ScenarioArtifact`,
`ScenarioExecution`, `ScenarioNodeResult`, `ScenarioRunResult`, `ApiAssertion`, and
`ScenarioViewerOptions`.

API nodes may define `cases` with an `expectedResponse`, request, assertions, and
setup strategy. Results carry `runId`, `origin`, observed API evidence, matched
response branch, failure kind, latest result, and per-node history. Existing
`node.request`/`node.assertions` definitions normalize to a `default` request-only
case.

## OpenAPI entry: `baekstage/openapi`

- `parseOpenApiDocument`: normalizes an already parsed OpenAPI 3.x document.
- `openApiOperationId`: creates stable operation references.
- `scenariosForOperation` / `operationTestState`: link Catalog and Scenario state.

The CLI reads JSON/YAML files declared in config. The browser entry does not bundle
Node filesystem APIs.

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
- `BaekstageConfig`: suite, source, runner, API limits, results, and server options.

## Viewer options

```ts
type ScenarioViewerOptions = {
  connectBy?: string[];
  primaryFacet?: string;
  runnerEndpoint?: string;
  traceViewerEndpoint?: string;
  catalogEndpoint?: string;
  apiRunnerEndpoint?: string;
};
```

Endpoints may be relative or absolute URLs. If an API is hosted on another origin,
configure CORS on JSON, screenshot, and Trace ZIP responses.
