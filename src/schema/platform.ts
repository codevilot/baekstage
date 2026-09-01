import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SchemaSourceConfig } from "../config";
import type { SchemaChange, SchemaComparison, SchemaField, SchemaObject, SchemaReferences, SchemaSnapshot } from "./types";

const execute = promisify(execFile);
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const unquote = (value: string) => value.replace(/^"|"$/g, "").replaceAll('""', '"');

export class SchemaPlatformError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = "SchemaPlatformError"; }
}

function inside(root: string, target: string) { const relative = path.relative(path.resolve(root), path.resolve(target)); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); }
function validReference(reference: unknown): reference is string { return typeof reference === "string" && reference.length > 0 && reference.length <= 512 && !/[\0\r\n]/u.test(reference); }

function splitTopLevel(value: string) {
  const items: string[] = []; let start = 0; let depth = 0; let quote = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"' && value[index - 1] !== "\\") quote = !quote;
    else if (!quote && character === "(") depth += 1;
    else if (!quote && character === ")") depth -= 1;
    else if (!quote && depth === 0 && character === ",") { items.push(value.slice(start, index)); start = index + 1; }
  }
  items.push(value.slice(start)); return items.map((item) => item.trim()).filter(Boolean);
}

function tableFields(definition: string): SchemaField[] {
  const body = /CREATE\s+TABLE\s+[^()]+\(([^]*?)\);/iu.exec(definition)?.[1];
  if (!body) return [];
  return splitTopLevel(body).flatMap((item) => {
    if (/^(?:CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|EXCLUDE)\b/iu.test(item)) return [];
    const match = /^("(?:[^"]|"")+"|[A-Za-z_][\w$]*)\s+([^]*)$/u.exec(item);
    return match ? [{ name: unquote(match[1]), definition: normalize(match[2]) }] : [];
  });
}

function parentTable(definition: string) {
  const match = /(?:ALTER\s+TABLE(?:\s+ONLY)?|ON)\s+(?:"?([\w]+)"?\.)?"?([\w]+)"?/iu.exec(definition);
  return match ? `${match[1] ?? "public"}.${match[2]}` : undefined;
}

export function parsePostgresDump(sourceId: string, reference: string, revision: string, sql: string): SchemaSnapshot {
  const header = /^--\n-- Name: (.*?); Type: (.*?); Schema: (.*?); Owner:.*?\n--\n/gmu;
  const matches = [...sql.matchAll(header)]; const objects: SchemaObject[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]; const definition = sql.slice(current.index! + current[0].length, matches[index + 1]?.index ?? sql.length).trim();
    const rawType = current[2].toUpperCase();
    const kind = ({ TABLE: "table", CONSTRAINT: "constraint", INDEX: "index", TYPE: "type", FUNCTION: "function", TRIGGER: "trigger" } as const)[rawType as "TABLE"];
    if (!kind || !definition) continue;
    const schema = current[3] === "-" ? "public" : unquote(current[3]); const name = current[1]; const parent = ["constraint", "index", "trigger"].includes(kind) ? parentTable(definition) : undefined;
    const key = `${kind}:${parent ? `${parent}.` : `${schema}.`}${name}`;
    objects.push({ key, kind, schema, name, parent, definition: normalize(definition), ...(kind === "table" ? { fields: tableFields(definition) } : {}) });
  }
  return { sourceId, reference, revision, objects: objects.sort((left, right) => left.key.localeCompare(right.key)) };
}

export function compareSchemaSnapshots(source: SchemaSourceConfig, before: SchemaSnapshot, after: SchemaSnapshot): SchemaComparison {
  const left = new Map(before.objects.map((item) => [item.key, item])); const right = new Map(after.objects.map((item) => [item.key, item]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort(); let unchanged = 0; const changes: SchemaChange[] = [];
  for (const key of keys) {
    const previous = left.get(key); const current = right.get(key);
    if (!previous) { changes.push({ key, status: "added", after: current, fields: current?.fields?.map((field) => ({ name: field.name, status: "added", after: field.definition })) ?? [] }); continue; }
    if (!current) { changes.push({ key, status: "removed", before: previous, fields: previous.fields?.map((field) => ({ name: field.name, status: "removed", before: field.definition })) ?? [] }); continue; }
    if (previous.definition === current.definition) { unchanged += 1; continue; }
    const previousFields = new Map(previous.fields?.map((field) => [field.name, field.definition]) ?? []); const currentFields = new Map(current.fields?.map((field) => [field.name, field.definition]) ?? []);
    const fields = [...new Set([...previousFields.keys(), ...currentFields.keys()])].sort().flatMap((name) => {
      const oldValue = previousFields.get(name); const newValue = currentFields.get(name);
      if (oldValue === newValue) return [];
      return [{ name, status: oldValue === undefined ? "added" as const : newValue === undefined ? "removed" as const : "modified" as const, before: oldValue, after: newValue }];
    });
    changes.push({ key, status: "modified", before: previous, after: current, fields });
  }
  return { source: { id: source.id, title: source.title, file: source.file }, before: { ...before, objects: [] }, after: { ...after, objects: [] }, summary: { added: changes.filter((item) => item.status === "added").length, removed: changes.filter((item) => item.status === "removed").length, modified: changes.filter((item) => item.status === "modified").length, unchanged }, changes };
}

export class SchemaPlatform {
  constructor(private root: string, private sources: SchemaSourceConfig[], private recentCommitCount = 30) {
    const identifiers = new Set<string>();
    for (const source of sources) {
      if (typeof source.id !== "string" || !source.id.trim()) throw new SchemaPlatformError("SCHEMA_SOURCE_INVALID", "Schema source id is required", 500);
      if (identifiers.has(source.id)) throw new SchemaPlatformError("SCHEMA_SOURCE_DUPLICATE", `Duplicate schema source id: ${source.id}`, 500);
      identifiers.add(source.id);
    }
  }
  sourceList() { return this.sources.map(({ id, title, file, format }) => ({ id, title, file, format })); }
  async references(): Promise<SchemaReferences> {
    try {
      const limit = Math.max(1, Math.min(Number.isFinite(this.recentCommitCount) ? this.recentCommitCount : 30, 100));
      const [{ stdout: branchOutput }, { stdout: commitOutput }] = await Promise.all([
        execute("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd: this.root }),
        execute("git", ["log", `-${limit}`, "--format=%H%x09%h%x09%cI%x09%s"], { cwd: this.root, maxBuffer: 2_000_000 }),
      ]);
      return { branches: branchOutput.trim().split("\n").filter(Boolean), commits: commitOutput.trim().split("\n").filter(Boolean).map((line) => { const [sha, shortSha, committedAt, ...subject] = line.split("\t"); return { sha, shortSha, committedAt, subject: subject.join("\t") }; }) };
    } catch { throw new SchemaPlatformError("SCHEMA_GIT_UNAVAILABLE", "Git references could not be read for schema comparison", 503); }
  }
  private source(id: unknown) { if (typeof id !== "string" || !id) throw new SchemaPlatformError("SCHEMA_SOURCE_REQUIRED", "Schema source is required"); const source = this.sources.find((item) => item.id === id); if (!source) throw new SchemaPlatformError("SCHEMA_SOURCE_NOT_FOUND", `Unknown schema source: ${id}`, 404); return source; }
  private async snapshot(source: SchemaSourceConfig, reference: string) {
    const relative = source.file.replaceAll("\\", "/").replace(/^\.\//, ""); const absolute = path.resolve(this.root, relative);
    if (!inside(this.root, absolute)) throw new SchemaPlatformError("SCHEMA_FILE_OUTSIDE_WORKSPACE", "Schema file must stay inside the workspace", 500);
    if (!validReference(reference)) throw new SchemaPlatformError("SCHEMA_REFERENCE_INVALID", "Schema reference is invalid");
    let sql: string; let revision: string;
    if (reference === "working") {
      revision = "working tree";
      try { sql = await readFile(absolute, "utf8"); } catch { throw new SchemaPlatformError("SCHEMA_FILE_NOT_FOUND", `Schema file is not available in the working tree: ${relative}`, 404); }
    } else {
      let sha: string;
      try { const result = await execute("git", ["rev-parse", "--verify", "--end-of-options", `${reference}^{commit}`], { cwd: this.root }); sha = result.stdout.trim(); }
      catch { throw new SchemaPlatformError("SCHEMA_REFERENCE_NOT_FOUND", `Schema reference does not exist: ${reference}`, 404); }
      revision = sha;
      try { sql = (await execute("git", ["show", `${sha}:${relative}`], { cwd: this.root, maxBuffer: 50_000_000 })).stdout; }
      catch { throw new SchemaPlatformError("SCHEMA_FILE_NOT_FOUND_AT_REFERENCE", `Schema file '${relative}' does not exist at ${reference}`, 404); }
    }
    const snapshot = parsePostgresDump(source.id, reference, revision, sql);
    if (!snapshot.objects.length) throw new SchemaPlatformError("SCHEMA_DUMP_UNSUPPORTED", `No supported PostgreSQL schema objects were found in '${relative}' at ${reference}`, 422);
    return snapshot;
  }
  async compare(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new SchemaPlatformError("SCHEMA_REQUEST_INVALID", "Schema comparison request must be an object");
    const request = input as { sourceId?: string; before?: string; after?: string };
    const source = this.source(request.sourceId); const [before, after] = await Promise.all([this.snapshot(source, request.before ?? "HEAD"), this.snapshot(source, request.after ?? "working")]);
    return compareSchemaSnapshots(source, before, after);
  }
}
