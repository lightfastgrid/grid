/**
 * Accessibility plugin — isolation boundary guard.
 *
 * The whole point of the plugin is a one-way dependency: everything lives under
 * `features/accessibility/`, and the *only* thing outside that folder allowed to
 * import from it is the feature registry (the single private-runtime seam).
 * Public option storage, neutral events, and atomic legacy-writer removals are
 * separate, explicitly guarded parts of the architecture. The AST-based
 * ESLint rule is authoritative; this scan remains a focused smoke check.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../.."); // src/features/accessibility/__tests__ -> src
const PLUGIN_DIR = join(SRC, "features", "accessibility");
const ALLOWED_IMPORTER = join(SRC, "features", "registry.ts");

/** All `.ts`/`.tsx` files under `dir`, recursively. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Import specifiers that resolve into the accessibility *folder* — a path with
 * an exact `accessibility` segment. Deliberately does not match unrelated names
 * like `accessibilityStatus` (a different internal module).
 */
const FOLDER_IMPORT = /from\s+["'][^"']*(?:^|\/)accessibility(?:\/[^"']*)?["']/;

describe("accessibility plugin isolation boundary", () => {
  it("is imported only by the feature registry (one-way dependency)", () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(SRC)) {
      // Files inside the plugin folder may import from it freely.
      if (file.startsWith(PLUGIN_DIR + sep)) continue;
      if (file === ALLOWED_IMPORTER) continue;

      const source = readFileSync(file, "utf8");
      for (const line of source.split("\n")) {
        if (FOLDER_IMPORT.test(line)) {
          offenders.push(`${relative(SRC, file)}: ${line.trim()}`);
        }
      }
    }

    expect(
      offenders,
      `Only features/registry.ts may import features/accessibility/. ` +
        `Route everything else through the EventBus / read seam:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
