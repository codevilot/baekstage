import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { baekstagePlugin } from "./src/vite/scenario-plugin";
import { parseOpenApiDocument } from "./src/openapi/catalog";
import openapi from "./src/examples/demo-openapi.json";
import { demoSuite } from "./src/examples/demo";
const demoBaseUrl = process.env.BAEKSTAGE_DEMO_API_URL ?? process.env.VITE_BAEKSTAGE_DEMO_API_URL ?? "http://localhost:8080";
const catalog = parseOpenApiDocument({ id: "task-runner", title: "Task Runner Demo API", baseUrl: demoBaseUrl, environments: { Local: demoBaseUrl } }, openapi);

export default defineConfig({
  test: { exclude: ["e2e/**", "node_modules/**", "dist/**"] },
  plugins: [react(), baekstagePlugin({
    projectRoot: process.cwd(),
    resultRoot: process.env.BAEKSTAGE_RESULT_ROOT,
    commandArgs: ["exec", "--", "playwright", "test", "--config=e2e/fixtures/playwright.config.ts"],
    catalog,
    suite: demoSuite,
    apiSources: [{ id: "task-runner", baseUrl: demoBaseUrl, environments: { Local: demoBaseUrl } }],
  })],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
