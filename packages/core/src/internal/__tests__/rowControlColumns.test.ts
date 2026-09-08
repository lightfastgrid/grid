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
  createRowControlsColumnDef,
  isCombinedRowControlsColumn,
  isRowDragHostColumn,
  isSelectionHostColumn,
  resolveRowControlColumns,
  resolveRowControlsColumnWidth,
  ROW_CONTROLS_COLUMN_FIELD,
  ROW_CONTROLS_MIN_WIDTH,
} from "../rowControlColumns";
import {
  createRowDragColumnDef,
  isRowDragColumn,
  ROW_DRAG_COLUMN_FIELD,
  ROW_DRAG_COLUMN_WIDTH,
} from "../rowDragColumn";
import {
  createSelectionColumnDef,
  isSelectionColumn,
  SELECTION_COLUMN_FIELD,
} from "../selectionColumn";

function userColumns(): ColumnDef[] {
  return [{ field: "name" }, { field: "status" }];
}

function leftCheckbox(width = 44) {
  return normalizeRowSelection({
    mode: "multiple",
    checkboxes: true,
    checkboxColumn: { width, pinned: "left" },
  });
}

describe("resolveRowControlColumns", () => {
  it("produces one drag-only column when only row drag is enabled", () => {
    const users = userColumns();
    const out = resolveRowControlColumns(
      users,
      normalizeRowSelection(undefined),
      normalizeRowDrag({ enabled: true }),
    );
    expect(out.map((c) => c.field)).toEqual([
      ROW_DRAG_COLUMN_FIELD,
      "name",
      "status",
    ]);
    expect(out[0]?.internal).toBe("row-drag");
    expect(out[1]).toBe(users[0]);
    expect(out[2]).toBe(users[1]);
  });

  it("produces one combined column for left-pinned checkboxes plus drag", () => {
    const users = userColumns();
    const out = resolveRowControlColumns(
      users,
      leftCheckbox(),
      normalizeRowDrag({ enabled: true }),
    );
    expect(out.map((c) => c.field)).toEqual([
      ROW_CONTROLS_COLUMN_FIELD,
      "name",
      "status",
    ]);
    expect(out[0]?.internal).toBe("row-controls");
    expect(out[1]).toBe(users[0]);
    expect(out.filter(isSelectionColumn)).toHaveLength(0);
    expect(out.filter(isRowDragColumn)).toHaveLength(0);
  });

  it("produces the existing selection column when only checkboxes are enabled", () => {
    const users = userColumns();
    const out = resolveRowControlColumns(
      users,
      leftCheckbox(),
      normalizeRowDrag(undefined),
    );
    expect(out.map((c) => c.field)).toEqual([
      SELECTION_COLUMN_FIELD,
      "name",
      "status",
    ]);
    expect(out[0]?.internal).toBe("selection");
    expect(out[1]).toBe(users[0]);
  });

  it("produces no system column when neither control is enabled", () => {
    const users = userColumns();
    const out = resolveRowControlColumns(
      users,
      normalizeRowSelection(undefined),
      normalizeRowDrag(undefined),
    );
    expect(out).toBe(users);
  });

  it("keeps a right-pinned checkbox separate from a left drag column", () => {
    const users = userColumns();
    const out = resolveRowControlColumns(
      users,
      normalizeRowSelection({
        mode: "multiple",
        checkboxes: true,
        checkboxColumn: { pinned: "right" },
      }),
      normalizeRowDrag({ enabled: true }),
    );
    expect(out.map((c) => c.field)).toEqual([
      ROW_DRAG_COLUMN_FIELD,
      SELECTION_COLUMN_FIELD,
      "name",
      "status",
    ]);
    expect(out[0]?.pinned).toBe("left");
    expect(out[1]?.pinned).toBe("right");
    expect(out[2]).toBe(users[0]);
  });

  it("keeps a center checkbox separate from a left drag column", () => {
    const users = userColumns();
    const out = resolveRowControlColumns(
      users,
      normalizeRowSelection({
        mode: "multiple",
        checkboxes: true,
      }),
      normalizeRowDrag({ enabled: true }),
    );
    expect(out.map((c) => c.field)).toEqual([
      ROW_DRAG_COLUMN_FIELD,
      SELECTION_COLUMN_FIELD,
      "name",
      "status",
    ]);
    expect(out[1]?.pinned).toBe(false);
    expect(out[2]).toBe(users[0]);
  });

  it("does not mutate user columns or their order", () => {
    const users = userColumns();
    const copy = users.map((c) => ({ ...c }));
    resolveRowControlColumns(
      users,
      leftCheckbox(),
      normalizeRowDrag({ enabled: true }),
    );
    expect(users).toEqual(copy);
  });
});

describe("combined row-controls width", () => {
  it("uses a fixed drag-only width of 36px", () => {
    const col = createRowDragColumnDef();
    expect(col.width).toBe(ROW_DRAG_COLUMN_WIDTH);
    expect(col.minWidth).toBe(ROW_DRAG_COLUMN_WIDTH);
    expect(col.maxWidth).toBe(ROW_DRAG_COLUMN_WIDTH);
  });

  it("never goes below the combined minimum", () => {
    expect(resolveRowControlsColumnWidth(24)).toBe(ROW_CONTROLS_MIN_WIDTH);
    expect(createRowControlsColumnDef({ width: 24, pinned: "left" }).width).toBe(
      ROW_CONTROLS_MIN_WIDTH,
    );
  });

  it("preserves an explicitly wider checkbox width", () => {
    const col = createRowControlsColumnDef({ width: 80, pinned: "left" });
    expect(col.width).toBe(80);
    expect(col.minWidth).toBe(80);
    expect(col.maxWidth).toBe(80);
  });

  it("defaults to the combined minimum when checkbox width is the standalone default", () => {
    const col = createRowControlsColumnDef({ width: 44, pinned: "left" });
    expect(col.width).toBe(ROW_CONTROLS_MIN_WIDTH);
  });
});

describe("row-control kind helpers", () => {
  it("distinguishes selection-only, drag-only, and combined hosts", () => {
    const selection = createSelectionColumnDef();
    const drag = createRowDragColumnDef();
    const combined = createRowControlsColumnDef();

    expect(isSelectionColumn(selection)).toBe(true);
    expect(isSelectionColumn(combined)).toBe(false);
    expect(isSelectionHostColumn(selection)).toBe(true);
    expect(isSelectionHostColumn(combined)).toBe(true);
    expect(isSelectionHostColumn(drag)).toBe(false);

    expect(isRowDragColumn(drag)).toBe(true);
    expect(isRowDragColumn(combined)).toBe(false);
    expect(isRowDragHostColumn(drag)).toBe(true);
    expect(isRowDragHostColumn(combined)).toBe(true);
    expect(isRowDragHostColumn(selection)).toBe(false);

    expect(isCombinedRowControlsColumn(combined)).toBe(true);
    expect(isInternalColumn(selection)).toBe(true);
    expect(isInternalColumn(drag)).toBe(true);
    expect(isInternalColumn(combined)).toBe(true);
    expect(isInternalColumn({ field: "name" })).toBe(false);
  });

  it("excludes the combined column from user-column eligibility helpers", () => {
    const col = createRowControlsColumnDef();
    expect(shouldShowMenuTrigger(col)).toBe(false);
    expect(isColumnFilterEligible(col)).toBe(false);
    expect(isColumnResizable(col)).toBe(false);
    expect(isAutoSizeEligibleColumn(col)).toBe(false);
    expect(isSizeToFitEligible(col)).toBe(false);
  });
});
