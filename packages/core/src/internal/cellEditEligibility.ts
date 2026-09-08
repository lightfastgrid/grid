/**
 * Neutral cell-edit eligibility resolution.
 *
 * The single source of truth for "may this cell be edited?". Consumed by the
 * editing feature and by any presentation layer that must agree with it — most
 * importantly the boolean checkbox shell, which renders a natively `disabled`
 * control for ineligible cells (`BOOLEAN_CELL_V1_ARCHITECTURE.md` §7.2, §6.9).
 *
 * There must be exactly one implementation of these rules in the codebase.
 * Presentation code must import this module rather than reaching into the
 * editing feature or re-deriving the rules.
 *
 * Pure: no DOM, no row mutation, no allocation on the common paths. The only
 * user code invoked is the caller's own `editable` callback, whose throw is
 * caught and treated as not editable.
 */

import type { CellEditEligibilityContext, ColumnDef, RowData } from "../types";

import { isFieldPathSafe } from "./fieldPathSafety";

export interface EligibilityResult {
  editable: boolean;
  reason?: string;
}

export interface CellEditEligibilityInput {
  row: RowData;
  rowIndex: number;
  column: ColumnDef;
  field: string;
  value: unknown;
}

function resolveCellEditEligibilityFailure(
  ctx: CellEditEligibilityInput,
): string | undefined {
  const { column, field } = ctx;

  if (column.internal) {
    return "Internal column";
  }

  if (column.cellKind === "actions") {
    return "Action column";
  }

  if (column.valueGetter) {
    return "Column has valueGetter";
  }

  if (!isFieldPathSafe(field)) {
    return "Unsafe field path";
  }

  const { editable } = column;

  if (editable === undefined || editable === false) {
    return "Not editable";
  }

  if (editable === true) {
    return undefined;
  }

  // editable is a callback
  try {
    const eligibilityCtx: CellEditEligibilityContext = {
      row: ctx.row,
      rowIndex: ctx.rowIndex,
      column: ctx.column,
      field: ctx.field,
      value: ctx.value,
    };
    const result = editable(eligibilityCtx);
    return result ? undefined : "Callback returned false";
  } catch {
    return "Editable callback threw";
  }
}

/** Allocation-free result for presentation hot paths on non-callback columns. */
export function isCellEditEligible(ctx: CellEditEligibilityInput): boolean {
  return resolveCellEditEligibilityFailure(ctx) === undefined;
}

export function resolveCellEditEligibility(
  ctx: CellEditEligibilityInput,
): EligibilityResult {
  const reason = resolveCellEditEligibilityFailure(ctx);
  return reason === undefined
    ? { editable: true }
    : { editable: false, reason };
}
