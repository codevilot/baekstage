#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { BaekstageConfig } from "./config";
import { baekstagePlugin } from "./vite/scenario-plugin";
import { loadOpenApiSources } from "./openapi/loader";
import { validateResponseEdges } from "./core/api-response";
import { startConfiguredWebServer } from "./cli-web-server";
import { discoverSuite, matchesPartDefinition, matchesScenarioDefinition } from "./scenario-discovery";

type Args = { config?: string; host?: string; port?: number; open?: boolean; help?: boolean };
type Cleanup = () => void | Promise<void>;
const candidates = ["baekstage.config.ts", "baekstage.config.mts", "baekstage.config.js", "baekstage.config.mjs", "baekstage.config.json", "baekstage.js", "baekstage.mjs", "baekstage.json"];
const cleanups: Cleanup[] = [];
let cleanupPromise: Promise<void> | undefined;

function addCleanup(cleanup: Cleanup) { cleanups.push(cleanup); }

function cleanup() {
  cleanupPromise ??= (async () => {
    while (cleanups.length) {
      try { await cleanups.pop()!(); }
      catch (error) { process.stderr.write(`Baekstage cleanup: ${error instanceof Error ? error.message : String(error)}\n`); }
    }
  })();
  return cleanupPromise;
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(exitCode)); });
}

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
  const loader = await createServer({
    root: cwd,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    // Managed revision worktrees can contain many complete repository copies.
    // They are runtime artifacts, never config dependencies, and watching them
    // can exhaust the process/user inotify limit before the CLI even starts.
    server: { middlewareMode: true, watch: { ignored: ["**/.baekstage/**"] } },
  });
  try {
    const config = file.endsWith(".json")
      ? JSON.parse(await (await import("node:fs/promises")).readFile(file, "utf8")) as BaekstageConfig
      : (await loader.ssrLoadModule(file)).default as BaekstageConfig;
    const discoveryRoot = path.resolve(cwd, config.discovery?.root ?? ".");
    config.suite = await discoverSuite(discoveryRoot, config.suite, async (scenarioFile) => (await loader.ssrLoadModule(scenarioFile)).default, config.discovery);
    return config;
  }
  finally { await loader.close(); }
}

async function configEnvironment(cwd: string, file?: string) {
  if (!file) return {};
  const content = await readFile(path.resolve(cwd, file), "utf8"); const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) { const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/); if (!match || line.trimStart().startsWith("#")) continue; let value = match[2]; if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); values[match[1]] = value; }
  return values;
}

async function standaloneRoot(config: BaekstageConfig, cwd: string) {
  const runtimeRoot = path.join(cwd, ".baekstage", "runtime"); await mkdir(runtimeRoot, { recursive: true });
  const root = await mkdtemp(path.join(runtimeRoot, "cli-"));
  const viewerEntry = fileURLToPath(new URL(/* @vite-ignore */ "./baekstage.js", import.meta.url));
  const stylesheet = fileURLToPath(new URL(/* @vite-ignore */ "./baekstage.css", import.meta.url));
  await writeFile(path.join(root, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baekstage</title><style>html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>');
  await writeFile(path.join(root, "main.js"), `import React from "react";import{createRoot}from "react-dom/client";import{ScenarioViewer}from ${JSON.stringify(viewerEntry)};import ${JSON.stringify(stylesheet)};import config from "virtual:baekstage-config";createRoot(document.getElementById("root")).render(React.createElement(ScenarioViewer,{suite:config.suite,catalog:config.catalog,options:config.options}));`);
  return root;
}

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url];
  spawn(command[0], command.slice(1), { detached: true, stdio: "ignore" }).unref();
}

async function start() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage()); return; }
  const cwd = process.cwd(); const file = configPath(cwd, args.config); const config = await loadConfig(cwd, file); const discoveryRoot = path.resolve(cwd, config.discovery?.root ?? ".");
  if (!config.suite) throw new Error("Baekstage could not create a scenario suite");
  const host = args.host ?? config.server?.host ?? "127.0.0.1"; const port = args.port ?? config.server?.port ?? 4173;
  const catalog = await loadOpenApiSources(cwd, config.sources?.openapi);
  const responseWarnings = config.suite.scenarios.flatMap((scenario) => validateResponseEdges(scenario, catalog.operations).map((message) => ({ sourceId: scenario.id, message })));
  if (config.validation?.strictOpenApiResponses && responseWarnings.length) throw new Error(responseWarnings.map((item) => item.message).join("\n"));
  catalog.errors?.push(...responseWarnings);
  const fileEnv = await configEnvironment(cwd, config.envFile);
  const runtimeEnv = { ...fileEnv };
  for (const [name, service] of Object.entries(config.services ?? {})) {
    const running = await startConfiguredWebServer({ ...service, env: { ...runtimeEnv, ...service.env } }, cwd);
    addCleanup(running.stop);
    const envName = name.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
    if (running.url) runtimeEnv[`BAEKSTAGE_SERVICE_${envName}_URL`] = running.url;
    if (running.port) runtimeEnv[`BAEKSTAGE_SERVICE_${envName}_PORT`] = String(running.port);
    process.stdout.write(`\n  Service ${name} ${running.reused ? "reused" : "ready"} at ${running.url}\n`);
  }
  const appServer = await startConfiguredWebServer(config.webServer ? { ...config.webServer, env: { ...runtimeEnv, ...config.webServer.env } } : undefined, cwd);
  addCleanup(appServer.stop);
  if (appServer.url) runtimeEnv.BAEKSTAGE_WEB_SERVER_URL = appServer.url;
  if (appServer.port) runtimeEnv.BAEKSTAGE_WEB_SERVER_PORT = String(appServer.port);
  if (config.webServer) process.stdout.write(`\n  App server ${appServer.reused ? "reused" : "ready"} at ${appServer.url}\n`);
  let root: string | undefined;
  try {
  root = await standaloneRoot(config, cwd); addCleanup(() => rm(root!, { recursive: true, force: true })); const plugins = [];
  let runtimePluginOptions: Parameters<typeof baekstagePlugin>[0] | undefined;
  if (config.suite) { const results = typeof config.results === "string" ? { root: config.results } : config.results; const playwrightEnv = Object.fromEntries(Object.entries(config.playwright?.env ?? {}).map(([key, value]) => [key, appServer.port ? value.replaceAll("{port}", String(appServer.port)) : value])); runtimePluginOptions = { workspaceRoot: cwd, definitionRoot: discoveryRoot, projectRoot: config.playwright?.projectRoot ? path.resolve(cwd, config.playwright.projectRoot) : cwd, resultRoot: path.resolve(cwd, results?.root ?? ".baekstage/results"), maxRunsPerNode: results?.maxRunsPerNode, redactKeys: config.security?.redactKeys, command: config.playwright?.command, commandArgs: config.playwright?.commandArgs, env: { ...runtimeEnv, ...playwrightEnv }, catalog, apiSources: config.sources?.openapi?.map((source) => ({ id: source.id, baseUrl: source.baseUrl, environments: source.environments })), apiTimeoutMs: config.api?.timeoutMs, apiMaxResponseBytes: config.api?.maxResponseBytes, suite: config.suite, storybookSources: config.sources?.storybook, visual: config.visual, schemaSources: config.schema?.sources, schemaRecentCommits: config.schema?.recentCommits }; plugins.push(baekstagePlugin(runtimePluginOptions)); }
  plugins.push({ name: "baekstage-config", resolveId(id: string) { return id === "virtual:baekstage-config" ? "\0virtual:baekstage-config" : null; }, load(id: string) { return id === "\0virtual:baekstage-config" ? `export default ${JSON.stringify({ suite: config.suite, catalog, options: { runnerEndpoint: "/api/scenarios", composerEndpoint: "/api/compositions", editorEndpoint: "/api/scenario-editor", traceViewerEndpoint: "/trace-viewer", catalogEndpoint: "/api/catalog", apiRunnerEndpoint: "/api/operations", storybookEndpoint: "/api/storybook", reviewEndpoint: "/api/reviews", schemaEndpoint: "/api/schema" } })}` : null; } });
  const server = await createServer({
    root,
    configFile: false,
    appType: "spa",
    plugins,
    resolve: { dedupe: ["react", "react-dom"] },
    optimizeDeps: {
      include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    server: { host, port, strictPort: true },
  });
  addCleanup(() => server.close());
  server.watcher.add(discoveryRoot);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshQueue = Promise.resolve();
  const refreshSuite = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshQueue = refreshQueue.then(async () => {
        try {
          const refreshed = await loadConfig(cwd, file);
          if (!refreshed.suite) throw new Error("Baekstage could not create a scenario suite");
          config.suite = refreshed.suite;
          if (runtimePluginOptions) runtimePluginOptions.suite = refreshed.suite;
          const virtualModule = server.moduleGraph.getModuleById("\0virtual:baekstage-config");
          if (virtualModule) server.moduleGraph.invalidateModule(virtualModule);
          server.ws.send({ type: "full-reload", path: "*" });
          process.stdout.write(`\n  Scenario catalog refreshed (${refreshed.suite.scenarios.length} scenarios)\n\n`);
        } catch (error) {
          process.stderr.write(`\n  Scenario catalog refresh failed: ${error instanceof Error ? error.message : String(error)}\n\n`);
        }
      });
    }, 150);
  };
  const onWatcherEvent = (_event: string, changedFile: string) => {
    const relative = path.relative(discoveryRoot, changedFile);
    if (!relative.startsWith(`..${path.sep}`) && (matchesScenarioDefinition(relative, config.discovery) || matchesPartDefinition(relative))) refreshSuite();
  };
  server.watcher.on("all", onWatcherEvent);
  addCleanup(() => { clearTimeout(refreshTimer); server.watcher.off("all", onWatcherEvent); });
  await server.listen(); const url = `http://${host}:${port}`; process.stdout.write(`\n  Baekstage ready at ${url}\n  Config: ${path.relative(cwd, file)}\n  Scenario discovery: watching ${path.relative(cwd, discoveryRoot) || "."}\n\n`);
  if (args.open ?? config.server?.open) openBrowser(url);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

start().catch(async (error) => { await cleanup(); process.stderr.write(`Baekstage: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
