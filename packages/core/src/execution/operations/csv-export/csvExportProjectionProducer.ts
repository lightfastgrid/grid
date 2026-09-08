/**
 * CSV Export V1 - cooperative main-thread Worker projection producer (Stage 4D-A).
 *
 * Projects planned CSV rows into bounded flattened protocol chunks. Work begins
 * only through CooperativeScheduler, pauses after every emitted chunk, and
 * resumes only through a scheduled continuation after exact acknowledgement.
 * Encoding, sinks, fallback selection, Worker creation, and Grid integration
 * are intentionally outside this producer.
 */

import type { CsvContentRowCursor } from "../../../features/csv-export/csvContentRowCursor";
import { createCsvContentRowCursor } from "../../../features/csv-export/csvContentRowCursor";
import type { CsvExportSnapshot } from "../../../features/csv-export/csvExportSnapshot";
import type {
  CsvContentRow,
  CsvProcessCellParams,
  CsvProcessGroupHeaderParams,
  CsvProcessHeaderParams,
  CsvShouldExportRowParams,
} from "../../../features/csv-export/csvExportTypes";
import {
  createCsvGroupHeaderProjectionCursor,
  createCsvLeafHeaderProjectionCursor,
  type CsvHeaderRowProjectionCursor,
} from "../../../features/csv-export/csvHeaderProjectionCursor";
import type { CsvProjectedValue } from "../../../features/csv-export/csvProjectedValue";
import {
  createCsvRowProjectionCursor,
  type CsvRowProjectionCursor,
} from "../../../features/csv-export/csvRowProjectionCursor";
import { estimateCsvProjectedBytes } from "../../../features/csv-export/estimateCsvProjectedBytes";
import type { NormalizedCsvExportDefaults } from "../../../features/csv-export/normalizeCsvExportOptions";
import type { CsvPlannedColumn } from "../../../features/csv-export/planCsvColumnScope";
import type { CsvGroupHeaderPlan } from "../../../features/csv-export/planCsvGroupHeaders";
import type { CsvRowPlan } from "../../../features/csv-export/planCsvRowScope";
import type {
  CooperativeHandle,
  CooperativeScheduler,
} from "../../../scheduling/CooperativeScheduler";

import type { CsvChunkRequest } from "./csvExportProtocol";
import {
  CsvProjectionChunkBuilder,
  type CsvProjectionChunkLimits,
} from "./csvProjectionChunk";

export const DEFAULT_CSV_PROJECTION_TIME_BUDGET_MS = 4;
export const DEFAULT_CSV_PROJECTION_MAX_ROWS_PER_SLICE = 256;
export const DEFAULT_CSV_PROJECTION_MAX_BYTES_PER_SLICE = 64 * 1024;
export const DEFAULT_CSV_PROJECTION_MAX_FIELDS_PER_BATCH = 64;

export interface CsvExportProjectionBudgets {
  timeBudgetMs: number;
  maxRowsPerSlice: number;
  maxProjectedBytesPerSlice: number;
  maxFieldsPerBatch: number;
}

export interface CsvExportProjectionRuntime {
  prependContent?: readonly CsvContentRow[];
  appendContent?: readonly CsvContentRow[];
  shouldExportRow?: (params: CsvShouldExportRowParams) => boolean;
  processCell?: (params: CsvProcessCellParams) => CsvProjectedValue;
  processHeader?: (params: CsvProcessHeaderParams) => string;
  processGroupHeader?: (params: CsvProcessGroupHeaderParams) => string;
}

export interface CsvExportProjectionCompletion {
  exportedRowCount: number;
  candidateRowCount: number;
  columnCount: number;
}

export interface CsvExportProjectionProducerInput {
  snapshot: CsvExportSnapshot;
  rowPlan: CsvRowPlan;
  plannedColumns: readonly CsvPlannedColumn[];
  groupHeaderPlan: CsvGroupHeaderPlan;
  normalized: NormalizedCsvExportDefaults;
  runtime: CsvExportProjectionRuntime;
  scheduler: CooperativeScheduler;
  now: () => number;
  taskId: number;
  budgets?: Partial<CsvExportProjectionBudgets>;
  /** Internal deterministic-boundary override; wire maxima remain clamped. */
  chunkLimits?: Partial<CsvProjectionChunkLimits>;
  onChunk: (chunk: CsvChunkRequest) => boolean;
  onProjectionComplete: (result: CsvExportProjectionCompletion) => void;
  onCancelled: (reason: unknown) => void;
  onError: (error: unknown) => void;
}

export interface CsvExportProjectionProducerHandle {
  start(): void;
  acknowledgeChunk(sequence: number, final: boolean): void;
  cancel(reason: unknown): void;
}

type ProducerPhase =
  | "prependContent"
  | "groupHeaders"
  | "leafHeader"
  | "dataRows"
  | "appendContent"
  | "finalChunk";

type ProducerStatus =
  | "idle"
  | "active"
  | "cancelled"
  | "failed"
  | "completed";

interface ProjectionCursor {
  step(out: CsvProjectedValue[], maxFields: number): boolean;
}

interface ActiveProjectionRow {
  cursor: ProjectionCursor;
  dataCursor: CsvRowProjectionCursor | null;
}

interface InFlightChunk {
  sequence: number;
  final: boolean;
}

interface ScheduledToken {
  handle: CooperativeHandle | null;
}

interface SliceCounters {
  startTime: number;
  rowsInspected: number;
  projectedBytes: number;
}

const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

function sanitizePositiveNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(sanitizePositiveNumber(value, fallback)));
}

function resolveBudgets(
  budgets: Partial<CsvExportProjectionBudgets> | undefined,
): CsvExportProjectionBudgets {
  return {
    timeBudgetMs: sanitizePositiveNumber(
      budgets?.timeBudgetMs,
      DEFAULT_CSV_PROJECTION_TIME_BUDGET_MS,
    ),
    maxRowsPerSlice: sanitizePositiveInteger(
      budgets?.maxRowsPerSlice,
      DEFAULT_CSV_PROJECTION_MAX_ROWS_PER_SLICE,
    ),
    maxProjectedBytesPerSlice: sanitizePositiveInteger(
      budgets?.maxProjectedBytesPerSlice,
      DEFAULT_CSV_PROJECTION_MAX_BYTES_PER_SLICE,
    ),
    maxFieldsPerBatch: Math.min(
      DEFAULT_CSV_PROJECTION_MAX_FIELDS_PER_BATCH,
      sanitizePositiveInteger(
        budgets?.maxFieldsPerBatch,
        DEFAULT_CSV_PROJECTION_MAX_FIELDS_PER_BATCH,
      ),
    ),
  };
}

function saturatingAdd(left: number, right: number): number {
  if (left >= MAX_COUNTER - right) return MAX_COUNTER;
  return left + right;
}

class CsvExportProjectionProducer
  implements CsvExportProjectionProducerHandle
{
  private readonly budgets: CsvExportProjectionBudgets;
  private readonly builder: CsvProjectionChunkBuilder;
  private readonly guardedShouldExportRow: CsvExportProjectionRuntime["shouldExportRow"];
  private readonly rowPlanOutput: number[] = [];
  private readonly projectedValues: CsvProjectedValue[] = [];
  private status: ProducerStatus = "idle";
  private phase: ProducerPhase = "prependContent";
  private scheduled: ScheduledToken | null = null;
  private inFlight: InFlightChunk | null = null;
  private reentrantAcknowledgement: InFlightChunk | null = null;
  private emissionCallbackActive = false;
  private emittedInCurrentSlice = false;
  private activeRow: ActiveProjectionRow | null = null;
  private batchIndex = 0;
  private batchCompletesRow = false;
  private prependIndex = 0;
  private groupHeaderIndex = 0;
  private leafHeaderStarted = false;
  private rowPlanDone = false;
  private candidateRowIndex = 0;
  private emittedRowIndex = 0;
  private appendIndex = 0;

  constructor(private readonly input: CsvExportProjectionProducerInput) {
    this.budgets = resolveBudgets(input.budgets);
    this.builder = new CsvProjectionChunkBuilder(
      input.taskId,
      input.chunkLimits,
    );
    const shouldExportRow = input.runtime.shouldExportRow;
    this.guardedShouldExportRow =
      shouldExportRow === undefined
        ? undefined
        : (params: CsvShouldExportRowParams): boolean => {
            const exported = shouldExportRow(params);
            return this.status === "active" && exported;
          };
  }

  start(): void {
    if (this.status !== "idle") return;
    this.status = "active";
    this.scheduleContinuation();
  }

  acknowledgeChunk(sequence: number, final: boolean): void {
    if (this.status !== "active") return;
    const inFlight = this.inFlight;
    if (
      inFlight === null ||
      inFlight.sequence !== sequence ||
      inFlight.final !== final
    ) {
      return;
    }

    if (this.emissionCallbackActive) {
      if (this.reentrantAcknowledgement === null) {
        this.reentrantAcknowledgement = { sequence, final };
      }
      return;
    }
    this.applyAcknowledgement(inFlight);
  }

  cancel(reason: unknown): void {
    if (this.status !== "idle" && this.status !== "active") return;
    this.status = "cancelled";
    this.cancelScheduledContinuation();
    this.releaseProjectionState();
    this.input.onCancelled(reason);
  }

  private scheduleContinuation(): void {
    if (
      this.status !== "active" ||
      this.scheduled !== null ||
      this.inFlight !== null
    ) {
      return;
    }

    const token: ScheduledToken = { handle: null };
    this.scheduled = token;
    try {
      token.handle = this.input.scheduler.schedule(
        () => {
          if (this.scheduled !== token) return;
          this.scheduled = null;
          this.runSlice();
        },
        { priority: "user-visible" },
      );
    } catch (error) {
      if (this.scheduled === token) this.scheduled = null;
      this.fail(error);
    }
  }

  private cancelScheduledContinuation(): void {
    const scheduled = this.scheduled;
    this.scheduled = null;
    scheduled?.handle?.cancel();
  }

  private runSlice(): void {
    if (this.status !== "active" || this.inFlight !== null) return;
    this.emittedInCurrentSlice = false;
    const slice: SliceCounters = {
      startTime: this.input.now(),
      rowsInspected: 0,
      projectedBytes: 0,
    };

    try {
      while (this.canRunSlice()) {
        this.advanceOneWorkUnit(slice);
        if (!this.canRunSlice() || this.wasChunkEmittedInCurrentSlice()) {
          return;
        }
        if (this.sliceCeilingReached(slice)) {
          this.scheduleContinuation();
          return;
        }
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private advanceOneWorkUnit(slice: SliceCounters): void {
    const pending = this.builder.takeSealed();
    if (pending !== null) {
      this.emitChunk(pending);
      return;
    }

    if (this.activeRow !== null) {
      this.projectActiveRow(slice);
      return;
    }

    switch (this.phase) {
      case "prependContent":
        if (this.prependIndex < (this.input.runtime.prependContent?.length ?? 0)) {
          const row = this.input.runtime.prependContent![this.prependIndex++]!;
          this.setNonDataRow(createCsvContentRowCursor(row));
        } else {
          this.phase = "groupHeaders";
        }
        return;

      case "groupHeaders":
        if (this.groupHeaderIndex < this.input.groupHeaderPlan.rows.length) {
          const row = this.input.groupHeaderPlan.rows[this.groupHeaderIndex++]!;
          this.setNonDataRow(
            createCsvGroupHeaderProjectionCursor(
              row,
              this.input.runtime.processGroupHeader,
            ),
          );
        } else {
          this.phase = "leafHeader";
        }
        return;

      case "leafHeader":
        if (this.input.normalized.includeColumnHeaders && !this.leafHeaderStarted) {
          this.leafHeaderStarted = true;
          this.setNonDataRow(
            createCsvLeafHeaderProjectionCursor(
              this.input.plannedColumns,
              this.input.runtime.processHeader,
            ),
          );
        } else {
          this.phase = "dataRows";
        }
        return;

      case "dataRows":
        this.advanceRowPlan(slice);
        return;

      case "appendContent":
        if (this.appendIndex < (this.input.runtime.appendContent?.length ?? 0)) {
          const row = this.input.runtime.appendContent![this.appendIndex++]!;
          this.setNonDataRow(createCsvContentRowCursor(row));
        } else {
          this.phase = "finalChunk";
        }
        return;

      case "finalChunk":
        this.emitChunk(this.builder.finalize());
    }
  }

  private setNonDataRow(
    cursor: CsvContentRowCursor | CsvHeaderRowProjectionCursor,
  ): void {
    this.activeRow = { cursor, dataCursor: null };
  }

  private advanceRowPlan(slice: SliceCounters): void {
    if (this.rowPlanDone) {
      this.phase = "appendContent";
      return;
    }

    const previousLength = this.rowPlanOutput.length;
    const done = this.input.rowPlan.step(this.rowPlanOutput, 1);
    slice.rowsInspected = saturatingAdd(slice.rowsInspected, 1);
    this.rowPlanDone = done;

    if (this.rowPlanOutput.length > previousLength) {
      const sourceRowIndex = this.rowPlanOutput.pop()!;
      const rowIndex = this.candidateRowIndex;
      this.candidateRowIndex = saturatingAdd(this.candidateRowIndex, 1);
      const row = this.input.snapshot.sourceRows[sourceRowIndex]!;
      const rowId = this.input.snapshot.rowIds.getRowIdBySourceIndex(sourceRowIndex);
      const dataCursor = createCsvRowProjectionCursor({
        row,
        rowId,
        rowIndex,
        sourceRowIndex,
        emittedRowIndex: this.emittedRowIndex,
        plannedColumns: this.input.plannedColumns,
        useValueFormatter: this.input.normalized.useValueFormatter,
        processCell: this.input.runtime.processCell,
        shouldExportRow: this.guardedShouldExportRow,
      });
      this.activeRow = { cursor: dataCursor, dataCursor };
    }
  }

  private projectActiveRow(slice: SliceCounters): void {
    const activeRow = this.activeRow!;
    const values = this.projectedValues;
    try {
      if (this.batchIndex >= values.length) {
        values.length = 0;
        this.batchIndex = 0;
        let done = false;
        while (values.length < this.budgets.maxFieldsPerBatch && !done) {
          const previousLength = values.length;
          done = activeRow.cursor.step(values, 1);
          if (this.status !== "active") return;

          if (values.length > previousLength) {
            const value = values[values.length - 1]!;
            slice.projectedBytes = saturatingAdd(
              slice.projectedBytes,
              estimateCsvProjectedBytes(value),
            );
            if (
              slice.projectedBytes >=
                this.budgets.maxProjectedBytesPerSlice ||
              this.timeCeilingReached(slice)
            ) {
              break;
            }
          } else if (!done) {
            throw new Error(
              "CSV projection producer: cursor made no progress",
            );
          }
        }
        this.batchCompletesRow = done;
      }

      if (activeRow.dataCursor?.exported === false) {
        values.length = 0;
        this.batchIndex = 0;
        this.batchCompletesRow = false;
        this.activeRow = null;
        return;
      }

      while (this.batchIndex < values.length) {
        const sealed = this.builder.append(values[this.batchIndex]!);
        this.batchIndex++;
        if (sealed !== null) {
          this.emitChunk(sealed);
          return;
        }
      }

      values.length = 0;
      this.batchIndex = 0;
      if (!this.batchCompletesRow) return;

      this.batchCompletesRow = false;
      if (activeRow.dataCursor?.exported === true) {
        this.emittedRowIndex = saturatingAdd(this.emittedRowIndex, 1);
      }
      this.activeRow = null;
      const sealed = this.builder.endRow();
      if (sealed !== null) this.emitChunk(sealed);
    } finally {
      if (this.status !== "active") {
        values.length = 0;
        this.batchIndex = 0;
      }
    }
  }

  private emitChunk(chunk: CsvChunkRequest): void {
    if (this.status !== "active" || this.inFlight !== null) return;
    const inFlight: InFlightChunk = {
      sequence: chunk.sequence,
      final: chunk.final,
    };
    this.inFlight = inFlight;
    this.emittedInCurrentSlice = true;
    this.emissionCallbackActive = true;
    this.reentrantAcknowledgement = null;

    let accepted: boolean;
    try {
      accepted = this.input.onChunk(chunk);
    } catch (error) {
      this.emissionCallbackActive = false;
      this.fail(error);
      return;
    }
    this.emissionCallbackActive = false;

    if (!this.isActive()) {
      this.reentrantAcknowledgement = null;
      return;
    }
    if (!accepted) {
      this.reentrantAcknowledgement = null;
      this.fail(new Error("CSV projection chunk was rejected"));
      return;
    }

    const acknowledgement = this.takeReentrantAcknowledgement();
    if (acknowledgement !== null) {
      this.applyAcknowledgement(acknowledgement);
    }
  }

  private applyAcknowledgement(acknowledgement: InFlightChunk): void {
    const inFlight = this.inFlight;
    if (
      this.status !== "active" ||
      inFlight === null ||
      inFlight.sequence !== acknowledgement.sequence ||
      inFlight.final !== acknowledgement.final
    ) {
      return;
    }

    this.inFlight = null;
    if (!inFlight.final) {
      this.scheduleContinuation();
      return;
    }

    this.status = "completed";
    this.cancelScheduledContinuation();
    this.projectedValues.length = 0;
    this.activeRow = null;
    this.input.onProjectionComplete({
      exportedRowCount: this.emittedRowIndex,
      candidateRowCount: this.candidateRowIndex,
      columnCount: this.input.plannedColumns.length,
    });
  }

  private sliceCeilingReached(slice: SliceCounters): boolean {
    return (
      slice.rowsInspected >= this.budgets.maxRowsPerSlice ||
      slice.projectedBytes >= this.budgets.maxProjectedBytesPerSlice ||
      this.timeCeilingReached(slice)
    );
  }

  private isActive(): boolean {
    return this.status === "active";
  }

  private canRunSlice(): boolean {
    return this.isActive() && this.inFlight === null;
  }

  private wasChunkEmittedInCurrentSlice(): boolean {
    return this.emittedInCurrentSlice;
  }

  private takeReentrantAcknowledgement(): InFlightChunk | null {
    const acknowledgement = this.reentrantAcknowledgement;
    this.reentrantAcknowledgement = null;
    return acknowledgement;
  }

  private timeCeilingReached(slice: SliceCounters): boolean {
    const now = this.input.now();
    return (
      !Number.isFinite(now) ||
      !Number.isFinite(slice.startTime) ||
      now - slice.startTime >= this.budgets.timeBudgetMs
    );
  }

  private releaseProjectionState(): void {
    this.inFlight = null;
    this.reentrantAcknowledgement = null;
    this.emissionCallbackActive = false;
    this.activeRow = null;
    this.projectedValues.length = 0;
    this.batchIndex = 0;
    this.batchCompletesRow = false;
    this.builder.discard();
  }

  private fail(error: unknown): void {
    if (this.status !== "active") return;
    this.status = "failed";
    this.cancelScheduledContinuation();
    this.releaseProjectionState();
    this.input.onError(error);
  }
}

export function createCsvExportProjectionProducer(
  input: CsvExportProjectionProducerInput,
): CsvExportProjectionProducerHandle {
  return new CsvExportProjectionProducer(input);
}
