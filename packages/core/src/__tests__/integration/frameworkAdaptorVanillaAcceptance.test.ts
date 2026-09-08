// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { Grid } from "../../../src";

const REPO_ROOT = resolve(process.cwd(), "../..");

function productionSources(path: string): string[] {
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "__typechecks__") {
        continue;
      }
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (extname(entry.name) === ".ts" || extname(entry.name) === ".tsx") {
        result.push(entryPath);
      }
    }
  };
  visit(resolve(REPO_ROOT, path));
  return result;
}

describe("framework adaptors Stage 6 acceptance", () => {
  it("runs the package-root vanilla lifecycle with events and runtime APIs", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mounted = vi.fn();
    const sorted = vi.fn();
    const rowsUpdated = vi.fn();
    const grid = new Grid({
      columns: [{ field: "name", sortable: true }],
      rows: [{ id: "row-1", name: "Alpha" }],
      getRowId: (row) => row.id,
    });
    const unsubscribeMounted = grid.on("grid:mounted", mounted);
    const unsubscribeSorted = grid.on("sort:changed", sorted);
    const unsubscribeRows = grid.on("row-data:updated", rowsUpdated);

    grid.mount(host);
    grid.setSortModel([{ field: "name", sort: "asc" }]);
    grid.applyTransaction({ add: [{ id: "row-2", name: "Beta" }] });

    expect(mounted).toHaveBeenCalledOnce();
    expect(mounted).toHaveBeenCalledWith({ container: host });
    expect(sorted).toHaveBeenCalledOnce();
    expect(rowsUpdated).toHaveBeenCalledOnce();
    expect(grid.getRows()).toHaveLength(2);

    unsubscribeMounted();
    unsubscribeSorted();
    unsubscribeRows();
    grid.clearSort();
    grid.applyTransaction({ add: [{ id: "row-3", name: "Gamma" }] });

    expect(sorted).toHaveBeenCalledOnce();
    expect(rowsUpdated).toHaveBeenCalledOnce();

    grid.destroy();
    expect(() => grid.setRows([])).toThrow(/destroyed/);
    host.remove();
  });

  it("keeps React production imports on the core package root", () => {
    const sources = productionSources("packages/react/src");

    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(
        /(?:from|import\s*)\s*\(?["'][^"']*(?:packages\/core|core\/src|\.\.\/.*core)[^"']*["']/,
      );
    }
  });

  it("keeps adaptor event work out of renderer hot paths", () => {
    const hotPaths = [
      "packages/core/src/rendering/DomGridRenderer.ts",
      "packages/core/src/rendering/ring-buffer/VirtualWindowSync.ts",
      "packages/core/src/rendering/dom/DomPoolManager.ts",
      "packages/core/src/rendering/helpers/populateRow.ts",
    ];

    for (const path of hotPaths) {
      const source = readFileSync(resolve(REPO_ROOT, path), "utf8");
      expect(source, path).not.toMatch(
        /gridEventCallbacks|subscribeGridEventCallbacks|GridEventCallbacks|\.emit\(/,
      );
    }
  });
});
