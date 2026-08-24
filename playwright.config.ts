import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testIgnore: "**/fixtures/**", timeout: 30_000, use: { headless: true }, reporter: "line" });
