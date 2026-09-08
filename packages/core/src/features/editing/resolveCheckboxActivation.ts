/**
 * Boolean Cell V1 — pure checkbox activation resolution.
 *
 * Source of truth: `BOOLEAN_CELL_V1_ARCHITECTURE.md` §5.3.3 (editor-kind
 * inference) and §5.3.4 (activation resolution).
 *
 * Every function here is pure and total: no row access, no DOM access, no
 * callback invocation, no allocation, no cache, and — deliberately — no
 * runtime warning. Misconfiguration fails closed and is diagnosed by
 * TypeScript and the contract tests, because these functions can run on the
 * pooled cell-binding path where a `console.warn` would fire once per visible
 * cell per render.
 */

import type {
  CellShellConfig,
  CellShellKind,
  CheckboxActivation,
  ColumnDef,
} from "../../types";

/** The resolved mode. `"auto"` is an input only, never a result. */
export type ResolvedCheckboxActivation = "toggle" | "edit";

/**
 * Whether a column renders the built-in checkbox presentation, which is the
 * only presentation that guarantees a clickable control.
 */
export function hasBuiltInCheckboxShell(column: ColumnDef): boolean {
  const shell: CellShellKind | CellShellConfig | undefined = column.cellShell;
  if (shell === undefined) return false;
  if (typeof shell === "string") return shell === "checkbox";
  return shell.kind === "checkbox";
}

/**
 * Whether the column's `cellShell` is a checkbox **type signal** for editor
 * inference (§5.3.3 rule 3). Only meaningful when no explicit editor is set.
 */
export function hasCheckboxTypeSignal(column: ColumnDef): boolean {
  return hasBuiltInCheckboxShell(column);
}

/**
 * Resolve the interaction mode for a checkbox cell.
 *
 * `activation` is the raw normalized input (`undefined` means `"auto"`).
 * A value outside the union is treated as `"auto"`.
 *
 * Strict control-only: `"toggle"` without the built-in checkbox presentation
 * fails safe to `"edit"`, so no mutation path exists without a visible control.
 */
export function resolveCheckboxActivation(
  activation: CheckboxActivation | undefined,
  column: ColumnDef,
): ResolvedCheckboxActivation {
  if (activation === "edit") return "edit";

  // "toggle" and "auto" both require the built-in checkbox presentation.
  // Anything not exactly "toggle" or "edit" — including undefined and any
  // out-of-union runtime value — is treated as "auto", which resolves the same
  // way as "toggle" here: both need the control, both fail safe to "edit".
  return hasBuiltInCheckboxShell(column) ? "toggle" : "edit";
}
