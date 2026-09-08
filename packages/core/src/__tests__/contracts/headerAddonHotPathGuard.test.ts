import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = [
  "querySelector",
  "querySelectorAll",
  "getBoundingClientRect",
  "offsetWidth",
  "offsetHeight",
  "clientWidth",
  "clientHeight",
  "getComputedStyle",
] as const;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function findViolations(label: string, source: string): string[] {
  const stripped = stripComments(source);
  const out: string[] = [];
  for (const token of FORBIDDEN) {
    if (stripped.includes(token)) out.push(`${label}: ${token}`);
  }
  return out;
}

describe("header addon sync hot-path guards", () => {
  it("forbids layout reads / querySelector in floating-filter and feature-host sync sources", () => {
    const srcRoot = join(__dirname, "../..");
    const files = [
      "features/floating-filters/FloatingFilterController.ts",
      "rendering/dom/DomFeatureHost.ts",
      "features/column-groups/columnGroupHeaderFeature.ts",
      "features/column-groups/columnGroupHeaderDom.ts",
      "features/column-groups/syncGroupHeaderRows.ts",
    ] as const;

    const violations: string[] = [];
    for (const rel of files) {
      violations.push(
        ...findViolations(rel, readFileSync(join(srcRoot, rel), "utf8")),
      );
    }
    expect(violations).toEqual([]);
  });

  it("forbids layout reads inside VirtualWindowSync.invokeHeaderAddonSync", () => {
    const src = readFileSync(
      join(__dirname, "../..", "rendering/ring-buffer/VirtualWindowSync.ts"),
      "utf8",
    );
    const match = src.match(
      /private invokeHeaderAddonSync\([\s\S]*?\n {2}\/\*\* Full bind:/,
    );
    expect(match).not.toBeNull();
    const violations = findViolations(
      "VirtualWindowSync.invokeHeaderAddonSync",
      match![0]!,
    );
    expect(violations).toEqual([]);
  });
});
