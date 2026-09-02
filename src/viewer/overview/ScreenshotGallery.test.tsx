// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { ScreenshotGallery } from "./ScreenshotGallery";

describe("ScreenshotGallery", () => {
  it("opens the image first and keeps the interactive trace as a separate action", async () => {
    const user = userEvent.setup();
    render(<ScreenshotGallery screenshots={[{
      type: "screenshot",
      label: "Month-close contract boundary",
      url: "/scenario-results/month-close/1.png",
      traceUrl: "/scenario-results/month-close/trace-1.zip",
      nodeId: "issue-contract",
    }]}/>);

    await user.click(screen.getByAltText("Month-close contract boundary"));
    const lightbox = screen.getByRole("dialog", { name: "Month-close contract boundary" });
    expect(lightbox).toBeVisible();
    expect(lightbox).toHaveClass("screenshot-lightbox");
    expect(lightbox.parentElement).toHaveClass("baekstage-portal");
    expect(lightbox).not.toHaveClass("baekstage-portal");
    expect(within(lightbox).getByRole("img", { name: "Month-close contract boundary" })).toHaveAttribute("src", "/scenario-results/month-close/1.png");
    expect(screen.queryByText("Interactive DOM snapshot")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open interactive trace" }));
    expect(screen.getByText("Interactive DOM snapshot")).toBeVisible();
    expect(screen.getByTitle("Playwright trace for Month-close contract boundary")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close trace viewer" }));
    expect(screen.getByRole("dialog", { name: "Month-close contract boundary" })).toBeVisible();
  });

  it("opens a Baekstage DOM snapshot without the Playwright trace viewer", async () => {
    const user = userEvent.setup();
    render(<ScreenshotGallery screenshots={[{
      type: "screenshot",
      label: "Loading skeleton",
      url: "/scenario-results/month-close/1.png",
      domSnapshotUrl: "/scenario-results/month-close/dom-1.html",
      traceUrl: "/scenario-results/month-close/trace-1.zip",
      nodeId: "loading",
    }]}/>);

    await user.click(screen.getByAltText("Loading skeleton"));
    await user.click(within(screen.getByRole("dialog", { name: "Loading skeleton" })).getByRole("button", { name: "Open interactive trace" }));
    expect(screen.getByTitle("DOM snapshot for Loading skeleton")).toHaveAttribute("src", "/scenario-results/month-close/dom-1.html");
  });
});
