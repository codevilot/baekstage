import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareSchemaSnapshots, parsePostgresDump, SchemaPlatform, SchemaPlatformError } from "./platform";

const dump = (column: string, extra = "") => `--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."users" (
    "user_id" bigint NOT NULL,
    "${column}" text
);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("user_id");
${extra}`;

describe("PostgreSQL schema comparison", () => {
  it("extracts canonical pg_dump tables, columns, and constraints", () => {
    const snapshot = parsePostgresDump("tdp", "HEAD", "abc", dump("login_id"));
    expect(snapshot.objects.map((item) => [item.kind, item.name, item.parent])).toEqual([
      ["constraint", "users users_pkey", "public.users"],
      ["table", "users", undefined],
    ]);
    expect(snapshot.objects.find((item) => item.kind === "table")?.fields?.map((field) => field.name)).toEqual(["user_id", "login_id"]);
  });

  it("reports only semantic additions, removals, modifications, and column changes", () => {
    const before = parsePostgresDump("tdp", "main", "abc", dump("login_id"));
    const after = parsePostgresDump("tdp", "working", "working", dump("email", `
--
-- Name: users_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "users_email_idx" ON "public"."users" USING "btree" ("email");
`));
    const comparison = compareSchemaSnapshots({ id: "tdp", title: "TDP", file: "psql/db.sql", format: "postgres-dump" }, before, after);
    expect(comparison.summary).toEqual({ added: 1, removed: 0, modified: 1, unchanged: 1 });
    expect(comparison.changes.find((item) => item.key === "table:public.users")?.fields).toEqual([
      { name: "email", status: "added", before: undefined, after: "text" },
      { name: "login_id", status: "removed", before: "text", after: undefined },
    ]);
  });

  it("classifies invalid revisions and missing revision files without creating worktrees", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-schema-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root }); execFileSync("git", ["config", "user.name", "Baekstage Test"], { cwd: root });
      await writeFile(path.join(root, "README.md"), "schema fixture"); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-m", "without schema"], { cwd: root, stdio: "ignore" });
      await writeFile(path.join(root, "db.sql"), dump("login_id"));
      const platform = new SchemaPlatform(root, [{ id: "tdp", title: "TDP", file: "db.sql", format: "postgres-dump" }]);

      await expect(platform.compare({ sourceId: "tdp", before: "missing-branch", after: "working" })).rejects.toMatchObject<Partial<SchemaPlatformError>>({ code: "SCHEMA_REFERENCE_NOT_FOUND", status: 404 });
      await expect(platform.compare({ sourceId: "tdp", before: "HEAD", after: "working" })).rejects.toMatchObject<Partial<SchemaPlatformError>>({ code: "SCHEMA_FILE_NOT_FOUND_AT_REFERENCE", status: 404 });
      expect(execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" }).match(/^worktree /gmu)).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("identifies the current branch for Branches comparison defaults", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-schema-refs-"));
    try {
      execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root }); execFileSync("git", ["config", "user.name", "Baekstage Test"], { cwd: root });
      await writeFile(path.join(root, "db.sql"), dump("login_id")); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-m", "schema"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["branch", "feature/schema-review"], { cwd: root });

      const references = await new SchemaPlatform(root, [{ id: "tdp", title: "TDP", file: "db.sql", format: "postgres-dump" }]).references();
      expect(references.currentBranch).toBe("main");
      expect(references.branches).toEqual(["feature/schema-review", "main"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects duplicate source identifiers at startup", () => {
    expect(() => new SchemaPlatform("/tmp", [
      { id: "tdp", title: "One", file: "one.sql", format: "postgres-dump" },
      { id: "tdp", title: "Two", file: "two.sql", format: "postgres-dump" },
    ])).toThrow(expect.objectContaining({ code: "SCHEMA_SOURCE_DUPLICATE" }));
  });

  it("rejects malformed comparison bodies before Git or filesystem access", async () => {
    const platform = new SchemaPlatform("/tmp", []);
    await expect(platform.compare(null)).rejects.toMatchObject({ code: "SCHEMA_REQUEST_INVALID", status: 400 });
  });
});
