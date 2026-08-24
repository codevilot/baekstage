#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { BaekstageConfig } from "./config";
import { baekstagePlugin } from "./vite/scenario-plugin";
import { loadOpenApiSources } from "./openapi/loader";
import { validateResponseEdges } from "./core/api-response";
import { startConfiguredWebServer } from "./cli-web-server";

type Args = { config?: string; host?: string; port?: number; open?: boolean; help?: boolean };
const candidates = ["baekstage.config.ts", "baekstage.config.mts", "baekstage.config.js", "baekstage.config.mjs", "baekstage.config.json", "baekstage.js", "baekstage.mjs", "baekstage.json"];

function usage() {
  return `Baekstage\n\nUsage: npx baekstage [options]\n\nOptions:\n  -c, --config <file>  Config file (default: baekstage.config.*)\n  -h, --host <host>    Host (default: 127.0.0.1)\n  -p, --port <port>    Port (default: 4173)\n      --open           Open the browser\n      --no-open        Do not open the browser\n      --help           Show this help\n`;
}

function parseArgs(values: string[]): Args {
  const result: Args = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help") result.help = true;
    else if (value === "--open") result.open = true;
    else if (value === "--no-open") result.open = false;
    else if (["-c", "--config"].includes(value)) result.config = values[++index];
    else if (["-h", "--host"].includes(value)) result.host = values[++index];
    else if (["-p", "--port"].includes(value)) result.port = Number(values[++index]);
    else throw new Error(`Unknown option: ${value}`);
  }
  if (result.port !== undefined && (!Number.isInteger(result.port) || result.port < 1 || result.port > 65535)) throw new Error("Port must be an integer from 1 to 65535");
  return result;
}

function configPath(cwd: string, requested?: string) {
  if (requested) return path.resolve(cwd, requested);
  const found = candidates.map((name) => path.join(cwd, name)).find(existsSync);
  if (!found) throw new Error(`No Baekstage config found. Create ${candidates[0]} or pass --config.`);
  return found;
}

async function loadConfig(cwd: string, file: string): Promise<BaekstageConfig> {
  if (!existsSync(file)) throw new Error(`Config does not exist: ${file}`);
  if (file.endsWith(".json")) return JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8"));
  const loader = await createServer({ root: cwd, configFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  try { return (await loader.ssrLoadModule(file)).default as BaekstageConfig; }
  finally { await loader.close(); }
}

function fsUrl(file: string) { return `/@fs/${file.replaceAll("\\", "/")}`; }
async function standaloneRoot(config: BaekstageConfig) {
  const root = await mkdtemp(path.join(tmpdir(), "baekstage-"));
  const packageDir = path.dirname(fileURLToPath(import.meta.url));
  const library = path.join(packageDir, "baekstage.js");
  const css = path.join(packageDir, "baekstage.css");
  const react = fileURLToPath(import.meta.resolve("react"));
  const reactDom = fileURLToPath(import.meta.resolve("react-dom/client"));
  await writeFile(path.join(root, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baekstage</title><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>');
  await writeFile(path.join(root, "main.js"), `import React from ${JSON.stringify(fsUrl(react))};import{createRoot}from ${JSON.stringify(fsUrl(reactDom))};import{ScenarioViewer}from ${JSON.stringify(fsUrl(library))};import ${JSON.stringify(fsUrl(css))};import config from "virtual:baekstage-config";createRoot(document.getElementById("root")).render(React.createElement(ScenarioViewer,{suite:config.suite,catalog:config.catalog,options:config.options}));`);
  return root;
}

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  spawn(command[0], command.slice(1), { detached: true, stdio: "ignore" }).unref();
}

async function start() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  const cwd = process.cwd(); const file = configPath(cwd, args.config); const config = await loadConfig(cwd, file);
  if (!config?.suite?.scenarios) throw new Error("Config must provide a ScenarioSuite as suite");
  const host = args.host ?? config.server?.host ?? "127.0.0.1"; const port = args.port ?? config.server?.port ?? 4173;
  const catalog = await loadOpenApiSources(cwd, config.sources?.openapi);
  const responseWarnings = config.suite.scenarios.flatMap((scenario) => validateResponseEdges(scenario, catalog.operations).map((message) => ({ sourceId: scenario.id, message })));
  if (config.validation?.strictOpenApiResponses && responseWarnings.length) throw new Error(responseWarnings.map((item) => item.message).join("\n"));
  catalog.errors?.push(...responseWarnings);
  const appServer = await startConfiguredWebServer(config.webServer, cwd);
  if (config.webServer) process.stdout.write(`\n  App server ${appServer.reused ? "reused" : "ready"} at ${config.webServer.url}\n`);
  let root: string | undefined;
  try {
  root = await standaloneRoot(config); const plugins = [];
  if (config.playwright?.projectRoot || config.sources?.openapi?.length) { const results = typeof config.results === "string" ? { root: config.results } : config.results; plugins.push(baekstagePlugin({ projectRoot: config.playwright?.projectRoot ? path.resolve(cwd, config.playwright.projectRoot) : cwd, resultRoot: path.resolve(cwd, results?.root ?? ".baekstage/results"), maxRunsPerNode: results?.maxRunsPerNode, redactKeys: config.security?.redactKeys, command: config.playwright?.command, commandArgs: config.playwright?.commandArgs, env: config.playwright?.env, catalog, apiSources: config.sources?.openapi?.map((source) => ({ id: source.id, baseUrl: source.baseUrl, environments: source.environments })), apiTimeoutMs: config.api?.timeoutMs, apiMaxResponseBytes: config.api?.maxResponseBytes, suite: config.suite })); }
  plugins.push({ name: "baekstage-config", resolveId(id: string) { return id === "virtual:baekstage-config" ? "\0virtual:baekstage-config" : null; }, load(id: string) { return id === "\0virtual:baekstage-config" ? `export default ${JSON.stringify({ suite: config.suite, catalog, options: { runnerEndpoint: "/api/scenarios", traceViewerEndpoint: "/trace-viewer", catalogEndpoint: "/api/catalog", apiRunnerEndpoint: "/api/operations" } })}` : null; } });
  const server = await createServer({ root, configFile: false, appType: "spa", plugins, server: { host, port, strictPort: true } });
  await server.listen(); const url = `http://${host}:${port}`; process.stdout.write(`\n  Baekstage ready at ${url}\n  Config: ${path.relative(cwd, file)}\n\n`);
  if (args.open ?? config.server?.open) openBrowser(url);
  const stop = async () => { await server.close(); await appServer.stop(); await rm(root!, { recursive: true }); process.exit(0); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  } catch (error) {
    await appServer.stop();
    if (root) await rm(root, { recursive: true });
    throw error;
  }
}

start().catch((error) => { process.stderr.write(`Baekstage: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
