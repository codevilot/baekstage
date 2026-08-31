// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualWorkspace } from "./VisualWorkspace";

const stories = [
  { id: "pages-admin-dashboard--default", sourceId: "current", title: "Pages/Admin/Dashboard", name: "Default", component: "Dashboard", tags: [], previewUrl: "http://story/iframe.html?id=pages-admin-dashboard--default" },
  { id: "components-button--primary", sourceId: "current", title: "Components/Button", name: "Primary", component: "Button", tags: [], previewUrl: "http://story/iframe.html?id=components-button--primary" },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("VisualWorkspace story explorer", () => {
  it("keeps code changes separate and captures only the selected story on demand", async () => {
    let captures = 0;
    let changedFileRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/sources")) return Response.json([{ id: "current", url: "http://story", branch: "feature" }]);
      if (url.endsWith("/branches")) return Response.json({ branches: ["feature"], worktrees: [] });
      if (url.endsWith("/commits")) return Response.json([{ sha: "a".repeat(40), shortSha: "aaaaaaa", committedAt: "2026-08-30T00:00:00Z", subject: "Current commit" }, { sha: "b".repeat(40), shortSha: "bbbbbbb", committedAt: "2026-08-29T00:00:00Z", subject: "Previous UI" }]);
      if (url.includes("/changed-files")) { changedFileRequests += 1; return Response.json([{ status: "M", path: "src/Button.tsx" }, { status: "A", path: "src/NewCard.tsx" }]); }
      if (url.includes("/stories?source=current")) return Response.json(stories);
      if (url.includes("/annotations")) return Response.json([]);
      if (url.endsWith("/capture") && init?.body) {
        captures += 1;
        const { storyId } = JSON.parse(String(init.body));
        const added = storyId === "components-button--primary";
        return Response.json({
          build: { id: `build-${storyId}`, repository: "/repo", branch: "feature", createdAt: "2026-08-31T00:00:00Z" },
          storyId,
          initialBaseline: added,
          status: added ? "passed" : "changed",
          diff: { changedPixels: added ? 0 : 12, totalPixels: 100, diffRatio: added ? 0 : 0.12, baselineImage: "/baseline.png", currentImage: "/current.png", diffImage: "/diff.png" },
        });
      }
      return Response.json({ error: `Unexpected request: ${url}` }, { status: 500 });
    }));

    render(<VisualWorkspace/>);
    await screen.findByRole("button", { name: "Pages 1" }, { timeout: 5_000 });
    expect(screen.getAllByRole("option", { name: "bbbbbbb · Previous UI" })).not.toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Components 1" }));
    expect(screen.queryByRole("button", { name: "Default" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Primary" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All 2" }));
    await userEvent.selectOptions(screen.getByLabelText("Changes before source"), "baseline");
    await waitFor(() => expect(screen.getByRole("button", { name: "Show code changes" })).toHaveTextContent("Changes 2"));
    const requestsBeforeReview = changedFileRequests;
    await userEvent.click(screen.getByRole("button", { name: "Show code changes" }));
    expect(screen.getByText("src/Button.tsx")).toBeInTheDocument();
    expect(screen.getByLabelText("Code change M")).toHaveTextContent("M");
    expect(screen.getByLabelText("Code change U")).toHaveTextContent("U");
    await userEvent.click(screen.getByRole("button", { name: "Show code changes" }));

    await userEvent.click(screen.getByRole("button", { name: "Default" }));
    const captureButton = screen.getByRole("button", { name: "Capture" });
    expect(captureButton.previousElementSibling).toHaveTextContent("Annotate");
    await userEvent.click(screen.getByRole("button", { name: "Diff" }));
    await screen.findByText("12.00% changed · red pixels are different");
    expect(captures).toBe(1);
    expect(changedFileRequests).toBe(requestsBeforeReview);
  });
});
