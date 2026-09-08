import { describe, expect, it } from "vitest";

import {
  createSelectionColumnDef,
  injectSelectionColumn,
  SELECTION_COLUMN_FIELD,
} from "../../../internal/selectionColumn";
import type {
  ColumnDef,
  RowSelectionCheckboxColumnConfig,
  RowSelectionConfig,
} from "../../../types";
import { normalizeRowSelection } from "../../../utils/rowSelectionConfig";
import { shouldShowMenuTrigger } from "../../column-menu/columnMenuDom";

/* ── helpers ─────────────────────────────────────────────── */

const DEFAULT_CB_COL: RowSelectionCheckboxColumnConfig = {
  width: 44,
  pinned: false,
};

function selCfg(
  overrides: Partial<RowSelectionConfig> = {},
): RowSelectionConfig {
  return {
    mode: "multiple",
    checkboxes: true,
    headerCheckbox: false,
    enableRowClickSelection: false,
    selectAllScope: "page",
    checkboxColumn: DEFAULT_CB_COL,
    ...overrides,
  };
}

const userCols: ColumnDef[] = [
  { field: "a", headerName: "A", visible: true, width: 100 },
  { field: "b", headerName: "B", visible: true, width: 200 },
];

/* ── createSelectionColumnDef ────────────────────────────── */

describe("createSelectionColumnDef defaults", () => {
  it("default checkbox column: pinned-left fallback (no config), width 44, all behavior hardcoded", () => {
    // createSelectionColumnDef() without config falls back to pinned:"left".
    // In practice it always receives config from normalizeRowSelection which
    // defaults pinned to false — this test covers the no-arg fallback only.
    const col = createSelectionColumnDef();
    expect(col.field).toBe(SELECTION_COLUMN_FIELD);
    expect(col.pinned).toBe("left");
    expect(col.width).toBe(44);
    expect(col.minWidth).toBe(44);
    expect(col.maxWidth).toBe(44);
    expect(col.pinnable).toBe(false);
    expect(col.resizable).toBe(false);
    expect(col.reorderable).toBe(false);
    expect(col.columnMenu).toBe(false);
    expect(col.columnSelectable).toBe(false);
    expect(col.suppressRowClickSelection).toBe(true);
    expect(col.headerName).toBe("");
    expect(col.sortable).toBe(false);
    expect(col.filterable).toBe(false);
    expect(col.editable).toBe(false);
    expect(col.visible).toBe(true);
    expect(col.internal).toBe("selection");
  });

  it("checkbox column with explicit unpinned config", () => {
    const col = createSelectionColumnDef(DEFAULT_CB_COL);
    expect(col.width).toBe(44);
    expect(col.pinned).toBe(false);
    expect(col.resizable).toBe(false);
    expect(col.maxWidth).toBe(44);
  });
});

/* ── checkboxColumn accepts width and pinned only ────────── */

describe("createSelectionColumnDef with custom config", () => {
  it("custom width controls fixed column width", () => {
    const col = createSelectionColumnDef({ width: 60, pinned: "left" });
    expect(col.width).toBe(60);
    expect(col.minWidth).toBe(60);
    expect(col.maxWidth).toBe(60);
  });

  it("pinned: 'right' controls placement", () => {
    const col = createSelectionColumnDef({ width: 44, pinned: "right" });
    expect(col.pinned).toBe("right");
  });

  it("pinned: false puts column in center flow", () => {
    const col = createSelectionColumnDef({ width: 44, pinned: false });
    expect(col.pinned).toBe(false);
  });

  it("all non-layout behavior is hardcoded regardless of config", () => {
    const col = createSelectionColumnDef({ width: 100, pinned: "right" });
    // These must always be fixed:
    expect(col.headerName).toBe("");
    expect(col.pinnable).toBe(false);
    expect(col.resizable).toBe(false);
    expect(col.reorderable).toBe(false);
    expect(col.columnMenu).toBe(false);
    expect(col.columnSelectable).toBe(false);
    expect(col.suppressRowClickSelection).toBe(true);
    expect(col.sortable).toBe(false);
    expect(col.filterable).toBe(false);
    expect(col.editable).toBe(false);
    expect(col.visible).toBe(true);
    expect(col.internal).toBe("selection");
    expect(col.field).toBe(SELECTION_COLUMN_FIELD);
  });
});

/* ── checkbox column never shows column menu trigger ─────── */

describe("checkbox column menu trigger", () => {
  it("checkbox column never shows menu trigger", () => {
    const col = createSelectionColumnDef();
    expect(shouldShowMenuTrigger(col)).toBe(false);
  });

  it("checkbox column never shows menu trigger even with global menu enabled", () => {
    const col = createSelectionColumnDef();
    expect(shouldShowMenuTrigger(col, { enabled: true })).toBe(false);
  });
});

/* ── injectSelectionColumn ───────────────────────────────── */

describe("injectSelectionColumn", () => {
  it("prepends checkbox column when checkboxes enabled", () => {
    const result = injectSelectionColumn(userCols, selCfg());
    expect(result.length).toBe(3);
    expect(result[0]!.field).toBe(SELECTION_COLUMN_FIELD);
    expect(result[1]!.field).toBe("a");
    expect(result[2]!.field).toBe("b");
  });

  it("does not inject when checkboxes is false", () => {
    const result = injectSelectionColumn(
      userCols,
      selCfg({ checkboxes: false }),
    );
    expect(result).toBe(userCols);
    expect(result.length).toBe(2);
  });

  it("does not inject when mode is none", () => {
    const result = injectSelectionColumn(
      userCols,
      selCfg({ mode: "none", checkboxes: true }),
    );
    expect(result).toBe(userCols);
  });

  it("does not duplicate if selection column already present", () => {
    const withSel = [createSelectionColumnDef(), ...userCols];
    const result = injectSelectionColumn(withSel, selCfg());
    expect(result).toBe(withSel);
    expect(result.length).toBe(3);
  });

  it("does not mutate the original array", () => {
    const original = [...userCols];
    const result = injectSelectionColumn(userCols, selCfg());
    expect(userCols.length).toBe(2);
    expect(userCols).toEqual(original);
    expect(result.length).toBe(3);
  });

  it("passes custom width and pinned through to injected column", () => {
    const customCfg = selCfg({
      checkboxColumn: { width: 60, pinned: "right" },
    });
    const result = injectSelectionColumn(userCols, customCfg);
    expect(result[0]!.width).toBe(60);
    expect(result[0]!.pinned).toBe("right");
  });

  it("injected column has all behavior hardcoded", () => {
    const customCfg = selCfg({
      checkboxColumn: { width: 60, pinned: "right" },
    });
    const result = injectSelectionColumn(userCols, customCfg);
    const sel = result[0]!;
    expect(sel.resizable).toBe(false);
    expect(sel.reorderable).toBe(false);
    expect(sel.columnMenu).toBe(false);
    expect(sel.columnSelectable).toBe(false);
    expect(sel.suppressRowClickSelection).toBe(true);
    expect(sel.headerName).toBe("");
  });
});

/* ── normalizeRowSelection with checkboxColumn ───────────── */

describe("normalizeRowSelection checkboxColumn", () => {
  it("defaults checkboxColumn when not provided in object form", () => {
    const cfg = normalizeRowSelection({ mode: "multiple", checkboxes: true });
    expect(cfg.checkboxColumn).toEqual(DEFAULT_CB_COL);
  });

  it("custom checkboxColumn.width is normalized", () => {
    const cfg = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
      checkboxColumn: { width: 60 },
    });
    expect(cfg.checkboxColumn.width).toBe(60);
    expect(cfg.checkboxColumn.pinned).toBe(false);
  });

  it("custom checkboxColumn.pinned is normalized", () => {
    const cfg = normalizeRowSelection({
      mode: "multiple",
      checkboxes: true,
      checkboxColumn: { pinned: "right" },
    });
    expect(cfg.checkboxColumn.pinned).toBe("right");
    expect(cfg.checkboxColumn.width).toBe(44);
  });

  it("string mode gets default checkboxColumn", () => {
    const cfg = normalizeRowSelection("multiple");
    expect(cfg.checkboxColumn).toEqual(DEFAULT_CB_COL);
  });

  it("undefined gets default checkboxColumn", () => {
    const cfg = normalizeRowSelection(undefined);
    expect(cfg.checkboxColumn).toEqual(DEFAULT_CB_COL);
  });
});

/* ── defaultColDef does NOT override checkbox column ─────── */

describe("defaultColDef does not override checkbox column", () => {
  it("selection column ignores defaultColDef values", () => {
    const col = createSelectionColumnDef(DEFAULT_CB_COL);
    expect(col.resizable).toBe(false);
    expect(col.sortable).toBe(false);
    expect(col.reorderable).toBe(false);
    expect(col.columnMenu).toBe(false);
    expect(col.columnSelectable).toBe(false);
  });
});

/* ── normal user columns are unaffected ──────────────────── */

describe("normal user columns are unaffected by checkbox column", () => {
  it("user columns retain their own properties after injection", () => {
    const cols: ColumnDef[] = [
      { field: "name", headerName: "Name", visible: true, width: 150, resizable: true },
      { field: "status", headerName: "Status", visible: true, width: 100 },
    ];
    const result = injectSelectionColumn(cols, selCfg());
    // Selection column is prepended
    expect(result[0]!.field).toBe(SELECTION_COLUMN_FIELD);
    // User columns are unchanged
    expect(result[1]).toBe(cols[0]);
    expect(result[2]).toBe(cols[1]);
    expect(result[1]!.resizable).toBe(true);
    expect(result[1]!.width).toBe(150);
  });
});
