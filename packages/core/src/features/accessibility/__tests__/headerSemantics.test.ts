// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
  COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
  COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
  COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE,
  COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
} from "../../../internal/columnGroupHeaderDomMetadata";
import type { ColumnDef } from "../../../types";
import type { DomGridFeatureContext } from "../../types";
import {
  buildFieldToAriaColIndexMap,
  buildSortDirectionByField,
  clearColumnHeaderSemantics,
  HeaderSemanticsReconciler,
  resolveAriaSortValue,
  resolveColumnHeaderAriaLabel,
  syncColumnHeaderSemantics,
  toAriaColIndex,
} from "../utils/headerSemantics";

describe("toAriaColIndex", () => {
  it("is 1-based from zero-based logical column index", () => {
    expect(toAriaColIndex(0)).toBe(1);
    expect(toAriaColIndex(2)).toBe(3);
  });
});

describe("buildFieldToAriaColIndexMap", () => {
  it("maps fields to display-order aria-colindex", () => {
    const columns = [
      { field: "a" },
      { field: "b" },
      { field: "c" },
    ] as ColumnDef[];
    const map = buildFieldToAriaColIndexMap(columns);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe(2);
    expect(map.get("c")).toBe(3);
  });

  it("uses pinned-left, center, pinned-right visual lane order", () => {
    const columns = [
      { field: "centerA" },
      { field: "right", pinned: "right" },
      { field: "left", pinned: "left" },
      { field: "centerB" },
    ] as ColumnDef[];
    const map = buildFieldToAriaColIndexMap(columns);
    expect(map.get("left")).toBe(1);
    expect(map.get("centerA")).toBe(2);
    expect(map.get("centerB")).toBe(3);
    expect(map.get("right")).toBe(4);
  });
});

describe("resolveAriaSortValue", () => {
  const sortable = { field: "a", sortable: true } as ColumnDef;
  const locked = { field: "b", sortable: false } as ColumnDef;

  it("returns null for non-sortable columns", () => {
    expect(resolveAriaSortValue(locked, undefined)).toBeNull();
  });

  it("maps sort directions to aria-sort tokens", () => {
    expect(resolveAriaSortValue(sortable, undefined)).toBeNull();
    expect(resolveAriaSortValue(sortable, "asc")).toBe("ascending");
    expect(resolveAriaSortValue(sortable, "desc")).toBe("descending");
  });
});

describe("resolveColumnHeaderAriaLabel", () => {
  it("includes visible label text for Label in Name", () => {
    const col = { field: "id", headerName: "ID" } as ColumnDef;
    expect(resolveColumnHeaderAriaLabel(col, "ID")).toBe("ID");
    expect(resolveColumnHeaderAriaLabel(col, "Custom visible")).toBe(
      "Custom visible ID",
    );
  });
});

function makeHeaderCell(field: string, hidden = false): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "lfg-header-cell";
  cell.setAttribute("data-col-id", field);
  const label = document.createElement("span");
  label.className = "lfg-header-label";
  label.textContent = field === "name" ? "Name" : field;
  cell.appendChild(label);
  if (hidden) {
    cell.style.display = "none";
  }
  return cell;
}

function makeMenuTrigger(field: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "lfg-column-menu-trigger";
  btn.setAttribute("data-col-id", field);
  return btn;
}

interface GroupSpanFixture {
  readonly label: string;
  readonly startField: string;
  readonly endField: string;
  readonly leafCount: number;
  readonly hidden?: boolean;
}

function addGroupRow(
  container: HTMLElement,
  leafRow: HTMLElement,
  level: number,
  fixtures: readonly GroupSpanFixture[],
): { row: HTMLDivElement; spans: HTMLDivElement[] } {
  const row = document.createElement("div");
  row.setAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE, String(level));
  const spans = fixtures.map((fixture) => {
    const span = document.createElement("div");
    span.setAttribute(COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE, "");
    span.setAttribute(
      COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
      fixture.startField,
    );
    span.setAttribute(
      COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
      fixture.endField,
    );
    span.setAttribute(
      COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
      String(fixture.leafCount),
    );
    span.textContent = fixture.label;
    if (fixture.hidden === true) {
      span.style.display = "none";
    }
    row.appendChild(span);
    return span;
  });
  container.insertBefore(row, leafRow);
  return { row, spans };
}

function makeCtx(
  columns: ColumnDef[],
  leafCells: HTMLDivElement[],
  extras?: Partial<DomGridFeatureContext>,
): DomGridFeatureContext {
  const root = document.createElement("div");
  const header = document.createElement("div");
  header.className = "lfg-header";
  const leaf = document.createElement("div");
  leaf.className = "lfg-header-row";
  for (const cell of leafCells) {
    leaf.appendChild(cell);
  }
  header.appendChild(leaf);
  root.appendChild(header);

  return {
    root,
    surface: root,
    viewport: document.createElement("div"),
    getPool: () => [],
    getColumns: () => columns,
    getDisplayRows: () => ({
      rowCount: 0,
      getRowData: () => ({}),
      getSourceIndex: () => -1,
      getRow: () => null,
    }),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    syncColumnSelectionClasses: () => {},
    resolveRowId: () => "id",
    getHeaderRowEl: () => leaf,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getDataRevision: () => 0,
    getSelectedColumnIdsForColumnOrder: () => [],
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: () => false,
    getSelectedRowIdsForRowOrder: () => [],
    getSortModel: () => [],
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
    ...extras,
  };
}

describe("syncColumnHeaderSemantics", () => {
  it("writes role, aria-colindex, aria-sort, and aria-label on visible leaf header cells", () => {
    const columns = [
      { field: "name", headerName: "Name", sortable: true },
      { field: "age", headerName: "Age", sortable: false },
    ] as ColumnDef[];
    const cells = [makeHeaderCell("name"), makeHeaderCell("age")];
    const ctx = makeCtx(columns, cells, {
      getSortModel: () => [{ field: "name", sort: "asc" }],
    });

    syncColumnHeaderSemantics(ctx);

    expect(cells[0]!.getAttribute("role")).toBe("columnheader");
    expect(cells[0]!.getAttribute("aria-colindex")).toBe("1");
    expect(cells[0]!.getAttribute("aria-sort")).toBe("ascending");
    expect(cells[0]!.getAttribute("aria-label")).toBe("Name");

    expect(cells[1]!.getAttribute("aria-colindex")).toBe("2");
    expect(cells[1]!.getAttribute("aria-sort")).toBeNull();
    expect(cells[1]!.getAttribute("aria-label")).toBe("age Age");
  });

  it("syncs column-menu trigger aria-haspopup and aria-expanded", () => {
    const columns = [{ field: "a", headerName: "A" }] as ColumnDef[];
    const cell = makeHeaderCell("a");
    cell.appendChild(makeMenuTrigger("a"));
    const ctx = makeCtx(columns, [cell], {
      getOpenColumnMenuField: () => "a",
      getOpenColumnMenuPopupId: () => "lfg-popup-column-menu-1",
    });

    syncColumnHeaderSemantics(ctx);

    const trigger = cell.querySelector("button.lfg-column-menu-trigger")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(
      "lfg-popup-column-menu-1",
    );
  });

  it("clears semantics on hidden or unbound cells", () => {
    const columns = [{ field: "a" }] as ColumnDef[];
    const bound = makeHeaderCell("a");
    const hidden = makeHeaderCell("a", true);
    const orphan = makeHeaderCell("missing");
    const ctx = makeCtx(columns, [bound, hidden, orphan]);

    syncColumnHeaderSemantics(ctx);

    expect(bound.getAttribute("aria-colindex")).toBe("1");
    expect(hidden.getAttribute("role")).toBeNull();
    expect(orphan.getAttribute("role")).toBeNull();
  });

  it("clears all leaf header semantics on detach path", () => {
    const columns = [{ field: "x" }] as ColumnDef[];
    const cell = makeHeaderCell("x");
    const ctx = makeCtx(columns, [cell]);

    syncColumnHeaderSemantics(ctx);
    clearColumnHeaderSemantics(ctx);

    expect(cell.getAttribute("role")).toBeNull();
    expect(cell.getAttribute("aria-colindex")).toBeNull();
  });
});

describe("buildSortDirectionByField", () => {
  it("uses first sort model entry per field", () => {
    const map = buildSortDirectionByField([
      { field: "a", sort: "asc" },
      { field: "a", sort: "desc" },
    ]);
    expect(map.get("a")).toBe("asc");
  });
});

describe("HeaderSemanticsReconciler retained updates", () => {
  it("refreshes rebound header widgets from one bounded target without selector discovery", () => {
    let openField: string | null = null;
    const cell = makeHeaderCell("a");
    const controls = document.createElement("div");
    controls.className = "lfg-header-controls";
    const oldAction = document.createElement("button");
    oldAction.className = "lfg-header-action-trigger";
    const oldMenu = makeMenuTrigger("a");
    controls.append(oldAction, oldMenu);
    const resize = document.createElement("div");
    resize.className = "lfg-resize-handle";
    cell.append(controls, resize);
    const ctx = makeCtx([{ field: "a" }, { field: "b" }], [cell], {
      getOpenColumnMenuField: () => openField,
      getOpenColumnMenuPopupId: () => openField === null ? null : "menu-b",
    });
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);
    expect(reconciler.resolveTargetWidgetCount("leafHeader", "a")).toBe(3);

    const nextAction = document.createElement("button");
    nextAction.className = "lfg-header-action-trigger";
    const nextMenu = makeMenuTrigger("b");
    controls.replaceChildren(nextAction, nextMenu);
    cell.setAttribute("data-col-id", "b");
    expect(reconciler.syncBindings()).toBe(true);

    const cellQuery = vi.spyOn(cell, "querySelector");
    const cellQueryAll = vi.spyOn(cell, "querySelectorAll");
    expect(reconciler.resolveTargetWidgetCount("leafHeader", "b")).toBe(3);
    expect(reconciler.resolveTargetWidget("leafHeader", "b", 0)).toBe(nextAction);
    expect(reconciler.resolveTargetWidget("leafHeader", "b", 1)).toBe(nextMenu);
    expect(reconciler.resolveTargetWidget("leafHeader", "b", 2)).toBe(resize);
    expect(reconciler.resolveColumnMenuTrigger("b")).toBe(nextMenu);
    openField = "b";
    reconciler.syncMenu(ctx);
    expect(nextMenu.getAttribute("aria-expanded")).toBe("true");
    expect(nextMenu.getAttribute("aria-controls")).toBe("menu-b");
    expect(oldMenu.getAttribute("aria-expanded")).not.toBe("true");
    expect(cellQuery).not.toHaveBeenCalled();
    expect(cellQueryAll).not.toHaveBeenCalled();
  });

  it("rebinds horizontal header slots without DOM discovery or map rebuild", () => {
    const columns = [
      { field: "a", headerName: "A" },
      { field: "b", headerName: "B" },
      { field: "c", headerName: "C" },
    ] as ColumnDef[];
    const cells = [makeHeaderCell("a"), makeHeaderCell("b")];
    const ctx = makeCtx(columns, cells);
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);

    cells[0]!.setAttribute("data-col-id", "c");
    cells[0]!.querySelector(".lfg-header-label")!.textContent = "C";
    const firstQuery = vi.spyOn(cells[0]!, "querySelector");
    const secondQuery = vi.spyOn(cells[1]!, "querySelector");

    expect(reconciler.syncBindings()).toBe(true);
    expect(cells[0]!.getAttribute("aria-colindex")).toBe("3");
    expect(cells[0]!.getAttribute("aria-label")).toBe("C");
    expect(firstQuery).not.toHaveBeenCalled();
    expect(secondQuery).not.toHaveBeenCalled();
  });

  it("fails closed when the retained physical header pool changes", () => {
    const cells = [makeHeaderCell("a"), makeHeaderCell("b")];
    const ctx = makeCtx(
      [{ field: "a" }, { field: "b" }] as ColumnDef[],
      cells,
    );
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);

    cells[1]!.remove();

    expect(reconciler.syncBindings()).toBe(false);
  });

  it("performs zero writes for unchanged physical header bindings", () => {
    const cells = [makeHeaderCell("a"), makeHeaderCell("b")];
    const ctx = makeCtx(
      [{ field: "a" }, { field: "b" }] as ColumnDef[],
      cells,
    );
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);
    const setSpies = cells.map((cell) =>
      vi.spyOn(cell, "setAttribute"),
    );
    const removeSpies = cells.map((cell) =>
      vi.spyOn(cell, "removeAttribute"),
    );

    expect(reconciler.syncBindings()).toBe(true);
    for (const spy of [...setSpies, ...removeSpies]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("updates at most the previous and current menu trigger", () => {
    let openField: string | null = null;
    const cells = [
      makeHeaderCell("a"),
      makeHeaderCell("b"),
      makeHeaderCell("c"),
    ];
    const triggers = cells.map((cell, index) => {
      const trigger = makeMenuTrigger(["a", "b", "c"][index]!);
      cell.appendChild(trigger);
      return trigger;
    });
    const ctx = makeCtx(
      [{ field: "a" }, { field: "b" }, { field: "c" }] as ColumnDef[],
      cells,
      {
        getOpenColumnMenuField: () => openField,
        getOpenColumnMenuPopupId: () =>
          openField === null ? null : "lfg-popup-column-menu-2",
      },
    );
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);
    const writes = triggers.map((trigger) =>
      vi.spyOn(trigger, "setAttribute"),
    );

    openField = "a";
    reconciler.syncMenu(ctx);
    expect(writes[0]).toHaveBeenCalled();
    expect(writes[1]).not.toHaveBeenCalled();
    expect(writes[2]).not.toHaveBeenCalled();
    writes.forEach((spy) => spy.mockClear());

    openField = "b";
    reconciler.syncMenu(ctx);
    expect(writes[0]).toHaveBeenCalled();
    expect(writes[1]).toHaveBeenCalled();
    expect(writes[2]).not.toHaveBeenCalled();
  });

  it("preserves exact popup ownership across pinned lanes and recycled slots", () => {
    let openField: string | null = "left";
    const popupId = "lfg-popup-column-menu-3";
    const centerCell = makeHeaderCell("a");
    const centerTrigger = makeMenuTrigger("a");
    centerCell.appendChild(centerTrigger);
    const leftCell = makeHeaderCell("left");
    const leftTrigger = makeMenuTrigger("left");
    leftCell.appendChild(leftTrigger);
    const ctx = makeCtx(
      [
        { field: "left", pinned: "left" },
        { field: "a" },
        { field: "b" },
      ] as ColumnDef[],
      [centerCell],
      {
        getOpenColumnMenuField: () => openField,
        getOpenColumnMenuPopupId: () =>
          openField === null ? null : popupId,
      },
    );
    const centerContainer =
      ctx.root.querySelector<HTMLDivElement>(".lfg-header")!;
    const centerRow = ctx.getHeaderRowEl()!;
    const leftContainer = document.createElement("div");
    const leftRow = document.createElement("div");
    leftRow.appendChild(leftCell);
    leftContainer.appendChild(leftRow);
    ctx.root.prepend(leftContainer);
    ctx.getHeaderLaneRefs = () => ({
      left: { container: leftContainer, leafRow: leftRow },
      center: { container: centerContainer, leafRow: centerRow },
      right: null,
    });
    const reconciler = new HeaderSemanticsReconciler();

    reconciler.syncTopology(ctx);
    expect(leftTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(leftTrigger.getAttribute("aria-controls")).toBe(popupId);
    expect(centerTrigger.getAttribute("aria-expanded")).toBe("false");

    centerCell.setAttribute("data-col-id", "b");
    centerCell.querySelector(".lfg-header-label")!.textContent = "b";
    centerTrigger.setAttribute("data-col-id", "b");
    openField = "b";

    expect(reconciler.syncBindings()).toBe(true);
    reconciler.syncMenu(ctx);
    expect(leftTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(leftTrigger.hasAttribute("aria-controls")).toBe(false);
    expect(centerTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(centerTrigger.getAttribute("aria-controls")).toBe(popupId);
  });
});

describe("grouped column-header semantics", () => {
  it("publishes role, global start, positive span, and visible-label name", () => {
    const columns = [
      { field: "a" },
      { field: "b" },
      { field: "c" },
    ] as ColumnDef[];
    const ctx = makeCtx(
      columns,
      columns.map((column) => makeHeaderCell(column.field)),
    );
    const container = ctx.root.querySelector<HTMLElement>(".lfg-header")!;
    const leafRow = ctx.getHeaderRowEl()!;
    const { spans } = addGroupRow(container, leafRow, 0, [
      {
        label: " Profile ",
        startField: "a",
        endField: "b",
        leafCount: 2,
      },
    ]);

    syncColumnHeaderSemantics(ctx);

    expect(spans[0]!.getAttribute("role")).toBe("columnheader");
    expect(spans[0]!.getAttribute("aria-colindex")).toBe("1");
    expect(spans[0]!.getAttribute("aria-colspan")).toBe("2");
    expect(spans[0]!.getAttribute("aria-label")).toBe("Profile");
    expect(spans[0]!.hasAttribute("aria-owns")).toBe(false);
  });

  it("expresses nested ancestry through top-to-bottom contained intervals", () => {
    const columns = [
      { field: "a" },
      { field: "b" },
      { field: "c" },
    ] as ColumnDef[];
    const cells = columns.map((column) => makeHeaderCell(column.field));
    const ctx = makeCtx(columns, cells);
    const container = ctx.root.querySelector<HTMLElement>(".lfg-header")!;
    const leafRow = ctx.getHeaderRowEl()!;
    const outer = addGroupRow(container, leafRow, 0, [
      { label: "All", startField: "a", endField: "c", leafCount: 3 },
    ]);
    const inner = addGroupRow(container, leafRow, 1, [
      {
        label: "Profile",
        startField: "a",
        endField: "b",
        leafCount: 2,
      },
      { label: "Status", startField: "c", endField: "c", leafCount: 1 },
    ]);

    syncColumnHeaderSemantics(ctx);

    expect(outer.row.nextElementSibling).toBe(inner.row);
    expect(inner.row.nextElementSibling).toBe(leafRow);
    expect(outer.spans[0]!.getAttribute("aria-colindex")).toBe("1");
    expect(outer.spans[0]!.getAttribute("aria-colspan")).toBe("3");
    expect(inner.spans[0]!.getAttribute("aria-colindex")).toBe("1");
    expect(inner.spans[0]!.getAttribute("aria-colspan")).toBe("2");
    expect(inner.spans[1]!.getAttribute("aria-colindex")).toBe("3");
    expect(inner.spans[1]!.getAttribute("aria-colspan")).toBe("1");
    expect(cells.map((cell) => cell.getAttribute("aria-colindex"))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("keeps distinct runs separated across an ungrouped gap", () => {
    const columns = [
      { field: "a" },
      { field: "gap" },
      { field: "c" },
    ] as ColumnDef[];
    const ctx = makeCtx(
      columns,
      columns.map((column) => makeHeaderCell(column.field)),
    );
    const container = ctx.root.querySelector<HTMLElement>(".lfg-header")!;
    const { spans } = addGroupRow(container, ctx.getHeaderRowEl()!, 0, [
      { label: "Shared", startField: "a", endField: "a", leafCount: 1 },
      { label: "Shared", startField: "c", endField: "c", leafCount: 1 },
    ]);

    syncColumnHeaderSemantics(ctx);

    expect(spans[0]!.getAttribute("aria-colindex")).toBe("1");
    expect(spans[0]!.getAttribute("aria-colspan")).toBe("1");
    expect(spans[1]!.getAttribute("aria-colindex")).toBe("3");
    expect(spans[1]!.getAttribute("aria-colspan")).toBe("1");
  });

  it("uses global indexes for independent pinned-lane fragments", () => {
    const columns = [
      { field: "centerA" },
      { field: "right", pinned: "right" },
      { field: "left", pinned: "left" },
      { field: "centerB" },
    ] as ColumnDef[];
    const ctx = makeCtx(columns, [
      makeHeaderCell("centerA"),
      makeHeaderCell("centerB"),
    ]);
    const centerContainer =
      ctx.root.querySelector<HTMLDivElement>(".lfg-header")!;
    const centerLeaf = ctx.getHeaderRowEl()!;
    const leftContainer = document.createElement("div");
    const leftLeaf = document.createElement("div");
    leftLeaf.className = "lfg-header-row";
    leftLeaf.appendChild(makeHeaderCell("left"));
    leftContainer.appendChild(leftLeaf);
    const rightContainer = document.createElement("div");
    const rightLeaf = document.createElement("div");
    rightLeaf.className = "lfg-header-row";
    rightLeaf.appendChild(makeHeaderCell("right"));
    rightContainer.appendChild(rightLeaf);
    ctx.root.prepend(leftContainer);
    ctx.root.appendChild(rightContainer);
    const left = addGroupRow(leftContainer, leftLeaf, 0, [
      {
        label: "Shared",
        startField: "left",
        endField: "left",
        leafCount: 1,
      },
    ]);
    const center = addGroupRow(centerContainer, centerLeaf, 0, [
      {
        label: "Shared",
        startField: "centerA",
        endField: "centerB",
        leafCount: 2,
      },
    ]);
    const right = addGroupRow(rightContainer, rightLeaf, 0, [
      {
        label: "Shared",
        startField: "right",
        endField: "right",
        leafCount: 1,
      },
    ]);
    ctx.getHeaderLaneRefs = () => ({
      left: { container: leftContainer, leafRow: leftLeaf },
      center: { container: centerContainer, leafRow: centerLeaf },
      right: { container: rightContainer, leafRow: rightLeaf },
    });

    syncColumnHeaderSemantics(ctx);

    expect(left.spans[0]!.getAttribute("aria-colindex")).toBe("1");
    expect(left.spans[0]!.getAttribute("aria-colspan")).toBe("1");
    expect(center.spans[0]!.getAttribute("aria-colindex")).toBe("2");
    expect(center.spans[0]!.getAttribute("aria-colspan")).toBe("2");
    expect(right.spans[0]!.getAttribute("aria-colindex")).toBe("4");
    expect(right.spans[0]!.getAttribute("aria-colspan")).toBe("1");
  });

  it("rebinds pooled spans without discovery and performs no unchanged writes", () => {
    const columns = [
      { field: "a" },
      { field: "b" },
      { field: "c" },
    ] as ColumnDef[];
    const ctx = makeCtx(
      columns,
      columns.map((column) => makeHeaderCell(column.field)),
    );
    const container = ctx.root.querySelector<HTMLElement>(".lfg-header")!;
    const { row, spans } = addGroupRow(container, ctx.getHeaderRowEl()!, 0, [
      { label: "A-B", startField: "a", endField: "b", leafCount: 2 },
    ]);
    const span = spans[0]!;
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);
    const unchangedSet = vi.spyOn(span, "setAttribute");
    const unchangedRemove = vi.spyOn(span, "removeAttribute");

    expect(reconciler.syncBindings()).toBe(true);
    expect(unchangedSet).not.toHaveBeenCalled();
    expect(unchangedRemove).not.toHaveBeenCalled();
    unchangedSet.mockRestore();
    unchangedRemove.mockRestore();

    span.setAttribute(COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE, "b");
    span.setAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE, "c");
    span.textContent = "B-C";
    const rowDiscovery = vi.spyOn(row, "querySelectorAll");
    const spanDiscovery = vi.spyOn(span, "querySelectorAll");

    expect(reconciler.syncBindings()).toBe(true);
    expect(span.getAttribute("aria-colindex")).toBe("2");
    expect(span.getAttribute("aria-colspan")).toBe("2");
    expect(span.getAttribute("aria-label")).toBe("B-C");
    expect(rowDiscovery).not.toHaveBeenCalled();
    expect(spanDiscovery).not.toHaveBeenCalled();
  });

  it("clears hidden and malformed pooled spans and fails closed on pool growth", () => {
    const columns = [
      { field: "a" },
      { field: "b" },
    ] as ColumnDef[];
    const ctx = makeCtx(
      columns,
      columns.map((column) => makeHeaderCell(column.field)),
    );
    const container = ctx.root.querySelector<HTMLElement>(".lfg-header")!;
    const { row, spans } = addGroupRow(container, ctx.getHeaderRowEl()!, 0, [
      { label: "A-B", startField: "a", endField: "b", leafCount: 2 },
    ]);
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);
    const span = spans[0]!;

    span.setAttribute(COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE, "1");
    expect(reconciler.syncBindings()).toBe(true);
    expect(span.getAttribute("role")).toBeNull();
    expect(span.getAttribute("aria-colspan")).toBeNull();

    span.setAttribute(COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE, "2");
    span.style.display = "none";
    expect(reconciler.syncBindings()).toBe(true);
    expect(span.getAttribute("role")).toBeNull();

    row.appendChild(document.createElement("div"));
    expect(reconciler.syncBindings()).toBe(false);
  });

  it("clears only plugin-owned group semantics on detach", () => {
    const columns = [{ field: "a" }] as ColumnDef[];
    const ctx = makeCtx(columns, [makeHeaderCell("a")]);
    const container = ctx.root.querySelector<HTMLElement>(".lfg-header")!;
    const { spans } = addGroupRow(container, ctx.getHeaderRowEl()!, 0, [
      { label: "A", startField: "a", endField: "a", leafCount: 1 },
    ]);
    const span = spans[0]!;
    span.setAttribute("data-owner-value", "retained");
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);

    reconciler.clear();

    expect(span.getAttribute("role")).toBeNull();
    expect(span.getAttribute("aria-colindex")).toBeNull();
    expect(span.getAttribute("aria-colspan")).toBeNull();
    expect(span.getAttribute("aria-label")).toBeNull();
    expect(span.getAttribute("data-owner-value")).toBe("retained");
  });
});
