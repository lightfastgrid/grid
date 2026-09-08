// ── Internal editing types ──────────────────────────────────────────

import type { CheckboxActivation, RowData, SelectOptionValue } from "../../types";

export interface SelectOption {
  value: SelectOptionValue;
  label: string;
}

export interface NormalizedCellEditorConfig {
  kind: "text" | "number" | "date" | "checkbox" | "select";
  options: readonly SelectOption[];
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
  /**
   * Raw checkbox activation input, before presentation is considered.
   * `undefined` means `"auto"`. Resolve with `resolveCheckboxActivation`, which
   * also applies the strict control-only fail-safe.
   */
  activation?: CheckboxActivation;
}

export type CellParseResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface EditCommitChange {
  rowId: string;
  rowIndex: number;
  sourceIndex: number;
  field: string;
  updatedRow: RowData;
  oldValue: unknown;
  newValue: unknown;
  topLevelField: string;
}
