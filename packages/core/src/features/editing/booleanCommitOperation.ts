import { isBooleanCellValue } from "../../internal/booleanCellValue";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../types";

import { prepareCommit } from "./commitPreparation";
import type { EditCommitChange } from "./editingTypes";
import { resolveCellEditEligibility } from "./eligibility";
import { getEditableFieldValue } from "./fieldPath";
import { resolveCheckboxActivation } from "./resolveCheckboxActivation";
import { resolveEditor } from "./resolveEditor";

export interface BooleanCellTarget {
  rowId?: string;
  rowIndex?: number;
  field: string;
}

export interface BooleanCommitOperationDeps {
  getColumns(): readonly ColumnDef[];
  getColumnByField?(field: string): ColumnDef | undefined;
  getDisplayRows(): DisplayRowReader;
  resolveRowId(row: RowData, index: number): string;
  commitEdit(change: EditCommitChange): void;
}

/**
 * Commit a boolean directly through the existing row-update pipeline.
 * No EditingStore session or editor DOM is created.
 */
export function commitBooleanCell(
  deps: BooleanCommitOperationDeps,
  target: BooleanCellTarget,
  candidateValue?: boolean,
): boolean {
  const rowIndex = target.rowIndex;
  if (
    rowIndex === undefined ||
    !Number.isSafeInteger(rowIndex) ||
    rowIndex < 0
  ) {
    return false;
  }

  const reader = deps.getDisplayRows();
  const row = reader.getRowData(rowIndex);
  const sourceIndex = reader.getSourceIndex(rowIndex);
  if (row === undefined || sourceIndex < 0) return false;

  const rowId = deps.resolveRowId(row, rowIndex);
  if (target.rowId !== undefined && target.rowId !== rowId) return false;

  let column = deps.getColumnByField?.(target.field);
  if (column === undefined) {
    const columns = deps.getColumns();
    for (let i = 0; i < columns.length; i++) {
      if (columns[i]!.field === target.field) {
        column = columns[i]!;
        break;
      }
    }
  }
  if (column === undefined) return false;

  const fieldResult = getEditableFieldValue(row, target.field);
  const rawValue = fieldResult.ok ? fieldResult.value : undefined;
  const editorConfig = resolveEditor(column, rawValue);
  if (
    editorConfig.kind !== "checkbox" ||
    resolveCheckboxActivation(editorConfig.activation, column) !== "toggle"
  ) {
    return false;
  }

  const eligibility = resolveCellEditEligibility({
    row,
    rowIndex,
    column,
    field: target.field,
    value: rawValue,
  });
  if (!eligibility.editable || !isBooleanCellValue(rawValue)) return false;

  const nextValue = candidateValue ?? (rawValue !== true);
  const result = prepareCommit(
    row,
    target.field,
    editorConfig,
    String(nextValue),
  );
  if (!result.ok || !result.changed) return false;

  const newFieldResult = getEditableFieldValue(result.row, target.field);
  deps.commitEdit({
    rowId,
    rowIndex,
    sourceIndex,
    field: target.field,
    updatedRow: result.row,
    oldValue: rawValue,
    newValue: newFieldResult.ok ? newFieldResult.value : undefined,
    topLevelField: result.topLevelField,
  });
  return true;
}
