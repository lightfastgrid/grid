/**
 * CSV Export V1 - bounded flattened projection-chunk builder (Stage 4A).
 *
 * Internal execution helper only. Seals immutable `csv:chunk` messages for the
 * Worker protocol. Does not stringify values, touch DOM/Grid/sinks, or run a
 * Worker. Cancellation via {@link CsvProjectionChunkBuilder.discard} drops
 * partial ownership and retains no projected values.
 *
 * Logical row openness is retained across non-final seals. Finalization is
 * terminal. When {@link CsvProjectionChunkBuilder.append} parks a follow-up
 * seal, call {@link CsvProjectionChunkBuilder.takeSealed} before the next
 * mutation.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 18–19.
 */

import { estimateCsvProjectedBytes } from "../../../features/csv-export/estimateCsvProjectedBytes";

import type {
  CsvChunkRequest,
  CsvWorkerProjectionValue,
} from "./csvExportProtocol";
import { isCsvExportTaskId } from "./csvExportTaskId";
import {
  type CsvProjectionChunkLimits,
  resolveCsvProjectionChunkLimits,
} from "./csvProjectionChunkLimits";

export {
  CSV_CHUNK_MAX_COMPLETED_ROWS,
  CSV_CHUNK_MAX_ESTIMATED_BYTES,
  CSV_CHUNK_MAX_VALUES,
  type CsvProjectionChunkLimits,
  resolveCsvProjectionChunkLimits,
} from "./csvProjectionChunkLimits";

type BuilderLifecycle = "active" | "finalized" | "discarded";

function saturatingAdd(left: number, right: number): number {
  if (left >= Number.MAX_SAFE_INTEGER - right) return Number.MAX_SAFE_INTEGER;
  return left + right;
}

/** Bounded builder that seals one immutable `csv:chunk` at a time. */
export class CsvProjectionChunkBuilder {
  private readonly taskId: number;
  private readonly limits: CsvProjectionChunkLimits;
  private values: CsvWorkerProjectionValue[];
  private rowEnds: number[];
  private estimatedBytes: number;
  private nextSequence: number;
  private pendingSealed: CsvChunkRequest | null;
  private lifecycle: BuilderLifecycle;
  private logicalRowOpen: boolean;

  constructor(taskId: number, limits?: Partial<CsvProjectionChunkLimits>) {
    if (!isCsvExportTaskId(taskId)) {
      throw new Error("CsvProjectionChunkBuilder: invalid taskId");
    }
    this.taskId = taskId;
    this.limits = resolveCsvProjectionChunkLimits(limits);
    this.values = [];
    this.rowEnds = [];
    this.estimatedBytes = 0;
    this.nextSequence = 0;
    this.pendingSealed = null;
    this.lifecycle = "active";
    this.logicalRowOpen = false;
  }

  /** Persistent logical-row openness across sealed chunk boundaries. */
  get hasOpenRow(): boolean {
    return this.logicalRowOpen;
  }

  /** True when the current chunk arrays hold no values and no row ends. */
  get isEmpty(): boolean {
    return this.values.length === 0 && this.rowEnds.length === 0;
  }

  get completedRowCount(): number {
    return this.rowEnds.length;
  }

  get valueCount(): number {
    return this.values.length;
  }

  get currentEstimatedBytes(): number {
    return this.estimatedBytes;
  }

  /** Next sequence to assign, or the assigned final sequence after finalize. */
  get sequence(): number {
    return this.nextSequence;
  }

  get isFinalized(): boolean {
    return this.lifecycle === "finalized";
  }

  get isDiscarded(): boolean {
    return this.lifecycle === "discarded";
  }

  /**
   * Take a follow-up sealed chunk parked after an oversized-alone accept.
   * Does not resurrect mutable lifecycle after finalize/discard.
   */
  takeSealed(): CsvChunkRequest | null {
    if (this.lifecycle !== "active") return null;
    const sealed = this.pendingSealed;
    this.pendingSealed = null;
    return sealed;
  }

  /**
   * Append one projected value without stringification.
   * Returns a sealed non-final chunk when limits require yielding. The value is
   * always consumed (into the returned chunk's successor state when yielding).
   */
  append(value: CsvWorkerProjectionValue): CsvChunkRequest | null {
    this.assertMutable();
    const cost = estimateCsvProjectedBytes(value);
    const wouldExceedValues = this.values.length + 1 > this.limits.maxValues;
    const wouldExceedBytes =
      this.estimatedBytes + cost > this.limits.maxEstimatedBytes;

    if ((wouldExceedValues || wouldExceedBytes) && !this.isEmpty) {
      const sealed = this.seal(false);
      this.pushValue(value, cost);
      if (this.isOversizedAlone(cost)) {
        this.pendingSealed = this.seal(false);
      }
      return sealed;
    }

    this.pushValue(value, cost);
    if (this.isOversizedAlone(cost)) {
      return this.seal(false);
    }
    return null;
  }

  /**
   * Record the end of the current logical row (including zero-field rows).
   * Returns a sealed non-final chunk when the completed-row limit requires
   * yielding first; the row end is then recorded on the fresh chunk.
   */
  endRow(): CsvChunkRequest | null {
    this.assertMutable();
    const wouldExceedRows =
      this.rowEnds.length + 1 > this.limits.maxCompletedRows;

    if (wouldExceedRows && !this.isEmpty) {
      const sealed = this.seal(false);
      this.pushRowEnd();
      return sealed;
    }

    this.pushRowEnd();
    return null;
  }

  /**
   * Seal a final chunk. Rejects an open logical row. An empty final marker is
   * allowed when no logical row is open. Finalization is terminal.
   */
  finalize(): CsvChunkRequest {
    this.assertMutable();
    if (this.logicalRowOpen) {
      throw new Error(
        "CsvProjectionChunkBuilder: cannot finalize while a row is open",
      );
    }
    const sealed = this.seal(true);
    this.lifecycle = "finalized";
    return sealed;
  }

  /** Drop partial arrays and logical ownership. Idempotent. */
  discard(): void {
    this.lifecycle = "discarded";
    this.pendingSealed = null;
    this.logicalRowOpen = false;
    this.values = [];
    this.rowEnds = [];
    this.estimatedBytes = 0;
  }

  private isOversizedAlone(cost: number): boolean {
    return (
      this.values.length === 1 &&
      this.rowEnds.length === 0 &&
      cost > this.limits.maxEstimatedBytes
    );
  }

  private pushValue(value: CsvWorkerProjectionValue, cost: number): void {
    this.values.push(value);
    this.estimatedBytes = saturatingAdd(this.estimatedBytes, cost);
    this.logicalRowOpen = true;
  }

  private pushRowEnd(): void {
    this.rowEnds.push(this.values.length);
    this.logicalRowOpen = false;
  }

  private assertMutable(): void {
    if (this.lifecycle === "discarded") {
      throw new Error("CsvProjectionChunkBuilder: builder was discarded");
    }
    if (this.lifecycle === "finalized") {
      throw new Error("CsvProjectionChunkBuilder: builder was finalized");
    }
    if (this.pendingSealed !== null) {
      throw new Error(
        "CsvProjectionChunkBuilder: sealed chunk pending takeSealed()",
      );
    }
  }

  private seal(final: boolean): CsvChunkRequest {
    if (!final && this.nextSequence === Number.MAX_SAFE_INTEGER) {
      throw new Error("CsvProjectionChunkBuilder: chunk sequence exhausted");
    }

    const values = this.values;
    const rowEndsBuffer = new ArrayBuffer(
      this.rowEnds.length * Uint32Array.BYTES_PER_ELEMENT,
    );
    const rowEnds: Uint32Array<ArrayBuffer> = new Uint32Array(rowEndsBuffer);
    for (let i = 0; i < this.rowEnds.length; i++) {
      rowEnds[i] = this.rowEnds[i]!;
    }
    const estimatedBytes = this.estimatedBytes;
    const sequence = this.nextSequence;
    if (!final) this.nextSequence = sequence + 1;
    this.values = [];
    this.rowEnds = [];
    this.estimatedBytes = 0;
    // logicalRowOpen is intentionally retained across non-final seals.

    return {
      kind: "csv:chunk",
      taskId: this.taskId,
      sequence,
      values,
      rowEnds,
      estimatedBytes,
      final,
    };
  }
}
