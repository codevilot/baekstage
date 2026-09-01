import { useEffect, useMemo, useState } from "react";
import type { SchemaChange, SchemaComparison, SchemaReferences } from "../../schema/types";

type Source = { id: string; title: string; file: string; format: string };
const request = async <T,>(url: string, init?: RequestInit): Promise<T> => { const response = await fetch(url, init); const value = await response.json(); if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`); return value; };

export function SchemaWorkspace({ endpoint = "/api/schema" }: { endpoint?: string }) {
  const [sources, setSources] = useState<Source[]>([]); const [references, setReferences] = useState<SchemaReferences>({ branches: [], commits: [] });
  const [sourceId, setSourceId] = useState(""); const [before, setBefore] = useState("HEAD"); const [after, setAfter] = useState("working");
  const [comparison, setComparison] = useState<SchemaComparison | null>(null); const [selectedKey, setSelectedKey] = useState(""); const [query, setQuery] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { Promise.all([request<Source[]>(`${endpoint}/sources`), request<SchemaReferences>(`${endpoint}/references`)]).then(([nextSources, nextReferences]) => { setSources(nextSources); setReferences(nextReferences); setSourceId(nextSources[0]?.id ?? ""); }).catch((reason) => setError(reason.message)); }, [endpoint]);
  useEffect(() => { if (!sourceId) return; setBusy(true); setError(""); request<SchemaComparison>(`${endpoint}/compare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId, before, after }) }).then((value) => { setComparison(value); setSelectedKey((current) => value.changes.some((item) => item.key === current) ? current : value.changes[0]?.key ?? ""); }).catch((reason) => setError(reason.message)).finally(() => setBusy(false)); }, [after, before, endpoint, sourceId]);
  const changes = useMemo(() => comparison?.changes.filter((item) => `${item.after?.kind ?? item.before?.kind} ${item.after?.name ?? item.before?.name} ${item.after?.parent ?? item.before?.parent ?? ""}`.toLowerCase().includes(query.toLowerCase())) ?? [], [comparison, query]);
  const selected = comparison?.changes.find((item) => item.key === selectedKey);
  const referenceOptions = <><option value="HEAD">HEAD</option>{references.branches.filter((item) => item !== "HEAD").map((branch) => <option value={branch} key={`branch:${branch}`}>Branch · {branch}</option>)}{references.commits.map((commit) => <option value={commit.sha} key={commit.sha}>{commit.shortSha} · {commit.subject}</option>)}</>;
  return <div className="schema-workspace">
    {busy && <div className="schema-loading" role="status" aria-label="Comparing schemas"><i/><i/><i/></div>}
    <header className="schema-toolbar">
      <label>Schema<select aria-label="Schema source" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{sources.map((source) => <option value={source.id} key={source.id}>{source.title}</option>)}</select></label>
      <label>Before<select aria-label="Before schema reference" value={before} onChange={(event) => setBefore(event.target.value)}>{referenceOptions}</select></label>
      <b>→</b>
      <label>After<select aria-label="After schema reference" value={after} onChange={(event) => setAfter(event.target.value)}><option value="working">Current working tree</option>{referenceOptions}</select></label>
      {comparison && <span>{comparison.source.file}</span>}
    </header>
    {error && <p className="schema-error">{error}</p>}
    <div className="schema-body">
      <aside className="schema-changes">
        <div className="schema-summary"><Summary label="Added" value={comparison?.summary.added ?? 0} tone="added"/><Summary label="Modified" value={comparison?.summary.modified ?? 0} tone="modified"/><Summary label="Removed" value={comparison?.summary.removed ?? 0} tone="removed"/></div>
        <input aria-label="Search schema changes" placeholder="Search changed schema" value={query} onChange={(event) => setQuery(event.target.value)}/>
        <nav aria-label="Schema changes">{changes.length ? changes.map((change) => <ChangeButton change={change} selected={change.key === selectedKey} onClick={() => setSelectedKey(change.key)} key={change.key}/>) : <p>No schema changes</p>}</nav>
      </aside>
      <section className="schema-detail">{selected ? <SchemaDetail change={selected}/> : <div className="schema-empty"><strong>Schemas match</strong><p>선택한 두 revision 사이에 semantic schema 변경이 없습니다.</p></div>}</section>
    </div>
  </div>;
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) { return <span className={tone}><strong>{value}</strong><small>{label}</small></span>; }
function ChangeButton({ change, selected, onClick }: { change: SchemaChange; selected: boolean; onClick: () => void }) { const object = change.after ?? change.before!; return <button className={`${change.status} ${selected ? "active" : ""}`} onClick={onClick}><i>{change.status === "added" ? "+" : change.status === "removed" ? "−" : "~"}</i><span><strong>{object.name}</strong><small>{object.kind}{object.parent ? ` · ${object.parent}` : ""}</small></span>{change.fields.length > 0 && <b>{change.fields.length}</b>}</button>; }
function SchemaDetail({ change }: { change: SchemaChange }) { const object = change.after ?? change.before!; return <>
  <header><span className={`schema-status ${change.status}`}>{change.status}</span><h2>{object.name}</h2><p>{object.kind} · {object.parent ?? object.schema}</p></header>
  {change.fields.length > 0 && <section className="schema-field-diff"><h3>Column changes</h3><table><thead><tr><th>Column</th><th>Before</th><th>After</th></tr></thead><tbody>{change.fields.map((field) => <tr className={field.status} key={field.name}><th>{field.name}</th><td>{field.before ?? "—"}</td><td>{field.after ?? "—"}</td></tr>)}</tbody></table></section>}
  <section className="schema-definition-diff"><article><h3>Before</h3><pre>{change.before?.definition ?? "Not present"}</pre></article><article><h3>After</h3><pre>{change.after?.definition ?? "Not present"}</pre></article></section>
  </>; }
