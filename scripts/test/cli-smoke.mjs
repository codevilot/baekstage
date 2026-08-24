import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "baekstage-cli-test-"));
const port = 43179;
const config = { suite: { name: "CLI smoke", scenarios: [{ id: "smoke", title: "Smoke", nodes: [{ id: "start", title: "Start", kind: "fixture" }], edges: [] }] } };
const packageRoot = process.cwd();
await mkdir(path.join(root, "node_modules"));
for (const dependency of ["baekstage", "react", "react-dom"]) {
  const target = dependency === "baekstage" ? packageRoot : path.join(packageRoot, "node_modules", dependency);
  await symlink(target, path.join(root, "node_modules", dependency), "junction");
}
await writeFile(path.join(root, "baekstage.json"), JSON.stringify(config));
const child = spawn(process.execPath, [path.resolve("dist-lib/cli.js"), "--port", String(port), "--no-open"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

try {
  const deadline = Date.now() + 10_000;
  while (!output.includes("Baekstage ready") && child.exitCode === null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!output.includes("Baekstage ready")) throw new Error(`CLI did not start:\n${output}`);
  const htmlResponse = await fetch(`http://127.0.0.1:${port}/`);
  const scriptResponse = await fetch(`http://127.0.0.1:${port}/main.js`);
  if (!htmlResponse.ok || !scriptResponse.ok) throw new Error(`CLI returned HTTP ${htmlResponse.status}/${scriptResponse.status}:\n${await scriptResponse.text()}`);
  const html = await htmlResponse.text();
  const script = await scriptResponse.text();
  if (!html.includes("Baekstage") || !script.includes("ScenarioViewer")) throw new Error("CLI did not serve the standalone viewer");
  if (script.includes("/@fs/") && script.includes("react/index.js")) throw new Error("CLI exposed React's CommonJS entry through /@fs");
  process.stdout.write("Baekstage CLI smoke test passed\n");
} finally {
  if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
  await rm(root, { recursive: true });
}
