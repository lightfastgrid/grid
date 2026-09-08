// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { Grid } from "../../../Grid";
import type { DomGridRenderer } from "../../../rendering/DomGridRenderer";
import type {
  LightFastGridCellValueChangedEvent,
  LightFastGridRowDataUpdatedEvent,
  RowData,
} from "../../../types";

function getRenderer(grid: Grid): DomGridRenderer {
  return (grid as unknown as { renderer: DomGridRenderer }).renderer;
}

// ── Helpers ────────────────────────────────────────────────────────

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function makeContainer(): HTMLDivElement {
  const c = document.createElement("div");
  Object.assign(c.style, { width: "600px", height: "400px" });
  document.body.appendChild(c);
  return c;
}

function cellEl(
  container: HTMLElement,
  rowId: string,
  field: string,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-row-id="${rowId}"] .lfg-cell[data-col-id="${field}"]`,
  );
}

function dblClick(el: Element): void {
  el.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );
}

function pressKey(el: Element, key: string): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Grid cell editing runtime", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("commits successfully without getRowId", async () => {
    const onCellValueChanged = vi.fn();
    const rows: RowData[] = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    const grid = new Grid({
      columns: [
        { field: "name", editable: true },
        { field: "age", editable: true },
      ],
      rows,
      suppressRowVirtualization: true,
      onCellValueChanged,
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = root.querySelector<HTMLElement>(
      `.lfg-row[data-row-index="0"] .lfg-cell[data-col-id="name"]`,
    )!;
    expect(cell).not.toBeNull();

    dblClick(cell);

    const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input");
    expect(input).not.toBeNull();
    input!.value = "Charlie";
    pressKey(input!, "Enter");

    expect(onCellValueChanged).toHaveBeenCalledOnce();
    expect(onCellValueChanged.mock.calls[0][0].newValue).toBe("Charlie");
    expect(onCellValueChanged.mock.calls[0][0].oldValue).toBe("Alice");

    grid.destroy();
  });

  it("commits correct source row when display index differs from source (sorted)", async () => {
    const onCellValueChanged = vi.fn();
    const rows: RowData[] = [
      { id: "r0", name: "Zara", v: 2 },
      { id: "r1", name: "Alice", v: 1 },
    ];
    const grid = new Grid({
      columns: [
        { field: "name", editable: true, sortable: true },
        { field: "v", sortable: true },
      ],
      rows,
      getRowId: (r) => r.id,
      initialSortModel: [{ field: "name", sort: "asc" }],
      suppressRowVirtualization: true,
      onCellValueChanged,
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = cellEl(container, "r1", "name");
    expect(cell).not.toBeNull();

    dblClick(cell!);

    const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input");
    expect(input).not.toBeNull();
    input!.value = "Updated";
    pressKey(input!, "Enter");

    expect(onCellValueChanged).toHaveBeenCalledOnce();
    const event = onCellValueChanged.mock.calls[0][0];
    expect(event.oldValue).toBe("Alice");
    expect(event.newValue).toBe("Updated");

    const sourceRows = grid.getRows();
    expect(sourceRows[1]!.name).toBe("Updated");
    expect(sourceRows[0]!.name).toBe("Zara");

    grid.destroy();
  });

  it("emits row-data:updated with source 'cellEdit'", async () => {
    const rowDataEvents: LightFastGridRowDataUpdatedEvent[] = [];
    const rows: RowData[] = [{ id: "r0", name: "Alice" }];
    const grid = new Grid({
      columns: [{ field: "name", editable: true }],
      rows,
      getRowId: (r) => r.id,
      suppressRowVirtualization: true,
      onRowDataUpdated: (e) => rowDataEvents.push(e),
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = cellEl(container, "r0", "name")!;
    dblClick(cell);

    const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input")!;
    input.value = "Bob";
    pressKey(input, "Enter");

    const editEvents = rowDataEvents.filter((e) => e.source === "cellEdit");
    expect(editEvents.length).toBe(1);
    expect(editEvents[0]!.updateCount).toBe(1);

    grid.destroy();
  });

  it("onCellValueChanged fires only after successful commit", async () => {
    const callOrder: string[] = [];
    const rows: RowData[] = [{ id: "r0", name: "Alice" }];
    const grid = new Grid({
      columns: [{ field: "name", editable: true }],
      rows,
      getRowId: (r) => r.id,
      suppressRowVirtualization: true,
      onCellValueChanged: () => callOrder.push("cellValueChanged"),
      onRowDataUpdated: () => callOrder.push("rowDataUpdated"),
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = cellEl(container, "r0", "name")!;
    dblClick(cell);

    const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input")!;
    input.value = "Changed";
    pressKey(input, "Enter");

    expect(callOrder).toEqual(["rowDataUpdated", "cellValueChanged"]);

    grid.destroy();
  });

  it("onBeforeCellEditCommit mutates derived fields before row commit", async () => {
    const callOrder: string[] = [];
    let projectionOnCommittedRow: string | undefined;
    const rows: RowData[] = [
      { id: "r0", name: "Alice", nameText: "Alice" },
    ];
    const grid = new Grid({
      columns: [
        {
          field: "name",
          editable: true,
          quickFilterTextField: "nameText",
        },
      ],
      rows,
      getRowId: (r) => r.id as string,
      suppressRowVirtualization: true,
      onBeforeCellEditCommit: (e) => {
        callOrder.push("beforeCommit");
        const row = e.row as Record<string, unknown>;
        row.nameText =
          e.newValue === null || e.newValue === undefined
            ? ""
            : String(e.newValue);
      },
      onRowDataUpdated: () => callOrder.push("rowDataUpdated"),
      onCellValueChanged: (e) => {
        callOrder.push("cellValueChanged");
        projectionOnCommittedRow = String(
          (e.row as Record<string, unknown> | undefined)?.nameText ?? "",
        );
      },
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = cellEl(container, "r0", "name")!;
    dblClick(cell);
    const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input")!;
    input.value = "Alicia";
    pressKey(input, "Enter");

    expect(callOrder).toEqual([
      "beforeCommit",
      "rowDataUpdated",
      "cellValueChanged",
    ]);
    expect(projectionOnCommittedRow).toBe("Alicia");

    grid.destroy();
  });

  it("replaces and clears the pre-commit hook for subsequent edits", async () => {
    const initialHook = vi.fn();
    const replacementHook = vi.fn();
    const grid = new Grid({
      columns: [{ field: "name", editable: true }],
      rows: [{ id: "r0", name: "Alice" }],
      getRowId: (row) => row.id as string,
      suppressRowVirtualization: true,
      onBeforeCellEditCommit: initialHook,
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    grid.setBeforeCellEditCommitHook(replacementHook);
    let cell = cellEl(container, "r0", "name")!;
    dblClick(cell);
    let input = container.querySelector<HTMLInputElement>(
      ".lfg-cell-editor-host input",
    )!;
    input.value = "Alicia";
    pressKey(input, "Enter");
    await flushRenders();

    expect(initialHook).not.toHaveBeenCalled();
    expect(replacementHook).toHaveBeenCalledOnce();

    grid.setBeforeCellEditCommitHook(undefined);
    cell = cellEl(container, "r0", "name")!;
    dblClick(cell);
    input = container.querySelector<HTMLInputElement>(
      ".lfg-cell-editor-host input",
    )!;
    input.value = "Ally";
    pressKey(input, "Enter");

    expect(replacementHook).toHaveBeenCalledOnce();
    grid.destroy();
  });

  it("active quick search observes projection updated by onBeforeCellEditCommit", async () => {
    // Regression for stale quick-search results:
    // If nameText is only refreshed in onCellValueChanged (after
    // afterRowDataCommit), synchronous QS can still read the old
    // projection and keep a row that should have left the match set.
    type GridStateAccess = {
      state: {
        getSnapshot: () => {
          rowView: { rowCount: number; getRow: (i: number) => RowData };
        };
      };
    };

    const rows: RowData[] = [
      { id: "r0", name: "Alice", nameText: "Alice" },
      { id: "r1", name: "Bob", nameText: "Bob" },
    ];
    const grid = new Grid({
      columns: [
        {
          field: "name",
          editable: true,
          quickFilterTextField: "nameText",
        },
      ],
      rows,
      getRowId: (r) => r.id as string,
      suppressRowVirtualization: true,
      quickFilter: true,
      onBeforeCellEditCommit: (e) => {
        const row = e.row as Record<string, unknown>;
        row.nameText =
          e.newValue === null || e.newValue === undefined
            ? ""
            : String(e.newValue);
      },
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    grid.setQuickFilterText("Alice");
    await flushRenders();

    const state = (grid as unknown as GridStateAccess).state;
    expect(state.getSnapshot().rowView.rowCount).toBe(1);
    expect(state.getSnapshot().rowView.getRow(0)).toMatchObject({ id: "r0" });

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = cellEl(container, "r0", "name")!;
    dblClick(cell);
    const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input")!;
    input.value = "Alicia";
    pressKey(input, "Enter");
    await flushRenders();

    // Projection is now "Alicia"; active query "Alice" must not match.
    expect(state.getSnapshot().rowView.rowCount).toBe(0);

    grid.destroy();
  });

  it("cell-value:changed event fires via bus after commit", async () => {
    const busEvents: LightFastGridCellValueChangedEvent[] = [];
    const rows: RowData[] = [{ id: "r0", name: "Alice" }];
    const grid = new Grid({
      columns: [{ field: "name", editable: true }],
      rows,
      getRowId: (r) => r.id,
      suppressRowVirtualization: true,
    });
    grid.on("cell-value:changed", (e) => busEvents.push(e));
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = cellEl(container, "r0", "name")!;
    dblClick(cell);

    const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input")!;
    input.value = "Bob";
    pressKey(input, "Enter");

    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]!.newValue).toBe("Bob");
    expect(busEvents[0]!.oldValue).toBe("Alice");

    grid.destroy();
  });

  it("parse failure keeps edit open and emits no value-changed event", async () => {
    const onCellValueChanged = vi.fn();
    const rows: RowData[] = [
      { id: "r0", status: "a" },
    ];
    const grid = new Grid({
      columns: [{
        field: "status",
        editable: true,
        editor: { type: "select", options: ["a", "b", "c"] },
      }],
      rows,
      getRowId: (r) => r.id,
      suppressRowVirtualization: true,
      onCellValueChanged,
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const cell = cellEl(container, "r0", "status")!;
    dblClick(cell);

    const selectEl = root.querySelector<HTMLSelectElement>(".lfg-cell-editor-host select")!;
    expect(selectEl).not.toBeNull();

    // Inject an invalid option value that won't match the select options
    selectEl.innerHTML = '<option value="__invalid__">invalid</option>';
    selectEl.value = "__invalid__";
    pressKey(selectEl, "Enter");

    expect(onCellValueChanged).not.toHaveBeenCalled();

    const editorHost = root.querySelector(".lfg-cell-editor-host");
    expect(editorHost).not.toBeNull();

    pressKey(selectEl, "Escape");

    grid.destroy();
  });

  it("keeps required validation owner-local in a pinned column and row", async () => {
    const onCellValueChanged = vi.fn();
    const grid = new Grid({
      columns: [
        {
          field: "name",
          pinned: "left",
          editable: true,
          editor: { type: "text", required: true },
        },
        { field: "status" },
      ],
      rows: [{ id: "r0", name: "Alice", status: "Active" }],
      getRowId: (row) => String(row.id),
      rowPinning: { top: ["r0"] },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      onCellValueChanged,
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const cell = container.querySelector<HTMLElement>(
      '.lfg-row-pinned-top-left-layer [data-row-id="r0"] .lfg-cell[data-col-id="name"]',
    );
    expect(cell).not.toBeNull();
    dblClick(cell!);
    const input = cell!.querySelector<HTMLInputElement>(
      ".lfg-cell-editor-host input",
    )!;
    expect(input.getAttribute("aria-required")).toBe("true");
    input.value = " ";
    pressKey(input, "Enter");

    const errorId = input.getAttribute("aria-errormessage");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(errorId).toMatch(/^lfg-editor-error-[1-9]\d*$/);
    expect(cell!.querySelector(`#${errorId}`)?.textContent).toBe(
      "Value is required",
    );
    expect(onCellValueChanged).not.toHaveBeenCalled();

    pressKey(input, "Escape");
    grid.destroy();
  });

  it("Grid has no public startEdit, stopEdit, or getEditingCell methods", () => {
    const grid = new Grid({
      columns: [{ field: "name" }],
      rows: [{ name: "a" }],
    });

    expect("startEdit" in grid).toBe(false);
    expect("stopEdit" in grid).toBe(false);
    expect("getEditingCell" in grid).toBe(false);

    grid.destroy();
  });
});

// ── Edit with active filter ───────────────────────────────────────

describe("cell edit with active filter", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("editor host stays visible until render frame patches the cell", async () => {
    const rows: RowData[] = [
      { id: "r1", language: "English", country: "Ireland" },
      { id: "r2", language: "Swedish", country: "Sweden" },
      { id: "r3", language: "English", country: "France" },
    ];
    const grid = new Grid({
      columns: [
        { field: "language", filter: "text", sortable: true },
        { field: "country", editable: true },
      ],
      rows,
      getRowId: (r) => r.id,
      suppressRowVirtualization: true,
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    grid.setFilterModel({
      language: {
        type: "text",
        conditions: [],
        selection: { operator: "in", values: ["English"] },
      },
    });
    await flushRenders();

    const filterModel = grid.getFilterModel();
    expect(Object.keys(filterModel)).toEqual(["language"]);

    const r = getRenderer(grid);
    const fullBefore = r._fullRenderCount;
    const patchBefore = r._dirtyPatchRenderCount;

    const countryCell = cellEl(container, "r1", "country")!;
    expect(countryCell).not.toBeNull();
    dblClick(countryCell);

    const root = container.querySelector<HTMLElement>(".lfg-grid")!;
    const input = root.querySelector<HTMLInputElement>(
      ".lfg-cell-editor-host input",
    )!;
    expect(input).not.toBeNull();
    input.value = "UK";
    pressKey(input, "Enter");

    const host = countryCell.querySelector<HTMLElement>(".lfg-cell-editor-host");
    expect(host).not.toBeNull();
    expect(host!.hidden).toBe(false);

    await flushRenders();

    const hostAfter = countryCell.querySelector<HTMLElement>(
      ".lfg-cell-editor-host",
    );
    expect(!hostAfter || hostAfter.hidden || hostAfter.children.length === 0).toBe(true);

    // Cell text shows the new value after render patch.
    const updatedCell = cellEl(container, "r1", "country")!;
    expect(updatedCell.textContent).toContain("UK");

    // Filtered rows remain stable — r1 and r3 (English) visible, r2 hidden.
    expect(Object.keys(grid.getFilterModel())).toEqual(["language"]);
    expect(cellEl(container, "r1", "language")).not.toBeNull();
    expect(cellEl(container, "r3", "language")).not.toBeNull();
    expect(cellEl(container, "r2", "language")).toBeNull();

    // Dirty patch used, no full render.
    expect(r._fullRenderCount).toBe(fullBefore);
    expect(r._dirtyPatchRenderCount).toBeGreaterThan(patchBefore);

    grid.destroy();
  });

  it("double-click opens a checkbox editor over a badge cell and click commits", async () => {
    const onCellValueChanged = vi.fn();
    const grid = new Grid({
      columns: [
        {
          field: "featured",
          headerName: "Featured (edit)",
          editable: true,
          editor: { type: "checkbox", activation: "edit" },
          cellShell: {
            kind: "badge",
            text: "formattedValue",
            tone: {
              from: "formattedValue",
              map: { Featured: "success", Standard: "neutral" },
              fallback: "danger",
            },
          },
          valueFormatter: ({ value }) =>
            value === true ? "Featured" : "Standard",
        },
      ],
      rows: [{ id: "row-1", featured: false }],
      getRowId: (row) => String(row.id),
      suppressRowVirtualization: true,
      onCellValueChanged,
    });
    const container = makeContainer();
    grid.mount(container);
    await flushRenders();

    const cell = cellEl(container, "row-1", "featured")!;
    expect(cell.textContent).toContain("Standard");

    dblClick(cell);

    const input = cell.querySelector<HTMLInputElement>(
      ".lfg-cell-editor-host input.lfg-editor-checkbox",
    );
    expect(input).not.toBeNull();
    expect(input!.type).toBe("checkbox");
    expect(input!.checked).toBe(false);
    expect(input!.className).toBe("lfg-editor lfg-editor-checkbox");

    input!.click();
    await flushRenders();

    expect(onCellValueChanged).toHaveBeenCalledOnce();
    const event = onCellValueChanged.mock.calls[0]![0] as LightFastGridCellValueChangedEvent;
    expect(event.oldValue).toBe(false);
    expect(event.newValue).toBe(true);
    expect(cellEl(container, "row-1", "featured")!.textContent).toContain(
      "Featured",
    );

    grid.destroy();
  });
});
