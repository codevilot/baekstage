import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Annotation, VisualReview } from "../core/types";

export type ReviewDatabase = { annotations: Annotation[]; reviews: VisualReview[] };

export interface MetadataStore {
  read(): Promise<ReviewDatabase>;
  write(value: ReviewDatabase): Promise<void>;
}

export interface ObjectStore {
  put(source: string, key: string): Promise<void>;
  path(key: string): string;
}

export class FileMetadataStore implements MetadataStore {
  constructor(private readonly file: string) {}
  async read(): Promise<ReviewDatabase> {
    if (!existsSync(this.file)) return { annotations: [], reviews: [] };
    try { return JSON.parse(await readFile(this.file, "utf8")) as ReviewDatabase; }
    catch { return { annotations: [], reviews: [] }; }
  }
  async write(value: ReviewDatabase) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx" });
    await rename(temporary, this.file);
  }
}

export class FileObjectStore implements ObjectStore {
  constructor(private readonly root: string) {}
  path(key: string) { return path.join(this.root, key); }
  async put(source: string, key: string) {
    const destination = this.path(key);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}
