import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Annotation,
  StorybookStory,
  TestResult,
  VisualBuild,
  VisualDiff,
} from "../../core/types";

type Source = { id: string; url: string; title?: string; branch?: string };
type Branches = {
  branches: string[];
  worktrees: Array<{
    directory: string;
    branch: string;
    dirty: boolean;
    managed: boolean;
  }>;
};
type Capture = {
  build: VisualBuild;
  storyId: string;
  initialBaseline: boolean;
  status: "passed" | "changed";
  diff: VisualDiff;
};
type Mode = "base" | "compare" | "side" | "diff";
type ComparisonKind = "changes" | "branches";
type StoryChange = "added" | "modified" | "removed" | "unchanged";
type Commit = {
  sha: string;
  shortSha: string;
  committedAt: string;
  subject: string;
};
const EMPTY_RELATED_STORY_IDS: string[] = [];
const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
};
const diffPercent = (ratio: number) => {
  const percent = ratio * 100;
  return percent > 0 && percent < 0.01 ? "<0.01%" : `${percent.toFixed(2)}%`;
};

function selectorFor(element: Element) {
  const annotated = element.closest(
    "[data-baekstage-id],[data-testid],[data-test-id]",
  );
  if (annotated)
    for (const key of ["data-baekstage-id", "data-testid", "data-test-id"]) {
      const value = annotated.getAttribute(key);
      if (value) return `[${key}="${CSS.escape(value)}"]`;
    }
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 5) {
    const siblings = current.parentElement
      ? [...current.parentElement.children].filter(
          (item) => item.tagName === current!.tagName,
        )
      : [];
    parts.unshift(
      `${current.tagName.toLowerCase()}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ""}`,
    );
    current = current.parentElement;
  }
  return parts.join(" > ");
}

export function VisualWorkspace({
  storybookEndpoint = "/api/storybook",
  reviewEndpoint = "/api/reviews",
  relatedStoryIds = EMPTY_RELATED_STORY_IDS,
  onResult,
}: {
  storybookEndpoint?: string;
  reviewEndpoint?: string;
  relatedStoryIds?: string[];
  onResult?: (result: TestResult) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [workingSourceId, setWorkingSourceId] = useState("");
  const [compareSourceId, setCompareSourceId] = useState("");
  const [stories, setStories] = useState<StorybookStory[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [titleFilter, setTitleFilter] = useState("all");
  const [changeFilter, setChangeFilter] = useState<"all" | "changes">("all");
  const [mode, setMode] = useState<Mode>("compare");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [annotating, setAnnotating] = useState(false);
  const [captureProgress, setCaptureProgress] = useState<{ done: number; total: number } | null>(null);
  const [removedStories, setRemovedStories] = useState<StorybookStory[]>([]);
  const [storyChanges, setStoryChanges] = useState<Record<string, StoryChange>>(
    {},
  );
  const [comparisonKind, setComparisonKind] =
    useState<ComparisonKind>("changes");
  const [changeReference, setChangeReference] = useState("HEAD");
  const [commits, setCommits] = useState<Commit[]>([]);
  const [changedFiles, setChangedFiles] = useState<Array<{ status: string; path: string }>>([]);
  const [branches, setBranches] = useState<Branches>({
    branches: [],
    worktrees: [],
  });
  const iframe = useRef<HTMLIFrameElement>(null);
  const source = sources.find((item) => item.id === sourceId);
  const compareSource = sources.find((item) => item.id === compareSourceId);
  const story = stories.find((item) => item.id === selectedId);
  useEffect(() => {
    request<Source[]>(`${storybookEndpoint}/sources`)
      .then((items) => {
        setSources(items);
        setSourceId(items[0]?.id ?? "");
        setWorkingSourceId(items[0]?.id ?? "");
        setCompareSourceId(items[0]?.id ?? "");
      })
      .catch((reason) => setError(reason.message));
  }, [storybookEndpoint]);
  useEffect(() => { request<Array<{ status: string; path: string }>>(`${storybookEndpoint}/changed-files?base=${encodeURIComponent(changeReference === "baseline" ? "HEAD" : changeReference)}`).then(setChangedFiles).catch(() => {}); }, [changeReference, storybookEndpoint]);
  useEffect(() => {
    request<Branches>(`${storybookEndpoint}/branches`)
      .then(setBranches)
      .catch(() => {});
  }, [storybookEndpoint]);
  useEffect(() => {
    request<Commit[]>(`${storybookEndpoint}/commits`)
      .then(setCommits)
      .catch(() => {});
  }, [storybookEndpoint]);
  useEffect(() => {
    if (!sourceId) return;
    setError("");
    request<StorybookStory[]>(
      `${storybookEndpoint}/stories?source=${encodeURIComponent(sourceId)}`,
    )
      .then((items) => {
        setStories(items);
        setStoryChanges({});
        setRemovedStories([]);
        setSelectedId((current) =>
          items.some((item) => item.id === current)
            ? current
            : (relatedStoryIds.find((id) =>
                items.some((item) => item.id === id),
              ) ??
              items[0]?.id ??
              ""),
        );
      })
      .catch((reason) => setError(reason.message));
  }, [relatedStoryIds, sourceId, storybookEndpoint]);
  useEffect(() => {
    if (!selectedId) return;
    request<Annotation[]>(
      `${reviewEndpoint}/annotations?storyId=${encodeURIComponent(selectedId)}`,
    )
      .then(setAnnotations)
      .catch(() => {});
  }, [reviewEndpoint, selectedId]);
  useEffect(() => {
    setStoryChanges({});
  }, [changeReference, compareSourceId, comparisonKind]);
  const titleGroups = useMemo(() => {
    const counts = new Map<string, number>();
    stories.forEach((item) => {
      const title = item.title.split("/")[0] || "Untitled";
      counts.set(title, (counts.get(title) ?? 0) + 1);
    });
    return [...counts].sort(([left], [right]) => left.localeCompare(right));
  }, [stories]);
  useEffect(() => {
    if (
      titleFilter !== "all" &&
      !titleGroups.some(([title]) => title === titleFilter)
    )
      setTitleFilter("all");
  }, [titleFilter, titleGroups]);
  const grouped = useMemo(() => {
    const result = new Map<string, StorybookStory[]>();
    stories
      .filter(
        (item) =>
          titleFilter === "all" || item.title.split("/")[0] === titleFilter,
      )
      .filter(
        (item) => changeFilter === "all" || Boolean(storyChanges[item.id]),
      )
      .filter((item) =>
        `${item.title} ${item.name} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .forEach((item) =>
        result.set(item.title, [...(result.get(item.title) ?? []), item]),
      );
    return [...result];
  }, [changeFilter, query, stories, storyChanges, titleFilter]);
  const compareUrl =
    story && compareSource
      ? `${compareSource.url.replace(/\/$/, "")}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`
      : "";
  const currentWorktree = branches.worktrees.find(
    (item) => item.branch === source?.branch,
  );
  const branchLabel = (branch: string) => {
    const worktree = branches.worktrees.find((item) => item.branch === branch);
    return `${branch}${worktree?.dirty ? " · working changes" : worktree ? " · checked out" : ""}`;
  };
  const selectedCommit =
    changeReference === "HEAD"
      ? commits[0]
      : commits.find((item) => item.sha === changeReference);
  const beforeLabel =
    changeReference === "baseline"
      ? "Approved baseline"
      : changeReference === "HEAD"
        ? "Last commit (HEAD)"
        : selectedCommit
          ? `${selectedCommit.shortSha} · ${selectedCommit.subject}`
          : "Preparing revision…";
  const emitResult = (
    value: Capture,
    status: TestResult["status"] = value.status,
  ) =>
    onResult?.({
      id: `visual:${value.build.id}:${value.storyId}`,
      type: "visual",
      status,
      artifacts: [
        {
          label: "Baseline",
          type: "screenshot",
          url: value.diff.baselineImage,
        },
        { label: "Current", type: "screenshot", url: value.diff.currentImage },
        {
          label: "Diff",
          type: "screenshot",
          url: value.diff.diffImage,
          category: "visual-diff",
        },
      ],
      metadata: {
        storyId: value.storyId,
        buildId: value.build.id,
        branch: value.build.branch,
        diffRatio: value.diff.diffRatio,
        changedPixels: value.diff.changedPixels,
      },
    });
  const markAddedStories = async (before: Source) => {
    const previous = await request<StorybookStory[]>(
      `${storybookEndpoint}/stories?source=${encodeURIComponent(before.id)}`,
    );
    const previousIds = new Set(previous.map((item) => item.id));
    setStoryChanges((current) => {
      const next = { ...current };
      stories.forEach((item) => {
        if (!previousIds.has(item.id)) next[item.id] = "added";
      });
      return next;
    });
    setRemovedStories(previous.filter((item) => !stories.some((current) => current.id === item.id)));
  };
  const prepareRevision = async (reference: string) => {
    const sha = reference === "HEAD" ? commits[0]?.sha : reference;
    const ready = sha
      ? sources.find((item) => item.id === `revision:${sha}`)
      : undefined;
    if (ready) {
      await markAddedStories(ready);
      return ready;
    }
    const created = await request<Source>(
      `${storybookEndpoint}/worktrees/start-revision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference }),
      },
    );
    setSources((items) => [
      ...items.filter((item) => item.id !== created.id),
      created,
    ]);
    await markAddedStories(created);
    return created;
  };
  const selectChangeReference = async (reference: string) => {
    setChangeReference(reference);
    setCapture(null);
    if (reference === "baseline") return;
    setBusy(true);
    setError("");
    try {
      await prepareRevision(reference);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const selectAfterReference = async (reference: string) => {
    setCapture(null);
    if (reference === "working") {
      setSourceId(workingSourceId);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const revision = await prepareRevision(reference);
      setSourceId(revision.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const captureStory = async (nextMode: Mode = "diff") => {
    if (!story || !source) return;
    setBusy(true);
    setError("");
    try {
      const before =
        comparisonKind === "branches"
          ? compareSource
          : changeReference !== "baseline"
            ? await prepareRevision(changeReference)
            : undefined;
      if (comparisonKind === "branches" && before)
        await markAddedStories(before);
      const value = await request<Capture>(`${storybookEndpoint}/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: source.id,
          storyId: story.id,
          branch: source.branch,
          baseBranch: before?.branch,
          baseSourceId: before?.id,
        }),
      });
      setCapture(value);
      setStoryChanges((items) => {
        const next = { ...items };
        if (value.initialBaseline) next[value.storyId] = "added";
        else if (value.diff.changedPixels) next[value.storyId] = "modified";
        else delete next[value.storyId];
        return next;
      });
      emitResult(value);
      setMode(nextMode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const captureAllStories = async () => {
    if (!source || !stories.length) return;
    setBusy(true);
    setError("");
    try {
      const before =
        comparisonKind === "branches"
          ? compareSource
          : changeReference !== "baseline"
            ? await prepareRevision(changeReference)
            : undefined;
      setCaptureProgress({ done: 0, total: stories.length });
      const results: Array<Capture | { error: string }> = [];
      let cursor = 0;
      const worker = async () => { while (true) { const index = cursor++; if (index >= stories.length) return; const item = stories[index]; try { results[index] = await request<Capture>(`${storybookEndpoint}/capture`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: source.id, storyId: item.id, branch: source.branch, baseBranch: before?.branch, baseSourceId: before?.id }) }); } catch (error) { results[index] = { error: error instanceof Error ? error.message : String(error) }; } setCaptureProgress((current) => current ? { ...current, done: current.done + 1 } : current); } };
      await Promise.all(Array.from({ length: Math.min(4, stories.length) }, () => worker()));
      setStoryChanges(() =>
        Object.fromEntries(
          results
            .flatMap((result) =>
              "storyId" in result
                ? [
                    [
                      result.storyId,
                      result.initialBaseline
                        ? "added"
                        : result.diff.changedPixels ? "modified" : "unchanged",
                    ],
                  ]
                : [],
            )
            .filter(([, value]) => value),
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      setCaptureProgress(null);
    }
  };
  const decide = async (status: "approved" | "rejected") => {
    if (!capture) return;
    setBusy(true);
    try {
      await request(`${reviewEndpoint}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          storyId: capture.storyId,
          buildId: capture.build.id,
          branch: capture.build.branch,
        }),
      });
      emitResult(capture, status);
      setCapture({
        ...capture,
        status: status === "approved" ? "passed" : "changed",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const annotate = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!story || mode === "diff") return;
    const comment = window.prompt("Comment");
    if (!comment) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    let selector: string | undefined;
    try {
      const frameDocument = iframe.current?.contentDocument;
      const frameBounds = iframe.current?.getBoundingClientRect();
      const element =
        frameDocument && frameBounds
          ? frameDocument.elementFromPoint(
              event.clientX - frameBounds.left,
              event.clientY - frameBounds.top,
            )
          : null;
      if (element) selector = selectorFor(element);
    } catch {}
    const item = await request<Annotation>(`${reviewEndpoint}/annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storyId: story.id,
        branch: source?.branch,
        buildId: capture?.build.id,
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
        selector,
        elementPath: selector,
        comment,
      }),
    });
    setAnnotations((items) => [...items, item]);
  };
  const updateAnnotation = async (
    item: Annotation,
    input: { status?: "open" | "resolved"; reply?: { body: string } },
  ) => {
    const updated = await request<Annotation>(
      `${reviewEndpoint}/annotations/${encodeURIComponent(item.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    setAnnotations((items) =>
      items.map((candidate) =>
        candidate.id === updated.id ? updated : candidate,
      ),
    );
  };
  const prepareBranch = async (branch: string, target: "base" | "compare") => {
    const ready = sources.find((item) => item.branch === branch);
    if (ready) {
      if (target === "base") setCompareSourceId(ready.id);
      else setSourceId(ready.id);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await request<Source>(
        `${storybookEndpoint}/worktrees/start`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ branch }),
        },
      );
      setSources((items) => [
        ...items.filter((item) => item.id !== created.id),
        created,
      ]);
      if (target === "base") setCompareSourceId(created.id);
      else setSourceId(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review-workspace">
      {captureProgress && <div className="capture-progress" role="status">Capturing stories… {captureProgress.done}/{captureProgress.total}</div>}
      {busy && (
        <div className="review-loading-scrim" aria-label="Updating story list">
          <span />
          <span />
          <span />
        </div>
      )}
      <label className="after-reference-control">
        After
        <select
          aria-label="After source"
          disabled={busy}
          value={
            sourceId === workingSourceId
              ? "working"
              : sourceId.startsWith("revision:")
                ? sourceId.slice("revision:".length)
                : "working"
          }
          onChange={(event) => void selectAfterReference(event.target.value)}
        >
          <option value="working">Current working tree</option>
          {commits.map((commit) => (
            <option value={commit.sha} key={commit.sha}>
              {commit.shortSha} · {commit.subject}
            </option>
          ))}
        </select>
      </label>
      <button
        className="capture-all-stories"
        onClick={() => void captureAllStories()}
        disabled={busy || !stories.length}
      >
        Capture all stories
      </button>
      <aside className="component-explorer">
        <header>
          <div>
            <span className="eyebrow">Explorer</span>
            <h2>Stories</h2>
          </div>
          <button
            className={`explorer-changes-toggle ${changeFilter === "changes" ? "active" : ""}`}
            aria-label="Show changed stories"
            aria-pressed={changeFilter === "changes"}
            onClick={() => setChangeFilter((value) => value === "changes" ? "all" : "changes")}
          >
            Changes <span>{Object.keys(storyChanges).length}</span>
          </button>
        </header>
        <div className="preview-branch">
          <i />
          <span>
            <small>
              Preview branch
            </small>
            <strong>{source?.branch ?? "Detecting branch…"}</strong>
          </span>
          <b>{busy ? "Preparing…" : changedFiles.length ? `${changedFiles.length} files changed` : "Ready"}</b>
        </div>
        <input
          aria-label="Search stories"
          placeholder="Search stories"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav
          className="story-title-filters"
          aria-label="Filter stories by title"
        >
          <button
            className={titleFilter === "all" ? "active" : ""}
            aria-pressed={titleFilter === "all"}
            onClick={() => setTitleFilter("all")}
          >
            All <span>{stories.length}</span>
          </button>
          {titleGroups.map(([title, count]) => (
            <button
              className={titleFilter === title ? "active" : ""}
              aria-pressed={titleFilter === title}
              onClick={() => setTitleFilter(title)}
              key={title}
            >
              {title} <span>{count}</span>
            </button>
          ))}
        </nav>
        <nav tabIndex={0} aria-label="Story list">
          {grouped.map(([title, items]) => {
            const [section, ...path] = title.split("/");
            return (
              <section key={title}>
                <strong title={title}>
                  <small>{section}</small>
                  <span>{path.join(" / ") || section}</span>
                </strong>
                {items.map((item) => {
                  const change = storyChanges[item.id];
                  return (
                    <button
                      title={`${item.title} / ${item.name}${change === "added" ? " · New" : change === "modified" ? " · Modified" : ""}`}
                      className={[
                        item.id === selectedId ? "active" : "",
                        change ?? "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        setSelectedId(item.id);
                        setCapture(null);
                        setMode("compare");
                      }}
                      key={item.id}
                    >
                      <span>{item.name}</span>
                      <span className="story-badges">
                        {relatedStoryIds.includes(item.id) && <i>linked</i>}
                        {change && (
                          <b
                            aria-label={
                              change === "added"
                                ? "New story"
                                : "Modified story"
                            }
                          >
                            {change === "added" ? "U" : "M"}
                          </b>
                        )}
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
          {removedStories.length > 0 && <section className="removed-stories"><strong><small>Removed</small><span>Stories no longer in After</span></strong>{removedStories.map((item) => <button className="removed" key={item.id} onClick={() => setSelectedId(item.id)}><span>{item.name}</span><span className="story-badges"><b aria-label="Removed story">R</b></span></button>)}</section>}
        </nav>
      </aside>
      <section className="review-stage">
        <header>
          <div>
            <span className="eyebrow">
              {source?.branch ?? source?.title ?? "Storybook"}
            </span>
            <h2>
              {story ? `${story.title} / ${story.name}` : "Select a story"}
            </h2>
          </div>
          <div className="stage-actions">
            <button
              className={annotating ? "active" : ""}
              onClick={() => setAnnotating((value) => !value)}
              disabled={!story}
            >
              {annotating ? "Click preview to pin" : "Annotate"}
            </button>
          </div>
        </header>
        <div className="comparison-setup">
          <nav aria-label="Comparison type">
            <button
              className={comparisonKind === "changes" ? "active" : ""}
              onClick={() => {
                setComparisonKind("changes");
                setCapture(null);
                setMode("compare");
              }}
            >
              Changes
            </button>
            <button
              className={comparisonKind === "branches" ? "active" : ""}
              onClick={() => {
                setComparisonKind("branches");
                setCapture(null);
                setMode("side");
              }}
            >
              Branches
            </button>
          </nav>
          {comparisonKind === "changes" ? (
            <div className="change-compare">
              <article>
                <small>Before</small>
                <strong title={beforeLabel}>{beforeLabel}</strong>
                <span>
                  {changeReference === "baseline"
                    ? `${source?.branch} · approved`
                    : selectedCommit
                      ? new Date(selectedCommit.committedAt).toLocaleString()
                      : `${source?.branch} · revision`}
                </span>
                <select
                  aria-label="Changes before source"
                  disabled={busy}
                  value={changeReference}
                  onChange={(event) =>
                    void selectChangeReference(event.target.value)
                  }
                >
                  <option value="HEAD">HEAD · Last commit</option>
                  {commits.slice(1).map((commit) => (
                    <option value={commit.sha} key={commit.sha}>
                      {commit.shortSha} · {commit.subject}
                    </option>
                  ))}
                  <option value="baseline">Approved baseline</option>
                </select>
              </article>
              <b>→</b>
              <article>
                <small>After</small>
                <strong>Current working tree</strong>
                <span>
                  {source?.branch}
                  {currentWorktree?.dirty
                    ? " · uncommitted changes"
                    : " · clean"}
                </span>
              </article>
            </div>
          ) : (
            <div className="branch-compare">
              <label>
                Before
                <select
                  disabled={busy}
                  value={compareSource?.branch ?? ""}
                  onChange={(event) =>
                    void prepareBranch(event.target.value, "base")
                  }
                >
                  {branches.branches.map((branch) => (
                    <option value={branch} key={branch}>
                      {branchLabel(branch)}
                    </option>
                  ))}
                </select>
              </label>
              <span>vs</span>
              <label>
                After
                <select
                  disabled={busy}
                  value={source?.branch ?? ""}
                  onChange={(event) =>
                    void prepareBranch(event.target.value, "compare")
                  }
                >
                  {branches.branches.map((branch) => (
                    <option value={branch} key={branch}>
                      {branchLabel(branch)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
        <nav className="review-modes">
          {(["base", "compare", "side", "diff"] as const).map((item) => (
            <button
              className={mode === item ? "active" : ""}
              disabled={
                busy ||
                (comparisonKind === "changes" && item === "base" && !capture)
              }
              onClick={() => {
                if (item === "diff" && !capture) void captureStory("diff");
                else if (
                  item === "side" &&
                  comparisonKind === "changes" &&
                  !capture
                )
                  void captureStory("side");
                else setMode(item);
              }}
              key={item}
            >
              {item === "base"
                ? "Before"
                : item === "compare"
                  ? "After"
                  : item === "side"
                    ? "Side by side"
                    : busy
                      ? "Preparing…"
                      : "Diff"}
            </button>
          ))}
        </nav>
        {error && <p className="review-error">{error}</p>}
        <div className={`story-frame mode-${mode}`}>
          {mode === "diff" && capture ? (
            <div
              className={`diff-view ${capture.diff.changedPixels ? "has-changes" : "no-changes"}`}
            >
              <img
                className="diff-context"
                src={capture.diff.currentImage}
                alt="Current UI context"
              />
              <img
                className="diff-mask"
                src={capture.diff.diffImage}
                alt="Changed pixels highlighted in red"
              />
              <span>
                {capture.diff.changedPixels
                  ? `${diffPercent(capture.diff.diffRatio)} changed · red pixels are different`
                  : "No visual changes"}
              </span>
            </div>
          ) : mode === "side" ? (
            capture ? (
              <>
                <img src={capture.diff.baselineImage} alt="Before" />
                <img src={capture.diff.currentImage} alt="After" />
              </>
            ) : comparisonKind === "branches" ? (
              <>
                <iframe title="Before story" src={compareUrl} />
                <iframe
                  ref={iframe}
                  title="After story"
                  src={story?.previewUrl}
                />
              </>
            ) : (
              <>
                <div className="before-placeholder">
                  <strong>Before</strong>
                  <span>
                    {changeReference === "baseline"
                      ? "Compare changes to load the approved baseline"
                      : `Compare changes to load ${beforeLabel}`}
                  </span>
                </div>
                <iframe
                  ref={iframe}
                  title="After story"
                  src={story?.previewUrl}
                />
              </>
            )
          ) : capture ? (
            <img
              src={
                mode === "base"
                  ? capture.diff.baselineImage
                  : capture.diff.currentImage
              }
              alt={mode === "base" ? "Before" : "After"}
            />
          ) : mode === "base" && comparisonKind === "changes" ? (
            <div className="before-placeholder">
              <strong>Before</strong>
              <span>
                {changeReference === "baseline"
                  ? "Compare changes to load the approved baseline"
                  : `Compare changes to load ${beforeLabel}`}
              </span>
            </div>
          ) : (
            <iframe
              ref={iframe}
              title={`${mode} story`}
              src={mode === "base" ? compareUrl : story?.previewUrl}
            />
          )}{" "}
          {annotating && mode !== "side" && mode !== "diff" && (
            <button
              className="annotation-surface"
              aria-label="Place annotation"
              onClick={(event) => {
                void annotate(
                  event as unknown as React.MouseEvent<HTMLDivElement>,
                );
                setAnnotating(false);
              }}
            />
          )}{" "}
          {mode !== "side" &&
            annotations
              .filter((item) => item.status === "open")
              .map(
                (item, index) =>
                  item.x !== undefined &&
                  item.y !== undefined && (
                    <button
                      className="annotation-pin"
                      style={{
                        left: `${item.x * 100}%`,
                        top: `${item.y * 100}%`,
                      }}
                      title={item.comment}
                      key={item.id}
                    >
                      {index + 1}
                    </button>
                  ),
              )}
        </div>
      </section>
      <aside className="review-inspector">
        <span className="eyebrow">Inspector</span>
        {capture ? (
          <>
            <h2>
              {capture.status === "changed" ? "Visual changed" : "No change"}
            </h2>
            <strong
              className={capture.diff.changedPixels ? "changed" : "passed"}
            >
              {diffPercent(capture.diff.diffRatio)}
            </strong>
            <dl>
              <div>
                <dt>Changed pixels</dt>
                <dd>
                  {capture.diff.changedPixels.toLocaleString()} /{" "}
                  {capture.diff.totalPixels.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Build</dt>
                <dd>
                  <code>{capture.build.id}</code>
                </dd>
              </div>
              <div>
                <dt>Git</dt>
                <dd>
                  {capture.build.branch}
                  {capture.build.workingTreeDirty ? " · dirty" : ""}
                </dd>
              </div>
            </dl>
            {capture.diff.changedPixels > 0 && (
              <div className="review-actions">
                <button onClick={() => decide("approved")} disabled={busy}>
                  Approve baseline
                </button>
                <button onClick={() => decide("rejected")} disabled={busy}>
                  Reject
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <h2>Story review</h2>
            <p>
              Capture creates a deterministic screenshot and compares it with
              the branch baseline.
            </p>
          </>
        )}
        <section className="annotation-list">
          <h3>
            Comments ·{" "}
            {annotations.filter((item) => item.status === "open").length} open
          </h3>
          {annotations.map((item, index) => (
            <article className={item.status} key={item.id}>
              <b>📌 #{index + 1}</b>
              {item.comments.map((comment) => (
                <p key={comment.id}>
                  {comment.body}
                  <small>{comment.author}</small>
                </p>
              ))}
              <div>
                <button
                  onClick={() =>
                    updateAnnotation(item, {
                      status: item.status === "open" ? "resolved" : "open",
                    })
                  }
                >
                  {item.status === "open" ? "Resolve" : "Reopen"}
                </button>
                <button
                  onClick={() => {
                    const body = window.prompt("Reply");
                    if (body) void updateAnnotation(item, { reply: { body } });
                  }}
                >
                  Reply
                </button>
              </div>
            </article>
          ))}
        </section>
      </aside>
    </div>
  );
}
