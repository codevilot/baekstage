import type { ScenarioSuite } from "./core/types";

export type OpenApiSourceConfig = { id: string; title: string; file: string; baseUrl?: string; environments?: Record<string, string> };
export type StorybookSourceConfig = { id: string; url: string; title?: string; branch?: string };
export type WebServerConfig = {
  command: string;
  url: string;
  cwd?: string;
  env?: Record<string, string>;
  reuseExistingServer?: boolean;
  timeoutMs?: number;
};

export type ScenarioDiscoveryConfig = {
  /** Directory to search, relative to the directory where Baekstage is run. */
  root?: string;
  /** Directory names or root-relative directory paths to skip. */
  exclude?: string[];
  /** Skip directories that cannot be read because of filesystem permissions. */
  ignorePermissionErrors?: boolean;
};

export type BaekstageConfig = {
  /** Optional dotenv file, resolved from the config working directory. */
  envFile?: string;
  /** Optional when scenarios are discovered from files ending in `.baekstage.*`. */
  suite?: ScenarioSuite;
  discovery?: ScenarioDiscoveryConfig;
  sources?: { openapi?: OpenApiSourceConfig[]; storybook?: StorybookSourceConfig[] };
  visual?: {
    viewport?: { width: number; height: number };
    deviceScaleFactor?: number;
    locale?: string;
    timezoneId?: string;
    threshold?: number;
  };
  playwright?: {
    projectRoot: string;
    command?: string;
    commandArgs?: string[];
    env?: Record<string, string>;
  };
  webServer?: WebServerConfig;
  /** Ordered, locally managed dependencies such as a database or API. */
  services?: Record<string, WebServerConfig>;
  results?: string | { root: string; maxRunsPerNode?: number };
  api?: { timeoutMs?: number; maxResponseBytes?: number };
  security?: { redactKeys?: string[] };
  validation?: { strictOpenApiResponses?: boolean };
  server?: { host?: string; port?: number; open?: boolean };
};

export function defineConfig(config: BaekstageConfig) {
  return config;
}
