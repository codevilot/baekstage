// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ScenarioSuite } from "../core/types";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const suite: ScenarioSuite = { name: "baekstage", scenarios: [] };

describe("WorkspaceSidebar suite execution", () => {
  afterEach(cleanup);

  it("asks how existing results should be handled before running the suite", async () => {
    const onPolicy = vi.fn();
    const onRunAll = vi.fn();
    render(<WorkspaceSidebar
      suite={suite}
      open
      batch={{ policy: "missing", running: false, progress: { completed: 0, total: 0, failed: 0, skipped: 0 } }}
      onPolicy={onPolicy}
      onRunAll={onRunAll}
      onStop={vi.fn()}
      onToggle={vi.fn()}
      onResize={vi.fn()}
      onSelect={vi.fn()}
    />);

    await userEvent.click(screen.getByRole("button", { name: "전체 실행" }));
    expect(onRunAll).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "전체 실행 범위를 확인해 주세요" })).toBeVisible();

    await userEvent.click(screen.getByRole("radio", { name: /전체 다시 실행/ }));
    await userEvent.click(screen.getByRole("button", { name: "적용 후 실행" }));

    expect(onPolicy).toHaveBeenCalledWith("all");
    expect(onRunAll).toHaveBeenCalledWith("all");
    expect(screen.queryByRole("dialog", { name: "전체 실행 범위를 확인해 주세요" })).not.toBeInTheDocument();
  });
});
