import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { StorybookVisualPlatform, WorktreeStorybookManager } from "./platform";

describe("Storybook visual platform", () => {
  let root = ""; let server: Server; let url = "";
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "baekstage-visual-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
    server = createServer((req, res) => {
      if (req.url?.endsWith("/index.json")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ entries: { "button--primary": { id: "button--primary", title: "Components/Button", name: "Primary", type: "story", tags: ["autodocs"] } } })); }
      const color = req.url?.startsWith("/feature/") ? "#dc2626" : "#2563eb";
      res.setHeader("content-type", "text/html"); res.end(`<!doctype html><style>body{margin:0;background:white}button{margin:80px;padding:16px 24px;border:0;border-radius:8px;color:white;background:${color};font:20px sans-serif}</style><button data-testid="submit">Continue</button>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Server address unavailable"); url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

  test("discovers, captures, diffs, reviews, and persists annotation threads", async () => {
    const platform = new StorybookVisualPlatform(root, [{ id: "main", url: `${url}/main`, branch: "main" }, { id: "feature", url: `${url}/feature`, branch: "feature/login" }], { viewport: { width: 500, height: 300 } });
    const stories = await platform.stories("main"); expect(stories[0]).toMatchObject({ id: "button--primary", component: "Button", name: "Primary" });
    const baseline = await platform.capture({ sourceId: "main", storyId: stories[0].id }); expect(baseline.initialBaseline).toBe(true); expect(baseline.diff.changedPixels).toBe(0);
    const changed = await platform.capture({ sourceId: "feature", baseSourceId: "main", storyId: stories[0].id, baseBranch: "main" }); expect(changed.status).toBe("changed"); expect(changed.diff.changedPixels).toBeGreaterThan(0); expect(changed.build.baseBranch).toBe("main");
    const annotation = await platform.createAnnotation({ storyId: stories[0].id, x: .5, y: .5, selector: "[data-testid=submit]", elementPath: "button", comment: "Use the approved token" });
    await platform.updateAnnotation(annotation.id, { reply: { body: "Updated" } }); await platform.updateAnnotation(annotation.id, { status: "resolved" });
    const reloaded = new StorybookVisualPlatform(root, [{ id: "main", url }]); expect((await reloaded.annotations(stories[0].id))[0]).toMatchObject({ status: "resolved", comments: [{ body: "Use the approved token" }, { body: "Updated" }] });
    await platform.approve(stories[0].id, changed.build.id, "feature/login");
    const approvedBytes = await readFile(path.join(root, ".baekstage", "baselines", "feature_2Flogin", "button--primary.png")); expect(approvedBytes.length).toBeGreaterThan(0);
  }, 30_000);
});

describe("worktree Storybook manager", () => {
  test("uses a detached preview so the compared branch remains switchable", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "baekstage-worktree-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repository });
      execFileSync("git", ["config", "user.name", "Baekstage Test"], { cwd: repository });
      await mkdir(path.join(repository, "tdp-web", ".storybook"), { recursive: true });
      await writeFile(path.join(repository, "tdp-web", "package.json"), JSON.stringify({ scripts: { storybook: "storybook dev" } }));
      await writeFile(path.join(repository, "tdp-web", ".storybook", "main.ts"), "export default {};");
      execFileSync("git", ["add", "."], { cwd: repository }); execFileSync("git", ["commit", "-m", "initial"], { cwd: repository, stdio: "ignore" }); execFileSync("git", ["branch", "feature"], { cwd: repository });
      const dependencyRoot = path.join(repository, "tdp-web", "node_modules");
      await mkdir(path.join(dependencyRoot, ".bin"), { recursive: true }); await writeFile(path.join(dependencyRoot, ".bin", "storybook"), "");
      const created = await new WorktreeStorybookManager(repository).create("feature");

      const linked = path.join(created.worktreeRoot!, "tdp-web", "node_modules");
      expect(created.dependenciesInstalled).toBe(true);
      expect((await lstat(linked)).isSymbolicLink()).toBe(true);
      expect(await readlink(linked)).toBe(dependencyRoot);
      expect(execFileSync("git", ["branch", "--show-current"], { cwd: created.worktreeRoot!, encoding: "utf8" }).trim()).toBe("");
      execFileSync("git", ["switch", "feature"], { cwd: repository, stdio: "ignore" });
      expect(execFileSync("git", ["branch", "--show-current"], { cwd: repository, encoding: "utf8" }).trim()).toBe("feature");
    } finally { await rm(repository, { recursive: true, force: true }); }
  });

  test("releases clean legacy branch worktrees before listing previews", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "baekstage-legacy-worktree-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repository });
      execFileSync("git", ["config", "user.name", "Baekstage Test"], { cwd: repository });
      await writeFile(path.join(repository, "README.md"), "fixture");
      execFileSync("git", ["add", "."], { cwd: repository }); execFileSync("git", ["commit", "-m", "initial"], { cwd: repository, stdio: "ignore" }); execFileSync("git", ["branch", "feature"], { cwd: repository });
      const legacy = path.join(repository, ".baekstage", "worktrees", "feature"); await mkdir(path.dirname(legacy), { recursive: true }); execFileSync("git", ["worktree", "add", legacy, "feature"], { cwd: repository, stdio: "ignore" });

      await new WorktreeStorybookManager(repository).branches();

      expect(existsSync(legacy)).toBe(false);
      execFileSync("git", ["switch", "feature"], { cwd: repository, stdio: "ignore" });
    } finally { await rm(repository, { recursive: true, force: true }); }
  });

  test("preserves dirty and locked legacy worktrees with actionable warnings", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "baekstage-preserved-worktree-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repository }); execFileSync("git", ["config", "user.name", "Baekstage Test"], { cwd: repository });
      await writeFile(path.join(repository, "README.md"), "fixture"); execFileSync("git", ["add", "."], { cwd: repository }); execFileSync("git", ["commit", "-m", "initial"], { cwd: repository, stdio: "ignore" }); execFileSync("git", ["branch", "dirty-preview"], { cwd: repository }); execFileSync("git", ["branch", "locked-preview"], { cwd: repository });
      const dirty = path.join(repository, ".baekstage", "worktrees", "dirty"); const locked = path.join(repository, ".baekstage", "worktrees", "locked"); await mkdir(path.dirname(dirty), { recursive: true });
      execFileSync("git", ["worktree", "add", dirty, "dirty-preview"], { cwd: repository, stdio: "ignore" }); execFileSync("git", ["worktree", "add", locked, "locked-preview"], { cwd: repository, stdio: "ignore" });
      await writeFile(path.join(dirty, "README.md"), "changed"); execFileSync("git", ["worktree", "lock", locked], { cwd: repository, stdio: "ignore" });
      const manager = new WorktreeStorybookManager(repository);

      await manager.branches();

      expect(existsSync(dirty)).toBe(true); expect(existsSync(locked)).toBe(true);
      expect(manager.warnings()).toEqual(expect.arrayContaining([expect.stringContaining("dirty-preview: working changes preserved"), expect.stringContaining("locked-preview: locked")]));
    } finally { await rm(repository, { recursive: true, force: true }); }
  });
});
