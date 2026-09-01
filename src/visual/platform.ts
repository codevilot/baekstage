import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { Annotation, AnnotationComment, StorybookStory, VisualBuild, VisualDiff, VisualReview } from "../core/types";
import type { StorybookSourceConfig } from "../config";
import { FileMetadataStore, type MetadataStore } from "./storage";

type CaptureOptions = { viewport?: { width: number; height: number }; deviceScaleFactor?: number; locale?: string; timezoneId?: string; threshold?: number };
type CaptureInput = { sourceId: string; storyId: string; branch?: string; baseBranch?: string; baseSourceId?: string };
type GitState = { repository: string; branch: string; commitSha?: string; workingTreeDirty: boolean; baseCommitSha?: string };
export type RecentCommit = { sha: string; shortSha: string; committedAt: string; subject: string };
const safe = (value: string) => encodeURIComponent(value).replaceAll("%", "_");

function command(cwd: string, args: string[]) {
  return new Promise<string>((resolve, reject) => execFile("git", args, { cwd }, (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}

async function gitState(root: string, baseBranch?: string): Promise<GitState> {
  const repository = await command(root, ["rev-parse", "--show-toplevel"]).catch(() => root);
  const branch = await command(root, ["branch", "--show-current"]).catch(() => "working-tree");
  const commitSha = await command(root, ["rev-parse", "HEAD"]).catch(() => undefined);
  const workingTreeDirty = !!await command(root, ["status", "--porcelain"]).catch(() => "");
  const baseCommitSha = baseBranch ? await command(root, ["merge-base", baseBranch, "HEAD"]).catch(() => undefined) : undefined;
  return { repository, branch: branch || "detached", commitSha, workingTreeDirty, baseCommitSha };
}

export class StorybookVisualPlatform {
  private readonly metadata: MetadataStore;
  constructor(private readonly root: string, private readonly sources: StorybookSourceConfig[], private readonly captureOptions: CaptureOptions = {}, metadata?: MetadataStore) {
    this.metadata = metadata ?? new FileMetadataStore(path.join(root, ".baekstage", "reviews.json"));
  }

  async sourceList() {
    if (!this.sources.length) try { const url = "http://127.0.0.1:6006"; const response = await fetch(`${url}/index.json`, { signal: AbortSignal.timeout(800) }); if (response.ok) this.sources.push({ id: "local-storybook", title: "Local Storybook", url }); } catch {}
    const state = await gitState(this.root); return this.sources.map((source) => ({ ...source, branch: source.branch ?? state.branch, url: source.url.replace(/\/$/, "") }));
  }
  addSource(source: StorybookSourceConfig) { const index = this.sources.findIndex((item) => item.id === source.id); if (index >= 0) this.sources[index] = source; else this.sources.push(source); }
  async recentCommits(limit = 8): Promise<RecentCommit[]> {
    const output = await command(this.root, ["log", `-${Math.max(1, Math.min(limit, 20))}`, "--format=%H%x09%h%x09%cI%x09%s"]).catch(() => "");
    return output.split("\n").filter(Boolean).map((line) => { const [sha, shortSha, committedAt, ...subject] = line.split("\t"); return { sha, shortSha, committedAt, subject: subject.join("\t") }; });
  }
  async changedFiles(base = "HEAD"): Promise<Array<{ status: string; path: string }>> {
    const output = await command(this.root, ["diff", "--name-status", base]).catch(() => "");
    return output.split("\n").filter(Boolean).map((line) => { const [status, ...parts] = line.split("\t"); return { status, path: parts.join("\t") }; });
  }

  async stories(sourceId: string): Promise<StorybookStory[]> {
    const source = this.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error(`Unknown Storybook source: ${sourceId}`);
    const base = source.url.replace(/\/$/, "");
    const response = await fetch(`${base}/index.json`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Storybook index returned HTTP ${response.status}`);
    const document = await response.json() as { entries?: Record<string, { id?: string; title?: string; name?: string; type?: string; tags?: string[] }> };
    return Object.values(document.entries ?? {}).filter((entry) => entry.type === "story").map((entry) => {
      const id = entry.id ?? ""; const title = entry.title ?? "Untitled";
      return { id, sourceId, title, name: entry.name ?? id, component: title.split("/").at(-1) ?? title, tags: entry.tags ?? [], previewUrl: `${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story` };
    }).filter((story) => !!story.id).sort((left, right) => `${left.title}/${left.name}`.localeCompare(`${right.title}/${right.name}`));
  }

  async capture(input: CaptureInput, sharedBrowser?: any) {
    const source = this.sources.find((item) => item.id === input.sourceId);
    if (!source) throw new Error(`Unknown Storybook source: ${input.sourceId}`);
    const state = await gitState(this.root, input.baseBranch);
    const build: VisualBuild = { id: `${Date.now()}-${randomUUID().slice(0, 8)}`, repository: state.repository, branch: input.branch ?? source.branch ?? state.branch, commitSha: state.commitSha, baseBranch: input.baseBranch, baseCommitSha: state.baseCommitSha, workingTreeDirty: state.workingTreeDirty, createdAt: new Date().toISOString() };
    const storyDirectory = path.join(this.root, ".baekstage", "builds", build.id, "stories", safe(input.storyId));
    await mkdir(storyDirectory, { recursive: true });
    const current = path.join(storyDirectory, "current.png"); const baseline = path.join(storyDirectory, "baseline.png"); const diff = path.join(storyDirectory, "diff.png");
    const playwright = await import("@playwright/test").catch(() => { throw new Error("Visual capture requires @playwright/test in the project"); }); const { chromium } = playwright;
    const browser = sharedBrowser ?? await chromium.launch({ headless: true });
    try {
      const screenshot = async (target: StorybookSourceConfig, destination: string) => { const context = await browser.newContext({ viewport: this.captureOptions.viewport ?? { width: 1280, height: 720 }, deviceScaleFactor: this.captureOptions.deviceScaleFactor ?? 1, locale: this.captureOptions.locale ?? "en-US", timezoneId: this.captureOptions.timezoneId ?? "UTC" }); try { const page = await context.newPage(); await page.goto(`${target.url.replace(/\/$/, "")}/iframe.html?id=${encodeURIComponent(input.storyId)}&viewMode=story`, { waitUntil: "networkidle" }); await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" }); await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter((image) => !image.complete).map((image) => new Promise<void>((done) => { image.addEventListener("load", () => done(), { once: true }); image.addEventListener("error", () => done(), { once: true }); }))); }); await page.screenshot({ path: destination, fullPage: true, animations: "disabled" }); } finally { await context.close(); } };
      await screenshot(source, current); const baseSource = input.baseSourceId ? this.sources.find((item) => item.id === input.baseSourceId) : undefined; if (input.baseSourceId && !baseSource) throw new Error(`Unknown before Storybook source: ${input.baseSourceId}`); if (baseSource) await screenshot(baseSource, baseline);
    } finally { if (!sharedBrowser) await browser.close(); }
    let initialBaseline = false;
    if (!input.baseSourceId) {
      const baselineRoot = path.join(this.root, ".baekstage", "baselines", safe(build.branch)); const baselineSource = path.join(baselineRoot, `${safe(input.storyId)}.png`); await mkdir(baselineRoot, { recursive: true });
      if (!existsSync(baselineSource)) { const inherited = input.baseBranch ? path.join(this.root, ".baekstage", "baselines", safe(input.baseBranch), `${safe(input.storyId)}.png`) : undefined; await copyFile(inherited && existsSync(inherited) ? inherited : current, baselineSource); initialBaseline = true; }
      await copyFile(baselineSource, baseline);
    }
    const comparison = await compareImages(baseline, current, diff, this.captureOptions.threshold ?? 0.1);
    await writeFile(path.join(storyDirectory, "result.json"), JSON.stringify({ build, storyId: input.storyId, sourceId: input.sourceId, initialBaseline, ...comparison }, null, 2));
    await writeFile(path.join(this.root, ".baekstage", "builds", build.id, "metadata.json"), JSON.stringify(build, null, 2));
    const asset = (name: string) => `/baekstage-assets/builds/${build.id}/stories/${safe(input.storyId)}/${name}.png`;
    return { build, storyId: input.storyId, initialBaseline, status: comparison.changedPixels ? "changed" : "passed", diff: { ...comparison, baselineImage: asset("baseline"), currentImage: asset("current"), diffImage: asset("diff") } satisfies VisualDiff };
  }

  async captureMany(inputs: CaptureInput[], concurrency = 4) {
    const playwright = await import("@playwright/test").catch(() => { throw new Error("Visual capture requires @playwright/test in the project"); });
    const browser = await playwright.chromium.launch({ headless: true });
    const results: Array<Awaited<ReturnType<StorybookVisualPlatform["capture"]>> | { error: string }> = new Array(inputs.length);
    let cursor = 0;
    const worker = async () => { while (true) { const index = cursor++; if (index >= inputs.length) return; try { results[index] = await this.capture(inputs[index], browser); } catch (error) { results[index] = { error: error instanceof Error ? error.message : String(error) }; } } };
    try { await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, inputs.length || 1)) }, worker)); } finally { await browser.close(); }
    return results;
  }

  async approve(storyId: string, buildId: string, branch: string, author?: string) {
    const source = path.join(this.root, ".baekstage", "builds", buildId, "stories", safe(storyId), "current.png");
    if (!existsSync(source)) throw new Error("Visual build does not exist");
    const destination = path.join(this.root, ".baekstage", "baselines", safe(branch), `${safe(storyId)}.png`);
    await mkdir(path.dirname(destination), { recursive: true }); await copyFile(source, destination);
    return this.review({ storyId, buildId, status: "approved", author });
  }

  async review(input: Omit<VisualReview, "updatedAt">) {
    const database = await this.metadata.read(); const value = { ...input, updatedAt: new Date().toISOString() };
    database.reviews = [...database.reviews.filter((item) => !(item.storyId === input.storyId && item.buildId === input.buildId)), value];
    await this.metadata.write(database); return value;
  }

  async annotations(storyId?: string) { const items = (await this.metadata.read()).annotations; return storyId ? items.filter((item) => item.storyId === storyId) : items; }

  async createAnnotation(input: Omit<Annotation, "id" | "createdAt" | "status" | "comments"> & { author?: string }) {
    const database = await this.metadata.read(); const createdAt = new Date().toISOString();
    const item: Annotation = { ...input, id: randomUUID(), status: "open", createdAt, comments: [{ id: randomUUID(), author: input.author ?? "Local user", body: input.comment, createdAt }] };
    database.annotations.push(item); await this.metadata.write(database); return item;
  }

  async updateAnnotation(id: string, input: { status?: "open" | "resolved"; reply?: { body: string; author?: string } }) {
    const database = await this.metadata.read(); const item = database.annotations.find((annotation) => annotation.id === id);
    if (!item) throw new Error("Annotation does not exist");
    if (input.status) item.status = input.status;
    if (input.reply?.body) { const comment: AnnotationComment = { id: randomUUID(), author: input.reply.author ?? "Local user", body: input.reply.body, createdAt: new Date().toISOString() }; item.comments.push(comment); }
    await this.metadata.write(database); return item;
  }
}

export async function compareImages(baselinePath: string, currentPath: string, diffPath: string, threshold = 0.1) {
  const baseline = PNG.sync.read(await readFile(baselinePath)); const current = PNG.sync.read(await readFile(currentPath));
  const width = Math.max(baseline.width, current.width); const height = Math.max(baseline.height, current.height); const totalPixels = width * height;
  if (baseline.width !== current.width || baseline.height !== current.height) {
    const blank = new PNG({ width, height }); const left = new PNG({ width, height }); const right = new PNG({ width, height });
    PNG.bitblt(baseline, left, 0, 0, baseline.width, baseline.height, 0, 0); PNG.bitblt(current, right, 0, 0, current.width, current.height, 0, 0);
    const changedPixels = pixelmatch(left.data, right.data, blank.data, width, height, { threshold, diffMask: true, diffColor: [239, 68, 68] }); await writeFile(diffPath, PNG.sync.write(blank));
    return { changedPixels, totalPixels, diffRatio: totalPixels ? changedPixels / totalPixels : 0 };
  }
  const diff = new PNG({ width, height }); const changedPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, { threshold, diffMask: true, diffColor: [239, 68, 68] }); await writeFile(diffPath, PNG.sync.write(diff));
  return { changedPixels, totalPixels, diffRatio: totalPixels ? changedPixels / totalPixels : 0 };
}

export async function listGitWorktrees(root: string) {
  const output = await command(root, ["worktree", "list", "--porcelain"]).catch(() => "");
  const blocks = output.split(/\n\n+/).filter(Boolean);
  return Promise.all(blocks.map(async (block) => { const lines = block.split("\n"); const directory = lines.find((line) => line.startsWith("worktree "))?.slice(9) ?? ""; const branch = lines.find((line) => line.startsWith("branch "))?.replace("branch refs/heads/", "") ?? "detached"; const dirty = !!await command(directory, ["status", "--porcelain"]).catch(() => ""); return { directory, branch, dirty, managed: directory.startsWith(path.join(root, ".baekstage", "worktrees")) }; }));
}

async function availablePort(start = 6006) {
  for (let port = start; port < start + 100; port += 1) { const free = await new Promise<boolean>((resolve) => { const server = net.createServer(); server.once("error", () => resolve(false)); server.listen(port, "127.0.0.1", () => server.close(() => resolve(true))); }); if (free) return port; }
  throw new Error("No Storybook port is available");
}

async function packageManager(directory: string) {
  let hasStorybookScript = false;
  try { hasStorybookScript = typeof JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).scripts?.storybook === "string"; } catch {}
  if (existsSync(path.join(directory, "pnpm-lock.yaml"))) return hasStorybookScript ? { name: "pnpm", command: "pnpm", args: ["storybook"] } : { name: "pnpm", command: "pnpm", args: ["exec", "storybook", "dev"] };
  if (existsSync(path.join(directory, "yarn.lock"))) return hasStorybookScript ? { name: "yarn", command: "yarn", args: ["storybook"] } : { name: "yarn", command: "yarn", args: ["exec", "storybook", "dev"] };
  if (existsSync(path.join(directory, "bun.lockb")) || existsSync(path.join(directory, "bun.lock"))) return hasStorybookScript ? { name: "bun", command: "bun", args: ["run", "storybook"] } : { name: "bun", command: "bun", args: ["x", "storybook", "dev"] };
  return hasStorybookScript ? { name: "npm", command: "npm", args: ["run", "storybook", "--"] } : { name: "npm", command: "npm", args: ["exec", "--", "storybook", "dev"] };
}

export class WorktreeStorybookManager {
  private readonly detachedPreviews = new Map<string, string>();
  private readonly processes = new Map<string, { child: ChildProcess; url: string; port: number }>();
  constructor(private readonly root: string) {}
  private async projectDirectory(worktreeRoot: string) {
    const projectRelativePath = (await command(this.root, ["rev-parse", "--show-prefix"])).replace(/\/$/, "");
    let directory = projectRelativePath ? path.join(worktreeRoot, projectRelativePath) : worktreeRoot;
    // Monorepos may run Baekstage from the repository root while Storybook lives
    // in a child app (for example `tdp-web/.storybook`). Resolve that app in the
    // worktree instead of launching Storybook from the repository root.
    if (!existsSync(path.join(directory, ".storybook")) && existsSync(path.join(directory, "tdp-web", "package.json"))) directory = path.join(directory, "tdp-web");
    if (!existsSync(path.join(directory, "package.json"))) throw new Error(`Storybook project was not found in ${directory}`);
    return directory;
  }
  private async ensureDependencies(directory: string) {
    const nodeModules = path.join(directory, "node_modules");
    if (existsSync(path.join(nodeModules, ".bin", "storybook"))) return true;
    const sourceDirectory = await this.projectDirectory(this.root);
    const dependencyCandidates = [path.join(sourceDirectory, "node_modules"), path.join(this.root, "node_modules")];
    const dependencyRoot = dependencyCandidates.find((candidate) => path.resolve(candidate) !== path.resolve(nodeModules) && existsSync(path.join(candidate, ".bin", "storybook")));
    if (!dependencyRoot) return false;
    const existing = await lstat(nodeModules).catch(() => undefined);
    // Never replace a real dependency directory: it may contain branch-specific
    // installs. A missing or stale symlink is safe to recreate from the primary
    // checkout, which is how managed revision worktrees are prepared as well.
    if (existing && !existing.isSymbolicLink()) return false;
    if (existing) await unlink(nodeModules);
    await symlink(dependencyRoot, nodeModules, "junction");
    return existsSync(path.join(nodeModules, ".bin", "storybook"));
  }
  private async describeWorktree(worktreeRoot: string, branch: string, managed: boolean) {
    const directory = await this.projectDirectory(worktreeRoot); const manager = await packageManager(directory);
    return { directory, worktreeRoot, branch, packageManager: manager.name, dependenciesInstalled: await this.ensureDependencies(directory), managed };
  }
  private async releaseLegacyBranchLocks() {
    const legacy = (await listGitWorktrees(this.root)).filter((item) => item.managed && item.branch !== "detached" && !item.dirty);
    for (const item of legacy) {
      await this.stop(item.branch);
      await command(this.root, ["worktree", "remove", item.directory]);
    }
  }
  async branches() { await this.releaseLegacyBranchLocks(); const output = await command(this.root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]); return output.split("\n").filter(Boolean); }
  async commits(limit = 20) { const output = await command(this.root, ["log", `-${limit}`, "--pretty=format:%H%x09%h%x09%cI%x09%s"]); return output.split("\n").filter(Boolean).map((line) => { const [sha, shortSha, committedAt, ...subject] = line.split("\t"); return { sha, shortSha, committedAt, subject: subject.join("\t") }; }); }
  async create(branch: string) {
    if (!(await this.branches()).includes(branch)) throw new Error("Branch does not exist");
    const sha = await command(this.root, ["rev-parse", "--verify", `${branch}^{commit}`]);
    const worktreeRoot = path.join(this.root, ".baekstage", "worktrees", "previews", `${safe(branch)}-${sha.slice(0, 12)}`);
    const resolved = path.resolve(worktreeRoot); const managedRoot = path.resolve(this.root, ".baekstage", "worktrees", "previews");
    if (!resolved.startsWith(`${managedRoot}${path.sep}`)) throw new Error("Unsafe worktree path");
    if (!existsSync(worktreeRoot)) { await mkdir(path.dirname(worktreeRoot), { recursive: true }); await command(this.root, ["worktree", "add", "--detach", worktreeRoot, sha]); }
    this.detachedPreviews.set(branch, worktreeRoot);
    return this.describeWorktree(worktreeRoot, branch, true);
  }
  async start(branch: string) {
    const worktree = await this.create(branch); return this.launch(`branch:${branch}`, worktree);
  }
  async startRevision(reference = "HEAD") {
    const sha = await command(this.root, ["rev-parse", "--verify", `${reference}^{commit}`]); const worktreeRoot = path.join(this.root, ".baekstage", "worktrees", "revisions", sha.slice(0, 12)); const managedRoot = path.join(this.root, ".baekstage", "worktrees", "revisions"); if (!path.resolve(worktreeRoot).startsWith(`${path.resolve(managedRoot)}${path.sep}`)) throw new Error("Unsafe revision worktree path");
    if (!existsSync(worktreeRoot)) { await mkdir(path.dirname(worktreeRoot), { recursive: true }); await command(this.root, ["worktree", "add", "--detach", worktreeRoot, sha]); }
    const worktree = await this.describeWorktree(worktreeRoot, `${reference}@${sha.slice(0, 7)}`, true);
    const result = await this.launch(`revision:${sha}`, worktree); return { ...result, sha, reference };
  }
  private async launch(key: string, worktree: { directory: string; worktreeRoot?: string; branch: string; packageManager: string; dependenciesInstalled: boolean; managed?: boolean }) {
    const existing = this.processes.get(key); if (existing && existing.child.exitCode === null) return { ...worktree, url: existing.url, port: existing.port };
    if (!worktree.dependenciesInstalled) throw new Error(`Dependencies are not installed in ${worktree.directory}`);
    const manager = await packageManager(worktree.directory); const port = await availablePort(); const child = spawn(manager.command, [...manager.args, "--port", String(port), "--host", "127.0.0.1"], { cwd: worktree.directory, env: { ...process.env, BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"] });
    let processOutput = ""; let processError = "";
    const appendOutput = (chunk: unknown) => { processOutput = `${processOutput}${String(chunk)}`.slice(-6000); };
    child.stdout?.on("data", appendOutput); child.stderr?.on("data", appendOutput); child.once("error", (reason) => { processError = reason.message; });
    const url = `http://127.0.0.1:${port}`; const deadline = Date.now() + 60_000;
    const failure = (summary: string) => new Error(`${summary}${processError || processOutput.trim() ? `\n\n${processError || processOutput.trim()}` : ""}`);
    this.processes.set(key, { child, url, port }); while (Date.now() < deadline) { if (processError) throw failure("Storybook could not be started"); if (child.exitCode !== null) throw failure(`Storybook exited with code ${child.exitCode}`); try { const response = await fetch(`${url}/index.json`); if (response.ok) return { ...worktree, url, port }; } catch {} await new Promise((resolve) => setTimeout(resolve, 500)); }
    child.kill("SIGTERM"); throw failure("Storybook health check timed out");
  }
  async stop(branch: string) { const key = `branch:${branch}`; const preview = this.processes.get(key); if (preview && preview.child.exitCode === null) preview.child.kill("SIGTERM"); this.processes.delete(key); }
  async remove(branch: string) {
    const directory = this.detachedPreviews.get(branch); if (!directory) throw new Error("Only a Baekstage-managed preview can be removed");
    const dirty = !!await command(directory, ["status", "--porcelain"]).catch(() => ""); if (dirty) throw new Error("Preview has uncommitted changes and was not removed");
    await this.stop(branch); await command(this.root, ["worktree", "remove", directory]); this.detachedPreviews.delete(branch); return { removed: true, directory };
  }
  close() { for (const [key, preview] of this.processes) { if (preview.child.exitCode === null) preview.child.kill("SIGTERM"); this.processes.delete(key); } }
}
