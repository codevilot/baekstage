import { test as base, expect } from "@playwright/test";
import { createBaekstageTest } from "../../src/playwright";

const test = createBaekstageTest(base, { scenarioIdFromTest: () => "retry-failed-conversion", exclude: ["**/health", "**/analytics/**"] });

test("observes retry UI network evidence", async ({ page, baekstage }: any) => {
  await page.goto(process.env.BAEKSTAGE_DOGFOOD_URL!);
  await baekstage.step({ id: "click-retry", fromNodeId: "retry-button", toNodeId: "retry-request", edgeId: "retry-button-to-request", operationId: "openapi:task-runner:POST:/conversion/jobs/{id}/retry", caseId: "already-running", sourceId: "task-runner" }, async () => {
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("result")).toContainText("JOB_ALREADY_RUNNING");
  });
});
