// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { DomGridFeatureContext } from "../../types";
import type { AccessibilityGridReadSeam } from "../accessibilityGridReadSeam";
import {
  captureGridRootSnapshot,
  countAccessibilityHeaderRows,
} from "../gridRootStructuralSnapshot";

function makeCtx(
  overrides: Partial<DomGridFeatureContext> & {
    rowCount?: number;
    columnCount?: number;
    groupDepth?: number;
    floatingFilterRow?: boolean;
  } = {},
): DomGridFeatureContext {
  const rowCount = overrides.rowCount ?? 0;
  const columns = Array.from({ length: overrides.columnCount ?? 0 }, (_, i) => ({
    field: `c${i}`,
  }));
  return {
    root: document.createElement("div"),
    viewport: document.createElement("div"),
    getPool: () => [],
    getColumns: () => columns,
    getDisplayRows: () => ({
      rowCount,
      getRowData: () => undefined,
      getSourceIndex: () => -1,
      getRow: () => null,
    }),
    getSourceRows: () => [],
    getVisibleRowStart: () => 0,
    requestSync: () => {},
    requestColumnTransformSync: () => {},
    resolveRowId: () => "",
    getHeaderRowEl: () => null,
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
    getColumnGroupHeaders:
      overrides.groupDepth !== undefined
        ? () => ({
            depth: overrides.groupDepth!,
            byField: {},
          })
        : undefined,
    hasFloatingFilterRow: () => overrides.floatingFilterRow === true,
    ...overrides,
  } as DomGridFeatureContext;
}

function makeRead(
  overrides: Partial<AccessibilityGridReadSeam> = {},
): AccessibilityGridReadSeam {
  return {
    getAccessibilityOptions: () => undefined,
    getRowSelectionMode: () => "none",
    isGridBusy: () => false,
    ...overrides,
  };
}

describe("countAccessibilityHeaderRows", () => {
  it("counts one leaf header when there are no groups", () => {
    expect(countAccessibilityHeaderRows(makeCtx())).toBe(1);
  });

  it("adds group levels to the leaf header row", () => {
    expect(countAccessibilityHeaderRows(makeCtx({ groupDepth: 2 }))).toBe(3);
  });

  it("counts the optional floating-filter row exactly once", () => {
    expect(
      countAccessibilityHeaderRows(
        makeCtx({ groupDepth: 2, floatingFilterRow: true }),
      ),
    ).toBe(4);
  });
});

describe("captureGridRootSnapshot", () => {
  it("sums header rows and display data rows for aria-rowcount", () => {
    const snapshot = captureGridRootSnapshot(
      makeCtx({ rowCount: 100, columnCount: 5, groupDepth: 1 }),
      makeRead(),
    );
    expect(snapshot.ariaRowCount).toBe(102);
    expect(snapshot.ariaColCount).toBe(5);
    expect("tabIndex" in snapshot).toBe(false);
  });

  it("includes the floating-filter row in root counts with empty data", () => {
    const snapshot = captureGridRootSnapshot(
      makeCtx({
        rowCount: 0,
        columnCount: 3,
        groupDepth: 1,
        floatingFilterRow: true,
      }),
      makeRead(),
    );
    expect(snapshot.ariaRowCount).toBe(3);
  });

  it("maps accessibility options and interaction state", () => {
    const snapshot = captureGridRootSnapshot(makeCtx(), makeRead({
      getAccessibilityOptions: () => ({
        ariaLabel: "Sales",
      }),
      getRowSelectionMode: () => "multiple",
      isGridBusy: () => true,
    }));
    expect(snapshot.ariaLabel).toBe("Sales");
    expect(snapshot.ariaMultiselectable).toBe(true);
    expect(snapshot.ariaBusy).toBe(true);
  });
});
