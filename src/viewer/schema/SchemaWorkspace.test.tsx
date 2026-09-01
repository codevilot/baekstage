// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchemaWorkspace } from "./SchemaWorkspace";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SchemaWorkspace", () => {
  it("compares HEAD with the working tree and lists semantic changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.endsWith("/sources") ? [{ id: "tdp", title: "TDP PostgreSQL", file: "psql/db.sql", format: "postgres-dump" }]
        : url.endsWith("/references") ? { branches: ["main"], commits: [{ sha: "abc", shortSha: "abc", committedAt: "now", subject: "base" }] }
          : { source: { id: "tdp", title: "TDP PostgreSQL", file: "psql/db.sql" }, before: { sourceId: "tdp", reference: "HEAD", revision: "abc", objects: [] }, after: { sourceId: "tdp", reference: "working", revision: "working tree", objects: [] }, summary: { added: 1, modified: 0, removed: 0, unchanged: 2 }, changes: [{ key: "table:public.jobs", status: "added", fields: [], after: { key: "table:public.jobs", kind: "table", schema: "public", name: "jobs", definition: "CREATE TABLE jobs (id bigint)" } }] };
      return { ok: true, json: async () => body } as Response;
    }));
    render(<SchemaWorkspace/>);
    expect(await screen.findByRole("button", { name: /jobs/u })).toBeTruthy();
    expect(screen.getByLabelText("Before schema reference")).toBeTruthy();
    expect(screen.getByLabelText("After schema reference")).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/schema/compare", expect.objectContaining({ method: "POST" })));
  });
});
