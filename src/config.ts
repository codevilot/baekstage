import type { ScenarioSuite } from "./core/types";

export type BaekstageConfig = {
  suite: ScenarioSuite;
  playwright?: {
    projectRoot: string;
    command?: string;
    commandArgs?: string[];
    env?: Record<string, string>;
  };
  results?: string;
  server?: { host?: string; port?: number; open?: boolean };
};

export function defineConfig(config: BaekstageConfig) {
  return config;
}
