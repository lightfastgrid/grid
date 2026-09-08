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
import type {
  ColumnDef,
  ColumnSelectionConfig,
  SortModel,
} from "../../../types";
import type {
  DomGridFeatureContext,
  HeaderLaneRefs,
} from "../../types";
import type { AccessibilityGridReadSeam } from "../accessibilityGridReadSeam";
import {
  ACCESSIBILITY_DESCRIPTION_CLASS,
} from "../accessibilityPersistentDescription";
import { captureGridRootSnapshot } from "../gridRootStructuralSnapshot";
import {
  HeaderSemanticsReconciler,
} from "../utils/headerSemantics";

function makeLeaf(field: string): HTMLDivElement {
  const cell = document.createElement("div");
  cell.className = "lfg-header-cell";
  cell.dataset.colId = field;
  const label = document.createElement("span");
  label.className = "lfg-header-label";
  label.textContent = field.toUpperCase();
  cell.appendChild(label);
  return cell;
}

function makeHeaderContext(): {
  readonly ctx: DomGridFeatureContext;
  readonly root: HTMLDivElement;
  readonly surface: HTMLDivElement;
  readonly cells: readonly HTMLDivElement[];
  readonly group: HTMLDivElement;
  readonly floating: HTMLDivElement;
  setSortModel(value: SortModel): void;
  setColumnSelection(value: ColumnSelectionConfig): void;
  select(field: string, value: boolean): void;
} {
  const root = document.createElement("div");
  const surface = document.createElement("div");
  const container = document.createElement("div");
  const groupRow = document.createElement("div");
  groupRow.setAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE, "0");
  const group = document.createElement("div");
  group.setAttribute(COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE, "");
  group.setAttribute(COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE, "a");
  group.setAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE, "c");
  group.setAttribute(COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE, "3");
  group.textContent = "Metrics";
  groupRow.appendChild(group);

  const leafRow = document.createElement("div");
  leafRow.className = "lfg-header-row";
  const cells = [makeLeaf("a"), makeLeaf("b"), makeLeaf("c")];
  leafRow.append(...cells);

  const floatingRow = document.createElement("div");
  floatingRow.setAttribute(
    HEADER_ADDON_ROW_KIND_ATTRIBUTE,
    FLOATING_FILTER_HEADER_ADDON_KIND,
  );
  const floating = document.createElement("div");
  floating.dataset.colId = "a";
  floating.setAttribute(HEADER_ADDON_CELL_ATTRIBUTE, "");
  floatingRow.appendChild(floating);
  container.append(groupRow, leafRow, floatingRow);
  surface.appendChild(container);
  root.appendChild(surface);

  const columns: ColumnDef[] = [
    { field: "a", sortable: true },
    { field: "b", sortable: true },
    { field: "c", sortable: true },
  ];
  let sortModel: SortModel = [];
  let columnSelection: ColumnSelectionConfig = {
    enabled: false,
    mode: "multiple",
    enableHeaderClickSelection: false,
    clearOnOutsideClick: false,
  };
  const selected = new Set<string>();
  const lanes: HeaderLaneRefs = {
    left: null,
    center: { container, leafRow },
    right: null,
  };
  const ctx: DomGridFeatureContext = {
    root,
    surface,
    viewport: document.createElement("div"),
    getPool: () => [],
    getColumns: () => columns,
    getDisplayRows: () => ({
      rowCount: 0,
      getRowData: () => undefined,
      getSourceIndex: () => -1,
      getRow: () => null,
    }),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    syncColumnSelectionClasses: () => {},
    resolveRowId: () => "",
    getHeaderRowEl: () => leafRow,
    getPinnedHeaderRowEl: () => null,
    getPinnedRightHeaderRowEl: () => null,
    getHeaderLaneRefs: () => lanes,
    getColumnGroupHeaders: () => ({ depth: 1, byField: {} }),
    hasFloatingFilterRow: () => true,
    getDataRevision: () => 0,
    getSelectedColumnIdsForColumnOrder: () => [...selected],
    getColumnSelectionConfig: () => columnSelection,
    isColumnSelected: (field) => selected.has(field),
    getSelectedRowCountForRowOrder: () => 0,
    isRowSelectedForRowOrder: () => false,
    getSelectedRowIdsForRowOrder: () => [],
    getSortModel: () => sortModel,
    toggleColumnSort: () => {},
    setColumnSort: () => {},
    pinColumn: () => {},
  };
  return {
    ctx,
    root,
    surface,
    cells,
    group,
    floating,
    setSortModel(value) {
      sortModel = value;
    },
    setColumnSelection(value) {
      columnSelection = value;
    },
    select(field, value) {
      if (value) selected.add(field);
      else selected.delete(field);
    },
  };
}

function makeRead(
  options: AccessibilityGridReadSeam["getAccessibilityOptions"],
  rowMode: AccessibilityGridReadSeam["getRowSelectionMode"] = () => "none",
): AccessibilityGridReadSeam {
  return {
    getAccessibilityOptions: options,
    getRowSelectionMode: rowMode,
    isGridBusy: () => false,
  };
}

describe("Accessibility V2 Stage F16C", () => {
  it("122 exposes aria-sort only on the visible primary sort", () => {
    const fixture = makeHeaderContext();
    fixture.setSortModel([
      { field: "a", sort: "asc" },
      { field: "b", sort: "desc" },
    ]);
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(fixture.ctx);

    expect(fixture.cells[0]!.getAttribute("aria-sort")).toBe("ascending");
    expect(fixture.cells[1]!.getAttribute("aria-sort")).toBeNull();

    fixture.cells[0]!.style.display = "none";
    expect(reconciler.syncBindings()).toBe(true);
    expect(fixture.cells[1]!.getAttribute("aria-sort")).toBeNull();

    fixture.setSortModel([]);
    reconciler.syncSort(fixture.ctx);
    for (const cell of fixture.cells) {
      expect(cell.getAttribute("aria-sort")).toBeNull();
    }
  });

  it("123 retains exact multi-sort descriptions and clears stale state", () => {
    const fixture = makeHeaderContext();
    const sortModel: SortModel = [
      { field: "a", sort: "asc" },
      { field: "b", sort: "desc" },
    ];
    fixture.setSortModel(sortModel);
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(fixture.ctx);

    const descriptions = fixture.root.querySelectorAll<HTMLElement>(
      `.${ACCESSIBILITY_DESCRIPTION_CLASS}`,
    );
    expect(descriptions).toHaveLength(3);
    const firstId = fixture.cells[0]!.getAttribute("aria-describedby");
    const secondId = fixture.cells[1]!.getAttribute("aria-describedby");
    expect(firstId).not.toBeNull();
    expect(secondId).not.toBeNull();
    expect(fixture.root.querySelector(`#${firstId}`)?.textContent).toBe(
      "Sorted ascending, priority 1 of 2.",
    );
    expect(fixture.root.querySelector(`#${secondId}`)?.textContent).toBe(
      "Sorted descending, priority 2 of 2.",
    );
    expect(fixture.cells[2]!.getAttribute("aria-describedby")).toBeNull();

    fixture.setSortModel([{ field: "b", sort: "desc" }]);
    reconciler.syncSort(fixture.ctx);
    expect(fixture.cells[0]!.getAttribute("aria-describedby")).toBeNull();
    expect(fixture.cells[1]!.getAttribute("aria-describedby")).toBeNull();
    expect(descriptions[0]!.textContent).toBe("");
    expect(descriptions[1]!.textContent).toBe("");

    reconciler.clear();
    expect(
      fixture.root.querySelectorAll(`.${ACCESSIBILITY_DESCRIPTION_CLASS}`),
    ).toHaveLength(0);
  });

  it("124 does no sort or description work for unchanged identity or settle", () => {
    const fixture = makeHeaderContext();
    const sortModel: SortModel = [
      { field: "a", sort: "asc" },
      { field: "b", sort: "desc" },
    ];
    fixture.setSortModel(sortModel);
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(fixture.ctx);
    const setAttribute = vi.spyOn(Element.prototype, "setAttribute");
    const removeAttribute = vi.spyOn(Element.prototype, "removeAttribute");

    try {
      reconciler.syncSort(fixture.ctx);
      expect(reconciler.syncBindings()).toBe(true);
      expect(setAttribute).not.toHaveBeenCalled();
      expect(removeAttribute).not.toHaveBeenCalled();
    } finally {
      setAttribute.mockRestore();
      removeAttribute.mockRestore();
    }
  });

  it("125 publishes explicit leaf selection and omits group/filter state", () => {
    const fixture = makeHeaderContext();
    fixture.setColumnSelection({
      enabled: true,
      mode: "multiple",
      enableHeaderClickSelection: true,
      clearOnOutsideClick: false,
    });
    fixture.select("a", true);
    const reconciler = new HeaderSemanticsReconciler();
    reconciler.syncTopology(fixture.ctx);

    expect(fixture.cells[0]!.getAttribute("aria-selected")).toBe("true");
    expect(fixture.cells[1]!.getAttribute("aria-selected")).toBe("false");
    expect(fixture.group.getAttribute("aria-selected")).toBeNull();
    expect(fixture.floating.getAttribute("aria-selected")).toBeNull();

    fixture.select("a", false);
    fixture.select("b", true);
    reconciler.syncSelection(fixture.ctx);
    expect(fixture.cells[0]!.getAttribute("aria-selected")).toBe("false");
    expect(fixture.cells[1]!.getAttribute("aria-selected")).toBe("true");

    fixture.setColumnSelection({
      enabled: false,
      mode: "multiple",
      enableHeaderClickSelection: false,
      clearOnOutsideClick: false,
    });
    reconciler.syncSelection(fixture.ctx);
    for (const cell of fixture.cells) {
      expect(cell.getAttribute("aria-selected")).toBeNull();
    }
  });

  it("126 reflects row-or-column multiple selection on the surface", () => {
    const fixture = makeHeaderContext();
    fixture.setColumnSelection({
      enabled: true,
      mode: "multiple",
      enableHeaderClickSelection: false,
      clearOnOutsideClick: false,
    });
    expect(
      captureGridRootSnapshot(
        fixture.ctx,
        makeRead(() => undefined),
      ).ariaMultiselectable,
    ).toBe(true);

    fixture.setColumnSelection({
      enabled: false,
      mode: "multiple",
      enableHeaderClickSelection: false,
      clearOnOutsideClick: false,
    });
    expect(
      captureGridRootSnapshot(
        fixture.ctx,
        makeRead(() => undefined, () => "multiple"),
      ).ariaMultiselectable,
    ).toBe(true);
    expect(
      captureGridRootSnapshot(
        fixture.ctx,
        makeRead(() => undefined),
      ).ariaMultiselectable,
    ).toBe(false);
  });

  it("127 applies deterministic naming without resolving document labels", () => {
    const fixture = makeHeaderContext();
    const query = vi.spyOn(Document.prototype, "querySelector");
    const getById = vi.spyOn(Document.prototype, "getElementById");

    try {
      const labelled = captureGridRootSnapshot(
        fixture.ctx,
        makeRead(() => ({
          ariaLabel: "Inventory",
          ariaLabelledBy: " inventory-title ",
        })),
      );
      expect(labelled.ariaLabel).toBeUndefined();
      expect(labelled.ariaLabelledBy).toBe("inventory-title");

      const explicit = captureGridRootSnapshot(
        fixture.ctx,
        makeRead(() => ({ ariaLabel: "Inventory" })),
      );
      expect(explicit.ariaLabel).toBe("Inventory");
      expect(explicit.ariaLabelledBy).toBeUndefined();

      const fallback = captureGridRootSnapshot(
        fixture.ctx,
        makeRead(() => ({
          ariaLabel: " ",
          ariaLabelledBy: "\t",
        })),
      );
      expect(fallback.ariaLabel).toBe("Data grid");
      expect(fallback.ariaLabelledBy).toBeUndefined();
      expect(query).not.toHaveBeenCalled();
      expect(getById).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
      getById.mockRestore();
    }
  });
});
