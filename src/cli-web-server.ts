import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
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
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.status < 500;
  } catch { return false; }
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
  if (!config) return { reused: false, stop: async () => {} };
  let parsed: URL;
  try { parsed = new URL(config.url); }
  catch { throw new Error(`webServer.url is invalid: ${config.url}`); }
  if (!(["http:", "https:", "tcp:"] as string[]).includes(parsed.protocol)) throw new Error("webServer.url must use http, https, or tcp");

  if (await reachable(config.url)) {
    if (config.reuseExistingServer ?? true) return { reused: true, stop: async () => {} };
    throw new Error(`webServer.url is already in use: ${config.url}`);
  }

  const cwd = path.resolve(root, config.cwd ?? ".");
  const child = spawn(config.command, { cwd, env: { ...process.env, ...config.env }, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; const remember = (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(-4_000); };
  child.stdout?.on("data", (chunk) => { remember(chunk); process.stdout.write(chunk); });
  child.stderr?.on("data", (chunk) => { remember(chunk); process.stderr.write(chunk); });

  const timeoutMs = config.timeoutMs ?? 120_000; const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reachable(config.url)) return { reused: false, stop: () => stopProcess(child) };
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`webServer.command exited before ${config.url} was ready.${output.trim() ? `\n${output.trim()}` : ""}`);
    await delay(250);
  }
  await stopProcess(child);
  throw new Error(`webServer.command did not make ${config.url} ready within ${timeoutMs}ms.${output.trim() ? `\n${output.trim()}` : ""}`);
}
