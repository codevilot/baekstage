import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { existsSync } from "node:fs";
import { baekstagePlugin } from "./src/vite/scenario-plugin";
import { parseOpenApiDocument } from "./src/openapi/catalog";
import openapi from "./src/examples/demo-workspace-openapi.json";
import { dataFoundrySuite } from "./src/examples/demo-workspace";

const playwrightRoot = path.resolve(process.env.PLAYWRIGHT_PROJECT_ROOT ?? "../demo_workspace_platform/web-app");
const hasDataFoundryProject = existsSync(playwrightRoot);
const runtimeSuite = hasDataFoundryProject ? dataFoundrySuite : {
  ...dataFoundrySuite,
  name: `${dataFoundrySuite.name} · Local demo`,
  scenarios: dataFoundrySuite.scenarios.map((scenario) => ({ ...scenario, source: "e2e/fixtures/demo-workspace-metric-demo.spec.ts", execution: { adapter: "playwright" as const, source: "e2e/fixtures/demo-workspace-metric-demo.spec.ts", grep: scenario.id === "retry-failed-conversion" ? "R-01" : scenario.execution && "grep" in scenario.execution ? scenario.execution.grep : undefined } })),
};
const demoBaseUrl = process.env.BAEKSTAGE_DEMO_API_URL ?? process.env.VITE_BAEKSTAGE_DEMO_API_URL ?? "http://localhost:8080";
const catalog = parseOpenApiDocument({ id: "task-runner", title: "Task Runner API", baseUrl: demoBaseUrl, environments: { Local: demoBaseUrl } }, openapi);

export default defineConfig({
  define: { __BAEKSTAGE_LOCAL_DEMO__: JSON.stringify(!hasDataFoundryProject) },
  test: { exclude: ["e2e/**", "node_modules/**", "dist/**"] },
  plugins: [react(), baekstagePlugin({
    projectRoot: hasDataFoundryProject ? playwrightRoot : process.cwd(),
    resultRoot: process.env.BAEKSTAGE_RESULT_ROOT,
    commandArgs: hasDataFoundryProject ? undefined : ["exec", "--", "playwright", "test", "--config=e2e/fixtures/playwright.config.ts"],
    catalog,
    suite: runtimeSuite,
    apiSources: [{ id: "task-runner", baseUrl: demoBaseUrl, environments: { Local: demoBaseUrl } }],
  })],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
