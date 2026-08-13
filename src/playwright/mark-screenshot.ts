export type ScreenshotMark = {
  label: string;
  scenarioId?: string;
  nodeId?: string;
  edgeId?: string;
  fromNodeId?: string;
  toNodeId?: string;
  category?: string;
  branch?: string;
  important?: boolean;
  checkpoint?: boolean;
  fullPage?: boolean;
  target?: string;
};

type PageLike = { screenshot(options?: { fullPage?: boolean }): Promise<Uint8Array> };
type LocatorLike = { screenshot(): Promise<Uint8Array> };
type TestInfoLike = { attach(name: string, options: { body: any; contentType: string }): Promise<void> };

export const SCREENSHOT_MARK_PREFIX = "scenario-graph:";

export function screenshotMarkName(mark: ScreenshotMark) {
  return `${SCREENSHOT_MARK_PREFIX}${encodeURIComponent(JSON.stringify(mark))}`;
}

export function readScreenshotMark(name: string): ScreenshotMark | null {
  if (!name.startsWith(SCREENSHOT_MARK_PREFIX)) return null;
  try { return JSON.parse(decodeURIComponent(name.slice(SCREENSHOT_MARK_PREFIX.length))); }
  catch { return null; }
}

export async function markScreenshot(page: PageLike, testInfo: TestInfoLike, mark: ScreenshotMark) {
  if (!mark.nodeId && !mark.edgeId && !(mark.fromNodeId && mark.toNodeId)) throw new Error("Marked screenshot requires nodeId, edgeId, or fromNodeId/toNodeId");
  const body = await page.screenshot({ fullPage: mark.fullPage ?? true });
  await testInfo.attach(screenshotMarkName(mark), { body, contentType: "image/png" });
}

export async function markElementScreenshot(locator: LocatorLike, testInfo: TestInfoLike, mark: ScreenshotMark) {
  if (!mark.nodeId && !mark.edgeId && !(mark.fromNodeId && mark.toNodeId)) throw new Error("Marked screenshot requires nodeId, edgeId, or fromNodeId/toNodeId");
  const body = await locator.screenshot();
  await testInfo.attach(screenshotMarkName(mark), { body, contentType: "image/png" });
}
