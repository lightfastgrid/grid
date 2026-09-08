/**
 * Default sort comparator shared by sortModel.ts and SortOrderCache.ts.
 *
 * Centralises the comparison semantics so that equal-value group detection
 * (used by `reverseGroupOrder`) matches the ordering produced by the full
 * sort path.
 *
 * Rules:
 * - number vs number  → numeric subtraction; `NaN` sorts after all
 *   real numbers (but before null/undefined) and `NaN` == `NaN`
 * - boolean vs boolean → false < true
 * - everything else   → `String(a).localeCompare(String(b))`
 *
 * `null` / `undefined` handling is NOT part of this comparator — the sort
 * path handles nulls via a separate null-flags layer that always pushes
 * them to the end.
 */

export function defaultCompare(a: unknown, b: unknown): number {
  if (a === b) return 0;

  if (typeof a === "number" && typeof b === "number") {
    // NaN sorts after all real numbers (but before null/undefined which
    // are handled outside this comparator).  NaN == NaN so they form one
    // stable group in reverseGroupOrder.  This keeps the comparator
    // transitive — a naive `a - b` would return NaN for any NaN operand,
    // and JS sort treats NaN results as ~equal, breaking transitivity
    // (NaN==1, NaN==2, but 1!=2) and making derived ≠ full sort.
    const aIsNaN = Number.isNaN(a);
    const bIsNaN = Number.isNaN(b);
    if (aIsNaN || bIsNaN) return aIsNaN === bIsNaN ? 0 : aIsNaN ? 1 : -1;
    return a - b;
  }
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);

  return String(a).localeCompare(String(b));
}

/**
 * Returns `true` when `a` and `b` are equal under the default sort
 * comparator.  This is NOT the same as `===` — for example `1` and `"1"`
 * compare equal because both fall through to `String(a).localeCompare(String(b))`.
 */
export function valuesCompareEqual(a: unknown, b: unknown): boolean {
  return defaultCompare(a, b) === 0;
}
