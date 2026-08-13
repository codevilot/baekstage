import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { baekstagePlugin } from "./src/vite/scenario-plugin";

export default defineConfig({
  plugins: [react(), baekstagePlugin({
    projectRoot: path.resolve(process.env.PLAYWRIGHT_PROJECT_ROOT ?? "../data_foundry_platform/tdp-web"),
  })],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
