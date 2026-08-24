// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioGraph } from "../../core/types";
import { ScenarioNodePanel } from "./ScenarioNodePanel";

const scenario: ScenarioGraph = {
  id: "operator",
  title: "Create operator",
  nodes: [
    { id: "session", title: "Admin session", kind: "fixture" },
    { id: "manage", title: "Team Manage", kind: "screen" },
    { id: "submit", title: "Submit Operator signup", kind: "action" },
  ],
  edges: [
    { id: "open", source: "session", target: "manage" },
    { id: "create", source: "manage", target: "submit" },
  ],
};

describe("ScenarioNodePanel", () => {
  it("navigates to adjacent scenario steps with buttons and arrow keys", async () => {
    Object.defineProperty(window.HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
    const onSelect = vi.fn();
    render(<ScenarioNodePanel scenario={scenario} node={scenario.nodes[1]} screenshots={[]} onBack={vi.fn()} onSelect={onSelect}/>);
    await userEvent.click(screen.getByRole("button", { name: /다음 단계/ }));
    expect(onSelect).toHaveBeenCalledWith("submit");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenCalledWith("session");
  });
});
