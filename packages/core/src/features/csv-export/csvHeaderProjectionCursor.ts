/**
 * CSV Export V1 - bounded leaf/group-header projection cursors (Stage 3B-A).
 *
 * Both cursors are O(1) to construct, invoke no callbacks at construction, and
 * append directly to caller-owned output. Group spans are represented only by
 * scalar segment/offset state, so empty spacer fields are never pre-expanded.
 */

import type {
  CsvProcessGroupHeaderParams,
  CsvProcessHeaderParams,
} from "./csvExportTypes";
import type { CsvProjectedValue } from "./csvProjectedValue";
import { normalizeCsvProjectionBudget } from "./csvProjectionBudget";
import type { CsvPlannedColumn } from "./planCsvColumnScope";
import type { CsvGroupHeaderRow } from "./planCsvGroupHeaders";

export interface CsvHeaderRowProjectionCursor {
  /** Append up to `maxFields` projected fields; returns whether the row is done. */
  step(out: CsvProjectedValue[], maxFields: number): boolean;
}

class LeafHeaderProjectionCursor implements CsvHeaderRowProjectionCursor {
  private columnIndex = 0;

  constructor(
    private readonly plannedColumns: readonly CsvPlannedColumn[],
    private readonly processHeader:
      | ((params: CsvProcessHeaderParams) => string)
      | undefined,
  ) {}

  step(out: CsvProjectedValue[], maxFields: number): boolean {
    let budget = normalizeCsvProjectionBudget(maxFields);
    while (budget > 0 && this.columnIndex < this.plannedColumns.length) {
      const column = this.plannedColumns[this.columnIndex]!;
      if (column.kind === "rowNumber") {
        out.push(column.headerName);
      } else {
        const headerName = column.column.headerName ?? column.field;
        out.push(
          this.processHeader !== undefined
            ? this.processHeader({
                column: column.column,
                field: column.field,
                headerName,
              })
            : headerName,
        );
      }
      this.columnIndex++;
      budget--;
    }
    return this.columnIndex >= this.plannedColumns.length;
  }
}

class GroupHeaderProjectionCursor implements CsvHeaderRowProjectionCursor {
  private segmentIndex = 0;
  private offsetInSegment = 0;

  constructor(
    private readonly row: CsvGroupHeaderRow,
    private readonly processGroupHeader:
      | ((params: CsvProcessGroupHeaderParams) => string)
      | undefined,
  ) {}

  step(out: CsvProjectedValue[], maxFields: number): boolean {
    let budget = normalizeCsvProjectionBudget(maxFields);
    while (budget > 0 && this.segmentIndex < this.row.segments.length) {
      const segment = this.row.segments[this.segmentIndex]!;
      const run = segment.run;
      if (this.offsetInSegment === 0 && run !== null) {
        out.push(
          this.processGroupHeader !== undefined
            ? this.processGroupHeader({
                groupId: run.groupId,
                headerName: run.headerName,
                level: run.level,
                fields: run.fields,
              })
            : run.headerName,
        );
      } else {
        out.push("");
      }

      this.offsetInSegment++;
      budget--;
      if (this.offsetInSegment >= segment.span) {
        this.segmentIndex++;
        this.offsetInSegment = 0;
      }
    }
    return this.segmentIndex >= this.row.segments.length;
  }
}

/** Build an O(1), callback-free cursor for one leaf-header row. */
export function createCsvLeafHeaderProjectionCursor(
  plannedColumns: readonly CsvPlannedColumn[],
  processHeader?: (params: CsvProcessHeaderParams) => string,
): CsvHeaderRowProjectionCursor {
  return new LeafHeaderProjectionCursor(plannedColumns, processHeader);
}

/** Build an O(1), callback-free cursor for one planned group-header row. */
export function createCsvGroupHeaderProjectionCursor(
  row: CsvGroupHeaderRow,
  processGroupHeader?: (params: CsvProcessGroupHeaderParams) => string,
): CsvHeaderRowProjectionCursor {
  return new GroupHeaderProjectionCursor(row, processGroupHeader);
}
