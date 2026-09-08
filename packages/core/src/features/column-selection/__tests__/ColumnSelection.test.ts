// @vitest-environment jsdom

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import { VirtualWindowSync } from "../../../rendering/ring-buffer/VirtualWindowSync";
import type { RowData } from "../../../types";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function headerCell(root: HTMLElement, field: string): HTMLElement | null {
  return root.querySelector(
    `.lfg-header-cell[data-col-id="${field}"]`,
  ) as HTMLElement | null;
}

function bodyCell(root: HTMLElement, field: string): HTMLElement | null {
  return root.querySelector(
    `.lfg-cell[data-col-id="${field}"]`,
  ) as HTMLElement | null;
}

async function makeColumnSelectionGrid(
  opts?: {
    columns?: Array<{ field: string; columnSelectable?: boolean }>;
    rows?: RowData[];
    columnSelection?: ConstructorParameters<typeof Grid>[0]["columnSelection"];
    rowSelection?: ConstructorParameters<typeof Grid>[0]["rowSelection"];
    onColumnSelectionChanged?: ConstructorParameters<typeof Grid>[0]["onColumnSelectionChanged"];
  },
) {
  const container = document.createElement("div");
  Object.assign(container.style, { height: "260px", width: "520px" });
  document.body.appendChild(container);

  const grid = new Grid({
    rows: opts?.rows ?? ([{ a: 1, b: 2, c: 3 }] as RowData[]),
    columns: opts?.columns ?? [{ field: "a" }, { field: "b" }, { field: "c" }],
    columnSelection: opts?.columnSelection ?? { mode: "multiple" },
    rowSelection: opts?.rowSelection,
    onColumnSelectionChanged: opts?.onColumnSelectionChanged,
    suppressRowVirtualization: true,
    suppressColumnVirtualization: true,
  });
  grid.mount(container);
  await flushRenders();

  return {
    grid,
    container,
    root: () => container.querySelector(".lfg-grid") as HTMLElement,
  };
}

describe("column selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("playground App enables column selection", () => {
    const appCandidates = [
      join(
        process.cwd(),
        "..",
        "..",
        "apps",
        "playgroundReact",
        "src",
        "gridDemo",
        "gridDemo.tsx",
      ),
      join(
        process.cwd(),
        "apps",
        "playgroundReact",
        "src",
        "gridDemo",
        "gridDemo.tsx",
      ),
    ];
    const configCandidates = [
      join(
        process.cwd(),
        "..",
        "..",
        "apps",
        "playgroundReact",
        "src",
        "gridDemo",
        "config",
        "columnSelection.ts",
      ),
      join(
        process.cwd(),
        "apps",
        "playgroundReact",
        "src",
        "gridDemo",
        "config",
        "columnSelection.ts",
      ),
    ];
    const appPath = appCandidates.find((p) => existsSync(p));
    const configPath = configCandidates.find((p) => existsSync(p));
    expect(appPath).toBeDefined();
    expect(configPath).toBeDefined();
    const src = readFileSync(appPath!, "utf8");
    const config = readFileSync(configPath!, "utf8");
    expect(src).toContain("columnSelection={gridDemoColumnSelection}");
    expect(config).toContain("enableHeaderClickSelection: true");
  });

  it("columnSelection true enables single header click selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["a"]);
    expect(headerCell(root, "a")?.classList.contains("lfg-column-selected")).toBe(
      true,
    );
    expect(
      root.querySelector('.lfg-cell[data-col-id="a"]')?.classList.contains(
        "lfg-column-selected",
      ),
    ).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("column selection applies to floating filter cells", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "320px", width: "520px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ name: "Tony", email: "tony@example.com" }] as RowData[],
      columns: [
        { field: "name", filterable: true },
        { field: "email", filterable: true },
      ],
      columnSelection: true,
      floatingFilters: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "email")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    const filterCell = root.querySelector(
      ".lfg-floating-filter-cell[data-col-id='email']",
    );
    expect(filterCell?.classList.contains("lfg-column-selected")).toBe(true);

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds selects multiple valid fields and emits one api event", async () => {
    const onColumnSelectionChanged = vi.fn();
    const { grid, container } = await makeColumnSelectionGrid({
      onColumnSelectionChanged,
    });

    grid.setSelectedColumnIds(["a", "b"], "api");

    expect(grid.getSelectedColumnIds()).toEqual(["a", "b"]);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onColumnSelectionChanged).toHaveBeenCalledWith({
      selectedColumnIds: ["a", "b"],
      changedColumnIds: ["a", "b"],
      source: "api",
    });

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds in single mode keeps the first valid field", async () => {
    const onColumnSelectionChanged = vi.fn();
    const { grid, container } = await makeColumnSelectionGrid({
      columnSelection: { mode: "single" },
      onColumnSelectionChanged,
    });

    grid.setSelectedColumnIds(["missing", "b", "c"]);

    expect(grid.getSelectedColumnIds()).toEqual(["b"]);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onColumnSelectionChanged.mock.calls[0]?.[0]).toEqual({
      selectedColumnIds: ["b"],
      changedColumnIds: ["b"],
      source: "api",
    });

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds with disabled column selection results in empty selection", async () => {
    const onColumnSelectionChanged = vi.fn();
    const { grid, container } = await makeColumnSelectionGrid({
      columnSelection: false,
      onColumnSelectionChanged,
    });

    grid.setSelectedColumnIds(["a", "b"]);

    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(onColumnSelectionChanged).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds([]) clears existing selection and emits once", async () => {
    const onColumnSelectionChanged = vi.fn();
    const { grid, container } = await makeColumnSelectionGrid({
      onColumnSelectionChanged,
    });

    grid.setSelectedColumnIds(["a", "b"]);
    onColumnSelectionChanged.mockClear();

    grid.setSelectedColumnIds([]);

    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onColumnSelectionChanged.mock.calls[0]?.[0]).toEqual({
      selectedColumnIds: [],
      changedColumnIds: ["a", "b"],
      source: "api",
    });

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds with the same ids emits nothing", async () => {
    const onColumnSelectionChanged = vi.fn();
    const { grid, container } = await makeColumnSelectionGrid({
      onColumnSelectionChanged,
    });

    grid.setSelectedColumnIds(["a", "b"]);
    onColumnSelectionChanged.mockClear();

    grid.setSelectedColumnIds(["a", "b"]);

    expect(grid.getSelectedColumnIds()).toEqual(["a", "b"]);
    expect(onColumnSelectionChanged).not.toHaveBeenCalled();

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds ignores invalid fields", async () => {
    const onColumnSelectionChanged = vi.fn();
    const { grid, container } = await makeColumnSelectionGrid({
      onColumnSelectionChanged,
    });

    grid.setSelectedColumnIds(["missing", "b", "unknown"]);

    expect(grid.getSelectedColumnIds()).toEqual(["b"]);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds ignores columnSelectable false fields", async () => {
    const { grid, container } = await makeColumnSelectionGrid({
      columns: [
        { field: "a" },
        { field: "b", columnSelectable: false },
        { field: "c" },
      ],
    });

    grid.setSelectedColumnIds(["b", "c"]);

    expect(grid.getSelectedColumnIds()).toEqual(["c"]);

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds ignores the internal selection checkbox column", async () => {
    const { grid, container } = await makeColumnSelectionGrid({
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
      },
    });

    grid.setSelectedColumnIds([SELECTION_COLUMN_FIELD, "a"]);

    expect(grid.getSelectedColumnIds()).toEqual(["a"]);

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds updates visible header and body classes", async () => {
    const { grid, container, root } = await makeColumnSelectionGrid();

    grid.setSelectedColumnIds(["b"]);
    await flushRenders();

    expect(headerCell(root(), "b")?.classList.contains("lfg-column-selected")).toBe(
      true,
    );
    expect(bodyCell(root(), "b")?.classList.contains("lfg-column-selected")).toBe(
      true,
    );
    expect(headerCell(root(), "a")?.classList.contains("lfg-column-selected")).toBe(
      false,
    );
    expect(bodyCell(root(), "a")?.classList.contains("lfg-column-selected")).toBe(
      false,
    );

    grid.destroy();
    container.remove();
  });

  it("clearSelection clears rows only and preserves selected columns", async () => {
    const { grid, container } = await makeColumnSelectionGrid({
      rows: [
        { a: 1, b: 2, c: 3 },
        { a: 4, b: 5, c: 6 },
      ] as RowData[],
      rowSelection: { mode: "multiple" },
      columnSelection: { mode: "multiple" },
    });

    grid.setSelectedRowIds(["auto:0", "auto:1"]);
    grid.setSelectedColumnIds(["a", "b"]);

    grid.clearSelection();

    expect(grid.getSelectedRowIds()).toEqual([]);
    expect(grid.getSelectedColumnIds()).toEqual(["a", "b"]);

    grid.destroy();
    container.remove();
  });

  it("clearColumnSelection clears columns only and preserves selected rows", async () => {
    const { grid, container } = await makeColumnSelectionGrid({
      rows: [
        { a: 1, b: 2, c: 3 },
        { a: 4, b: 5, c: 6 },
      ] as RowData[],
      rowSelection: { mode: "multiple" },
      columnSelection: { mode: "multiple" },
    });

    grid.setSelectedRowIds(["auto:0", "auto:1"]);
    grid.setSelectedColumnIds(["a", "b"]);

    grid.clearColumnSelection();

    expect(grid.getSelectedRowIds()).toEqual(["auto:0", "auto:1"]);
    expect(grid.getSelectedColumnIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("setSelectedRowIds does not clear selected columns", async () => {
    const { grid, container } = await makeColumnSelectionGrid({
      rows: [
        { a: 1, b: 2, c: 3 },
        { a: 4, b: 5, c: 6 },
      ] as RowData[],
      rowSelection: { mode: "multiple" },
      columnSelection: { mode: "multiple" },
    });

    grid.setSelectedColumnIds(["a", "b"]);
    grid.setSelectedRowIds(["auto:1"]);

    expect(grid.getSelectedRowIds()).toEqual(["auto:1"]);
    expect(grid.getSelectedColumnIds()).toEqual(["a", "b"]);

    grid.destroy();
    container.remove();
  });

  it("setSelectedColumnIds does not clear selected rows", async () => {
    const { grid, container } = await makeColumnSelectionGrid({
      rows: [
        { a: 1, b: 2, c: 3 },
        { a: 4, b: 5, c: 6 },
      ] as RowData[],
      rowSelection: { mode: "multiple" },
      columnSelection: { mode: "multiple" },
    });

    grid.setSelectedRowIds(["auto:0", "auto:1"]);
    grid.setSelectedColumnIds(["b", "c"]);

    expect(grid.getSelectedRowIds()).toEqual(["auto:0", "auto:1"]);
    expect(grid.getSelectedColumnIds()).toEqual(["b", "c"]);

    grid.destroy();
    container.remove();
  });

  it("single mode replaces previous column", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["b"]);
    expect(headerCell(root, "a")?.classList.contains("lfg-column-selected")).toBe(
      false,
    );
    expect(headerCell(root, "b")?.classList.contains("lfg-column-selected")).toBe(
      true,
    );

    grid.destroy();
    container.remove();
  });

  it("multiple mode with ctrl toggles columns", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }, { field: "c" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["a", "b"]));

    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["b"]));

    grid.destroy();
    container.remove();
  });

  it("multiple mode plain click replaces previous selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }, { field: "c" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedColumnIds()).toEqual(["a"]);

    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["c"]);

    grid.destroy();
    container.remove();
  });

  it("multiple mode shift selects inclusive range from anchor", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    headerCell(root, "d")?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        shiftKey: true,
      }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["b", "c", "d"]),
    );

    grid.destroy();
    container.remove();
  });

  it("multiple mode Shift+Ctrl/Cmd adds range to existing selection", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        shiftKey: true,
        ctrlKey: true,
      }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["a", "b", "c"]),
    );

    grid.destroy();
    container.remove();
  });

  it("multiple mode shift with no anchor behaves like plain click", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("clearColumnSelection resets anchor so subsequent shift is plain", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }, { field: "c" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();
    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["a", "b", "c"]),
    );

    grid.clearColumnSelection();
    await flushRenders();

    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("single mode treats Ctrl like plain click", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("single mode treats Shift like plain click", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }, { field: "c" }],
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["c"]);

    grid.destroy();
    container.remove();
  });

  it("single mode plain click deselects selected column", async () => {
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: true,
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    onColumnSelectionChanged.mockClear();

    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(
      headerCell(root, "a")?.classList.contains("lfg-column-selected"),
    ).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("multiple mode plain click deselects a selected column without clearing others", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }, { field: "c" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    await flushRenders();
    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["a", "b"]));

    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["b"]));

    grid.destroy();
    container.remove();
  });

  it("multiple mode Shift+Ctrl with no anchor toggles like Ctrl click", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        shiftKey: true,
        ctrlKey: true,
      }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("Escape clears column selection with keyboard source", async () => {
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: { mode: "multiple" },
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const h = headerCell(root, "a")!;
    h.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    h.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    onColumnSelectionChanged.mockClear();

    const focusEl = document.activeElement ?? root;
    focusEl.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    expect(onColumnSelectionChanged.mock.calls[0]![0].source).toBe("keyboard");

    grid.destroy();
    container.remove();
  });

  it("clearOnOutsideClick false keeps selection when clicking outside grid", async () => {
    const wrap = document.createElement("div");
    const outside = document.createElement("button");
    outside.textContent = "outside";
    const gridHost = document.createElement("div");
    wrap.appendChild(outside);
    wrap.appendChild(gridHost);
    document.body.appendChild(wrap);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: { mode: "multiple", clearOnOutsideClick: false },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(gridHost);
    await flushRenders();

    const root = gridHost.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    expect(grid.getSelectedColumnIds()).toEqual(["a"]);

    outside.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["a"]);

    grid.destroy();
    wrap.remove();
  });

  it("clearOnOutsideClick true clears selection when clicking outside grid", async () => {
    const wrap = document.createElement("div");
    const outside = document.createElement("button");
    outside.textContent = "outside";
    const gridHost = document.createElement("div");
    wrap.appendChild(outside);
    wrap.appendChild(gridHost);
    document.body.appendChild(wrap);

    const onColumnSelectionChanged = vi.fn();
    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: { mode: "multiple", clearOnOutsideClick: true },
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(gridHost);
    await flushRenders();

    const root = gridHost.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    onColumnSelectionChanged.mockClear();

    outside.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);

    grid.destroy();
    wrap.remove();
  });

  it("destroy removes document capture listener for outside click", async () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const wrap = document.createElement("div");
    const gridHost = document.createElement("div");
    wrap.appendChild(gridHost);
    document.body.appendChild(wrap);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: { mode: "multiple", clearOnOutsideClick: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(gridHost);
    await flushRenders();

    removeSpy.mockClear();
    grid.destroy();
    await flushRenders();

    expect(removeSpy.mock.calls.some((c) => c[0] === "click" && c[2] === true)).toBe(
      true,
    );

    removeSpy.mockRestore();
    wrap.remove();
  });

  it("shift range follows rendered column order", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ z: 1, a: 2, b: 3 }] as RowData[],
      columns: [{ field: "z" }, { field: "a" }, { field: "b" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "z")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual(["z", "a", "b"]);

    grid.destroy();
    container.remove();
  });

  it("shift range skips row-selection column in ordering", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", x: 1, y: 2 }] as RowData[],
      columns: [{ field: "x" }, { field: "y" }],
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: { mode: "multiple", checkboxes: true },
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "x")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "y")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["x", "y"]));
    expect(grid.getSelectedColumnIds()).not.toContain(SELECTION_COLUMN_FIELD);

    grid.destroy();
    container.remove();
  });

  it("pruning removed columns is silent (no onColumnSelectionChanged)", async () => {
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: { mode: "multiple" },
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    await flushRenders();
    expect(new Set(grid.getSelectedColumnIds())).toEqual(new Set(["a", "b"]));

    onColumnSelectionChanged.mockClear();
    grid.setColumns([{ field: "b" }]);
    await flushRenders();

    expect(onColumnSelectionChanged).not.toHaveBeenCalled();
    expect(grid.getSelectedColumnIds()).toEqual(["b"]);

    grid.destroy();
    container.remove();
  });

  it("shift column selection does not invoke VirtualWindowSync", async () => {
    const syncSpy = vi.spyOn(VirtualWindowSync.prototype, "sync");
    const scrollSpy = vi.spyOn(VirtualWindowSync.prototype, "syncFromScroll");
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }, { field: "c" }],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    syncSpy.mockClear();
    scrollSpy.mockClear();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const cell = root.querySelector('.lfg-cell[data-col-id="b"]') as HTMLElement;
    const textBefore = cell.textContent;

    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(syncSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(cell.textContent).toBe(textBefore);

    grid.destroy();
    container.remove();
  });

  it("clicking resize handle does not select column", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const handle = root.querySelector(
      '.lfg-header-cell[data-col-id="a"] .lfg-resize-handle',
    ) as HTMLElement;
    expect(handle).toBeTruthy();
    handle.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("clicking dedicated filter trigger does not select column", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a", filterable: true }],
      columnSelection: true,
      columnMenu: {
        enabled: true,
        filter: { enabled: true, placement: "dedicatedMenu" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const trigger = root.querySelector(
      '.lfg-header-cell[data-col-id="a"] .lfg-column-filter-trigger',
    ) as HTMLElement;
    expect(trigger).toBeTruthy();
    trigger.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);

    grid.destroy();
    container.remove();
  });

  it("ignores row-selection checkbox column header", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ id: "r1", x: 1 }] as RowData[],
      columns: [{ field: "x" }],
      getRowId: (r) => (r as { id: string }).id,
      rowSelection: { mode: "multiple", checkboxes: true },
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const selHeader = headerCell(root, SELECTION_COLUMN_FIELD);
    expect(selHeader).toBeTruthy();
    selHeader?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(selHeader?.classList.contains("lfg-column-selected")).toBe(false);

    grid.destroy();
    container.remove();
  });

  it("clearColumnSelection clears and invokes callback when selection existed", async () => {
    const onColumnSelectionChanged = vi.fn();
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: true,
      onColumnSelectionChanged,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();
    onColumnSelectionChanged.mockClear();

    grid.clearColumnSelection();
    await flushRenders();

    expect(grid.getSelectedColumnIds()).toEqual([]);
    expect(
      headerCell(root, "a")?.classList.contains("lfg-column-selected"),
    ).toBe(false);
    expect(onColumnSelectionChanged).toHaveBeenCalledTimes(1);
    const ev = onColumnSelectionChanged.mock.calls[0]![0];
    expect(ev.selectedColumnIds).toEqual([]);
    expect(ev.changedColumnIds).toEqual(["a"]);
    expect(ev.source).toBe("api");

    grid.destroy();
    container.remove();
  });

  it("re-sync restores column selected class after vertical scroll", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "120px", width: "440px" });
    document.body.appendChild(container);

    const rows = Array.from({ length: 40 }, (_, i) => ({
      k: i,
    })) as RowData[];
    const grid = new Grid({
      rows,
      columns: [{ field: "k" }],
      columnSelection: true,
      rowSelection: "none",
      suppressRowVirtualization: false,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const viewport = root.querySelector(".lfg-viewport") as HTMLElement;
    headerCell(root, "k")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    const cellBefore = root.querySelector(".lfg-cell.lfg-column-selected");
    expect(cellBefore).toBeTruthy();

    viewport.scrollTop = 800;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    const cellAfter = root.querySelector(".lfg-cell.lfg-column-selected");
    expect(cellAfter).toBeTruthy();
    expect(cellAfter?.getAttribute("data-col-id")).toBe("k");

    grid.destroy();
    container.remove();
  });

  it("re-sync restores column selected class after horizontal scroll", async () => {
    const n = 25;
    const columns = Array.from({ length: n }, (_, i) => ({
      field: `c${i}`,
    }));
    const row: RowData = {};
    for (let i = 0; i < n; i++) {
      row[`c${i}`] = i;
    }

    const container = document.createElement("div");
    Object.assign(container.style, { height: "140px", width: "220px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [row] as RowData[],
      columns,
      columnSelection: true,
      rowSelection: "none",
      suppressRowVirtualization: true,
      suppressColumnVirtualization: false,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const viewport = root.querySelector(".lfg-viewport") as HTMLElement;
    const targetField = "c0";
    headerCell(root, targetField)?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(
      headerCell(root, targetField)?.classList.contains("lfg-column-selected"),
    ).toBe(true);

    viewport.scrollLeft = 2000;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    viewport.scrollLeft = 0;
    viewport.dispatchEvent(new Event("scroll"));
    await flushRenders();

    const hdr = headerCell(root, targetField);
    expect(hdr?.classList.contains("lfg-column-selected")).toBe(true);
    const cell = root.querySelector(
      `.lfg-cell[data-col-id="${targetField}"].lfg-column-selected`,
    );
    expect(cell).toBeTruthy();

    grid.destroy();
    container.remove();
  });

  it("header click does not invoke VirtualWindowSync sync or syncFromScroll", async () => {
    const syncSpy = vi.spyOn(VirtualWindowSync.prototype, "sync");
    const scrollSpy = vi.spyOn(VirtualWindowSync.prototype, "syncFromScroll");
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2 }] as RowData[],
      columns: [{ field: "a" }, { field: "b" }],
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    syncSpy.mockClear();
    scrollSpy.mockClear();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    const cell = root.querySelector('.lfg-cell[data-col-id="a"]') as HTMLElement;
    const textBefore = cell.textContent;

    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    expect(syncSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(cell.textContent).toBe(textBefore);
    expect(grid.getSelectedColumnIds()).toEqual(["a"]);

    grid.destroy();
    container.remove();
  });

  it("shift-click preserves anchor: click A, shift C, shift E => A-E", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4, e: 5 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
        { field: "e" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    headerCell(root, "e")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["a", "b", "c", "d", "e"]),
    );

    grid.destroy();
    container.remove();
  });

  it("shift-click does not shrink existing Shift range extent: click B, shift D, shift C => B-C-D", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "d")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["b", "c", "d"]),
    );

    grid.destroy();
    container.remove();
  });

  it("ctrl-click sets anchor, shift-click ranges from it", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4, e: 5 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
        { field: "e" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "e")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, ctrlKey: true }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["c", "d", "e"]),
    );

    grid.destroy();
    container.remove();
  });

  it("shift+ctrl range preserves anchor across repeated extends", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4, e: 5 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
        { field: "e" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "b")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        shiftKey: true,
        ctrlKey: true,
      }),
    );
    headerCell(root, "e")?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        button: 0,
        shiftKey: true,
        ctrlKey: true,
      }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["b", "c", "d", "e"]),
    );

    grid.destroy();
    container.remove();
  });

  it("shift-range uses display order (leftPinned+center+rightPinned), skipping right-pinned col between center cols", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ col1: 1, col2: 2, col3: 3, col4: 4 }] as RowData[],
      columns: [
        { field: "col1", pinned: "left" },
        { field: "col2" },
        { field: "col3", pinned: "right" },
        { field: "col4" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "col1")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "col4")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["col1", "col2", "col4"]),
    );
    expect(grid.getSelectedColumnIds()).not.toContain("col3");

    grid.destroy();
    container.remove();
  });

  it("shift-range into right-pinned lane includes it at visual end", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ col1: 1, col2: 2, col3: 3, col4: 4 }] as RowData[],
      columns: [
        { field: "col1", pinned: "left" },
        { field: "col2" },
        { field: "col3", pinned: "right" },
        { field: "col4" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "col4")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "col3")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["col4", "col3"]),
    );
    expect(grid.getSelectedColumnIds()).not.toContain("col1");
    expect(grid.getSelectedColumnIds()).not.toContain("col2");

    grid.destroy();
    container.remove();
  });

  it("shift-range with no pinned columns preserves existing behavior", async () => {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1, b: 2, c: 3, d: 4 }] as RowData[],
      columns: [
        { field: "a" },
        { field: "b" },
        { field: "c" },
        { field: "d" },
      ],
      columnSelection: { mode: "multiple" },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    headerCell(root, "c")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }),
    );
    await flushRenders();

    expect(new Set(grid.getSelectedColumnIds())).toEqual(
      new Set(["a", "b", "c"]),
    );

    grid.destroy();
    container.remove();
  });

  it("clearColumnSelection does not invoke VirtualWindowSync or rewrite cell text", async () => {
    const syncSpy = vi.spyOn(VirtualWindowSync.prototype, "sync");
    const scrollSpy = vi.spyOn(VirtualWindowSync.prototype, "syncFromScroll");
    const container = document.createElement("div");
    Object.assign(container.style, { height: "260px", width: "440px" });
    document.body.appendChild(container);

    const grid = new Grid({
      rows: [{ a: 1 }] as RowData[],
      columns: [{ field: "a" }],
      columnSelection: true,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
    });
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector(".lfg-grid") as HTMLElement;
    headerCell(root, "a")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    await flushRenders();

    syncSpy.mockClear();
    scrollSpy.mockClear();

    const cell = root.querySelector('.lfg-cell[data-col-id="a"]') as HTMLElement;
    const textBefore = cell.textContent;

    grid.clearColumnSelection();
    await flushRenders();

    expect(syncSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(cell.textContent).toBe(textBefore);
    expect(
      headerCell(root, "a")?.classList.contains("lfg-column-selected"),
    ).toBe(false);

    grid.destroy();
    container.remove();
  });
});
