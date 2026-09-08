import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "../../..");
const PAGINATION_FOOTER = join(SRC, "rendering", "dom", "PaginationFooter.ts");
const ACCESSIBILITY = join(SRC, "features", "accessibility");

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

describe("pagination accessibility architecture", () => {
  it("keeps control semantics owner-local without a duplicate live region", () => {
    const footer = readFileSync(PAGINATION_FOOTER, "utf8");

    expect(footer).not.toMatch(
      /features\/accessibility|role=["']status|aria-live|role=["']navigation/,
    );
    expect(footer).toContain('document.createElement("label")');
    expect(footer).toContain('button.setAttribute("aria-label", ariaLabel)');
    expect(footer).toContain('button.setAttribute("aria-current", "page")');
    expect(footer).toContain('ellipsis.setAttribute("aria-hidden", "true")');
    expect(footer).not.toMatch(/addEventListener\(["']keydown/);
  });

  it("keeps pagination footer discovery out of the accessibility plugin", () => {
    const offenders = productionFiles(ACCESSIBILITY)
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return (
          source.includes("PaginationFooter") ||
          source.includes(".lfg-pagination")
        );
      })
      .map((path) => relative(SRC, path).split(sep).join("/"));

    expect(offenders).toEqual([]);
  });

  it("keeps pagination-control semantics out of renderer hot paths", () => {
    for (const path of [
      "rendering/ring-buffer/VirtualWindowSync.ts",
      "rendering/dom/DomPoolManager.ts",
      "rendering/helpers/populateRow.ts",
    ]) {
      expect(readFileSync(join(SRC, path), "utf8")).not.toMatch(
        /PaginationFooter|lfg-pagination|Previous page|Rows per page|aria-current/,
      );
    }
  });
});
