// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { Grid } from "../../../Grid";
import {
  ROW_CONTROLS_CELL_CLASS,
  ROW_CONTROLS_COLUMN_FIELD,
  ROW_CONTROLS_DRAG_SLOT_CLASS,
  ROW_CONTROLS_MIN_WIDTH,
  ROW_CONTROLS_SELECTION_SLOT_CLASS,
} from "../../../internal/rowControlColumns";
import {
  ROW_DRAG_CELL_CLASS,
  ROW_DRAG_COLUMN_FIELD,
  ROW_DRAG_COLUMN_WIDTH,
  ROW_DRAG_HANDLE_CLASS,
} from "../../../internal/rowDragColumn";
import { SELECTION_COLUMN_FIELD } from "../../../internal/selectionColumn";
import { fieldToCssToken } from "../../../rendering/helpers/columnGeometryVars";
import { ROW_HEIGHT } from "../../../rendering/helpers/gridConstants";
import type { RowData } from "../../../types";
import { normalizeSortModel } from "../../../utils/sortModel";
import { resolveSearchableFields } from "../../quick-search/searchableFieldResolver";

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function colWidth(root: HTMLElement, field: string): string {
  const token = fieldToCssToken(field);
  return root.style.getPropertyValue(`--col-${token}-width`);
}

function leftHeaderFields(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      ".lfg-pinned-header-row .lfg-header-cell[data-col-id]",
    ),
  )
    .filter((el) => el.style.display !== "none")
    .map((el) => el.getAttribute("data-col-id")!)
    .filter(Boolean);
}

function displayedPinnedLeftRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(".lfg-pinned-row")).filter(
    (el) => el.getAttribute("data-row-id"),
  );
}

function assertNoDirectRowHandle(rowEl: HTMLElement): void {
  expect(rowEl.querySelector(`:scope > .${ROW_DRAG_HANDLE_CLASS}`)).toBeNull();
}

function assertOneHandleInDragCell(rowEl: HTMLElement): HTMLElement {
  assertNoDirectRowHandle(rowEl);
  const handles = rowEl.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`);
  expect(handles.length).toBe(1);
  const handle = handles[0] as HTMLElement;
  const cell = handle.closest<HTMLElement>(`.${ROW_DRAG_CELL_CLASS}`);
  expect(cell).not.toBeNull();
  expect(cell!.getAttribute("data-col-id")).toBe(ROW_DRAG_COLUMN_FIELD);
  expect(handle.closest(".lfg-row-selection-checkbox")).toBeNull();
  expect(cell!.querySelector(".lfg-row-selection-checkbox")).toBeNull();
  expect(cell!.querySelector(`.${ROW_CONTROLS_SELECTION_SLOT_CLASS}`)).toBeNull();
  return handle;
}

function assertOneHandleInCombinedCell(rowEl: HTMLElement): HTMLElement {
  assertNoDirectRowHandle(rowEl);
  const handles = rowEl.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`);
  expect(handles.length).toBe(1);
  const handle = handles[0] as HTMLElement;
  const cell = handle.closest<HTMLElement>(`.${ROW_CONTROLS_CELL_CLASS}`);
  expect(cell).not.toBeNull();
  expect(cell!.getAttribute("data-col-id")).toBe(ROW_CONTROLS_COLUMN_FIELD);
  expect(cell!.querySelectorAll(`.${ROW_CONTROLS_DRAG_SLOT_CLASS}`).length).toBe(1);
  expect(cell!.querySelectorAll(`.${ROW_CONTROLS_SELECTION_SLOT_CLASS}`).length).toBe(1);
  expect(cell!.querySelectorAll(".lfg-row-selection-checkbox").length).toBe(1);
  expect(handle.closest(`.${ROW_CONTROLS_DRAG_SLOT_CLASS}`)).not.toBeNull();
  expect(handle.closest(`.${ROW_CONTROLS_SELECTION_SLOT_CLASS}`)).toBeNull();
  return handle;
}

describe("row-drag utility column layout", () => {
  const mounts: Array<{ grid: Grid; container: HTMLDivElement }> = [];

  afterEach(() => {
    while (mounts.length > 0) {
      const m = mounts.pop()!;
      m.grid.destroy();
      m.container.remove();
    }
  });

  async function mountGrid(opts: ConstructorParameters<typeof Grid>[0]): Promise<{
    grid: Grid;
    root: HTMLElement;
    container: HTMLDivElement;
  }> {
    const container = document.createElement("div");
    Object.assign(container.style, { height: "400px", width: "800px" });
    document.body.appendChild(container);
    const grid = new Grid(opts);
    grid.mount(container);
    await flushRenders();
    const root = container.querySelector(".lfg-grid") as HTMLElement;
    expect(root).not.toBeNull();
    mounts.push({ grid, container });
    return { grid, root, container };
  }

  const rows: RowData[] = [
    { id: "r1", name: "Alice", status: "active" },
    { id: "r2", name: "Bob", status: "inactive" },
    { id: "r3", name: "Carol", status: "active" },
  ];

  it("injects a drag utility column with one handle per displayed row when checkboxes are off", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [{ field: "name" }, { field: "status" }],
      rowDrag: { enabled: true, managed: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(grid.getColumns().map((c) => c.field)).toEqual(["name", "status"]);
    expect(colWidth(root, ROW_DRAG_COLUMN_FIELD)).toBe(`${ROW_DRAG_COLUMN_WIDTH}px`);
    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);

    const pinnedRows = displayedPinnedLeftRows(root);
    expect(pinnedRows.length).toBe(rows.length);
    for (const rowEl of pinnedRows) {
      assertOneHandleInDragCell(rowEl);
    }

    const centerHandles = root.querySelectorAll(
      `.lfg-row:not(.lfg-pinned-row) .${ROW_DRAG_HANDLE_CLASS}`,
    );
    expect(centerHandles.length).toBe(0);
    expect(root.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`).length).toBe(rows.length);
  });

  it("combines left-pinned checkboxes with drag; a narrow checkbox width cannot shrink below the combined minimum", async () => {
    const { root } = await mountGrid({
      rows,
      columns: [{ field: "name", minWidth: 48, width: 48 }, { field: "status" }],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        checkboxColumn: { width: 24, pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);
    expect(leftHeaderFields(root)).not.toContain(ROW_DRAG_COLUMN_FIELD);
    expect(leftHeaderFields(root)).not.toContain(SELECTION_COLUMN_FIELD);
    expect(colWidth(root, ROW_CONTROLS_COLUMN_FIELD)).toBe(`${ROW_CONTROLS_MIN_WIDTH}px`);
    expect(colWidth(root, "name")).toBe("48px");

    for (const rowEl of displayedPinnedLeftRows(root)) {
      assertOneHandleInCombinedCell(rowEl);
    }
    expect(root.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`).length).toBe(rows.length);

    const headerCell = root.querySelector<HTMLElement>(
      `.lfg-pinned-header-row .lfg-header-cell[data-col-id="${ROW_CONTROLS_COLUMN_FIELD}"]`,
    );
    expect(headerCell).not.toBeNull();
    expect(headerCell!.classList.contains("lfg-row-controls-header-cell")).toBe(true);
    expect(
      headerCell!.querySelectorAll(`.${ROW_CONTROLS_DRAG_SLOT_CLASS}`).length,
    ).toBe(1);
    expect(
      headerCell!.querySelectorAll(`.${ROW_CONTROLS_SELECTION_SLOT_CLASS}`).length,
    ).toBe(1);
    expect(
      headerCell!.querySelector(`.${ROW_CONTROLS_DRAG_SLOT_CLASS} .${ROW_DRAG_HANDLE_CLASS}`),
    ).toBeNull();
    expect(
      headerCell!.querySelector(
        `.${ROW_CONTROLS_SELECTION_SLOT_CLASS} .lfg-header-selection-checkbox`,
      ),
    ).not.toBeNull();
  });

  it("preserves an explicitly wider left checkbox width on the combined column", async () => {
    const { root } = await mountGrid({
      rows,
      columns: [{ field: "name" }],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { width: 80, pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);
    expect(colWidth(root, ROW_CONTROLS_COLUMN_FIELD)).toBe("80px");
  });

  it.each([
    { pinned: false as const, label: "center" },
    { pinned: "right" as const, label: "right" },
  ])("keeps a $label checkbox separate from the left drag column", async ({ pinned }) => {
    const { root } = await mountGrid({
      rows,
      columns: [{ field: "name" }, { field: "status" }],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { width: 28, pinned },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);
    expect(leftHeaderFields(root)).not.toContain(SELECTION_COLUMN_FIELD);
    expect(leftHeaderFields(root)).not.toContain(ROW_CONTROLS_COLUMN_FIELD);
    expect(colWidth(root, ROW_DRAG_COLUMN_FIELD)).toBe(`${ROW_DRAG_COLUMN_WIDTH}px`);
    expect(colWidth(root, SELECTION_COLUMN_FIELD)).toBe("28px");

    for (const rowEl of displayedPinnedLeftRows(root)) {
      assertOneHandleInDragCell(rowEl);
    }

    const selectionSelector =
      pinned === "right"
        ? `.lfg-pinned-right-row .lfg-cell[data-col-id="${SELECTION_COLUMN_FIELD}"]`
        : `.lfg-row:not(.lfg-pinned-row):not(.lfg-pinned-right-row) .lfg-cell[data-col-id="${SELECTION_COLUMN_FIELD}"]`;
    expect(root.querySelector(selectionSelector)).not.toBeNull();
    expect(root.querySelector(`.${ROW_CONTROLS_CELL_CLASS}`)).toBeNull();
  });

  it("applies custom width to a right-pinned checkbox with a left-pinned user column", async () => {
    const { root } = await mountGrid({
      rows,
      columns: [
        { field: "account", width: 200, pinned: "left" },
        { field: "region", width: 110 },
      ],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { width: 24, pinned: "right" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(colWidth(root, SELECTION_COLUMN_FIELD)).toBe("24px");
    expect(root.style.getPropertyValue("--lfg-right-pinned-width")).toBe("24px");
    expect(
      root.querySelector(
        `.lfg-pinned-right-header-row .lfg-header-cell[data-col-id="${SELECTION_COLUMN_FIELD}"]`,
      ),
    ).not.toBeNull();
  });

  it("applies a wider custom width to a right-pinned checkbox column", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [
        { field: "account", width: 200, pinned: "left" },
        { field: "region", width: 110 },
      ],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { width: 80, pinned: "right" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(colWidth(root, SELECTION_COLUMN_FIELD)).toBe("80px");
    expect(root.style.getPropertyValue("--lfg-right-pinned-width")).toBe("80px");

    grid.setRowSelection({
      mode: "multiple",
      checkboxes: true,
      checkboxColumn: { width: 120, pinned: "right" },
    });
    await flushRenders();

    expect(colWidth(root, SELECTION_COLUMN_FIELD)).toBe("120px");
    expect(root.style.getPropertyValue("--lfg-right-pinned-width")).toBe("120px");
  });

  it("updates right-pinned checkbox width after switching from left-pinned combined lane", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [
        { field: "account", width: 200, pinned: "left" },
        { field: "region", width: 110 },
      ],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { width: 24, pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(colWidth(root, ROW_CONTROLS_COLUMN_FIELD)).toBe(`${ROW_CONTROLS_MIN_WIDTH}px`);

    grid.setRowSelection({
      mode: "multiple",
      checkboxes: true,
      checkboxColumn: { width: 24, pinned: "right" },
    });
    await flushRenders();

    expect(colWidth(root, SELECTION_COLUMN_FIELD)).toBe("24px");
    expect(root.style.getPropertyValue("--lfg-right-pinned-width")).toBe("24px");
    expect(colWidth(root, ROW_DRAG_COLUMN_FIELD)).toBe(`${ROW_DRAG_COLUMN_WIDTH}px`);
    expect(
      root.querySelector(
        `.lfg-pinned-right-header-row .lfg-header-cell[data-col-id="${SELECTION_COLUMN_FIELD}"]`,
      ),
    ).not.toBeNull();
  });

  it("keeps the handle inside the utility cell when the first user column is at min width", async () => {
    const { root } = await mountGrid({
      rows,
      columns: [
        { field: "name", minWidth: 48, width: 48, pinned: "left" },
        { field: "status" },
      ],
      rowDrag: { enabled: true, managed: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(colWidth(root, ROW_DRAG_COLUMN_FIELD)).toBe(`${ROW_DRAG_COLUMN_WIDTH}px`);
    expect(colWidth(root, "name")).toBe("48px");
    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);
    expect(leftHeaderFields(root)[1]).toBe("name");
    for (const rowEl of displayedPinnedLeftRows(root)) {
      const handle = assertOneHandleInDragCell(rowEl);
      expect(handle.closest(`[data-col-id="name"]`)).toBeNull();
    }
  });

  it("injects and removes the utility column through setRowDrag without leftover pooled handles", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [{ field: "name" }],
      rowDrag: false,
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(root.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)).toBeNull();
    expect(leftHeaderFields(root)).not.toContain(ROW_DRAG_COLUMN_FIELD);

    grid.setRowDrag({ enabled: true, managed: true });
    await flushRenders();

    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);
    expect(displayedPinnedLeftRows(root).length).toBe(rows.length);
    for (const rowEl of displayedPinnedLeftRows(root)) {
      assertOneHandleInDragCell(rowEl);
    }

    grid.setRowDrag(false);
    await flushRenders();

    expect(root.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${ROW_DRAG_CELL_CLASS}`)).toBeNull();
    expect(leftHeaderFields(root)).not.toContain(ROW_DRAG_COLUMN_FIELD);
    expect(grid.getColumns().map((c) => c.field)).toEqual(["name"]);
  });

  it("keeps the utility column while SortModel blocks pointer drag", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [{ field: "name", sortable: true }],
      rowDrag: { enabled: true, managed: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    grid.setSortModel([{ field: "name", sort: "asc" }]);
    await flushRenders();

    expect(root.classList.contains("lfg-row-drag-blocked")).toBe(true);
    expect(root.classList.contains("lfg-row-drag-enabled")).toBe(false);
    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);

    const handle = assertOneHandleInDragCell(displayedPinnedLeftRows(root)[0]!);
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 8,
        clientY: 8,
        pointerId: 1,
      }),
    );
    expect(root.classList.contains("lfg-row-dragging")).toBe(false);
  });

  it("excludes the row-drag field from column order, selection, sort, filter, search, autosize, and size-to-fit", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [
        { field: "name", sortable: true, filterable: true, resizable: true, width: 120 },
        { field: "status", sortable: true, resizable: true, width: 120 },
      ],
      rowDrag: { enabled: true, managed: true },
      columnSelection: { mode: "multiple" },
      columnOrder: { enabled: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(grid.getColumns().map((c) => c.field)).toEqual(["name", "status"]);
    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);

    grid.setSelectedColumnIds([ROW_DRAG_COLUMN_FIELD, "name"]);
    expect(grid.getSelectedColumnIds()).toEqual(["name"]);

    grid.setSortModel([{ field: ROW_DRAG_COLUMN_FIELD, sort: "asc" }]);
    expect(grid.getSortModel()).toEqual([]);
    expect(
      normalizeSortModel(
        [{ field: ROW_DRAG_COLUMN_FIELD, sort: "asc" }],
        [{ field: ROW_DRAG_COLUMN_FIELD, internal: "row-drag", sortable: false }],
      ),
    ).toEqual([]);

    const searchable = resolveSearchableFields([
      { field: ROW_DRAG_COLUMN_FIELD, internal: "row-drag" },
      { field: "name" },
    ]);
    expect(searchable.fields.map((f) => f.field)).toEqual(["name"]);

    const searchableCombined = resolveSearchableFields([
      { field: ROW_CONTROLS_COLUMN_FIELD, internal: "row-controls" },
      { field: "name" },
    ]);
    expect(searchableCombined.fields.map((f) => f.field)).toEqual(["name"]);

    const beforeWidth = colWidth(root, ROW_DRAG_COLUMN_FIELD);
    grid.autoSizeColumn(ROW_DRAG_COLUMN_FIELD);
    grid.sizeColumnsToFit();
    await flushRenders();
    expect(colWidth(root, ROW_DRAG_COLUMN_FIELD)).toBe(beforeWidth);
    expect(beforeWidth).toBe(`${ROW_DRAG_COLUMN_WIDTH}px`);
  });

  it("renders the handle in the pinned-left utility cell of top and bottom pinned rows", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [{ field: "name" }, { field: "status" }],
      rowDrag: { enabled: true, managed: true },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    grid.pinRow("r1", "top");
    grid.pinRow("r3", "bottom");
    await flushRenders();

    const topCell = root.querySelector<HTMLElement>(
      `.lfg-row-pinned-top-left-layer .lfg-row[data-row-id="r1"] .${ROW_DRAG_CELL_CLASS}`,
    );
    const bottomCell = root.querySelector<HTMLElement>(
      `.lfg-row-pinned-bottom-left-layer .lfg-row[data-row-id="r3"] .${ROW_DRAG_CELL_CLASS}`,
    );
    expect(topCell).not.toBeNull();
    expect(bottomCell).not.toBeNull();
    expect(topCell!.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`).length).toBe(1);
    expect(bottomCell!.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`).length).toBe(1);
  });

  it("recycles virtualized rows with exactly one correctly bound handle", async () => {
    const many: RowData[] = Array.from({ length: 80 }, (_, i) => ({
      id: `r${i}`,
      name: `Row ${i}`,
    }));
    const { root } = await mountGrid({
      rows: many,
      columns: [{ field: "name" }],
      rowDrag: { enabled: true, managed: true },
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    const viewport = root.querySelector<HTMLElement>(".lfg-viewport");
    expect(viewport).not.toBeNull();

    const assertVisibleHandles = (): void => {
      const visible = displayedPinnedLeftRows(root).filter((el) => {
        const index = Number(el.getAttribute("data-row-index"));
        return Number.isFinite(index) && index >= 0;
      });
      expect(visible.length).toBeGreaterThan(0);
      for (const rowEl of visible) {
        assertOneHandleInDragCell(rowEl);
      }
    };

    assertVisibleHandles();
    viewport!.scrollTop = 40 * ROW_HEIGHT;
    viewport!.dispatchEvent(new Event("scroll"));
    await flushRenders();
    assertVisibleHandles();
  });

  it("renders no drag handle when only checkboxes are enabled", async () => {
    const { root } = await mountGrid({
      rows,
      columns: [{ field: "name" }],
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(leftHeaderFields(root)[0]).toBe(SELECTION_COLUMN_FIELD);
    expect(root.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${ROW_CONTROLS_CELL_CLASS}`)).toBeNull();
    expect(root.querySelector(`.${ROW_DRAG_CELL_CLASS}`)).toBeNull();
  });

  it("isolates combined drag and checkbox pointer interaction", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [{ field: "name" }],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        headerCheckbox: true,
        enableRowClickSelection: false,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    const rowEl = displayedPinnedLeftRows(root)[0]!;
    const handle = assertOneHandleInCombinedCell(rowEl);
    const checkbox = rowEl.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();

    checkbox.click();
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);
    expect(root.classList.contains("lfg-row-dragging")).toBe(false);

    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 8,
        clientY: 8,
        pointerId: 1,
      }),
    );
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.setSortModel([{ field: "name", sort: "asc" }]);
    await flushRenders();
    expect(root.classList.contains("lfg-row-drag-blocked")).toBe(true);

    const blockedRow = displayedPinnedLeftRows(root)[1]!;
    const blockedCheckbox = blockedRow.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement;
    blockedCheckbox.click();
    await flushRenders();
    expect(new Set(grid.getSelectedRowIds())).toEqual(new Set(["r1", "r2"]));
  });

  it("preserves selection and order through adaptive column transitions", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [{ field: "name" }],
      rowDrag: false,
      rowSelection: {
        mode: "multiple",
        checkboxes: false,
        enableRowClickSelection: false,
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    expect(leftHeaderFields(root)).not.toContain(ROW_DRAG_COLUMN_FIELD);
    expect(root.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)).toBeNull();

    grid.setRowDrag({ enabled: true, managed: true });
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);
    assertOneHandleInDragCell(displayedPinnedLeftRows(root)[0]!);

    grid.setRowSelection({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      enableRowClickSelection: false,
      checkboxColumn: { pinned: "left" },
    });
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);
    expect(leftHeaderFields(root)).not.toContain(ROW_DRAG_COLUMN_FIELD);
    const combinedRow = displayedPinnedLeftRows(root)[0]!;
    assertOneHandleInCombinedCell(combinedRow);
    combinedRow.querySelector(".lfg-row-selection-checkbox")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flushRenders();
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.setRowSelection({
      mode: "multiple",
      checkboxes: false,
      enableRowClickSelection: false,
    });
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);
    assertOneHandleInDragCell(displayedPinnedLeftRows(root)[0]!);
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.setRowSelection({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      enableRowClickSelection: false,
      checkboxColumn: { pinned: "left" },
    });
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.setRowDrag(false);
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(SELECTION_COLUMN_FIELD);
    expect(root.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)).toBeNull();
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.setRowDrag({ enabled: true, managed: true });
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);

    grid.setRowSelection({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      enableRowClickSelection: false,
      checkboxColumn: { pinned: "right" },
    });
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_DRAG_COLUMN_FIELD);
    expect(leftHeaderFields(root)).not.toContain(SELECTION_COLUMN_FIELD);
    expect(
      root.querySelector(
        `.lfg-pinned-right-header-row .lfg-header-cell[data-col-id="${SELECTION_COLUMN_FIELD}"]`,
      ),
    ).not.toBeNull();
    assertOneHandleInDragCell(displayedPinnedLeftRows(root)[0]!);
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.setRowSelection({
      mode: "multiple",
      checkboxes: true,
      headerCheckbox: true,
      enableRowClickSelection: false,
      checkboxColumn: { pinned: "left" },
    });
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);
    expect(leftHeaderFields(root)).not.toContain(ROW_DRAG_COLUMN_FIELD);
    assertOneHandleInCombinedCell(displayedPinnedLeftRows(root)[0]!);
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.setSortModel([{ field: "name", sort: "asc" }]);
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);
    expect(root.classList.contains("lfg-row-drag-blocked")).toBe(true);
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);

    grid.clearSort();
    await flushRenders();
    expect(leftHeaderFields(root)[0]).toBe(ROW_CONTROLS_COLUMN_FIELD);
    expect(root.classList.contains("lfg-row-drag-enabled")).toBe(true);
    expect(grid.getSelectedRowIds()).toEqual(["r1"]);
    expect(grid.getRows().map((row) => String(row.id))).toEqual([
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("renders a combined handle in top and bottom pinned rows", async () => {
    const { grid, root } = await mountGrid({
      rows,
      columns: [{ field: "name" }],
      rowDrag: { enabled: true, managed: true },
      rowSelection: {
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { pinned: "left" },
      },
      suppressRowVirtualization: true,
      suppressColumnVirtualization: true,
      getRowId: (r: RowData) => String(r.id),
    });

    grid.pinRow("r1", "top");
    grid.pinRow("r3", "bottom");
    await flushRenders();

    const topCell = root.querySelector<HTMLElement>(
      `.lfg-row-pinned-top-left-layer .lfg-row[data-row-id="r1"] .${ROW_CONTROLS_CELL_CLASS}`,
    );
    const bottomCell = root.querySelector<HTMLElement>(
      `.lfg-row-pinned-bottom-left-layer .lfg-row[data-row-id="r3"] .${ROW_CONTROLS_CELL_CLASS}`,
    );
    expect(topCell).not.toBeNull();
    expect(bottomCell).not.toBeNull();
    expect(topCell!.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`).length).toBe(1);
    expect(bottomCell!.querySelectorAll(`.${ROW_DRAG_HANDLE_CLASS}`).length).toBe(1);
    expect(topCell!.querySelector(".lfg-row-selection-checkbox")).not.toBeNull();
  });
});
