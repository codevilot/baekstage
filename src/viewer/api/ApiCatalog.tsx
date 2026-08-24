import { useMemo, useState } from "react";
import type { OpenApiCatalog, OpenApiOperation, ScenarioSuite } from "../../core/types";
import { operationTestState, scenariosForOperation } from "../../openapi/catalog";

export function ApiCatalogView({ catalog, suite, selected, onSelect }: { catalog: OpenApiCatalog; suite: ScenarioSuite; selected?: string; onSelect: (operation: OpenApiOperation) => void }) {
  const [query, setQuery] = useState(""); const filtered = useMemo(() => catalog.operations.filter((operation) => [operation.tags.join(" "), operation.method, operation.path, operation.operationId].join(" ").toLowerCase().includes(query.toLowerCase())), [catalog, query]);
  const tags = useMemo(() => new Map(filtered.flatMap((operation) => operation.tags.map((tag) => [tag, operation] as const)).reduce<Array<[string, OpenApiOperation[]]>>((groups, [tag, operation]) => { const found = groups.find(([name]) => name === tag); if (found) found[1].push(operation); else groups.push([tag, [operation]]); return groups; }, [])), [filtered]);
  return <section className="api-catalog"><header><div><span className="eyebrow">API Catalog</span><h2>APIs</h2></div><input aria-label="Search APIs" placeholder="Search tag, method, path, operationId" value={query} onChange={(event) => setQuery(event.target.value)}/></header>
    {catalog.errors?.map((error) => <p className="api-error" key={error.sourceId}>{error.sourceId}: {error.message}</p>)}
    <div className="catalog-tree">{[...tags].map(([tag, operations]) => <section key={tag}><h3>{tag}</h3>{operations.map((operation) => { const linked = scenariosForOperation(suite, operation.id); const state = operationTestState(suite, operation.id); return <button className={selected === operation.id ? "selected" : ""} onClick={() => onSelect(operation)} key={operation.id}><span className={`method ${operation.method.toLowerCase()}`}>{operation.method}</span><span><strong>{operation.path}</strong><small>{operation.operationId ?? operation.summary}</small></span><span className={`api-state ${state}`}>{state === "unlinked" ? "Unlinked · Untested" : state}{linked.length > 0 && <small>{linked.length} scenario</small>}</span></button>; })}</section>)}</div>
    {!filtered.length && <p className="empty">No API operations match this search.</p>}
  </section>;
}
