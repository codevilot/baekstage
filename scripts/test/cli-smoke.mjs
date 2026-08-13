import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "baekstage-cli-test-"));
const port = 43179;
const config = { suite: { name: "CLI smoke", scenarios: [{ id: "smoke", title: "Smoke", nodes: [{ id: "start", title: "Start", kind: "fixture" }], edges: [] }] } };
await writeFile(path.join(root, "baekstage.config.json"), JSON.stringify(config));
const child = spawn(process.execPath, [path.resolve("dist-lib/cli.js"), "--port", String(port), "--no-open"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

try {
  const deadline = Date.now() + 10_000;
  while (!output.includes("Baekstage ready") && child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!output.includes("Baekstage ready")) throw new Error(`CLI did not start:\n${output}`);
  const html = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
  const script = await fetch(`http://127.0.0.1:${port}/main.js`).then((response) => response.text());
  if (!html.includes("Baekstage") || !script.includes("ScenarioViewer")) throw new Error("CLI did not serve the standalone viewer");
  process.stdout.write("Baekstage CLI smoke test passed\n");
} finally {
  if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
  await rm(root, { recursive: true });
}
