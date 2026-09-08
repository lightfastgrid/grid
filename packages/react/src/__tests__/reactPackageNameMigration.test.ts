import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "worktrees",
  "generated",
]);

const SKIP_FILES = new Set(["pnpm-lock.yaml"]);

const FORBIDDEN = [
  `@lightfastgrid/${"react-adaptor"}`,
  `packages/${"reactAdaptor"}`,
  `lightfastgrid-${"react-adaptor"}`,
];

function listFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) {
      continue;
    }
    const absolute = join(directory, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...listFiles(absolute));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs|json|md|mdx|css|yml|yaml)$/.test(entry)) {
      continue;
    }
    files.push(absolute);
  }
  return files;
}

describe("React package name migration", () => {
  it("has no retired package or directory name in active source files", () => {
    const hits: string[] = [];
    for (const file of listFiles(repoRoot)) {
      let contents: string;
      try {
        contents = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const token of FORBIDDEN) {
        if (contents.includes(token)) {
          hits.push(`${relative(repoRoot, file)}: ${token}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
