// @vitest-environment jsdom
//
// Renderer / window-sync integration tests for cell styling (center body
// columns only). Drives the full prop → snapshot → DomGridRenderer →
// VirtualWindowSync → populateRow / rebindCells path.

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { CSS } from "../../../rendering/const/css-classes";
import * as populateRowModule from "../../../rendering/helpers/populateRow";
import type { ColumnDef, RowData } from "../../../types";
import type {
  CellClassParams,
  CellClassRules,
  GetCellClass,
} from "..";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

const rows: RowData[] = [
  { id: "r1", name: "Alice", amount: 100 },
  { id: "r2", name: "Bob", amount: -5 },
  { id: "r3", name: "Carol", amount: 9000 },
];

function getRoot(container: HTMLElement): HTMLElement {
  return container.querySelector(`.${CSS.GRID}`) as HTMLElement;
}

function getCenterRow(root: HTMLElement, rowId: string): HTMLElement | null {
  const sc = root.querySelector(`.${CSS.SCROLL_CONTAINER}`);
  if (!sc) return null;
  return sc.querySelector<HTMLElement>(
    `:scope > .${CSS.ROW}[data-row-id="${rowId}"]`,
  );
}

function getCell(root: HTMLElement, rowId: string, field: string): HTMLElement | null {
  const rowEl = getCenterRow(root, rowId);
  if (!rowEl) return null;
  return rowEl.querySelector<HTMLElement>(`.${CSS.CELL}[data-col-id="${field}"]`);
}

function makeGrid(columns: ColumnDef[], opts?: {
  suppressColumnVirtualization?: boolean;
  rowsOverride?: RowData[];
}) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "300px", width: "400px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: opts?.rowsOverride ?? rows,
    columns,
    getRowId: (row) => row.id as string,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: opts?.suppressColumnVirtualization ?? true,
  });
  grid.mount(container);
  return { grid, container };
}

describe("cell styling: renderer / window-sync integration (center body)", () => {
  let grid: Grid;
  let container: HTMLElement;

  afterEach(() => {
    grid.destroy();
    container.remove();
  });

  it("center cells receive classes from column `cellClass`", async () => {
    ({ grid, container } = makeGrid([
      { field: "id" },
      { field: "amount", cellClass: "money" },
    ]));
    await flushRenders();

    const root = getRoot(container);
    for (const r of rows) {
      const amountCell = getCell(root, r.id as string, "amount")!;
      expect(amountCell.classList.contains("money")).toBe(true);
      // Other column does not get the class.
      const idCell = getCell(root, r.id as string, "id")!;
      expect(idCell.classList.contains("money")).toBe(false);
    }
  });

  it("`getCellClass` works through the renderer path and receives full params", async () => {
    const seen: CellClassParams[] = [];
    const getCellClass: GetCellClass = (p) => {
      seen.push(p);
      return typeof p.value === "number" && p.value < 0 ? "neg" : "pos";
    };
    ({ grid, container } = makeGrid([
      { field: "id" },
      { field: "amount", getCellClass },
    ]));
    await flushRenders();

    const root = getRoot(container);
    expect(getCell(root, "r1", "amount")!.classList.contains("pos")).toBe(true);
    expect(getCell(root, "r2", "amount")!.classList.contains("neg")).toBe(true);
    expect(getCell(root, "r3", "amount")!.classList.contains("pos")).toBe(true);

    // Params carry column, field, raw value, rowId, grid.
    const aliceCall = seen.find((p) => p.rowId === "r1");
    expect(aliceCall).toBeDefined();
    expect(aliceCall!.field).toBe("amount");
    expect(aliceCall!.column.field).toBe("amount");
    expect(aliceCall!.value).toBe(100);
    expect(aliceCall!.grid).toBe(grid);
  });

  it("`cellClassRules` works through the renderer path", async () => {
    const rules: CellClassRules = {
      "cell-big": (p) => typeof p.value === "number" && p.value > 1000,
      "cell-negative": (p) => typeof p.value === "number" && p.value < 0,
    };
    ({ grid, container } = makeGrid([
      { field: "id" },
      { field: "amount", cellClassRules: rules },
    ]));
    await flushRenders();

    const root = getRoot(container);
    expect(getCell(root, "r3", "amount")!.classList.contains("cell-big")).toBe(true);
    expect(getCell(root, "r1", "amount")!.classList.contains("cell-big")).toBe(false);
    expect(getCell(root, "r2", "amount")!.classList.contains("cell-negative")).toBe(true);
  });

  it("raw (pre-format) value is passed to the resolver while text uses the formatter", async () => {
    const seen: unknown[] = [];
    ({ grid, container } = makeGrid([
      {
        field: "amount",
        valueFormatter: ({ value }) => `$${String(value)}`,
        getCellClass: (p) => {
          seen.push(p.value);
          return [];
        },
      },
    ]));
    await flushRenders();

    const root = getRoot(container);
    // Resolver saw raw numbers; cell text used formatted strings.
    expect(seen).toContain(100);
    expect(getCell(root, "r1", "amount")!.textContent).toBe("$100");
  });

  // ── Horizontal virtualization ────────────────────────────────────────

  it("recycled entering cells apply correct cell-styling classes after horizontal scroll", async () => {
    const colCount = 60;
    const cols: ColumnDef[] = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 100,
      // Every column styles its cell with a column-specific class so we can
      // assert that entering cells get the right column's class.
      getCellClass: (p: CellClassParams) => `styled-${p.field}`,
    }));
    const wideRows: RowData[] = Array.from({ length: 5 }, (_, r) => {
      const row: Record<string, unknown> = { id: `r${r}` };
      for (let i = 0; i < colCount; i++) row[`c${i}`] = `${r}-${i}`;
      return row as RowData;
    });
    ({ grid, container } = makeGrid(cols, {
      suppressColumnVirtualization: false,
      rowsOverride: wideRows,
    }));
    await flushRenders();

    const root = getRoot(container);
    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 2500;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    // A column now in the scrolled window should carry its own styled class.
    // Find any bound cell in row r0 and verify its class matches its col id.
    const r0 = getCenterRow(root, "r0")!;
    const styledCells = Array.from(
      r0.querySelectorAll<HTMLElement>(`.${CSS.CELL}[data-col-id]`),
    ).filter((c) => c.style.display !== "none");
    expect(styledCells.length).toBeGreaterThan(0);
    for (const cell of styledCells) {
      const field = cell.getAttribute("data-col-id")!;
      expect(cell.classList.contains(`styled-${field}`)).toBe(true);
    }
  });

  it("recycled cells drain stale cell classes when moving from a styled to an unstyled column", async () => {
    // Only c0 is styled; the rest are unstyled. After horizontal scroll the
    // physical cell that held c0 recycles to an unstyled column and must
    // drop the c0 managed class.
    const colCount = 60;
    const cols: ColumnDef[] = Array.from({ length: colCount }, (_, i) => ({
      field: `c${i}`,
      width: 100,
      ...(i === 0 ? { cellClass: "first-col-style" } : {}),
    }));
    const wideRows: RowData[] = Array.from({ length: 5 }, (_, r) => {
      const row: Record<string, unknown> = { id: `r${r}` };
      for (let i = 0; i < colCount; i++) row[`c${i}`] = `${r}-${i}`;
      return row as RowData;
    });
    ({ grid, container } = makeGrid(cols, {
      suppressColumnVirtualization: false,
      rowsOverride: wideRows,
    }));
    await flushRenders();

    const root = getRoot(container);
    // Sanity: c0 is styled before scroll.
    expect(getCell(root, "r0", "c0")!.classList.contains("first-col-style")).toBe(true);

    const viewport = root.querySelector(`.${CSS.VIEWPORT}`) as HTMLElement;
    viewport.scrollLeft = 2500;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();
    await flushRenders();

    // c0 is now out of window. No currently-bound cell should carry the
    // first-col-style class — it must have drained on recycle.
    const r0 = getCenterRow(root, "r0")!;
    const stillStyled = Array.from(
      r0.querySelectorAll<HTMLElement>(`.${CSS.CELL}`),
    ).filter(
      (c) => c.style.display !== "none" && c.classList.contains("first-col-style"),
    );
    expect(stillStyled.length).toBe(0);
  });

  // ── No styling → no resolver ─────────────────────────────────────────

  it("does not invoke the cell-styling resolver when no column has cell styling", async () => {
    const resolveSpy = vi.spyOn(populateRowModule, "applyManagedCellClasses");
    ({ grid, container } = makeGrid([
      { field: "id" },
      { field: "amount" },
      { field: "name" },
    ]));
    await flushRenders();

    // No column carries cell styling → renderer passes no resolver → the
    // managed-class apply helper is never called.
    expect(resolveSpy).not.toHaveBeenCalled();
    resolveSpy.mockRestore();
  });

  // ── Value pipeline not duplicated ────────────────────────────────────

  it("does not duplicate valueGetter / valueFormatter when cell styling is active", async () => {
    const getter = vi.fn(({ row }: { row: RowData }) => (row as { amount: number }).amount);
    const formatter = vi.fn(({ value }: { value: unknown }) => `$${String(value)}`);
    ({ grid, container } = makeGrid([
      {
        field: "amount",
        valueGetter: getter,
        valueFormatter: formatter,
        getCellClass: () => "money",
      },
    ]));
    await flushRenders();

    // One getter + one formatter call per visible row (3 rows). The resolver
    // shares the raw value from the same pipeline pass — no duplication.
    expect(getter).toHaveBeenCalledTimes(rows.length);
    expect(formatter).toHaveBeenCalledTimes(rows.length);
  });

  // ── Unrelated render does not rerun resolver for unchanged pooled rows ─

  it("unrelated render with same cellClassVersion does not rerun the resolver for unchanged rows", async () => {
    const getCellClass = vi.fn((_p: CellClassParams): string => "money");
    ({ grid, container } = makeGrid([
      { field: "id" },
      { field: "amount", getCellClass },
    ]));
    await flushRenders();
    const callsAfterMount = getCellClass.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // A row-selection mutation triggers a render but does NOT change column
    // cell-styling inputs → cellClassVersion is stable → populateRow's outer
    // dirty-skip + cell-styling fast-pass version check skip the resolver.
    grid.setSelectedRowIds(["r1"]);
    await flushRenders();

    expect(getCellClass.mock.calls.length).toBe(callsAfterMount);
  });
});
