/**
 * Pure resolver for cell-class inputs.
 *
 * No DOM access. No side effects. Errors thrown from user predicates / hooks
 * propagate to the caller — by design, so misbehaving rules surface loudly
 * during development.
 *
 * Composition order:
 *   1. `cellClass` (static)
 *   2. `getCellClass(params)` (functional)
 *   3. `cellClassRules` predicates (each truthy predicate contributes its key)
 *
 * Class names are normalized by:
 * - accepting `string` or `string[]` inputs,
 * - splitting whitespace inside a single string,
 * - dropping empty / whitespace-only tokens,
 * - deduplicating while preserving first-seen order.
 *
 * The final list is returned in insertion order; callers can `.join(" ")`.
 */

import type { CellClassParams, CellClassRules, GetCellClass } from "./types";

/** Append space-split, non-empty class names from a single string. */
function appendFromString(out: string[], seen: Set<string>, raw: string): void {
  // `String#split(/\s+/)` is fine; we filter empties below to handle leading
  // / trailing whitespace and multiple separators uniformly.
  const tokens = raw.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.length === 0) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
}

/** Normalize a `string | string[] | null | undefined | false` input. */
function appendValue(
  out: string[],
  seen: Set<string>,
  value: string | string[] | null | undefined | false,
): void {
  if (value === null || value === undefined || value === false) return;
  if (typeof value === "string") {
    appendFromString(out, seen, value);
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const v = value[i];
    if (typeof v !== "string") continue;
    appendFromString(out, seen, v);
  }
}

export interface ResolveCellClassesInput {
  cellClass?: string | string[];
  getCellClass?: GetCellClass;
  cellClassRules?: CellClassRules;
  params: CellClassParams;
}

/**
 * Resolve the deduplicated, ordered list of class names for a cell.
 *
 * Errors from `getCellClass` or any `cellClassRules` predicate are NOT caught —
 * they propagate to the caller so consumers see them in dev.
 */
export function resolveCellClasses(input: ResolveCellClassesInput): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // 1. Static cellClass.
  appendValue(out, seen, input.cellClass);

  // 2. Functional getCellClass.
  if (input.getCellClass !== undefined) {
    const value = input.getCellClass(input.params);
    appendValue(out, seen, value);
  }

  // 3. Predicate rules — each truthy predicate contributes its key.
  // Skip non-function entries (e.g. AG Grid string expressions) so raw
  // foreign columnDefs do not crash the render path.
  if (input.cellClassRules !== undefined) {
    // Object key iteration order is insertion order for string keys, which
    // gives the consumer stable / predictable output.
    for (const key in input.cellClassRules) {
      if (!Object.prototype.hasOwnProperty.call(input.cellClassRules, key)) continue;
      const predicate = input.cellClassRules[key];
      if (typeof predicate !== "function") continue;
      // Intentionally do NOT wrap in try/catch — predicate errors propagate.
      if (!predicate(input.params)) continue;
      // The key itself may contain whitespace (rare but legal); pass through
      // the same normalizer so "foo bar" becomes two classes if needed.
      appendFromString(out, seen, key);
    }
  }

  return out;
}
