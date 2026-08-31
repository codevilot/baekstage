import { spawn, type ChildProcess } from "node:child_process";
import { connect, createServer } from "node:net";
import path from "node:path";
import type { WebServerConfig } from "./config";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function reachable(url: string) {
  if (url.startsWith("tcp://")) return new Promise<boolean>((resolve) => {
    const target = new URL(url); const socket = connect(Number(target.port), target.hostname);
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1_000); socket.once("connect", () => done(true)); socket.once("error", () => done(false)); socket.once("timeout", () => done(false));
  });
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    // Any HTTP response proves that a server owns the configured endpoint. In
    // particular, do not try to bind the same port just because an app is
    // temporarily returning 5xx during development.
    return true;
  } catch { return false; }
}

async function availablePort(hostname: string) {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, hostname, () => {
      const address = probe.address();
      if (!address || typeof address === "string") { probe.close(); reject(new Error("Could not allocate an internal port")); return; }
      const port = address.port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function replacePort(value: string, port: number) { return value.replaceAll("{port}", String(port)); }

async function resolveConfig(config: WebServerConfig) {
  if (config.port !== "auto") {
    let parsed: URL;
    try { parsed = new URL(config.url); }
    catch { throw new Error(`webServer.url is invalid: ${config.url}`); }
    return { ...config, port: parsed.port ? Number(parsed.port) : undefined };
  }
  let template: URL;
  try { template = new URL(config.url.replaceAll("{port}", "0")); }
  catch { throw new Error(`webServer.url is invalid: ${config.url}`); }
  if (!config.url.includes("{port}")) throw new Error('webServer.url must contain "{port}" when port is "auto"');
  const port = await availablePort(template.hostname);
  return {
    ...config,
    command: replacePort(config.command, port),
    url: replacePort(config.url, port),
    env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, replacePort(value, port)])),
    port,
  };
}

function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const signal = (value: NodeJS.Signals) => {
    if (process.platform !== "win32" && child.pid) { try { process.kill(-child.pid, value); return; } catch {} }
    child.kill(value);
  };
  return new Promise<void>((resolve) => {
    const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) signal("SIGKILL"); }, 3_000);
    child.once("close", () => { clearTimeout(force); resolve(); });
    signal("SIGTERM");
  });
}

export async function startConfiguredWebServer(config: WebServerConfig | undefined, root: string) {
  if (!config) return { reused: false, url: undefined, port: undefined, stop: async () => {} };
  const resolved = await resolveConfig(config);
  let parsed: URL;
  try { parsed = new URL(resolved.url); }
  catch { throw new Error(`webServer.url is invalid: ${resolved.url}`); }
  if (!(["http:", "https:", "tcp:"] as string[]).includes(parsed.protocol)) throw new Error("webServer.url must use http, https, or tcp");

  if (await reachable(resolved.url)) {
    if (resolved.reuseExistingServer ?? true) return { reused: true, url: resolved.url, port: resolved.port, stop: async () => {} };
    throw new Error(`webServer.url is already in use: ${resolved.url}`);
  }

  const cwd = path.resolve(root, resolved.cwd ?? ".");
  const child = spawn(resolved.command, { cwd, env: { ...process.env, ...resolved.env, ...(resolved.port ? { PORT: String(resolved.port), BAEKSTAGE_PORT: String(resolved.port) } : {}) }, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; const remember = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-4_000); };
  child.stdout?.on("data", (chunk) => { remember(chunk); process.stdout.write(chunk); });
  child.stderr?.on("data", (chunk) => { remember(chunk); process.stderr.write(chunk); });

  const timeoutMs = resolved.timeoutMs ?? 120_000; const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reachable(resolved.url)) return { reused: false, url: resolved.url, port: resolved.port, stop: () => stopProcess(child) };
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`webServer.command exited before ${resolved.url} was ready.${output.trim() ? `\n${output.trim()}` : ""}`);
    await delay(250);
  }
  await stopProcess(child);
  throw new Error(`webServer.command did not make ${resolved.url} ready within ${timeoutMs}ms.${output.trim() ? `\n${output.trim()}` : ""}`);
}
