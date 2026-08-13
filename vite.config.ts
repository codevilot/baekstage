import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { existsSync } from "node:fs";
import { baekstagePlugin } from "./src/vite/scenario-plugin";

const playwrightRoot = path.resolve(process.env.PLAYWRIGHT_PROJECT_ROOT ?? "../data_foundry_platform/tdp-web");

export default defineConfig({
  plugins: [react(), ...(existsSync(playwrightRoot) ? [baekstagePlugin({ projectRoot: playwrightRoot })] : [])],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
