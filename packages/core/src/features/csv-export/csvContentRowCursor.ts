/**
 * CSV Export V1 - bounded structured-content cursor (Stage 2C).
 *
 * Streams a `CsvContentRow` into projected values without ever materializing
 * the full expansion. `mergeAcross: N` emits the cell value followed by `N`
 * empty fields, but a huge valid `mergeAcross` (up to `Number.MAX_SAFE_INTEGER`)
 * is produced incrementally across `step` calls rather than expanded eagerly.
 *
 * - Construction is O(number of content cells), never O(mergeAcross): it only
 *   validates each cell's `mergeAcross`.
 * - Retained state is O(number of content cells) (the row reference plus three
 *   scalar counters), not O(total expanded fields).
 * - Each `step` emits at most `maxFields` projected values.
 * - Discarding the cursor performs no later/hidden work; nothing is scheduled.
 * - Content rows/cells are never mutated.
 *
 * The projected values feed the same encoder/formula/quoting path as grid rows.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Section 13.5.
 */

import { CsvExportInvalidOptionsError } from "./csvExportErrors";
import type { CsvContentRow } from "./csvExportTypes";
import type { CsvProjectedValue } from "./csvProjectedValue";

export interface CsvContentRowCursor {
  /** Append up to `maxFields` projected values to `out`; returns whether done. */
  step(out: CsvProjectedValue[], maxFields: number): boolean;
}

function validateMergeAcross(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CsvExportInvalidOptionsError(
      `mergeAcross must be a non-negative safe integer (received ${value}).`,
    );
  }
}

/** Normalize a field budget so every active call makes progress (min 1). */
function normalizeFieldBudget(maxFields: number): number {
  const floored = Math.floor(maxFields);
  if (!Number.isFinite(floored) || floored < 1) return 1;
  return floored;
}

class ContentRowCursor implements CsvContentRowCursor {
  private cellIndex = 0;
  private valueEmitted = false;
  private emptiesRemaining = 0;

  constructor(private readonly row: CsvContentRow) {}

  step(out: CsvProjectedValue[], maxFields: number): boolean {
    let budget = normalizeFieldBudget(maxFields);
    while (budget > 0 && this.cellIndex < this.row.length) {
      const cell = this.row[this.cellIndex]!;
      if (!this.valueEmitted) {
        out.push(cell.value);
        this.valueEmitted = true;
        this.emptiesRemaining = cell.mergeAcross ?? 0;
        budget--;
      }
      while (this.emptiesRemaining > 0 && budget > 0) {
        out.push(undefined);
        this.emptiesRemaining--;
        budget--;
      }
      if (this.emptiesRemaining === 0) {
        this.cellIndex++;
        this.valueEmitted = false;
      } else {
        break; // budget exhausted mid-cell
      }
    }
    return this.cellIndex >= this.row.length;
  }
}

/**
 * Build a bounded cursor over a structured content row. Validates each
 * `mergeAcross` up front (O(cells)); throws {@link CsvExportInvalidOptionsError}
 * for a non-negative-safe-integer violation.
 */
export function createCsvContentRowCursor(
  row: CsvContentRow,
): CsvContentRowCursor {
  for (const cell of row) {
    if (cell.mergeAcross !== undefined) validateMergeAcross(cell.mergeAcross);
  }
  return new ContentRowCursor(row);
}
