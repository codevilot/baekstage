import { expect, test } from "@playwright/test";
import { markScreenshot, observeApiScenario } from "../../src/playwright";

const cases = [
  ["D-01", "sampling-collector", "Sampling 확인 후 Collector KPI 변화", "Collector", "84", "91", "collector-before", "sampling-review", "collector-after"],
  ["J-05", "sampling-curator-good", "Sampling Good Review 후 Curator KPI 변화", "Curator", "76", "83", "curator-before", "sampling-review", "curator-after"],
  ["J-04", "sampling-curator-bad", "Sampling Bad Review 후 KPI 변화", "Curator", "83", "78", "curator-before", "sampling-review", "curator-after"],
  ["A-01", "collector-leave", "Collector KPI에 소급 휴가 적용", "Collector", "96", "92", "kpi-before", "admin-leave", "kpi-after"],
  ["B-02", "curator-leave", "Curator KPI에 소급 휴가 적용", "Curator", "89", "85", "kpi-before", "admin-leave", "kpi-after"],
] as const;

for (const [code, scenarioId, title, role, before, after, beforeNode, actionNode, afterNode] of cases) test(`${code} ${title}`, async ({ page }, testInfo) => {
  await page.setContent(`<style>body{font:16px Arial;background:#f4f6fa;padding:50px}main{max-width:760px;margin:auto;padding:36px;border-radius:20px;background:white;box-shadow:0 15px 50px #ccd3df}button{padding:12px 18px;border:0;border-radius:9px;color:white;background:#2563eb;font-weight:700}.card{margin:22px 0;padding:22px;border-radius:14px;background:#eff6ff;font-size:24px;font-weight:700}</style><main><h1>${title}</h1><p>${role} KPI</p><p class="card" data-testid="before">Before: ${before}%</p><button>Apply scenario</button><p class="card" data-testid="after" hidden>After: ${after}%</p><script>document.querySelector('button').onclick=()=>document.querySelector('[data-testid=after]').hidden=false</script></main>`);
  await expect(page.getByTestId("before")).toContainText(`${before}%`);
  await markScreenshot(page, testInfo, { scenarioId, nodeId: beforeNode, label: `${role} KPI before`, category: "Before state" });
  await page.getByRole("button", { name: "Apply scenario" }).click();
  await markScreenshot(page, testInfo, { scenarioId, nodeId: actionNode, label: "Scenario action", category: "Action" });
  await expect(page.getByTestId("after")).toContainText(`${after}%`);
  await markScreenshot(page, testInfo, { scenarioId, nodeId: afterNode, label: `${role} KPI after`, category: "After result", checkpoint: true });
});

test("R-01 실패한 Dataset 변환 다시 시도", async ({ page }, testInfo) => {
  const scenarioId = "retry-failed-conversion";
  const apiOrigin = process.env.BAEKSTAGE_DEMO_API_URL ?? "http://localhost:8080";
  await page.route(`${apiOrigin}/conversion/jobs/**`, (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "JOB_ALREADY_RUNNING" }) }));
  const observe = observeApiScenario(page, testInfo, { scenarioId, include: [{ sourceId: "dataset-manager" }] });
  await page.setContent(`<style>body{font:16px Arial;background:#f4f6fa;padding:50px}main{max-width:760px;margin:auto;padding:36px;border-radius:20px;background:white}.error{padding:18px;border-radius:12px;color:#991b1b;background:#fff1f2}button{padding:12px 20px;border:0;border-radius:9px;color:white;background:#2563eb;font-weight:700}#message{margin-top:20px;padding:16px;border-radius:10px;background:#fffbeb;color:#92400e}</style><main><h1>Conversion jobs</h1><div class="error"><b>Dataset conversion failed</b><p>Queue worker did not complete the job.</p></div><button>Retry</button><div id="message" hidden></div><script>document.querySelector('button').onclick=async()=>{const r=await fetch('${apiOrigin}/conversion/jobs/running-job/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:false})});const b=await r.json();const m=document.querySelector('#message');m.textContent=r.status+' '+b.code;m.hidden=false}</script></main>`);
  await markScreenshot(page, testInfo, { scenarioId, nodeId: "failed-screen", label: "Failed conversion", category: "Before state" });
  await observe.step({ id: "click-retry", fromNodeId: "retry-button", toNodeId: "retry-request", edgeId: "retry-button-to-request", operationId: "openapi:dataset-manager:POST:/conversion/jobs/{id}/retry", caseId: "already-running", sourceId: "dataset-manager" }, async () => page.getByRole("button", { name: "Retry" }).click());
  await expect(page.locator("#message")).toContainText("409 JOB_ALREADY_RUNNING");
  await markScreenshot(page, testInfo, { scenarioId, nodeId: "already-running", label: "Already running response", category: "Error result", checkpoint: true });
  await observe.flush();
});
