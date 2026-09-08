import type {
  RowSelectionCheckboxColumnConfig,
  RowSelectionCheckboxColumnOptions,
  RowSelectionConfig,
  RowSelectionMode,
  RowSelectionOptions,
  RowSelectionProp,
} from "../types";

function normalizeMode(m: unknown): RowSelectionMode {
  if (m === "single") return "single";
  if (m === "multiple" || m === "multi") return "multiple";
  return "none";
}

const DEFAULT_CHECKBOX_COLUMN: RowSelectionCheckboxColumnConfig = {
  width: 44,
  pinned: false,
};

function normalizeCheckboxColumn(
  opts?: RowSelectionCheckboxColumnOptions,
): RowSelectionCheckboxColumnConfig {
  if (!opts) return DEFAULT_CHECKBOX_COLUMN;
  return {
    width: opts.width ?? DEFAULT_CHECKBOX_COLUMN.width,
    pinned: opts.pinned ?? DEFAULT_CHECKBOX_COLUMN.pinned,
  };
}

/** Normalize public `rowSelection` prop to internal config (full booleans). */
export function normalizeRowSelection(value: RowSelectionProp): RowSelectionConfig {
  if (value === undefined) {
    return {
      mode: "none",
      checkboxes: false,
      headerCheckbox: false,
      enableRowClickSelection: true,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CHECKBOX_COLUMN,
    };
  }

  if (typeof value === "string") {
    const mode = normalizeMode(value);
    return {
      mode,
      checkboxes: false,
      headerCheckbox: false,
      enableRowClickSelection: true,
      selectAllScope: "page",
      checkboxColumn: DEFAULT_CHECKBOX_COLUMN,
    };
  }

  const obj = value as RowSelectionOptions;
  const mode = normalizeMode(obj.mode);

  let checkboxes = mode !== "none" && !!obj.checkboxes;
  let headerCheckbox =
    mode === "multiple" && checkboxes && !!obj.headerCheckbox;

  // Default for enableRowClickSelection:
  //  - Explicit value from the user always wins.
  //  - mode "none" → true (inert; no selection happens anyway).
  //  - checkboxes enabled → false (checkbox path owns selection).
  //  - checkboxes disabled → true (body cell clicks select rows).
  // Users who want both checkboxes AND body-click selection must
  // explicitly pass enableRowClickSelection: true.
  let enableRowClickSelection: boolean;
  if (obj.enableRowClickSelection !== undefined) {
    enableRowClickSelection = obj.enableRowClickSelection;
  } else if (mode === "none") {
    enableRowClickSelection = true;
  } else {
    enableRowClickSelection = !checkboxes;
  }

  if (mode === "none") {
    checkboxes = false;
    headerCheckbox = false;
  }

  return {
    mode,
    checkboxes,
    headerCheckbox,
    enableRowClickSelection,
    // Default "page": header select-all targets the displayed rows only
    // (all rows when pagination is disabled).
    selectAllScope: obj.selectAllScope === "all" ? "all" : "page",
    checkboxColumn: normalizeCheckboxColumn(obj.checkboxColumn),
  };
}

export function rowSelectionConfigsEqual(
  a: RowSelectionConfig,
  b: RowSelectionConfig,
): boolean {
  return (
    a.mode === b.mode &&
    a.checkboxes === b.checkboxes &&
    a.headerCheckbox === b.headerCheckbox &&
    a.enableRowClickSelection === b.enableRowClickSelection &&
    a.selectAllScope === b.selectAllScope &&
    checkboxColumnConfigsEqual(a.checkboxColumn, b.checkboxColumn)
  );
}

function checkboxColumnConfigsEqual(
  a: RowSelectionCheckboxColumnConfig,
  b: RowSelectionCheckboxColumnConfig,
): boolean {
  return a.width === b.width && a.pinned === b.pinned;
}
