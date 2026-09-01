import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist-lib",
    lib: {
      entry: {
        index: "src/index.ts",
        cli: "src/cli.ts",
        config: "src/config.ts",
        playwright: "src/playwright/index.ts",
        vite: "src/vite/scenario-plugin.ts",
        openapi: "src/openapi/catalog.ts",
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        const name = entryName === "index" ? "baekstage" : entryName;
        return `${name}.${format === "cjs" ? "cjs" : "js"}`;
      },
      cssFileName: "baekstage",
    },
    rollupOptions: {
      external: [/^node:/, "vite", "react", "react-dom", "react/jsx-runtime", "@playwright/test", "pixelmatch", "pngjs"],
    },
  },
});
