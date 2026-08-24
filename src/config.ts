import type { ScenarioSuite } from "./core/types";

export type OpenApiSourceConfig = { id: string; title: string; file: string; baseUrl?: string; environments?: Record<string, string> };
export type StorybookSourceConfig = { id: string; url: string; title?: string };
export type WebServerConfig = {
  command: string;
  url: string;
  cwd?: string;
  env?: Record<string, string>;
  reuseExistingServer?: boolean;
  timeoutMs?: number;
};

export type BaekstageConfig = {
  suite: ScenarioSuite;
  sources?: { openapi?: OpenApiSourceConfig[]; storybook?: StorybookSourceConfig[] };
  playwright?: {
    projectRoot: string;
    command?: string;
    commandArgs?: string[];
    env?: Record<string, string>;
  };
  webServer?: WebServerConfig;
  results?: string | { root: string; maxRunsPerNode?: number };
  api?: { timeoutMs?: number; maxResponseBytes?: number };
  security?: { redactKeys?: string[] };
  validation?: { strictOpenApiResponses?: boolean };
  server?: { host?: string; port?: number; open?: boolean };
};

export function defineConfig(config: BaekstageConfig) {
  return config;
}
