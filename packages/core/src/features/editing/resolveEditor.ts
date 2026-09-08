import type { CellEditor, CellEditorConfig, ColumnDef } from "../../types";

import type { NormalizedCellEditorConfig } from "./editingTypes";
import { normalizeCellEditor } from "./normalizeCellEditor";
import { isValidDateString } from "./parsers";
import { hasCheckboxTypeSignal } from "./resolveCheckboxActivation";

/**
 * Shared result for the shell-inferred checkbox kind — no allocation per call.
 * Frozen so a future caller cannot corrupt it for every other column.
 */
const CHECKBOX_FROM_SHELL: NormalizedCellEditorConfig = Object.freeze({
  kind: "checkbox",
  options: Object.freeze([]) as readonly [],
});

function inferKindFromValue(value: unknown): NormalizedCellEditorConfig {
  if (typeof value === "boolean") {
    return { kind: "checkbox", options: [] };
  }
  if (typeof value === "number") {
    return { kind: "number", options: [] };
  }
  if (typeof value === "string" && isValidDateString(value)) {
    return { kind: "date", options: [] };
  }
  return { kind: "text", options: [] };
}

export function resolveEditor(
  column: ColumnDef,
  currentValue: unknown,
): NormalizedCellEditorConfig {
  const editor = column.editor;

  // Rules 1 and 2 (architecture §5.3.3): an explicit editor always wins, so the
  // checkbox shell signal can never override a different explicit kind.
  if (editor !== undefined) {
    // String shorthand: CellEditorKind
    if (typeof editor === "string") {
      return normalizeCellEditor(editor);
    }
    // Object with `type` field: CellEditorConfig or legacy CellEditor
    if ("type" in editor) {
      return normalizeCellEditor(editor as CellEditorConfig | CellEditor);
    }
  }

  // Rule 3: the built-in checkbox presentation is a checkbox type signal. This
  // holds even when the value is null/undefined, so an empty cell in a checkbox
  // column still presents and behaves as a checkbox instead of falling back to
  // a text editor.
  if (hasCheckboxTypeSignal(column)) {
    return CHECKBOX_FROM_SHELL;
  }

  // Rule 4: existing value-based inference, unchanged.
  return inferKindFromValue(currentValue);
}
