// @vitest-environment jsdom

/**
 * Renderer change-set tests (Phases 3–6).
 *
 * Verifies that update-only transactions with stable visual order
 * refresh only changed rows/cells in the DOM, while structural
 * transactions and sort-invalidation fall back to full refresh.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../Grid";
import type { LightFastGridProps, RowData } from "../../types";
import { CSS } from "../const/css-classes";
import type { DomGridRenderer } from "../DomGridRenderer";

// ── Helpers ────────────────────────────────────────────────────────────

function createGrid(props: Partial<LightFastGridProps> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const grid = new Grid({
    columns: [
      { field: "name", sortable: true },
      { field: "score", sortable: true },
    ],
    rows: [
      { id: "a", name: "Alice", score: 10 },
      { id: "b", name: "Bob", score: 20 },
      { id: "c", name: "Carol", score: 30 },
    ],
    getRowId: (row) => row.id,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
    ...props,
  });
  grid.mount(container);
  return { grid, container };
}

function destroyGrid(grid: Grid, container: HTMLElement): void {
  grid.destroy();
  container.remove();
}

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Get all visible body row elements. */
function getRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll(`.${CSS.ROW}`)) as HTMLElement[];
}

/** Get center cells in a row, keyed by data-col-id. */
function getCells(row: HTMLElement): Record<string, HTMLElement> {
  const cells: Record<string, HTMLElement> = {};
  for (const cell of Array.from(row.querySelectorAll(`.${CSS.CELL}`))) {
    const colId = cell.getAttribute("data-col-id");
    if (colId) cells[colId] = cell as HTMLElement;
  }
  return cells;
}

/** Get a body row by its data-row-id attribute. */
function getRowById(container: HTMLElement, rowId: string): HTMLElement | null {
  return container.querySelector(
    `.${CSS.ROW}[data-row-id="${rowId}"]`,
  ) as HTMLElement | null;
}

function getRenderer(grid: Grid): DomGridRenderer {
  return (grid as unknown as { renderer: DomGridRenderer }).renderer;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("renderer dirty-skip (Phase 3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("update-only visible row refreshes changed cell text", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const rowA = getRowById(container, "a")!;
    expect(rowA).toBeTruthy();
    const nameCell = getCells(rowA)["name"];
    expect(nameCell!.textContent).toBe("Alice");

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    const nameAfter = getCells(getRowById(container, "a")!)["name"];
    expect(nameAfter!.textContent).toBe("Alicia");

    destroyGrid(grid, container);
  });

  it("update-only visible row does not refresh unrelated cell", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    // Spy on textContent setter by patching the cell element.
    const rowA = getRowById(container, "a")!;
    const scoreCell = getCells(rowA)["score"]!;
    const origScore = scoreCell.textContent;
    expect(origScore).toBe("10");

    // Replace the score cell's textContent descriptor to track writes.
    let scoreWriteCount = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    const origSet = descriptor.set!;
    Object.defineProperty(scoreCell, "textContent", {
      get: descriptor.get,
      set(val: string) {
        scoreWriteCount++;
        origSet.call(this, val);
      },
      configurable: true,
    });

    // Update only "name" — "score" should be skipped.
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(scoreWriteCount).toBe(0);
    expect(scoreCell.textContent).toBe("10");

    // Clean up descriptor.
    delete (scoreCell as unknown as Record<string, unknown>).textContent;
    destroyGrid(grid, container);
  });

  it("update-only non-dirty row is not repopulated", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    // Row "b" will not be updated — its cells should not be touched.
    const rowB = getRowById(container, "b")!;
    const bNameCell = getCells(rowB)["name"]!;
    let bNameWriteCount = 0;
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    const origSet = descriptor.set!;
    Object.defineProperty(bNameCell, "textContent", {
      get: descriptor.get,
      set(val: string) {
        bNameWriteCount++;
        origSet.call(this, val);
      },
      configurable: true,
    });

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(bNameWriteCount).toBe(0);
    expect(bNameCell.textContent).toBe("Bob");

    delete (bNameCell as unknown as Record<string, unknown>).textContent;
    destroyGrid(grid, container);
  });

  it("structural add triggers full refresh of existing rows", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    // Mutate row a's name directly so we can detect a full re-render
    // vs. a dirty-skip (which would leave the old text).
    const rowABefore = getRowById(container, "a")!;
    expect(getCells(rowABefore)["name"]!.textContent).toBe("Alice");

    // Structural add — replaces "c" slot with the new row "d" (pool is fixed),
    // and should fully re-render all slots (no dirty-skip).
    grid.applyTransaction({
      add: [{ id: "d", name: "Dave", score: 40 }],
    });
    await flushRenders();

    // After structural add, all visible rows should have correct data.
    const ids = getRows(container).map((r) => r.getAttribute("data-row-id"));
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    // Pool may not have a slot for "d" (only 3 pool slots), but existing
    // rows must be fully refreshed — no dirty-skip.
    expect(getCells(getRowById(container, "a")!)["name"]!.textContent).toBe("Alice");
    expect(getCells(getRowById(container, "b")!)["name"]!.textContent).toBe("Bob");

    destroyGrid(grid, container);
  });

  it("structural remove still renders correctly", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    grid.applyTransaction({ remove: [{ id: "b" }] });
    await flushRenders();

    const ids = getRows(container).map((r) => r.getAttribute("data-row-id"));
    expect(ids).not.toContain("b");
    expect(ids).toContain("a");
    expect(ids).toContain("c");

    destroyGrid(grid, container);
  });

  it("sorted update not touching sort field keeps order and refreshes dirty cell only", async () => {
    const { grid, container } = createGrid();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // Verify initial sort order: a(10), b(20), c(30).
    const sortedIds = getRows(container).map((r) => r.getAttribute("data-row-id"));
    expect(sortedIds).toEqual(["a", "b", "c"]);

    // Spy on row b's name cell to prove it's NOT touched.
    const rowB = getRowById(container, "b")!;
    const bNameCell = getCells(rowB)["name"]!;
    let bWriteCount = 0;
    const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    const origSet = desc.set!;
    Object.defineProperty(bNameCell, "textContent", {
      get: desc.get,
      set(val: string) {
        bWriteCount++;
        origSet.call(this, val);
      },
      configurable: true,
    });

    // Update "name" on row a — sort is on "score" (untouched).
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    // Order preserved.
    const afterIds = getRows(container).map((r) => r.getAttribute("data-row-id"));
    expect(afterIds).toEqual(["a", "b", "c"]);

    // Dirty cell refreshed.
    expect(getCells(getRowById(container, "a")!)["name"]!.textContent).toBe("Alicia");

    // Non-dirty row b not touched.
    expect(bWriteCount).toBe(0);

    delete (bNameCell as unknown as Record<string, unknown>).textContent;
    destroyGrid(grid, container);
  });

  it("sorted update touching sort field falls back to full refresh", async () => {
    const { grid, container } = createGrid();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    // Update "score" — the sort field. Should trigger full re-sort.
    grid.applyTransaction({
      update: [{ id: "a", name: "Alice", score: 100 }],
    });
    await flushRenders();

    // "a" should now be last (score=100).
    const ids = getRows(container).map((r) => r.getAttribute("data-row-id"));
    expect(ids).toEqual(["b", "c", "a"]);
    expect(getCells(getRowById(container, "a")!)["score"]!.textContent).toBe("100");

    destroyGrid(grid, container);
  });

  it("pinned row update refreshes pinned row cells", async () => {
    const { grid, container } = createGrid();
    grid.pinRow("a", "top");
    await flushRenders();

    // Find the pinned row element (in the pinned-top lane).
    const pinnedRows = container.querySelectorAll(
      ".lfg-row-pinned-top-layer .lfg-row",
    );
    expect(pinnedRows.length).toBeGreaterThan(0);
    const pinnedA = Array.from(pinnedRows).find(
      (r) => r.getAttribute("data-row-id") === "a",
    ) as HTMLElement | undefined;
    expect(pinnedA).toBeTruthy();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    // Re-query the pinned row after render.
    const afterPinnedRows = container.querySelectorAll(
      ".lfg-row-pinned-top-layer .lfg-row",
    );
    const afterPinnedA = Array.from(afterPinnedRows).find(
      (r) => r.getAttribute("data-row-id") === "a",
    ) as HTMLElement | undefined;
    expect(afterPinnedA).toBeTruthy();
    const cells = getCells(afterPinnedA!);
    expect(cells["name"]!.textContent).toBe("Alicia");

    destroyGrid(grid, container);
  });

  it("pinned column update refreshes correct pinned and body cell", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true, pinned: "left" },
        { field: "score", sortable: true },
      ],
    });
    await flushRenders();

    // The pinned-left cell for row a should show "Alice".
    const pinnedLeftCells = container.querySelectorAll(
      ".lfg-pinned-left-layer .lfg-cell[data-col-id='name']",
    );
    const pinnedANameCell = Array.from(pinnedLeftCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(pinnedANameCell).toBeTruthy();
    expect(pinnedANameCell!.textContent).toBe("Alice");

    // Update name (pinned) and score (center) for row a.
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 99 }],
    });
    await flushRenders();

    // Pinned cell refreshed.
    const afterPinnedCells = container.querySelectorAll(
      ".lfg-pinned-left-layer .lfg-cell[data-col-id='name']",
    );
    const afterPinnedA = Array.from(afterPinnedCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(afterPinnedA!.textContent).toBe("Alicia");

    // Center body cell refreshed.
    const rowA = getRowById(container, "a")!;
    expect(getCells(rowA)["score"]!.textContent).toBe("99");

    destroyGrid(grid, container);
  });

  it("valueGetter column always refreshes for dirty rows", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "display",
          valueGetter: ({ row }: { row: RowData }) =>
            `${row.name}:${row.score}`,
        },
      ],
    });
    await flushRenders();

    const rowA = getRowById(container, "a")!;
    expect(getCells(rowA)["display"]!.textContent).toBe("Alice:10");

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    const afterA = getRowById(container, "a")!;
    expect(getCells(afterA)["display"]!.textContent).toBe("Alicia:10");

    destroyGrid(grid, container);
  });

  // ── Review follow-up tests ──────────────────────────────────────────

  it("valueFormatter reading another field refreshes when that field is dirty", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          valueFormatter: ({ value, row }: { value: unknown; row: RowData }) =>
            `${String(value)} (${row.name})`,
        },
      ],
    });
    await flushRenders();

    const rowA = getRowById(container, "a")!;
    expect(getCells(rowA)["score"]!.textContent).toBe("10 (Alice)");

    // Update only "name" — the "score" column's valueFormatter reads row.name
    // so the score cell MUST refresh despite "score" field being unchanged.
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(getCells(getRowById(container, "a")!)["score"]!.textContent).toBe(
      "10 (Alicia)",
    );

    destroyGrid(grid, container);
  });

  it("getCellClass reading another field refreshes class state", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          getCellClass: ({ row }: { row: RowData }) =>
            row.name === "Alicia" ? "highlight" : null,
        },
      ],
    });
    await flushRenders();

    const scoreCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(scoreCell.classList.contains("highlight")).toBe(false);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    const afterScoreCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(afterScoreCell.classList.contains("highlight")).toBe(true);

    destroyGrid(grid, container);
  });

  it("cellClassRules reading another field refreshes class state", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          cellClassRules: {
            "high-score": ({ row }: { row: RowData }) =>
              row.name === "Alicia",
          },
        },
      ],
    });
    await flushRenders();

    const scoreCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(scoreCell.classList.contains("high-score")).toBe(false);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    const afterScoreCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(afterScoreCell.classList.contains("high-score")).toBe(true);

    destroyGrid(grid, container);
  });

  it("dot-path column refreshes when top-level key is dirty", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "user.name" },
        { field: "score" },
      ],
      rows: [
        { id: "a", user: { name: "Alice" }, score: 10 },
        { id: "b", user: { name: "Bob" }, score: 20 },
        { id: "c", user: { name: "Carol" }, score: 30 },
      ],
    });
    await flushRenders();

    const rowA = getRowById(container, "a")!;
    expect(getCells(rowA)["user.name"]!.textContent).toBe("Alice");

    // RowStore marks top-level "user" dirty. The column "user.name" must refresh.
    grid.applyTransaction({
      update: [{ id: "a", user: { name: "Alicia" }, score: 10 }],
    });
    await flushRenders();

    expect(
      getCells(getRowById(container, "a")!)["user.name"]!.textContent,
    ).toBe("Alicia");

    destroyGrid(grid, container);
  });

  it("pinned dot-path column refreshes when top-level key is dirty", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "user.name", pinned: "left" },
        { field: "score" },
      ],
      rows: [
        { id: "a", user: { name: "Alice" }, score: 10 },
        { id: "b", user: { name: "Bob" }, score: 20 },
        { id: "c", user: { name: "Carol" }, score: 30 },
      ],
    });
    await flushRenders();

    const pinnedCells = container.querySelectorAll(
      ".lfg-pinned-left-layer .lfg-cell[data-col-id='user.name']",
    );
    const pinnedA = Array.from(pinnedCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(pinnedA).toBeTruthy();
    expect(pinnedA!.textContent).toBe("Alice");

    grid.applyTransaction({
      update: [{ id: "a", user: { name: "Alicia" }, score: 10 }],
    });
    await flushRenders();

    const afterPinnedCells = container.querySelectorAll(
      ".lfg-pinned-left-layer .lfg-cell[data-col-id='user.name']",
    );
    const afterA = Array.from(afterPinnedCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(afterA!.textContent).toBe("Alicia");

    destroyGrid(grid, container);
  });

  it("with virtualization, updating non-visible row does not touch visible DOM", async () => {
    const rows: RowData[] = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: false,
      suppressColumnVirtualization: true,
    });
    await flushRenders();

    // Get visible rows — with virtualization, only a subset is rendered.
    const visibleRows = getRows(container);
    expect(visibleRows.length).toBeLessThan(100);
    expect(visibleRows.length).toBeGreaterThan(0);

    // Track writes on the first visible row's name cell.
    const firstVisible = visibleRows[0]!;
    const firstId = firstVisible.getAttribute("data-row-id")!;
    const nameCell = getCells(firstVisible)["name"]!;
    let writeCount = 0;
    const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    const origSet = desc.set!;
    Object.defineProperty(nameCell, "textContent", {
      get: desc.get,
      set(val: string) {
        writeCount++;
        origSet.call(this, val);
      },
      configurable: true,
    });

    // Update a row that is NOT visible (row 99 is far off-screen).
    grid.applyTransaction({
      update: [{ id: "99", name: "updated-99", score: 99 }],
    });
    await flushRenders();

    // Visible row should not have been touched.
    expect(writeCount).toBe(0);
    expect(nameCell.textContent).toBe(`row-${firstId}`);

    delete (nameCell as unknown as Record<string, unknown>).textContent;
    destroyGrid(grid, container);
  });

  it("onRowDataUpdated calling getSelectedRows does not consume dirty metadata", async () => {
    let callbackFired = false;
    const { grid, container } = createGrid({
      onRowDataUpdated: () => {
        // This calls getSnapshot() internally — must not drain dirty metadata.
        grid.getSelectedRows();
        callbackFired = true;
      },
    });
    await flushRenders();

    const rowA = getRowById(container, "a")!;
    expect(getCells(rowA)["name"]!.textContent).toBe("Alice");

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });

    expect(callbackFired).toBe(true);

    await flushRenders();

    // Dirty metadata must still have reached the renderer.
    expect(getCells(getRowById(container, "a")!)["name"]!.textContent).toBe(
      "Alicia",
    );

    destroyGrid(grid, container);
  });
});

// ── Phase 4: Targeted dirty-patch fast path ──────────────────────────

describe("renderer dirty-patch (Phase 4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("single dirty row triggers dirty-patch path and increments counter", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);
    expect(r._fullRenderCount).toBe(1);
    expect(r._dirtyPatchRenderCount).toBe(0);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchedRowCount).toBe(1);
    expect(r._fullRenderCount).toBe(1);
    expect(getCells(getRowById(container, "a")!)["name"]!.textContent).toBe("Alicia");

    destroyGrid(grid, container);
  });

  it("multi-row dirty triggers dirty-patch with correct patched count", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [
        { id: "a", name: "Alicia", score: 10 },
        { id: "b", name: "Bobby", score: 20 },
      ],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchedRowCount).toBe(2);
    expect(r._fullRenderCount).toBe(1);
    expect(getCells(getRowById(container, "a")!)["name"]!.textContent).toBe("Alicia");
    expect(getCells(getRowById(container, "b")!)["name"]!.textContent).toBe("Bobby");

    destroyGrid(grid, container);
  });

  it("structural add falls back to full render", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      add: [{ id: "d", name: "Dave", score: 40 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBe(2);
    expect(r._dirtyPatchRenderCount).toBe(0);

    destroyGrid(grid, container);
  });

  it("column width change falls back to full render", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);

    grid.setColumns([
      { field: "name", sortable: true, width: 200 },
      { field: "score", sortable: true },
    ]);
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBe(2);
    expect(r._dirtyPatchRenderCount).toBe(0);

    destroyGrid(grid, container);
  });

  it("sort model change falls back to full render", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);

    grid.setSortModel([{ field: "score", sort: "desc" }]);
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBe(2);
    expect(r._dirtyPatchRenderCount).toBe(0);

    destroyGrid(grid, container);
  });

  it("row selection config change falls back to full render", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);

    grid.setRowSelection({ mode: "multiple" });
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBe(2);
    expect(r._dirtyPatchRenderCount).toBe(0);

    destroyGrid(grid, container);
  });

  it("invisible dirty row increments skipped counter", async () => {
    const rows: RowData[] = Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: false,
      suppressColumnVirtualization: true,
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "99", name: "updated-99", score: 99 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtySkippedInvisibleRowCount).toBe(1);
    expect(r._dirtyPatchedRowCount).toBe(0);

    destroyGrid(grid, container);
  });

  it("pinned row dirty is patched in lane", async () => {
    const { grid, container } = createGrid();
    grid.pinRow("a", "top");
    await flushRenders();

    const r = getRenderer(grid);
    const beforePatch = r._dirtyPatchRenderCount;

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(beforePatch + 1);
    expect(r._dirtyPatchedRowCount).toBeGreaterThanOrEqual(1);

    const pinnedRows = container.querySelectorAll(
      ".lfg-row-pinned-top-layer .lfg-row",
    );
    const pinnedA = Array.from(pinnedRows).find(
      (r) => r.getAttribute("data-row-id") === "a",
    ) as HTMLElement | undefined;
    expect(pinnedA).toBeTruthy();
    expect(getCells(pinnedA!)["name"]!.textContent).toBe("Alicia");

    destroyGrid(grid, container);
  });

  it("consecutive dirty-patches accumulate counters", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "b", name: "Bobby", score: 20 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(2);
    expect(r._dirtyPatchedRowCount).toBe(2);
    expect(r._fullRenderCount).toBe(1);

    destroyGrid(grid, container);
  });

  it("pagination page change before transaction falls back to full render", async () => {
    const { grid, container } = createGrid({
      rows: Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        name: `row-${i}`,
        score: i,
      })),
      pagination: true,
      paginationPageSize: 5,
    });
    await flushRenders();

    const r = getRenderer(grid);
    expect(r._fullRenderCount).toBe(1);

    grid.setPageIndex(1);
    grid.applyTransaction({
      update: [{ id: "0", name: "updated-0", score: 0 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBe(2);
    expect(r._dirtyPatchRenderCount).toBe(0);

    destroyGrid(grid, container);
  });

  it("pinned left/right column dirty-patch refreshes pinned cells", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true, pinned: "left" },
        { field: "score", sortable: true },
        { field: "extra", pinned: "right" },
      ],
      rows: [
        { id: "a", name: "Alice", score: 10, extra: "x" },
        { id: "b", name: "Bob", score: 20, extra: "y" },
        { id: "c", name: "Carol", score: 30, extra: "z" },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 99, extra: "X" }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);

    // Left pinned cell refreshed.
    const leftCells = container.querySelectorAll(
      ".lfg-pinned-left-layer .lfg-cell[data-col-id='name']",
    );
    const leftA = Array.from(leftCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(leftA).toBeTruthy();
    expect(leftA!.textContent).toBe("Alicia");

    // Right pinned cell refreshed.
    const rightCells = container.querySelectorAll(
      ".lfg-pinned-right-layer .lfg-cell[data-col-id='extra']",
    );
    const rightA = Array.from(rightCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-right-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(rightA).toBeTruthy();
    expect(rightA!.textContent).toBe("X");

    // Center cell refreshed.
    expect(getCells(getRowById(container, "a")!)["score"]!.textContent).toBe("99");

    destroyGrid(grid, container);
  });

  it("bottom pinned row dirty-patch refreshes lane cells", async () => {
    const { grid, container } = createGrid();
    grid.pinRow("c", "bottom");
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "c", name: "Carlos", score: 30 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);

    const bottomRows = container.querySelectorAll(
      ".lfg-row-pinned-bottom-layer .lfg-row",
    );
    const bottomC = Array.from(bottomRows).find(
      (r) => r.getAttribute("data-row-id") === "c",
    ) as HTMLElement | undefined;
    expect(bottomC).toBeTruthy();
    expect(getCells(bottomC!)["name"]!.textContent).toBe("Carlos");

    destroyGrid(grid, container);
  });

  it("valueFormatter refreshes on dirty-patch path", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          valueFormatter: ({ value, row }: { value: unknown; row: RowData }) =>
            `${String(value)} (${row.name})`,
        },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 99 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(getCells(getRowById(container, "a")!)["score"]!.textContent).toBe(
      "99 (Alicia)",
    );

    destroyGrid(grid, container);
  });

  it("getCellClass refreshes on dirty-patch path", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          getCellClass: ({ row }: { row: RowData }) =>
            row.name === "Alicia" ? "highlight" : null,
        },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);
    const scoreCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(scoreCell.classList.contains("highlight")).toBe(false);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    const afterCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(afterCell.classList.contains("highlight")).toBe(true);

    destroyGrid(grid, container);
  });

  it("cellClassRules refreshes on dirty-patch path", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          cellClassRules: {
            "high-score": ({ row }: { row: RowData }) =>
              row.name === "Alicia",
          },
        },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);
    const scoreCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(scoreCell.classList.contains("high-score")).toBe(false);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    const afterCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(afterCell.classList.contains("high-score")).toBe(true);

    destroyGrid(grid, container);
  });

  it("cell-styling change before dirty render falls back to full render", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        { field: "score", sortable: true },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    // Add getCellClass to score column — changes cell-styling fingerprint.
    grid.setColumns([
      { field: "name", sortable: true },
      {
        field: "score",
        sortable: true,
        getCellClass: ({ row }: { row: RowData }) =>
          (row.score as number) > 50 ? "high" : null,
      },
    ]);
    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBe(2);
    expect(r._dirtyPatchRenderCount).toBe(0);

    destroyGrid(grid, container);
  });
});

// ── Phase 5: Index-based dirty-patch (no pool scan) ──────────────────

describe("renderer dirty-patch index (Phase 5)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("large suppressRowVirtualization grid: one dirty row, no pool scan", async () => {
    const rows: RowData[] = Array.from({ length: 1200 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    await flushRenders();

    const r = getRenderer(grid);
    expect(r._fullRenderCount).toBe(1);

    grid.applyTransaction({
      update: [{ id: "500", name: "updated-500", score: 500 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchedRowCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(r._dirtyPatchLookupMissCount).toBe(0);
    expect(r._dirtyPatchIndexRebuildCount).toBe(0);
    expect(r._dirtyPatchPoolScanCount).toBe(0);
    expect(r._fullRenderCount).toBe(1);
    expect(
      getCells(getRowById(container, "500")!)["name"]!.textContent,
    ).toBe("updated-500");

    destroyGrid(grid, container);
  });

  it("virtualized grid: offscreen dirty row skipped via index miss", async () => {
    const rows: RowData[] = Array.from({ length: 200 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: false,
      suppressColumnVirtualization: true,
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "199", name: "updated-199", score: 199 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupMissCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(0);
    expect(r._dirtyPatchedRowCount).toBe(0);
    expect(r._dirtySkippedInvisibleRowCount).toBe(1);

    destroyGrid(grid, container);
  });

  it("pinned top row patches through index", async () => {
    const { grid, container } = createGrid();
    grid.pinRow("a", "top");
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(r._dirtyPatchLookupMissCount).toBe(0);
    expect(r._dirtyPatchIndexRebuildCount).toBe(0);
    expect(r._dirtyPatchPoolScanCount).toBe(0);

    const pinnedRows = container.querySelectorAll(
      ".lfg-row-pinned-top-layer .lfg-row",
    );
    const pinnedA = Array.from(pinnedRows).find(
      (el) => el.getAttribute("data-row-id") === "a",
    ) as HTMLElement | undefined;
    expect(pinnedA).toBeTruthy();
    expect(getCells(pinnedA!)["name"]!.textContent).toBe("Alicia");

    destroyGrid(grid, container);
  });

  it("pinned bottom row patches through index", async () => {
    const { grid, container } = createGrid();
    grid.pinRow("c", "bottom");
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "c", name: "Carlos", score: 30 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(r._dirtyPatchIndexRebuildCount).toBe(0);
    expect(r._dirtyPatchPoolScanCount).toBe(0);

    const bottomRows = container.querySelectorAll(
      ".lfg-row-pinned-bottom-layer .lfg-row",
    );
    const bottomC = Array.from(bottomRows).find(
      (el) => el.getAttribute("data-row-id") === "c",
    ) as HTMLElement | undefined;
    expect(bottomC).toBeTruthy();
    expect(getCells(bottomC!)["name"]!.textContent).toBe("Carlos");

    destroyGrid(grid, container);
  });

  it("pinned left/right columns patch through index", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true, pinned: "left" },
        { field: "score", sortable: true },
        { field: "extra", pinned: "right" },
      ],
      rows: [
        { id: "a", name: "Alice", score: 10, extra: "x" },
        { id: "b", name: "Bob", score: 20, extra: "y" },
        { id: "c", name: "Carol", score: 30, extra: "z" },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 99, extra: "X" }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);

    // Left pinned.
    const leftCells = container.querySelectorAll(
      ".lfg-pinned-left-layer .lfg-cell[data-col-id='name']",
    );
    const leftA = Array.from(leftCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(leftA!.textContent).toBe("Alicia");

    // Right pinned.
    const rightCells = container.querySelectorAll(
      ".lfg-pinned-right-layer .lfg-cell[data-col-id='extra']",
    );
    const rightA = Array.from(rightCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-right-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(rightA!.textContent).toBe("X");

    // Center.
    expect(getCells(getRowById(container, "a")!)["score"]!.textContent).toBe("99");

    destroyGrid(grid, container);
  });

  it("valueFormatter refreshes via indexed dirty-patch", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          valueFormatter: ({ value, row }: { value: unknown; row: RowData }) =>
            `${String(value)} (${row.name})`,
        },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 99 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(getCells(getRowById(container, "a")!)["score"]!.textContent).toBe(
      "99 (Alicia)",
    );

    destroyGrid(grid, container);
  });

  it("getCellClass refreshes via indexed dirty-patch", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          getCellClass: ({ row }: { row: RowData }) =>
            row.name === "Alicia" ? "highlight" : null,
        },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    const afterCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(afterCell.classList.contains("highlight")).toBe(true);

    destroyGrid(grid, container);
  });

  it("cellClassRules refreshes via indexed dirty-patch", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true },
        {
          field: "score",
          sortable: true,
          cellClassRules: {
            "high-score": ({ row }: { row: RowData }) =>
              row.name === "Alicia",
          },
        },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    const afterCell = getCells(getRowById(container, "a")!)["score"]!;
    expect(afterCell.classList.contains("high-score")).toBe(true);

    destroyGrid(grid, container);
  });

  // ── Phase 5 hardening: zero-scan / zero-rebuild regressions ──────────

  it("large grid + pinned row: dirty pinned row patches with zero index rebuild", async () => {
    const rows: RowData[] = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.pinRow("10", "top");
    await flushRenders();

    const r = getRenderer(grid);
    r._dirtyPatchIndexRebuildCount = 0;
    r._dirtyPatchPoolScanCount = 0;

    grid.applyTransaction({
      update: [{ id: "10", name: "pinned-updated", score: 10 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchIndexRebuildCount).toBe(0);
    expect(r._dirtyPatchPoolScanCount).toBe(0);
    expect(r._dirtyPatchLookupHitCount).toBe(1);

    const pinnedRows = container.querySelectorAll(
      ".lfg-row-pinned-top-layer .lfg-row",
    );
    const pinned10 = Array.from(pinnedRows).find(
      (el) => el.getAttribute("data-row-id") === "10",
    ) as HTMLElement | undefined;
    expect(pinned10).toBeTruthy();
    expect(getCells(pinned10!)["name"]!.textContent).toBe("pinned-updated");

    destroyGrid(grid, container);
  });

  it("large grid + pinned state: dirty non-pinned row patches with zero scan", async () => {
    const rows: RowData[] = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.pinRow("0", "top");
    grid.pinRow("1", "bottom");
    await flushRenders();

    const r = getRenderer(grid);
    r._dirtyPatchIndexRebuildCount = 0;
    r._dirtyPatchPoolScanCount = 0;

    grid.applyTransaction({
      update: [{ id: "250", name: "body-updated", score: 250 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchIndexRebuildCount).toBe(0);
    expect(r._dirtyPatchPoolScanCount).toBe(0);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(r._dirtyPatchLookupMissCount).toBe(0);
    expect(
      getCells(getRowById(container, "250")!)["name"]!.textContent,
    ).toBe("body-updated");

    destroyGrid(grid, container);
  });

  it("virtualized scroll then update visible row patches via index", async () => {
    const rows: RowData[] = Array.from({ length: 200 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: false,
      suppressColumnVirtualization: true,
    });
    await flushRenders();

    // Scroll down to bring row 100 into view.
    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = 100 * 40;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;

    grid.applyTransaction({
      update: [{ id: "100", name: "scroll-updated", score: 100 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchIndexRebuildCount).toBe(0);
    expect(r._dirtyPatchPoolScanCount).toBe(0);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(r._dirtyPatchedRowCount).toBe(1);
    expect(r._fullRenderCount).toBe(fullBefore);
    expect(
      getCells(getRowById(container, "100")!)["name"]!.textContent,
    ).toBe("scroll-updated");

    destroyGrid(grid, container);
  });
});

// ── Phase 6: Formalized render metadata + scroll optimization ────────

describe("renderer change-set metadata (Phase 6)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("RenderChangeSet is not exported from root index", async () => {
    // The public barrel should not expose internal render types.
    const rootExports = await import("../../index");
    expect("RenderChangeSet" in rootExports).toBe(false);
  });

  it("GridSnapshot does not have renderChangeSet property", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const snapshot = (grid as unknown as { state: { getSnapshot(): Record<string, unknown> } }).state.getSnapshot();
    expect("renderChangeSet" in snapshot).toBe(false);

    destroyGrid(grid, container);
  });

  it("renderer internal snapshot can carry renderChangeSet", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 10 }],
    });
    await flushRenders();

    const r = getRenderer(grid);
    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(getCells(getRowById(container, "a")!)["name"]!.textContent).toBe(
      "Alicia",
    );

    destroyGrid(grid, container);
  });

  it("horizontal-only scroll does not rebuild row indexes", async () => {
    const colCount = 50;
    const columns = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 80,
    }));
    const rows: RowData[] = Array.from({ length: 20 }, (_, r) => {
      const row: Record<string, unknown> = { id: `r${r}` };
      for (let i = 0; i < colCount; i++) row[`c${i}`] = `${r}-${i}`;
      return row;
    });
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "300px" });
    document.body.appendChild(container);
    const grid = new Grid({
      rows,
      columns,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
      getRowId: (row) => (row as { id: string }).id,
    });
    grid.mount(container);
    await flushRenders();

    const r = getRenderer(grid);
    const rebuildsBefore = r._rowIndexRebuildCount;

    // Pure horizontal scroll — row bindings should not change.
    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 200;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    expect(r._rowIndexRebuildCount).toBe(rebuildsBefore);

    grid.destroy();
    container.remove();
  });

  it("vertical scroll does rebuild row indexes", async () => {
    const rows: RowData[] = Array.from({ length: 200 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      suppressRowVirtualization: false,
      suppressColumnVirtualization: true,
    });
    await flushRenders();

    const r = getRenderer(grid);
    const rebuildsBefore = r._rowIndexRebuildCount;

    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollTop = 100 * 40;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    expect(r._rowIndexRebuildCount).toBeGreaterThan(rebuildsBefore);

    destroyGrid(grid, container);
  });

  it("dirty patch still works for body rows after metadata rename", async () => {
    const { grid, container } = createGrid();
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "b", name: "Bobby", score: 20 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);
    expect(getCells(getRowById(container, "b")!)["name"]!.textContent).toBe(
      "Bobby",
    );

    destroyGrid(grid, container);
  });

  it("dirty patch works for pinned top/bottom after metadata rename", async () => {
    const { grid, container } = createGrid();
    grid.pinRow("a", "top");
    grid.pinRow("c", "bottom");
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [
        { id: "a", name: "Alicia", score: 10 },
        { id: "c", name: "Carlos", score: 30 },
      ],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);

    const topPinned = Array.from(
      container.querySelectorAll(".lfg-row-pinned-top-layer .lfg-row"),
    ).find((el) => el.getAttribute("data-row-id") === "a") as HTMLElement;
    expect(getCells(topPinned)["name"]!.textContent).toBe("Alicia");

    const bottomPinned = Array.from(
      container.querySelectorAll(".lfg-row-pinned-bottom-layer .lfg-row"),
    ).find((el) => el.getAttribute("data-row-id") === "c") as HTMLElement;
    expect(getCells(bottomPinned)["name"]!.textContent).toBe("Carlos");

    destroyGrid(grid, container);
  });

  it("dirty patch works for pinned left/right after metadata rename", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true, pinned: "left" },
        { field: "score", sortable: true },
        { field: "extra", pinned: "right" },
      ],
      rows: [
        { id: "a", name: "Alice", score: 10, extra: "x" },
        { id: "b", name: "Bob", score: 20, extra: "y" },
      ],
    });
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "a", name: "Alicia", score: 99, extra: "X" }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);

    const leftCells = container.querySelectorAll(
      ".lfg-pinned-left-layer .lfg-cell[data-col-id='name']",
    );
    const leftA = Array.from(leftCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(leftA!.textContent).toBe("Alicia");

    const rightCells = container.querySelectorAll(
      ".lfg-pinned-right-layer .lfg-cell[data-col-id='extra']",
    );
    const rightA = Array.from(rightCells).find((cell) => {
      const row = cell.closest(".lfg-pinned-right-row");
      return row?.getAttribute("data-row-id") === "a";
    }) as HTMLElement | undefined;
    expect(rightA!.textContent).toBe("X");

    destroyGrid(grid, container);
  });

  it("sort-field update still falls back to full render", async () => {
    const { grid, container } = createGrid();
    grid.setSortModel([{ field: "score", sort: "asc" }]);
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;

    grid.applyTransaction({
      update: [{ id: "a", name: "Alice", score: 999 }],
    });
    await flushRenders();

    expect(r._fullRenderCount).toBeGreaterThan(fullBefore);
    expect(r._dirtyPatchRenderCount).toBe(0);

    destroyGrid(grid, container);
  });

  it("pagination page change still falls back to full render", async () => {
    const rows: RowData[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      name: `row-${i}`,
      score: i,
    }));
    const { grid, container } = createGrid({
      rows,
      pagination: true,
      paginationPageSize: 5,
    });
    await flushRenders();

    grid.setPageIndex(1);
    await flushRenders();

    const r = getRenderer(grid);

    grid.applyTransaction({
      update: [{ id: "5", name: "updated-5", score: 5 }],
    });
    await flushRenders();

    expect(r._dirtyPatchRenderCount).toBe(1);
    expect(r._dirtyPatchLookupHitCount).toBe(1);

    grid.setPageIndex(0);
    await flushRenders();

    expect(r._fullRenderCount).toBeGreaterThan(0);

    destroyGrid(grid, container);
  });
});

describe("no-op config churn does not trigger full render", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("equivalent setDefaultColDef after cell edit does not cause extra full render", async () => {
    const { grid, container } = createGrid({
      columns: [
        { field: "name", sortable: true, filter: "text" },
        { field: "score", sortable: true },
      ],
      defaultColDef: { sortable: true, filter: true, resizable: true },
    });
    await flushRenders();

    grid.setFilterModel({
      name: { type: "text", operator: "and", conditions: [{ operator: "contains", value: "o" }] },
    });
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;

    grid.applyTransaction({
      update: [{ id: "b", name: "Bob", score: 99 }],
    });
    await flushRenders();

    grid.setDefaultColDef({ sortable: true, filter: true, resizable: true });
    await flushRenders();

    expect(r._fullRenderCount).toBe(fullBefore);

    destroyGrid(grid, container);
  });

  it("no-op setRowSelection does not trigger full render", async () => {
    const { grid, container } = createGrid({
      rowSelection: { mode: "multiple", checkboxes: true, headerCheckbox: true },
    });
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;

    grid.setRowSelection({ mode: "multiple", checkboxes: true, headerCheckbox: true });
    await flushRenders();

    expect(r._fullRenderCount).toBe(fullBefore);

    destroyGrid(grid, container);
  });

  it("equivalent setColumnMenu does not schedule render", async () => {
    const menuConfig = {
      enabled: true,
      filter: { enabled: true, placement: "dedicatedMenu" as const },
      headerIcons: { sortAsc: "▲", sortDesc: "▼" },
    };
    const { grid, container } = createGrid({ columnMenu: menuConfig });
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;

    grid.setColumnMenu({
      enabled: true,
      filter: { enabled: true, placement: "dedicatedMenu" },
      headerIcons: { sortAsc: "▲", sortDesc: "▼" },
    });
    await flushRenders();

    expect(r._fullRenderCount).toBe(fullBefore);

    destroyGrid(grid, container);
  });

  it("changed headerIcons still triggers render", async () => {
    const { grid, container } = createGrid({
      columnMenu: { headerIcons: { sortAsc: "▲" } },
    });
    await flushRenders();

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;

    grid.setColumnMenu({ headerIcons: { sortAsc: "UP" } });
    await flushRenders();

    expect(r._fullRenderCount).toBeGreaterThan(fullBefore);

    destroyGrid(grid, container);
  });

  it("preserves floating filter row after viewport resize rebuilds header pool", async () => {
    const columns = Array.from({ length: 30 }, (_, i) => ({
      field: `c${i}`,
      headerName: `C${i}`,
      filterable: true,
    }));
    const container = document.createElement("div");
    container.style.width = "300px";
    container.style.height = "400px";
    document.body.appendChild(container);

    const grid = new Grid({
      columns,
      rows: [{ id: "1", c0: "alpha" }],
      getRowId: (row) => row.id,
      floatingFilters: true,
      suppressRowVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const renderer = getRenderer(grid);
    const viewport = container.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    const rootEl = container.querySelector(`.${CSS.GRID}`) as HTMLElement;

    Object.defineProperty(viewport, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });

    expect(container.querySelector(".lfg-floating-filter-input")).not.toBeNull();
    const headerHeightBefore = rootEl.style.getPropertyValue("--lfg-header-height");
    expect(headerHeightBefore).not.toBe("");

    Object.defineProperty(viewport, "clientWidth", { value: 900, configurable: true });
    (renderer as unknown as { onViewportResize(): void }).onViewportResize();
    await flushRenders();

    expect(container.querySelector(".lfg-floating-filter-input")).not.toBeNull();
    expect(rootEl.style.getPropertyValue("--lfg-header-height")).toBe(headerHeightBefore);

    grid.destroy();
    container.remove();
  });
});
