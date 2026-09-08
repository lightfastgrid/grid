import type { RowData } from "../../types";

import type { NormalizedCellEditorConfig } from "./editingTypes";
import { setEditableFieldValue } from "./fieldPath";
import { parseEditorValue } from "./parsers";

export type CommitResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; row: RowData; topLevelField: string }
  | { ok: false; reason: string };

function isRequiredValueMissing(
  rawEditorValue: string,
  parsedValue: unknown,
  editorConfig: NormalizedCellEditorConfig,
): boolean {
  if (editorConfig.required !== true) return false;
  switch (editorConfig.kind) {
    case "text":
      return rawEditorValue.trim().length === 0;
    case "number":
    case "date":
      return parsedValue === null;
    case "checkbox":
      return parsedValue !== true;
    case "select":
      return parsedValue === null || parsedValue === "";
  }
}

export function prepareCommit(
  row: RowData,
  field: string,
  editorConfig: NormalizedCellEditorConfig,
  rawEditorValue: string,
): CommitResult {
  const parsed = parseEditorValue(rawEditorValue, editorConfig);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  if (isRequiredValueMissing(rawEditorValue, parsed.value, editorConfig)) {
    return { ok: false, reason: "Value is required" };
  }

  const setResult = setEditableFieldValue(row, field, parsed.value);
  if (!setResult.ok) {
    return { ok: false, reason: setResult.reason };
  }

  if (!setResult.value.changed) {
    return { ok: true, changed: false };
  }

  const topLevelField = field.split(".")[0]!;
  return {
    ok: true,
    changed: true,
    row: setResult.value.row,
    topLevelField,
  };
}
