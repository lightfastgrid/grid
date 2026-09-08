// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
  COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
  COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
  COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE,
  COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
} from "../../../internal/columnGroupHeaderDomMetadata";
import {
  FLOATING_FILTER_HEADER_ADDON_KIND,
  HEADER_ADDON_CELL_ATTRIBUTE,
  HEADER_ADDON_ROW_KIND_ATTRIBUTE,
} from "../../../internal/headerAddonDomMetadata";
import type { PooledRow } from "../../../internal/poolTypes";
import type { ColumnDef } from "../../../types";
import type {
  DomGridFeatureContext,
  HeaderLaneRef,
  HeaderLaneRefs,
} from "../../types";
import {
  countAccessibilityHeaderRows,
} from "../gridRootStructuralSnapshot";
import {
  HeaderSemanticsReconciler,
} from "../utils/headerSemantics";
import { RowSemanticsReconciler } from "../utils/rowSemantics";

interface LaneFixture {
  readonly ref: HeaderLaneRef;
  readonly groupRow: HTMLDivElement;
  readonly groupCells: HTMLDivElement[];
  readonly leafCells: HTMLDivElement[];
  readonly floatingRow: HTMLDivElement;
  readonly floatingCells: HTMLDivElement[];
}

function makeLeafCell(field: string): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "lfg-header-cell";
  cell.dataset.colId = field;
  const label = document.createElement("span");
  label.className = "lfg-header-label";
  label.textContent = field.toUpperCase();
  cell.appendChild(label);
  return cell;
}

function makeGroupCell(
  label: string,
  startField: string,
  endField: string,
  leafCount: number,
): HTMLDivElement {
  const cell = document.createElement("div");
  cell.setAttribute(COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE, "");
  cell.setAttribute(
    COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
    startField,
  );
  cell.setAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE, endField);
  cell.setAttribute(
    COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
    String(leafCount),
  );
  cell.textContent = label;
  return cell;
}

function makeFloatingCell(field: string): HTMLDivElement {
  const cell = document.createElement("div");
  cell.setAttribute(HEADER_ADDON_CELL_ATTRIBUTE, "");
  cell.dataset.colId = field;
  const input = document.createElement("input");
  input.setAttribute("aria-label", `Filter ${field.toUpperCase()}`);
  cell.appendChild(input);
  return cell;
}

function makeLane(
  fields: readonly string[],
  groupLabel: string,
): LaneFixture {
  const container = document.createElement("div");
  const groupRow = document.createElement("div");
  groupRow.setAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE, "0");
  const groupCells =
    fields.length === 0
      ? []
      : [
          makeGroupCell(
            groupLabel,
            fields[0]!,
            fields[fields.length - 1]!,
            fields.length,
          ),
        ];
  groupRow.append(...groupCells);

  const leafRow = document.createElement("div");
  leafRow.className = "lfg-header-row";
  const leafCells = fields.map(makeLeafCell);
  leafRow.append(...leafCells);

  const floatingRow = document.createElement("div");
  floatingRow.setAttribute(
    HEADER_ADDON_ROW_KIND_ATTRIBUTE,
    FLOATING_FILTER_HEADER_ADDON_KIND,
  );
  const floatingCells = fields.map(makeFloatingCell);
  floatingRow.append(...floatingCells);
  container.append(groupRow, leafRow, floatingRow);

  return {
    ref: { container, leafRow },
    groupRow,
    groupCells,
    leafCells,
    floatingRow,
    floatingCells,
  };
}

function makeContext(input: {
  columns: ColumnDef[];
  lanes: HeaderLaneRefs;
  pool?: PooledRow[];
  hasFloatingFilterRow?: () => boolean;
}): DomGridFeatureContext {
  const root = document.createElement("div");
  root.append(
    input.lanes.left?.container ?? document.createDocumentFragment(),
    input.lanes.center.container,
    input.lanes.right?.container ?? document.createDocumentFragment(),
  );
  const pool = input.pool ?? [];
  return {
    root,
    surface: root,
    viewport: document.createElement("div"),
    getPool: () => pool,
    getColumns: () => input.columns,
    getDisplayRows: () => ({
      rowCount: pool.length,
      getRowData: () => ({}),
      getSourceIndex: () => 0,
      getRow: () => null,
    }),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    syncColumnSelectionClasses: () => {},
    resolveRowId: () => "",
    getHeaderRowEl: () => input.lanes.center.leafRow,
    getPinnedHeaderRowEl: () => input.lanes.left?.leafRow ?? null,
    getPinnedRightHeaderRowEl: () => input.lanes.right?.leafRow ?? null,
    getHeaderLaneRefs: () => input.lanes,
    getColumnGroupHeaders: () => ({ depth: 1, byField: {} }),
    hasFloatingFilterRow: input.hasFloatingFilterRow ?? (() => true),
    getDataRevision: () => 0,
    getSelectedColumnIdsForColumnOrder: () => [],
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: () => false,
    getSelectedRowIdsForRowOrder: () => [],
    getSortModel: () => [],
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
  };
}

function splitFixture(): {
  readonly ctx: DomGridFeatureContext;
  readonly left: LaneFixture;
  readonly center: LaneFixture;
  readonly right: LaneFixture;
} {
  const left = makeLane(["a"], "A");
  const center = makeLane(["b", "c"], "B-C");
  const right = makeLane(["d"], "D");
  const ctx = makeContext({
    columns: [
      { field: "b" },
      { field: "d", pinned: "right" },
      { field: "a", pinned: "left" },
      { field: "c" },
    ],
    lanes: {
      left: left.ref,
      center: center.ref,
      right: right.ref,
    },
  });
  return { ctx, left, center, right };
}

function ownedIds(row: HTMLElement): string[] {
  return row.getAttribute("aria-owns")?.split(" ") ?? [];
}

describe("Accessibility V2 Stage F16B logical header structure", () => {
  it("117 exposes one indexed center owner per group, leaf, and floating level", () => {
    const { ctx, left, center, right } = splitFixture();
    new HeaderSemanticsReconciler().syncTopology(ctx);

    expect(center.groupRow.getAttribute("role")).toBe("row");
    expect(center.groupRow.getAttribute("aria-rowindex")).toBe("1");
    expect(center.ref.leafRow.getAttribute("role")).toBe("row");
    expect(center.ref.leafRow.getAttribute("aria-rowindex")).toBe("2");
    expect(center.floatingRow.getAttribute("role")).toBe("row");
    expect(center.floatingRow.getAttribute("aria-rowindex")).toBe("3");

    for (const row of [
      left.groupRow,
      left.ref.leafRow,
      left.floatingRow,
      right.groupRow,
      right.ref.leafRow,
      right.floatingRow,
    ]) {
      expect(row.getAttribute("role")).toBe("presentation");
      expect(row.getAttribute("aria-rowindex")).toBeNull();
    }
  });

  it("fails closed when a split level has no center owner", () => {
    const left = makeLane(["a"], "A");
    const center = makeLane([], "");
    center.floatingRow.remove();
    const ctx = makeContext({
      columns: [{ field: "a", pinned: "left" }],
      lanes: { left: left.ref, center: center.ref, right: null },
    });
    const reconciler = new HeaderSemanticsReconciler();

    reconciler.syncTopology(ctx);

    expect(left.floatingRow.getAttribute("role")).toBeNull();
    expect(left.floatingCells[0]!.getAttribute("role")).toBeNull();
    expect(left.floatingCells[0]!.id).not.toBe("");
    expect(reconciler.syncBindings()).toBe(false);
  });

  it("118 owns stable split-row IDs in global order and omits owns when unsplit", () => {
    const { ctx, left, center, right } = splitFixture();
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);

    expect(ownedIds(center.ref.leafRow)).toEqual([
      left.leafCells[0]!.id,
      center.leafCells[0]!.id,
      center.leafCells[1]!.id,
      right.leafCells[0]!.id,
    ]);
    expect(ownedIds(center.groupRow)).toEqual([
      left.groupCells[0]!.id,
      center.groupCells[0]!.id,
      right.groupCells[0]!.id,
    ]);

    const stableLeafIds = [
      left.leafCells[0]!.id,
      center.leafCells[0]!.id,
      center.leafCells[1]!.id,
      right.leafCells[0]!.id,
    ];
    reconciler.syncTopology(ctx);
    expect(reconciler.syncBindings()).toBe(true);
    expect([
      left.leafCells[0]!.id,
      center.leafCells[0]!.id,
      center.leafCells[1]!.id,
      right.leafCells[0]!.id,
    ]).toEqual(stableLeafIds);

    reconciler.clear();
    for (const cell of [
      ...left.leafCells,
      ...center.leafCells,
      ...right.leafCells,
      ...left.groupCells,
      ...center.groupCells,
      ...right.groupCells,
    ]) {
      expect(cell.getAttribute("id")).toBeNull();
      expect(cell.getAttribute("role")).toBeNull();
    }
    expect(center.ref.leafRow.getAttribute("aria-owns")).toBeNull();

    const onlyCenter = makeLane(["x", "y"], "X-Y");
    const centerCtx = makeContext({
      columns: [{ field: "x" }, { field: "y" }],
      lanes: { left: null, center: onlyCenter.ref, right: null },
    });
    new HeaderSemanticsReconciler().syncTopology(centerCtx);
    expect(onlyCenter.ref.leafRow.getAttribute("aria-owns")).toBeNull();
    expect(onlyCenter.groupRow.getAttribute("aria-owns")).toBeNull();
    expect(onlyCenter.floatingRow.getAttribute("aria-owns")).toBeNull();
  });

  it("119 counts one floating row and offsets body rows across runtime presence", () => {
    const center = makeLane(["a"], "A");
    let floating = true;
    const poolRow: PooledRow = {
      element: document.createElement("div"),
      cells: [],
      rowIndex: 0,
      rowVersion: 0,
      rowId: "r0",
    };
    const ctx = makeContext({
      columns: [{ field: "a" }],
      lanes: { left: null, center: center.ref, right: null },
      pool: [poolRow],
      hasFloatingFilterRow: () => floating,
    });
    const rows = new RowSemanticsReconciler();
    const read = {
      getRowSelectionMode: () => "none" as const,
      isRowSelected: () => false,
    };

    expect(countAccessibilityHeaderRows(ctx)).toBe(3);
    rows.syncStructure(ctx, read);
    expect(poolRow.element.getAttribute("aria-rowindex")).toBe("4");

    floating = false;
    expect(countAccessibilityHeaderRows(ctx)).toBe(2);
    rows.syncStructure(ctx, read);
    expect(poolRow.element.getAttribute("aria-rowindex")).toBe("3");
  });

  it("120 gives floating wrappers stable gridcell IDs without changing control names", () => {
    const { ctx, left, center, right } = splitFixture();
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);

    const cells = [
      left.floatingCells[0]!,
      center.floatingCells[0]!,
      center.floatingCells[1]!,
      right.floatingCells[0]!,
    ];
    expect(cells.map((cell) => cell.getAttribute("aria-colindex"))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    for (const cell of cells) {
      expect(cell.getAttribute("role")).toBe("gridcell");
      expect(cell.id).toMatch(/^lfg-a11y-\d+-header-filter-\d+$/);
      expect(cell.querySelector("input")?.getAttribute("aria-label")).toBe(
        `Filter ${cell.dataset.colId?.toUpperCase()}`,
      );
    }
    expect(ownedIds(center.floatingRow)).toEqual(cells.map((cell) => cell.id));
  });

  it("121 keeps binding settle discovery-free and writes nothing when unchanged", () => {
    const { ctx } = splitFixture();
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(ctx);
    const query = vi.spyOn(Element.prototype, "querySelector");
    const queryAll = vi.spyOn(Element.prototype, "querySelectorAll");
    const setAttribute = vi.spyOn(Element.prototype, "setAttribute");
    const removeAttribute = vi.spyOn(Element.prototype, "removeAttribute");

    try {
      for (let index = 0; index < 1_000; index += 1) {
        expect(reconciler.syncBindings()).toBe(true);
      }

      expect(query).not.toHaveBeenCalled();
      expect(queryAll).not.toHaveBeenCalled();
      expect(setAttribute).not.toHaveBeenCalled();
      expect(removeAttribute).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      queryAll.mockRestore();
      setAttribute.mockRestore();
      removeAttribute.mockRestore();
    }
  });
});
