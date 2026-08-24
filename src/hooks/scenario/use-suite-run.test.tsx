// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScenarioGraph, ScenarioRunResult } from "../../core/types";
import { useSuiteRun } from "./use-suite-run";

const scenarios: ScenarioGraph[] = [
  { id: "existing", title: "Existing", source: "existing.spec.ts", nodes: [], edges: [] },
  { id: "new", title: "New", source: "new.spec.ts", nodes: [], edges: [] },
];
const runResult = (scenarioId: string): ScenarioRunResult => ({ runId: `run-${scenarioId}`, origin: "playwright", scenarioId, status: "passed", screenshots: [], output: "", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", nodeResults: [] });

describe("useSuiteRun", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs only scenarios without stored results by default", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method) return url.endsWith("/existing") ? Response.json(runResult("existing")) : new Response(null, { status: 404 });
      return Response.json(runResult("new"));
    });
    vi.stubGlobal("fetch", fetchMock); const onResult = vi.fn();
    const { result } = renderHook(() => useSuiteRun("/api/scenarios", onResult));
    await act(async () => result.current.run(scenarios, "missing"));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => String(url))).toEqual(["/api/scenarios/new/run"]);
    expect(result.current.progress).toMatchObject({ completed: 2, total: 2, skipped: 1, failed: 0 });
  });

  it("reruns every runnable scenario with the all policy", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => init?.method === "POST" ? Response.json(runResult(String(input).includes("existing") ? "existing" : "new")) : Response.json(runResult(String(input).includes("existing") ? "existing" : "new")));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSuiteRun("/api/scenarios", vi.fn()));
    await act(async () => result.current.run(scenarios, "all"));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(result.current.progress.completed).toBe(2);
  });
});
