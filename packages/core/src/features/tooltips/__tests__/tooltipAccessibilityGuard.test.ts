import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../..");

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "__benchmarks__") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...productionFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("tooltip accessibility architecture", () => {
  it("keeps tooltip semantics owner-local and off renderer hot paths", () => {
    const tooltipSources = [
      "features/tooltips/TooltipController.ts",
      "features/tooltips/tooltipDom.ts",
      "features/tooltips/tooltipSemantics.ts",
    ].map((path) => readFileSync(join(SRC, path), "utf8"));
    expect(tooltipSources.join("\n")).not.toMatch(
      /features\/accessibility|requestReconcile|markDirty/,
    );

    for (const path of [
      "rendering/DomGridRenderer.ts",
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ]) {
      expect(readFileSync(join(SRC, path), "utf8")).not.toMatch(
        /tooltipSemantics|connectTooltipTarget|role=["']tooltip/,
      );
    }
  });

  it("limits the neutral describedby composer to the two approved owners", () => {
    const approved = new Set([
      "features/accessibility/utils/bodyCellSemanticsDom.ts",
      "features/tooltips/tooltipSemantics.ts",
    ]);
    const consumers = productionFiles(SRC)
      .filter((path) =>
        readFileSync(path, "utf8").includes(
          "internal/ariaIdReferenceTokens",
        ),
      )
      .map((path) => relative(SRC, path).split(sep).join("/"));
    expect(new Set(consumers)).toEqual(approved);

    for (const path of productionFiles(SRC)) {
      const relativePath = relative(SRC, path).split(sep).join("/");
      if (
        approved.has(relativePath) ||
        relativePath === "internal/ariaIdReferenceTokens.ts"
      ) {
        continue;
      }
      if (
        readFileSync(path, "utf8").includes(
          "replaceOwnedAriaDescribedByTokens",
        )
      ) {
        throw new Error(`Unexpected ARIA token owner: ${relativePath}`);
      }
    }
  });

  it("keeps tooltip content hoverable without making it focusable", () => {
    const css = readFileSync(join(SRC, "themes/default.css"), "utf8");
    const start = css.indexOf(".lfg-tooltip {");
    const end = css.indexOf("}", start);
    const rule = css.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(rule).toContain("pointer-events: auto");
    expect(rule).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);

    const dom = readFileSync(
      join(SRC, "features/tooltips/tooltipDom.ts"),
      "utf8",
    );
    expect(dom).not.toMatch(
      /\.innerHTML\s*=|\.tabIndex\s*=|setAttribute\(["']tabindex/,
    );
  });
});
