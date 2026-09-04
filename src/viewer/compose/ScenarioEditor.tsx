import { useEffect, useMemo, useState } from "react";
import { materializeScenario, scenarioEditWarnings } from "../../core/scenario";
import type {
  ScenarioCompositionRoute,
  ScenarioEditDraft,
  ScenarioGraph,
  ScenarioNode,
  ScenarioNodeKind,
  ScenarioPart,
  ScenarioPartVariable,
} from "../../core/types";

type EditItem = ScenarioEditDraft["items"][number];
type PartItem = Extract<EditItem, { type: "part" }>;
type Props = {
  scenario: ScenarioGraph;
  parts: ScenarioPart[];
  creating?: boolean;
  endpoint?: string;
  onClose: () => void;
  onSaved: (scenario: ScenarioGraph) => void;
};

const kinds: ScenarioNodeKind[] = ["fixture", "action", "screen", "api", "service", "database", "worker", "external", "assertion", "outcome"];
const key = () => crypto.randomUUID().slice(0, 8);

function initialItems(scenario: ScenarioGraph): EditItem[] {
  if (scenario.composition?.items.length) {
    const items: EditItem[] = [];
    for (const item of scenario.composition.items) {
      if (item.type === "part") items.push({ ...item });
      else {
        const node = scenario.nodes.find((candidate) => candidate.id === item.nodeId);
        if (node) items.push({ id: item.id, type: "node", node: { ...node } });
      }
    }
    return items;
  }
  return scenario.nodes.map((node) => ({ id: `node-${node.id}`, type: "node" as const, node: { ...node } }));
}

function valueText(value: unknown, type: ScenarioPartVariable["type"]) {
  if (value === undefined) return "";
  if (type === "json") return JSON.stringify(value, null, 2);
  return String(value);
}

function parseValue(value: string, type: ScenarioPartVariable["type"]): unknown {
  if (type === "number") return value === "" ? undefined : Number(value);
  if (type === "boolean") return value === "true";
  if (type === "json") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function PartFields({ item, part, items, routes, onItem, onRoutes }: {
  item: PartItem;
  part?: ScenarioPart;
  items: EditItem[];
  routes: ScenarioCompositionRoute[];
  onItem: (change: Partial<PartItem>) => void;
  onRoutes: (routes: ScenarioCompositionRoute[]) => void;
}) {
  const variables = (title: string, declarations: ScenarioPartVariable[] | undefined, field: "inputs" | "expectations") => declarations?.length ? (
    <fieldset className="part-variables">
      <legend>{title}</legend>
      {declarations.map((variable) => {
        const values = item[field] ?? {};
        const current = values[variable.id] ?? variable.defaultValue;
        const update = (raw: string) => onItem({ [field]: { ...values, [variable.id]: parseValue(raw, variable.type) } });
        return <label key={variable.id}>
          <b>{variable.title}{variable.required ? " *" : ""}</b>
          {variable.type === "boolean" ? (
            <select aria-label={`${title} ${variable.title}`} value={String(current ?? false)} onChange={(event) => update(event.target.value)}>
              <option value="true">true</option><option value="false">false</option>
            </select>
          ) : variable.type === "json" ? (
            <textarea aria-label={`${title} ${variable.title}`} value={valueText(current, variable.type)} onChange={(event) => update(event.target.value)}/>
          ) : (
            <input aria-label={`${title} ${variable.title}`} type={variable.type === "number" ? "number" : "text"} value={valueText(current, variable.type)} onChange={(event) => update(event.target.value)}/>
          )}
          {variable.description && <small>{variable.description}</small>}
        </label>;
      })}
    </fieldset>
  ) : null;

  return <>
    {variables("입력값", part?.inputs, "inputs")}
    {variables("기대값", part?.expectations, "expectations")}
    {!!part?.outcomes?.length && <fieldset className="part-routes">
      <legend>결과별 다음 항목</legend>
      <p>Part가 반환한 outcome에 따라 다음 실행 위치를 정합니다. 분기를 사용하면 반환 가능한 결과를 모두 연결하세요.</p>
      {part.outcomes.map((outcome) => {
        const route = routes.find((candidate) => candidate.fromItemId === item.id && candidate.outcome === outcome.id);
        return <label key={outcome.id}>
          <span><b>{outcome.title}</b><small>{outcome.id}{outcome.verdict ? ` · ${outcome.verdict}` : ""}</small></span>
          <select aria-label={`${outcome.title} 다음 항목`} value={route?.toItemId ?? ""} onChange={(event) => {
            const next = routes.filter((candidate) => !(candidate.fromItemId === item.id && candidate.outcome === outcome.id));
            if (event.target.value) next.push({ fromItemId: item.id, outcome: outcome.id, toItemId: event.target.value });
            onRoutes(next);
          }}>
            <option value="">경로 미지정</option>
            {items.filter((candidate) => candidate.id !== item.id).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.type === "part" ? `Part · ${candidate.partId}` : `Node · ${candidate.node.title}`}</option>)}
          </select>
        </label>;
      })}
    </fieldset>}
  </>;
}

export function ScenarioEditor({ scenario, parts, creating = false, endpoint = "/api/scenario-editor", onClose, onSaved }: Props) {
  const [id, setId] = useState(scenario.id);
  const [title, setTitle] = useState(scenario.title);
  const [description, setDescription] = useState(scenario.description ?? "");
  const [items, setItems] = useState<EditItem[]>(() => initialItems(scenario));
  const [selected, setSelected] = useState<string>();
  const [edges, setEdges] = useState(scenario.edges);
  const [routes, setRoutes] = useState<ScenarioCompositionRoute[]>(scenario.composition?.routes ?? []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string; files?: string[] }>();

  useEffect(() => {
    setId(scenario.id); setTitle(scenario.title); setDescription(scenario.description ?? "");
    setItems(initialItems(scenario)); setEdges(scenario.edges); setRoutes(scenario.composition?.routes ?? []);
    setSelected(undefined); setMessage(undefined);
  }, [scenario]);

  const byId = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts]);
  const selectedItem = items.find((item) => item.id === selected);
  const hasExecutableParts = items.some((item) => item.type === "part");
  const draft: ScenarioEditDraft = { id, title, description, items, edges, routes, execution: scenario.execution, definitionSource: scenario.definitionSource };
  const previewState = useMemo(() => {
    try { return { graph: materializeScenario(draft, parts) }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [description, edges, id, items, parts, routes, scenario.definitionSource, scenario.execution, title]);
  const preview = previewState.graph;
  const warnings = useMemo(() => scenarioEditWarnings(draft, parts), [items, parts, routes]);

  const move = (index: number, offset: number) => setItems((current) => {
    const next = [...current]; const target = index + offset;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const updateNode = (change: Partial<ScenarioNode>) => {
    if (change.id && selectedItem?.type === "node" && change.id !== selectedItem.node.id) {
      const before = selectedItem.node.id;
      setEdges((current) => current.map((edge) => ({ ...edge, source: edge.source === before ? change.id! : edge.source, target: edge.target === before ? change.id! : edge.target })));
    }
    setItems((current) => current.map((item) => item.id === selected && item.type === "node" ? { ...item, node: { ...item.node, ...change } } : item));
  };
  const updatePart = (itemId: string, change: Partial<PartItem>) => setItems((current) => current.map((item) => item.id === itemId && item.type === "part" ? { ...item, ...change } : item));
  const insertPart = (partId: string, position: "before" | "after") => {
    const item: EditItem = { id: `part-${key()}`, type: "part", partId, repeat: 1 };
    setItems((current) => {
      const selectedIndex = current.findIndex((entry) => entry.id === selected);
      if (selectedIndex < 0) return position === "before" ? [item, ...current] : [...current, item];
      const next = [...current]; next.splice(selectedIndex + (position === "after" ? 1 : 0), 0, item); return next;
    });
    setSelected(item.id);
  };
  const removeItem = (itemId: string) => {
    setItems((current) => current.filter((entry) => entry.id !== itemId));
    setRoutes((current) => current.filter((route) => route.fromItemId !== itemId && route.toItemId !== itemId));
    if (selected === itemId) setSelected(undefined);
  };
  const save = async () => {
    setSaving(true); setMessage(undefined);
    try {
      const response = await fetch(`${endpoint}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "시나리오를 저장하지 못했습니다.");
      setMessage({ kind: "success", text: "편집 내용을 저장했습니다.", files: value.files }); onSaved(value.scenario);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally { setSaving(false); }
  };

  return <section className="scenario-editor" aria-label={creating ? "새 시나리오 편집" : `${scenario.title} 편집`}>
    <div className="editor-toolbar">
      <div><button onClick={onClose}>← Map</button><span>{creating ? "New scenario" : "Scenario editor"}</span><h2>{title || "새 시나리오"}</h2></div>
      <div className="editor-legend"><span className="part">◆ Part<strong>재사용 코드</strong></span><span className="node">● Node<strong>시나리오 전용 설명</strong></span></div>
    </div>
    <div className="editor-columns">
      <aside className="editor-library">
        <div className="composer-section-heading"><span>Reusable layer</span><h2>Part 추가</h2><p>구성 항목을 선택하고 Part를 앞이나 뒤에 삽입하세요.</p></div>
        {parts.map((part) => <article className="part-card editor-part-card" key={part.id}><div className="part-card-icon">◆</div><div><small>PART · {part.nodes.length} STEPS</small><strong>{part.title}</strong><p>{part.description ?? part.id}</p></div><div className="part-insert-actions"><button aria-label={`${part.title} 앞에 추가`} onClick={() => insertPart(part.id, "before")}>앞</button><button aria-label={`${part.title} 뒤에 추가`} onClick={() => insertPart(part.id, "after")}>뒤</button></div></article>)}
        <button className="add-manual-node" onClick={() => { const nodeId = `node-${key()}`, itemId = `manual-${key()}`; setItems((current) => [...current, { id: itemId, type: "node", node: { id: nodeId, title: "새 Node", kind: "action" } }]); setSelected(itemId); }}>＋ 수동 Node 추가</button>
        <small className="manual-help">Node는 이 시나리오에만 존재하며 Playwright 함수를 실행하지 않습니다.</small>
      </aside>
      <section className="editor-canvas">
        <header><div><span>Edit structure</span><h2>시나리오 구성</h2></div><b>{items.length} items · {routes.length} branches</b></header>
        <div className="editor-stack">{items.map((item, index) => {
          const part = item.type === "part" ? byId.get(item.partId) : undefined;
          return <article className={`editor-item ${item.type} ${selected === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item.id)}>
            <span className="editor-item-mark">{item.type === "part" ? "◆" : "●"}</span>
            <div><small>{item.type === "part" ? `PART INSTANCE · ${item.partId}` : `MANUAL NODE · ${item.node.kind}`}</small><strong>{item.type === "part" ? part?.title ?? item.partId : item.node.title}</strong><p>{item.type === "part" ? `${item.repeat ?? 1}회 실행 · ${part?.outcomes?.length ?? 0}개 outcome` : item.node.description ?? "시나리오 전용 Node"}</p></div>
            {item.type === "part" && <label>반복<input aria-label={`${part?.title ?? item.partId} 반복`} type="number" min="1" max="20" value={item.repeat ?? 1} onChange={(event) => updatePart(item.id, { repeat: Math.min(20, Math.max(1, Number(event.target.value) || 1)) })}/></label>}
            <div className="instance-actions"><button disabled={index === 0} onClick={(event) => { event.stopPropagation(); move(index, -1); }}>↑</button><button disabled={index === items.length - 1} onClick={(event) => { event.stopPropagation(); move(index, 1); }}>↓</button><button onClick={(event) => { event.stopPropagation(); removeItem(item.id); }}>×</button></div>
          </article>;
        })}</div>
      </section>
      <aside className="editor-inspector">
        <div className="composer-section-heading inspector-heading"><div><span>Properties</span><h2>{selectedItem?.type === "part" ? "Part 인스턴스" : selectedItem?.type === "node" ? "Node 속성" : "시나리오 속성"}</h2></div>{selectedItem && <button onClick={() => setSelected(undefined)}>시나리오 설정</button>}</div>
        {creating && <label>Scenario ID<input value={id} onChange={(event) => setId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}/></label>}
        {!selectedItem && <><label>시나리오 이름<input value={title} onChange={(event) => setTitle(event.target.value)}/></label><label>설명<textarea value={description} onChange={(event) => setDescription(event.target.value)}/></label></>}
        {selectedItem?.type === "part" && <>
          <label>참조 Part<select value={selectedItem.partId} onChange={(event) => { updatePart(selectedItem.id, { partId: event.target.value, inputs: {}, expectations: {} }); setRoutes((current) => current.filter((route) => route.fromItemId !== selectedItem.id)); }}>{parts.map((part) => <option value={part.id} key={part.id}>{part.title}</option>)}</select></label>
          <PartFields item={selectedItem} part={byId.get(selectedItem.partId)} items={items} routes={routes} onItem={(change) => updatePart(selectedItem.id, change)} onRoutes={setRoutes}/>
          <div className="layer-note part"><strong>재사용 참조</strong><span>입력값은 동작을, 기대값은 Playwright assertion을 바꿉니다. outcome은 성공·실패 판정이 아니라 다음 흐름을 선택합니다.</span></div>
        </>}
        {selectedItem?.type === "node" && <><label>Node ID<input value={selectedItem.node.id} onChange={(event) => updateNode({ id: event.target.value.replace(/[^a-zA-Z0-9:_-]/g, "") })}/></label><label>이름<input value={selectedItem.node.title} onChange={(event) => updateNode({ title: event.target.value })}/></label><label>종류<select value={selectedItem.node.kind} onChange={(event) => updateNode({ kind: event.target.value as ScenarioNodeKind })}>{kinds.map((kind) => <option key={kind}>{kind}</option>)}</select></label><label>설명<textarea value={selectedItem.node.description ?? ""} onChange={(event) => updateNode({ description: event.target.value })}/></label><div className="layer-note node"><strong>시나리오 전용</strong><span>이 Node는 흐름과 증거를 설명하며 재사용 함수로 등록되지 않습니다.</span></div></>}
        {previewState.error && <div className="editor-validation error" role="alert"><strong>저장 전 확인</strong><span>{previewState.error}</span></div>}
        {warnings.map((warning) => <div className="editor-validation warning" key={warning}><strong>실행 경고</strong><span>{warning}</span></div>)}
        <div className="editor-summary"><span>{preview?.nodes.length ?? 0}<small>Nodes</small></span><span>{preview?.edges.length ?? 0}<small>Edges</small></span><span>{routes.length}<small>Branches</small></span></div>
        <button className="editor-save" disabled={saving || !preview || !title.trim() || !id} onClick={() => void save()}>{saving ? "실행 중…" : hasExecutableParts ? creating ? "실행하고 생성" : "실행하고 저장" : creating ? "시나리오 생성" : "편집 내용 저장"}</button>
        {message && <div className={`composer-message ${message.kind}`} role="status"><strong>{message.kind === "success" ? "Saved" : "저장 실패"}</strong><span>{message.text}</span>{message.files?.map((file) => <code key={file}>{file}</code>)}</div>}
      </aside>
    </div>
  </section>;
}
