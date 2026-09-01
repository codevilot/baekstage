import { describe, expect, it } from "vitest";
import { compareSchemaSnapshots, parsePostgresDump } from "./platform";

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
});
