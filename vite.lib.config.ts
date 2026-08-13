import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-lib",
    lib: {
      entry: {
        index: "src/index.ts",
        playwright: "src/playwright/index.ts",
        vite: "src/vite/scenario-plugin.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => entryName === "index" ? "baekstage.js" : `${entryName}.js`,
      cssFileName: "baekstage",
    },
    rollupOptions: {
      external: [/^node:/, "vite", "react", "react-dom", "react/jsx-runtime"],
    },
  },
});
