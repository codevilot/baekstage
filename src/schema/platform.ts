import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SchemaSourceConfig } from "../config";
import type { SchemaChange, SchemaComparison, SchemaField, SchemaObject, SchemaReferences, SchemaSnapshot } from "./types";

const execute = promisify(execFile);
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const unquote = (value: string) => value.replace(/^"|"$/g, "").replaceAll('""', '"');

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
  constructor(private root: string, private sources: SchemaSourceConfig[], private recentCommitCount = 30) {}
  sourceList() { return this.sources.map(({ id, title, file, format }) => ({ id, title, file, format })); }
  async references(): Promise<SchemaReferences> {
    const [{ stdout: branchOutput }, { stdout: commitOutput }] = await Promise.all([
      execute("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd: this.root }),
      execute("git", ["log", `-${this.recentCommitCount}`, "--format=%H%x09%h%x09%cI%x09%s"], { cwd: this.root, maxBuffer: 2_000_000 }),
    ]);
    return { branches: branchOutput.trim().split("\n").filter(Boolean), commits: commitOutput.trim().split("\n").filter(Boolean).map((line) => { const [sha, shortSha, committedAt, ...subject] = line.split("\t"); return { sha, shortSha, committedAt, subject: subject.join("\t") }; }) };
  }
  private source(id: string) { const source = this.sources.find((item) => item.id === id); if (!source) throw new Error(`Unknown schema source: ${id}`); return source; }
  private async snapshot(source: SchemaSourceConfig, reference: string) {
    const relative = source.file.replaceAll("\\", "/").replace(/^\.\//, ""); const absolute = path.resolve(this.root, relative);
    if (!absolute.startsWith(`${path.resolve(this.root)}${path.sep}`)) throw new Error("Schema file must stay inside the workspace");
    if (reference === "working") return parsePostgresDump(source.id, reference, "working tree", await readFile(absolute, "utf8"));
    const { stdout: revision } = await execute("git", ["rev-parse", "--verify", `${reference}^{commit}`], { cwd: this.root });
    const sha = revision.trim(); const { stdout } = await execute("git", ["show", `${sha}:${relative}`], { cwd: this.root, maxBuffer: 50_000_000 });
    return parsePostgresDump(source.id, reference, sha, stdout);
  }
  async compare(input: { sourceId: string; before?: string; after?: string }) {
    const source = this.source(input.sourceId); const [before, after] = await Promise.all([this.snapshot(source, input.before ?? "HEAD"), this.snapshot(source, input.after ?? "working")]);
    return compareSchemaSnapshots(source, before, after);
  }
}
