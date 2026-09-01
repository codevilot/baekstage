export type SchemaField = { name: string; definition: string };
export type SchemaObject = {
  key: string;
  kind: "table" | "constraint" | "index" | "type" | "function" | "trigger" | "other";
  schema: string;
  name: string;
  parent?: string;
  definition: string;
  fields?: SchemaField[];
};
export type SchemaSnapshot = { sourceId: string; reference: string; revision: string; objects: SchemaObject[] };
export type SchemaFieldChange = { name: string; status: "added" | "removed" | "modified"; before?: string; after?: string };
export type SchemaChange = { key: string; status: "added" | "removed" | "modified"; before?: SchemaObject; after?: SchemaObject; fields: SchemaFieldChange[] };
export type SchemaComparison = {
  source: { id: string; title: string; file: string };
  before: SchemaSnapshot;
  after: SchemaSnapshot;
  summary: { added: number; removed: number; modified: number; unchanged: number };
  changes: SchemaChange[];
};
export type SchemaReferences = {
  currentBranch?: string;
  branches: string[];
  commits: Array<{ sha: string; shortSha: string; committedAt: string; subject: string }>;
};
