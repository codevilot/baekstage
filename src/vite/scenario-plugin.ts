import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { readScreenshotMark } from "../playwright/mark-screenshot";

type Item = Record<string, unknown>;
type Shot = { label: string; url: string; traceUrl?: string; scenarioId?: string; nodeId?: string; edgeId?: string; fromNodeId?: string; toNodeId?: string; category?: string; branch?: string; important?: boolean; checkpoint?: boolean; target?: string };
export type BaekstagePluginOptions = {
  projectRoot: string;
  resultRoot?: string;
  apiBase?: string;
  assetBase?: string;
  traceViewerBase?: string;
  command?: string;
  commandArgs?: string[];
  env?: Record<string, string>;
};

const cleanBase = (value: string) => `/${value.replace(/^\/+|\/+$/g, "")}`;
function json(res: import("node:http").ServerResponse, status: number, value: unknown) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); }
async function requestBody(req: import("node:http").IncomingMessage) { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function attachmentGroups(value: unknown, found: Item[][] = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) { value.forEach((item) => attachmentGroups(item, found)); return found; }
  const record = value as Item;
  if (Array.isArray(record.attachments) && record.attachments.length) found.push(record.attachments as Item[]);
  Object.entries(record).filter(([key]) => key !== "attachments").forEach(([, item]) => attachmentGroups(item, found));
  return found;
}
function run(command: string, args: string[], cwd: string, customEnv: Record<string, string>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...customEnv } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject); child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
function failureOutput(report: unknown, fallback: string) {
  const messages = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Item;
    if (typeof record.message === "string" && ("stack" in record || "location" in record)) messages.add([record.message, typeof record.stack === "string" ? record.stack.split("\n").slice(1, 5).join("\n") : ""].filter(Boolean).join("\n"));
    Object.entries(record).filter(([key]) => !["config", "metadata", "attachments"].includes(key)).forEach(([, item]) => visit(item));
  };
  visit(report); return [...messages].join("\n\n") || fallback.slice(-2000) || "Playwright exited without an error message.";
}
async function copyAttachment(item: Item, destination: string) {
  if (typeof item.path === "string" && existsSync(item.path)) await copyFile(item.path, destination);
  else if (typeof item.body === "string") await writeFile(destination, Buffer.from(item.body, "base64"));
  else return false;
  return true;
}

export function baekstagePlugin(options: BaekstagePluginOptions): Plugin {
  const projectRoot = path.resolve(options.projectRoot);
  const resultRoot = path.resolve(options.resultRoot ?? ".scenario-results");
  const apiBase = cleanBase(options.apiBase ?? "/api/scenarios");
  const assetBase = cleanBase(options.assetBase ?? "/scenario-results");
  const traceBase = cleanBase(options.traceViewerBase ?? "/trace-viewer");
  if (!existsSync(projectRoot)) throw new Error(`Playwright projectRoot does not exist: ${projectRoot}`);
  async function saveArtifacts(id: string, report: unknown) {
    const directory = path.join(resultRoot, id); await mkdir(directory, { recursive: true });
    const screenshots: Shot[] = [], traces: Array<{ label: string; url: string }> = [];
    for (const group of attachmentGroups(report)) {
      const trace = group.find((item) => item.name === "trace" || String(item.contentType).includes("zip"));
      let traceUrl: string | undefined;
      if (trace) { const name = `trace-${traces.length + 1}.zip`; if (await copyAttachment(trace, path.join(directory, name))) { traceUrl = `${assetBase}/${id}/${name}`; traces.push({ label: String(trace.name ?? "Trace"), url: traceUrl }); } }
      for (const item of group.filter((entry) => String(entry.contentType).startsWith("image/"))) {
        const extension = String(item.contentType).includes("jpeg") ? "jpg" : "png"; const name = `${screenshots.length + 1}.${extension}`;
        if (!await copyAttachment(item, path.join(directory, name))) continue;
        const rawLabel = String(item.name ?? `Screenshot ${screenshots.length + 1}`); const mark = readScreenshotMark(rawLabel);
        screenshots.push({ label: mark?.label ?? rawLabel, url: `${assetBase}/${id}/${name}`, traceUrl, ...(mark ?? {}) });
      }
    }
    return { screenshots, traces };
  }
  async function execute(id: string, source?: string, grep?: string) {
    let relative: string | undefined;
    if (source) { relative = source.startsWith(`${path.basename(projectRoot)}/`) ? source.slice(path.basename(projectRoot).length + 1) : source; const target = path.resolve(projectRoot, relative); if (!target.startsWith(`${projectRoot}${path.sep}`) || !existsSync(target)) throw new Error("Playwright source is outside projectRoot or does not exist"); }
    const command = options.command ?? "npm";
    const prefix = options.commandArgs ?? ["exec", "--", "playwright", "test"];
    const result = await run(command, [...prefix, ...(relative ? [relative] : []), "--reporter=json", "--trace=on", ...(grep ? ["--grep", grep] : [])], projectRoot, options.env ?? {});
    const start = result.stdout.indexOf("{"); const end = result.stdout.lastIndexOf("}"); let report: unknown = {};
    if (start >= 0 && end > start) try { report = JSON.parse(result.stdout.slice(start, end + 1)); } catch { report = {}; }
    const artifacts = await saveArtifacts(id, report); const manifest = { scenarioId: id, status: result.code === 0 ? "passed" : "failed", ...artifacts, output: result.code === 0 ? "" : failureOutput(report, result.stderr), finishedAt: new Date().toISOString() };
    await mkdir(path.join(resultRoot, id), { recursive: true }); await writeFile(path.join(resultRoot, id, "manifest.json"), JSON.stringify(manifest, null, 2)); return manifest;
  }
  return { name: "baekstage", configureServer(server) {
    const traceRoot = path.join(projectRoot, "node_modules/playwright-core/lib/vite/traceViewer");
    server.middlewares.use(traceBase, (req, res, next) => { const relative = req.url === "/" ? "/index.html" : req.url?.split("?")[0] ?? "/index.html"; const file = path.resolve(traceRoot, `.${relative}`); if (!file.startsWith(`${traceRoot}${path.sep}`) || !existsSync(file)) return next(); const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf" }; readFile(file).then((data) => { res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }); res.end(data); }).catch(next); });
    server.middlewares.use(assetBase, (req, res, next) => { const file = path.resolve(resultRoot, `.${req.url}`); if (!file.startsWith(`${resultRoot}${path.sep}`) || !existsSync(file)) return next(); readFile(file).then((data) => { res.writeHead(200, { "content-type": file.endsWith(".zip") ? "application/zip" : file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".json") ? "application/json" : "image/png", "access-control-allow-origin": "*" }); res.end(data); }).catch(next); });
    server.middlewares.use(apiBase, async (req, res) => { try { const match = req.url?.match(/^\/([^/]+)(?:\/run)?/); const id = match?.[1]; if (!id) return json(res, 400, { error: "Scenario id is required" }); if (req.method === "GET") { const file = path.join(resultRoot, id, "manifest.json"); return json(res, 200, existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null); } if (req.method === "POST" && req.url?.endsWith("/run")) { const input = await requestBody(req); return json(res, 200, await execute(id, input.source, input.grep)); } json(res, 405, { error: "Method not allowed" }); } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : String(error) }); } });
  }};
}
