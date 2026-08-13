import { lstat, rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();

for (const name of ["dist-lib", "dist-types"]) {
  const target = path.resolve(projectRoot, name);
  if (path.dirname(target) !== projectRoot || path.basename(target) !== name) {
    throw new Error(`Refusing to clean unexpected path: ${target}`);
  }
  const info = await lstat(target).catch(() => null);
  if (!info) continue;
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Refusing to clean non-directory: ${target}`);
  }
  await rm(target, { recursive: true });
}
