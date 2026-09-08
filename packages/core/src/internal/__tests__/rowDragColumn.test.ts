import { describe, expect, it } from "vitest";

import { shouldShowMenuTrigger } from "../../features/column-menu/columnMenuDom";
import { isColumnFilterEligible } from "../../features/filters/filterColumnEligibility";
import { isAutoSizeEligibleColumn } from "../../features/resize/autoSizeColumnEligibility";
import { isSizeToFitEligible } from "../../features/resize/sizeColumnsToFit";
import type { ColumnDef } from "../../types";
import { normalizeRowDrag } from "../../utils/rowDragConfig";
import { normalizeRowSelection } from "../../utils/rowSelectionConfig";
import { isColumnResizable } from "../columnSizing";
import { isInternalColumn } from "../internalColumns";
import {
  createRowDragColumnDef,
  injectRowDragColumn,
  isRowDragColumn,
  ROW_DRAG_COLUMN_FIELD,
  ROW_DRAG_COLUMN_WIDTH,
} from "../rowDragColumn";
import {
  createSelectionColumnDef,
  injectSelectionColumn,
  isSelectionColumn,
  SELECTION_COLUMN_FIELD,
} from "../selectionColumn";

function userColumns(): ColumnDef[] {
  return [{ field: "name" }, { field: "status" }];
}

describe("row-drag internal column", () => {
  it("uses a single fixed width for width, minWidth, and maxWidth", () => {
    const col = createRowDragColumnDef();
    expect(col.field).toBe(ROW_DRAG_COLUMN_FIELD);
    expect(col.internal).toBe("row-drag");
    expect(col.pinned).toBe("left");
    expect(col.width).toBe(ROW_DRAG_COLUMN_WIDTH);
    expect(col.minWidth).toBe(ROW_DRAG_COLUMN_WIDTH);
    expect(col.maxWidth).toBe(ROW_DRAG_COLUMN_WIDTH);
    expect(col.resizable).toBe(false);
    expect(col.reorderable).toBe(false);
    expect(col.pinnable).toBe(false);
    expect(col.sortable).toBe(false);
    expect(col.filterable).toBe(false);
    expect(col.editable).toBe(false);
    expect(col.columnSelectable).toBe(false);
    expect(col.columnMenu).toBe(false);
    expect(col.searchable).toBe(false);
    expect(col.floatingFilter).toBe(false);
    expect(col.suppressSizeToFit).toBe(true);
    expect(col.headerName).toBe("");
  });

  it("injects only while row drag is enabled and does not mutate user columns", () => {
    const users = userColumns();
    const copy = users.map((c) => ({ ...c }));
    const disabled = injectRowDragColumn(users, normalizeRowDrag(false));
    expect(disabled).toBe(users);
    expect(users).toEqual(copy);

    const enabled = injectRowDragColumn(users, normalizeRowDrag({ enabled: true }));
    expect(enabled).not.toBe(users);
    expect(enabled[0]?.field).toBe(ROW_DRAG_COLUMN_FIELD);
    expect(enabled[1]).toBe(users[0]);
    expect(users).toEqual(copy);
  });

  it("does not duplicate when the reserved field is already present", () => {
    const withDrag: ColumnDef[] = [
      createRowDragColumnDef(),
      { field: "name" },
    ];
    const out = injectRowDragColumn(withDrag, normalizeRowDrag(true));
    expect(out.filter((c) => c.field === ROW_DRAG_COLUMN_FIELD)).toHaveLength(1);
    expect(out).toBe(withDrag);
  });

  it("is a distinct internal kind from selection", () => {
    const drag = createRowDragColumnDef();
    const selection = createSelectionColumnDef();
    expect(isRowDragColumn(drag)).toBe(true);
    expect(isSelectionColumn(drag)).toBe(false);
    expect(isRowDragColumn(selection)).toBe(false);
    expect(isSelectionColumn(selection)).toBe(true);
    expect(isInternalColumn(drag)).toBe(true);
    expect(isInternalColumn(selection)).toBe(true);
    expect(isInternalColumn({ field: "name" })).toBe(false);
  });

  it("low-level inject helpers still stack when called independently", () => {
    const users = userColumns();
    const withSelection = injectSelectionColumn(
      users,
      normalizeRowSelection({ mode: "multiple", checkboxes: true }),
    );
    const withBoth = injectRowDragColumn(
      withSelection,
      normalizeRowDrag({ enabled: true }),
    );
    expect(withBoth.map((c) => c.field)).toEqual([
      ROW_DRAG_COLUMN_FIELD,
      SELECTION_COLUMN_FIELD,
      "name",
      "status",
    ]);
  });

  it("is excluded from user-column eligibility helpers", () => {
    const col = createRowDragColumnDef();
    expect(shouldShowMenuTrigger(col)).toBe(false);
    expect(isColumnFilterEligible(col)).toBe(false);
    expect(isColumnResizable(col)).toBe(false);
    expect(isAutoSizeEligibleColumn(col)).toBe(false);
    expect(isSizeToFitEligible(col)).toBe(false);
  });
});
