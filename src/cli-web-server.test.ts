import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startConfiguredWebServer } from "./cli-web-server";

describe("configured web server", () => {
  let server: Server | undefined;
  afterEach(async () => { if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

  it("reuses a healthy server by default", async () => {
    server = createServer((_request, response) => { response.writeHead(200); response.end("ok"); });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address(); const port = typeof address === "object" && address ? address.port : 0;
    const running = await startConfiguredWebServer({ command: "exit 9", url: `http://127.0.0.1:${port}` }, process.cwd());
    expect(running.reused).toBe(true);
    await running.stop();
    expect(server.listening).toBe(true);
  });

  it("reports command output when startup exits", async () => {
    await expect(startConfiguredWebServer({ command: 'node -e "console.error(\'missing app dependency\');process.exit(1)"', url: "http://127.0.0.1:1", timeoutMs: 2_000 }, process.cwd())).rejects.toThrow(/missing app dependency/);
  });

  it("starts and stops the configured command", async () => {
    const probe = createServer(); await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const address = probe.address(); const port = typeof address === "object" && address ? address.port : 0;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-web-server-"));
    const script = path.join(root, "server.cjs");
    await writeFile(script, `require("node:http").createServer((_q,r)=>r.end("ready")).listen(${port},"127.0.0.1")`);
    const running = await startConfiguredWebServer({ command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, url: `http://127.0.0.1:${port}`, timeoutMs: 5_000 }, root);
    try { expect(running.reused).toBe(false); expect(await fetch(`http://127.0.0.1:${port}`).then((response) => response.text())).toBe("ready"); }
    finally { await running.stop(); await rm(root, { recursive: true }); }
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
  });
});
