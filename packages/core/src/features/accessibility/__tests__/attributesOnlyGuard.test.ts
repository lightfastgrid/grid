/**
 * Accessibility plugin — renderer-DOM ownership guard.
 *
 * The plugin never restructures the composite grid DOM. Approved auxiliary
 * owners create only the status sibling plus F16 overlay/sort descriptions
 * outside the grid surface.
 *
 * This is a static source scan (no DOM setup, cannot be fooled at runtime): any
 * node-creation or tree-mutation API in plugin production code fails the test.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = join(here, ".."); // __tests__ -> features/accessibility
const LIVE_REGION_FILE = join(PLUGIN_DIR, "accessibilityLiveRegion.ts");
const PERSISTENT_DESCRIPTION_FILE = join(
  PLUGIN_DIR,
  "accessibilityPersistentDescription.ts",
);
const HEADER_SEMANTICS_FILE = join(
  PLUGIN_DIR,
  "utils",
  "headerSemantics.ts",
);
const APPROVED_AUXILIARY_OWNERS = new Set([
  LIVE_REGION_FILE,
  PERSISTENT_DESCRIPTION_FILE,
  HEADER_SEMANTICS_FILE,
]);

/** Tree-mutation / node-creation APIs forbidden in the plugin. */
const FORBIDDEN = [
  "createElement",
  "createDocumentFragment",
  "appendChild",
  "insertBefore",
  "removeChild",
  "replaceChild",
  ".append(",
  ".prepend(",
  ".remove()",
  ".replaceWith(",
  ".after(",
  ".before(",
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "insertAdjacentElement",
] as const;

/** Plugin `.ts` production files (excludes test and benchmark harnesses). */
function collectProductionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "__benchmarks__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectProductionFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("accessibility plugin preserves renderer DOM ownership", () => {
  it("limits tree mutation to the approved outside-surface auxiliary owners", () => {
    const offenders: string[] = [];

    for (const file of collectProductionFiles(PLUGIN_DIR)) {
      if (APPROVED_AUXILIARY_OWNERS.has(file)) continue;
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        for (const api of FORBIDDEN) {
          if (line.includes(api)) {
            offenders.push(
              `${relative(PLUGIN_DIR, file).split(sep).join("/")}:${i + 1}: ${line.trim()}`,
            );
          }
        }
      });
    }

    expect(
      offenders,
      `Only approved status/description owners may mutate auxiliary DOM:\n` +
        offenders.join("\n"),
    ).toEqual([]);

    const liveRegionSource = readFileSync(LIVE_REGION_FILE, "utf8");
    expect(liveRegionSource.match(/createElement\(/g)).toHaveLength(1);
    expect(liveRegionSource.match(/insertBefore\(/g)).toHaveLength(1);
    expect(liveRegionSource.match(/\.remove\(\)/g)).toHaveLength(1);
    expect(liveRegionSource).not.toMatch(
      /appendChild|createDocumentFragment|innerHTML|outerHTML|insertAdjacent/,
    );

    for (const file of [
      PERSISTENT_DESCRIPTION_FILE,
      HEADER_SEMANTICS_FILE,
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(
        /createDocumentFragment|innerHTML|outerHTML|insertAdjacent|querySelector\([^)]*description/,
      );
    }
  });
});
