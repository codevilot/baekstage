import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { OpenApiSourceConfig } from "../config";
import type { OpenApiCatalog } from "../core/types";
import { parseOpenApiDocument } from "./catalog";

export async function loadOpenApiSources(cwd: string, sources: OpenApiSourceConfig[] = []): Promise<OpenApiCatalog> {
  const catalog: OpenApiCatalog = { operations: [], errors: [] };
  for (const source of sources) {
    try {
      if (!source.id.trim() || !source.title.trim()) throw new Error("id and title are required");
      const file = path.resolve(cwd, source.file);
      const text = await readFile(file, "utf8");
      const document = source.file.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
      catalog.operations.push(...parseOpenApiDocument(source, document).operations);
    } catch (error) {
      catalog.errors?.push({ sourceId: source.id || "unknown", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return catalog;
}
