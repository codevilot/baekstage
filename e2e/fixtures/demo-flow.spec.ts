import { expect, test } from "@playwright/test";
import { markScreenshot, observeApiScenario } from "../../src/playwright";

const cases = [
  ["C-01", "checkout-success", "Complete checkout", "Cart ready", "Order confirmed"],
  ["C-02", "payment-declined", "Handle a declined payment", "Payment form ready", "Decline message shown"],
  ["C-03", "apply-discount", "Apply a discount code", "Regular price", "Discounted total"],
  ["C-04", "cancel-order", "Cancel an order", "Order processing", "Order cancelled"],
  ["C-05", "restock-item", "Restock an unavailable item", "Out of stock", "Available"],
] as const;

for (const [code, scenarioId, title, before, after] of cases) test(`${code} ${title}`, async ({ page }, testInfo) => {
  await page.setContent(`<style>body{font:16px Arial;background:#f4f6fa;padding:50px}main{max-width:760px;margin:auto;padding:36px;border-radius:20px;background:white;box-shadow:0 15px 50px #ccd3df}button{padding:12px 18px;border:0;border-radius:9px;color:white;background:#2563eb;font-weight:700}.card{margin:22px 0;padding:22px;border-radius:14px;background:#eff6ff;font-size:24px;font-weight:700}</style><main><h1>${title}</h1><p class="card" data-testid="before">${before}</p><button>Apply action</button><p class="card" data-testid="after" hidden>${after}</p><script>document.querySelector('button').onclick=()=>document.querySelector('[data-testid=after]').hidden=false</script></main>`);
  await expect(page.getByTestId("before")).toContainText(before);
  await markScreenshot(page, testInfo, { scenarioId, nodeId: "before", label: before, category: "Before state" });
  await page.getByRole("button", { name: "Apply action" }).click();
  await markScreenshot(page, testInfo, { scenarioId, nodeId: "action", label: "Demo action", category: "Action" });
  await expect(page.getByTestId("after")).toContainText(after);
  await markScreenshot(page, testInfo, { scenarioId, nodeId: "after", label: after, category: "After result", checkpoint: true });
});

test("R-01 Retry a failed export", async ({ page }, testInfo) => {
  const scenarioId = "retry-failed-export";
  const apiOrigin = process.env.BAEKSTAGE_DEMO_API_URL ?? "http://localhost:8080";
  await page.route(`${apiOrigin}/exports/**`, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "EXPORT_ALREADY_RUNNING" }) }));
  const observe = observeApiScenario(page, testInfo, { scenarioId, include: [{ sourceId: "task-runner" }] });
  await page.setContent(`<style>body{font:16px Arial;background:#f4f6fa;padding:50px}main{max-width:760px;margin:auto;padding:36px;border-radius:20px;background:white}.error{padding:18px;border-radius:12px;color:#991b1b;background:#fff1f2}button{padding:12px 20px;border:0;border-radius:9px;color:white;background:#2563eb;font-weight:700}#message{margin-top:20px;padding:16px;border-radius:10px;background:#fffbeb;color:#92400e}</style><main><h1>Demo exports</h1><div class="error"><b>Export failed</b><p>The demo worker did not complete the task.</p></div><button>Retry</button><div id="message" hidden></div><script>document.querySelector('button').onclick=async()=>{const r=await fetch('${apiOrigin}/exports/running-export/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:false})});const b=await r.json();const m=document.querySelector('#message');m.textContent=r.status+' '+b.code;m.hidden=false}</script></main>`);
  await markScreenshot(page, testInfo, { scenarioId, nodeId: "failed-screen", label: "Failed export", category: "Before state" });
  await observe.step({ id: "click-retry", fromNodeId: "retry-button", toNodeId: "retry-request", edgeId: "retry-button-to-request", operationId: "openapi:task-runner:POST:/exports/{id}/retry", caseId: "already-running", sourceId: "task-runner" }, async () => page.getByRole("button", { name: "Retry" }).click());
  await expect(page.locator("#message")).toContainText("409 EXPORT_ALREADY_RUNNING");
  await markScreenshot(page, testInfo, { scenarioId, nodeId: "already-running", label: "Already running response", category: "Error result", checkpoint: true });
  await observe.flush();
});
