/**
 * CSV Export V1 - bounded data-row projection cursor (Stage 3B-A).
 *
 * Construction retains the source input plus scalar position/decision state;
 * it is O(1) in the planned-column count and invokes no callbacks. Each step
 * appends at most its normalized cell budget to caller-owned output.
 */

import type { CsvProjectedValue } from "./csvProjectedValue";
import { normalizeCsvProjectionBudget } from "./csvProjectionBudget";
import type { ProjectCsvRowInput } from "./projectCsvRow";
import { resolveCsvCellValue } from "./resolveCsvCellValue";

export interface CsvRowProjectionCursor {
  /** `null` until the first step makes the row-export decision. */
  readonly exported: boolean | null;
  /** Append up to `maxCells` projected values; returns whether the row is done. */
  step(out: CsvProjectedValue[], maxCells: number): boolean;
}

class RowProjectionCursor implements CsvRowProjectionCursor {
  private columnIndex = 0;
  private exportDecision: boolean | null = null;

  constructor(private readonly input: ProjectCsvRowInput) {}

  get exported(): boolean | null {
    return this.exportDecision;
  }

  step(out: CsvProjectedValue[], maxCells: number): boolean {
    if (this.exportDecision === false) return true;
    if (this.exportDecision === null) {
      const { row, rowId, rowIndex, sourceRowIndex, shouldExportRow } = this.input;
      this.exportDecision =
        shouldExportRow === undefined ||
        shouldExportRow({ row, rowId, rowIndex, sourceRowIndex });
      if (!this.exportDecision) return true;
    }

    let budget = normalizeCsvProjectionBudget(maxCells);
    const {
      row,
      rowId,
      rowIndex,
      sourceRowIndex,
      emittedRowIndex,
      plannedColumns,
      useValueFormatter,
      processCell,
    } = this.input;

    while (budget > 0 && this.columnIndex < plannedColumns.length) {
      const plannedColumn = plannedColumns[this.columnIndex]!;
      const value =
        plannedColumn.kind === "rowNumber"
          ? plannedColumn.startAt + emittedRowIndex
          : resolveCsvCellValue({
              plannedColumn,
              row,
              rowId,
              rowIndex,
              sourceRowIndex,
              useValueFormatter,
              processCell,
            });
      out.push(value);
      this.columnIndex++;
      budget--;
    }

    return this.columnIndex >= plannedColumns.length;
  }
}

/** Build an O(1), callback-free-at-construction cursor for one data row. */
export function createCsvRowProjectionCursor(
  input: ProjectCsvRowInput,
): CsvRowProjectionCursor {
  return new RowProjectionCursor(input);
}
