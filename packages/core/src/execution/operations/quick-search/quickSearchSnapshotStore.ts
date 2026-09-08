/**
 * Worker-owned normalized row-text snapshot.
 *
 * Consumes searchable-only snapshot chunks (`SearchableSnapshotRow[]`)
 * and aggregates each row's field values into one row text string.
 * Field values are joined with a space so query parts can match across
 * different fields of the same row. Stale-generation chunks are
 * rejected. Never sees full `RowData` objects.
 */

import type { SearchableSnapshotRow } from "./quickSearchProtocol";

export class QuickSearchSnapshotStore {
  private rowTexts: string[] = [];
  private generation = 0;
  private rowCount = 0;
  private completeFlag = false;

  start(generation: number, rowCount: number): void {
    this.generation = generation;
    this.rowCount = rowCount;
    this.rowTexts = new Array<string>(rowCount).fill("");
    this.completeFlag = false;
  }

  /** Returns false (and ignores the chunk) when the generation is stale. */
  applyChunk(generation: number, rows: readonly SearchableSnapshotRow[]): boolean {
    if (generation !== this.generation) return false;
    for (const row of rows) {
      if (row.rowIndex >= 0 && row.rowIndex < this.rowCount) {
        this.rowTexts[row.rowIndex] = row.values.join(" ");
      }
    }
    return true;
  }

  markComplete(generation: number): boolean {
    if (generation !== this.generation) return false;
    this.completeFlag = true;
    return true;
  }

  /**
   * Atomically apply staged sourceIndex → normalized row-text updates.
   * Validates every index before mutating; on failure leaves rowTexts
   * unchanged. Requires a complete, generation-matching snapshot.
   */
  commitPatch(
    generation: number,
    updates: ReadonlyMap<number, string>,
  ): boolean {
    if (generation !== this.generation) return false;
    if (!this.completeFlag) return false;

    for (const index of updates.keys()) {
      if (!Number.isInteger(index) || index < 0 || index >= this.rowCount) {
        return false;
      }
    }

    for (const [index, text] of updates) {
      this.rowTexts[index] = text;
    }
    return true;
  }

  clear(): void {
    this.rowTexts = [];
    this.generation = 0;
    this.rowCount = 0;
    this.completeFlag = false;
  }

  getRowText(rowIndex: number): string {
    return this.rowTexts[rowIndex] ?? "";
  }

  getRowCount(): number {
    return this.rowCount;
  }

  getGeneration(): number {
    return this.generation;
  }

  isComplete(): boolean {
    return this.completeFlag;
  }
}
