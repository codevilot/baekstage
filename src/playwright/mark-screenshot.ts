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
export const DOM_SNAPSHOT_MARK_PREFIX = "scenario-dom:";
export const DOM_SNAPSHOT_CONTENT_TYPE = "application/vnd.baekstage.dom-snapshot+json";

export type DomSnapshot = { version: 1; url: string; title: string; html: string };

export function screenshotMarkName(mark: ScreenshotMark) {
  return `${SCREENSHOT_MARK_PREFIX}${encodeURIComponent(JSON.stringify(mark))}`;
}

export function readScreenshotMark(name: string): ScreenshotMark | null {
  if (!name.startsWith(SCREENSHOT_MARK_PREFIX)) return null;
  try { return JSON.parse(decodeURIComponent(name.slice(SCREENSHOT_MARK_PREFIX.length))); }
  catch { return null; }
}

export function domSnapshotMarkName(mark: ScreenshotMark) {
  return `${DOM_SNAPSHOT_MARK_PREFIX}${encodeURIComponent(JSON.stringify(mark))}`;
}

export function readDomSnapshotMark(name: string): ScreenshotMark | null {
  if (!name.startsWith(DOM_SNAPSHOT_MARK_PREFIX)) return null;
  try { return JSON.parse(decodeURIComponent(name.slice(DOM_SNAPSHOT_MARK_PREFIX.length))); }
  catch { return null; }
}

type SnapshotPageLike = PageLike & { evaluate?<Result>(callback: () => Result): Promise<Result> };

async function captureDomSnapshot(page: SnapshotPageLike): Promise<DomSnapshot | undefined> {
  if (!page.evaluate) return undefined;
  return page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const originals = [document.documentElement, ...document.documentElement.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    originals.forEach((original, index) => {
      const copy = copies[index];
      if (!copy) return;
      const sensitive = (value: string | null) => /password|passcode|token|secret|authorization|cookie|session/i.test(value ?? "");
      if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
        copy.setAttribute("value", original.type === "password" || sensitive(original.name) || sensitive(original.id) ? "[REDACTED]" : original.value);
        original.checked ? copy.setAttribute("checked", "") : copy.removeAttribute("checked");
      }
      if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) copy.textContent = sensitive(original.name) || sensitive(original.id) ? "[REDACTED]" : original.value;
      if (original instanceof HTMLOptionElement && copy instanceof HTMLOptionElement) original.selected ? copy.setAttribute("selected", "") : copy.removeAttribute("selected");
      if (original instanceof HTMLDetailsElement && copy instanceof HTMLDetailsElement) original.open ? copy.setAttribute("open", "") : copy.removeAttribute("open");
      for (const attribute of [...copy.attributes]) {
        if (attribute.name.toLowerCase().startsWith("on")) copy.removeAttribute(attribute.name);
        else if (sensitive(attribute.name)) copy.setAttribute(attribute.name, "[REDACTED]");
      }
    });
    clone.querySelectorAll("script,noscript,meta[http-equiv='refresh' i]").forEach((node) => node.remove());
    clone.querySelectorAll("link[rel='stylesheet' i]").forEach((node) => node.remove());
    const css: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      try { css.push([...sheet.cssRules].map((rule) => rule.cssText).join("\n")); }
      catch { /* Cross-origin stylesheets cannot be read and are intentionally omitted. */ }
    }
    const head = clone.querySelector("head") ?? clone.insertBefore(document.createElement("head"), clone.firstChild);
    const base = document.createElement("base"); base.href = location.href; head.prepend(base);
    const style = document.createElement("style"); style.setAttribute("data-baekstage-dom-snapshot", ""); style.textContent = css.join("\n"); head.append(style);
    return { version: 1 as const, url: location.href, title: document.title, html: `<!doctype html>\n${clone.outerHTML}` };
  });
}

export async function markScreenshot(page: SnapshotPageLike, testInfo: TestInfoLike, mark: ScreenshotMark) {
  if (!mark.nodeId && !mark.edgeId && !(mark.fromNodeId && mark.toNodeId)) throw new Error("Marked screenshot requires nodeId, edgeId, or fromNodeId/toNodeId");
  const snapshot = await captureDomSnapshot(page);
  if (snapshot) await testInfo.attach(domSnapshotMarkName(mark), { body: Buffer.from(JSON.stringify(snapshot)), contentType: DOM_SNAPSHOT_CONTENT_TYPE });
  const body = await page.screenshot({ fullPage: mark.fullPage ?? true });
  await testInfo.attach(screenshotMarkName(mark), { body, contentType: "image/png" });
}

export async function markElementScreenshot(locator: LocatorLike, testInfo: TestInfoLike, mark: ScreenshotMark) {
  if (!mark.nodeId && !mark.edgeId && !(mark.fromNodeId && mark.toNodeId)) throw new Error("Marked screenshot requires nodeId, edgeId, or fromNodeId/toNodeId");
  const body = await locator.screenshot();
  await testInfo.attach(screenshotMarkName(mark), { body, contentType: "image/png" });
}
