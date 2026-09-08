/**
 * CSV Export V1 - cooperative main-thread executor core (Stage 3B-C).
 *
 * Work begins only through CooperativeScheduler at user-visible priority. The
 * executor owns one phase cursor, a projected-value batch capped by
 * `maxCellsPerBatch`, and at most one encoded chunk being accepted by the sink.
 * It never materializes a complete data/header/content row.
 *
 * Progress is throttled and truthfully phased (`projecting` / `finalizing`).
 * Sampling occurs only at scheduled-slice entry, public phase transitions, and
 * successful completion — never from promise microtasks or per-work-unit loops.
 * `onProgress` is an internal observer seam; Stage 5 owns public task/event
 * adaptation. No progress runs on the API caller stack.
 *
 * Projected-byte accounting is an internal cooperative estimate, not an output
 * limit: strings cost two bytes per UTF-16 code unit, numbers eight bytes,
 * booleans one byte, bigints sixteen bytes, and null/undefined zero bytes.
 * CsvByteLimitedSink remains the authoritative encoded-output size guard.
 */

import type { CsvContentRowCursor } from "../../../features/csv-export/csvContentRowCursor";
import { createCsvContentRowCursor } from "../../../features/csv-export/csvContentRowCursor";
import type { CsvExportSnapshot } from "../../../features/csv-export/csvExportSnapshot";
import type {
  CsvContentRow,
  CsvExportProgress,
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
import type {
  CsvOutputSink,
  CsvSinkResult,
} from "../../../features/csv-export/csvOutputSink";
import type { CsvProjectedValue } from "../../../features/csv-export/csvProjectedValue";
import {
  createCsvRowProjectionCursor,
  type CsvRowProjectionCursor,
} from "../../../features/csv-export/csvRowProjectionCursor";
import { CsvEncodingSession } from "../../../features/csv-export/csvUtf8Encoder";
import { estimateCsvProjectedBytes } from "../../../features/csv-export/estimateCsvProjectedBytes";
import type { NormalizedCsvExportDefaults } from "../../../features/csv-export/normalizeCsvExportOptions";
import type { CsvPlannedColumn } from "../../../features/csv-export/planCsvColumnScope";
import type { CsvGroupHeaderPlan } from "../../../features/csv-export/planCsvGroupHeaders";
import type { CsvRowPlan } from "../../../features/csv-export/planCsvRowScope";
import type {
  CooperativeHandle,
  CooperativeScheduler,
} from "../../../scheduling/CooperativeScheduler";

export const DEFAULT_CSV_MAIN_TIME_BUDGET_MS = 4;
export const DEFAULT_CSV_MAIN_MAX_ROWS_PER_SLICE = 256;
export const DEFAULT_CSV_MAIN_MAX_PROJECTED_BYTES_PER_SLICE = 64 * 1024;
export const DEFAULT_CSV_MAIN_MAX_ENCODED_BYTES_PER_SLICE = 64 * 1024;
export const DEFAULT_CSV_MAIN_MAX_CELLS_PER_BATCH = 64;
export const DEFAULT_CSV_PROGRESS_INTERVAL_MS = 50;

type CsvMainProgressPhase = Extract<
  CsvExportProgress["phase"],
  "projecting" | "finalizing"
>;

export interface CsvExportMainThreadBudgets {
  timeBudgetMs: number;
  maxRowsPerSlice: number;
  maxProjectedBytesPerSlice: number;
  maxEncodedBytesPerSlice: number;
  maxCellsPerBatch: number;
}

export interface CsvExportMainThreadRuntime {
  prependContent?: readonly CsvContentRow[];
  appendContent?: readonly CsvContentRow[];
  shouldExportRow?: (params: CsvShouldExportRowParams) => boolean;
  processCell?: (params: CsvProcessCellParams) => CsvProjectedValue;
  processHeader?: (params: CsvProcessHeaderParams) => string;
  processGroupHeader?: (params: CsvProcessGroupHeaderParams) => string;
}

export interface CsvExportMainThreadCompletion {
  sinkResult: CsvSinkResult;
  /** Exported data rows only; headers and custom content are excluded. */
  rowCount: number;
  columnCount: number;
}

export interface CsvExportMainThreadInput {
  snapshot: CsvExportSnapshot;
  rowPlan: CsvRowPlan;
  plannedColumns: readonly CsvPlannedColumn[];
  groupHeaderPlan: CsvGroupHeaderPlan;
  normalized: NormalizedCsvExportDefaults;
  runtime: CsvExportMainThreadRuntime;
  sink: CsvOutputSink;
  scheduler: CooperativeScheduler;
  now: () => number;
  taskId: number;
  /** Internal observer seam; Stage 5 adapts this into the public task/events. */
  onProgress?: (progress: CsvExportProgress) => void;
  budgets?: Partial<CsvExportMainThreadBudgets>;
  onCommit?: (result: CsvExportMainThreadCompletion) => void;
  onComplete: (result: CsvExportMainThreadCompletion) => void;
  onCancelled: (reason: unknown) => void;
  onError: (error: unknown) => void;
}

export interface CsvExportMainThreadHandle {
  cancel(reason: unknown): void;
}

type ExecutionPhase =
  | "prependContent"
  | "groupHeaders"
  | "leafHeader"
  | "dataRows"
  | "appendContent"
  | "finish"
  | "close"
  | "complete";

type ExecutionStatus = "active" | "cancelled" | "failed" | "completed";

interface ProjectionCursor {
  step(out: CsvProjectedValue[], maxFields: number): boolean;
}

interface ActiveProjectionRow {
  cursor: ProjectionCursor;
  dataCursor: CsvRowProjectionCursor | null;
}

interface ScheduledToken {
  handle: CooperativeHandle | null;
}

interface SliceCounters {
  startTime: number;
  rowsInspected: number;
  projectedBytes: number;
  encodedBytes: number;
}

const MAX_COUNTER = Number.MAX_SAFE_INTEGER;

function sanitizePositiveNumber(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  const positive = sanitizePositiveNumber(value, fallback);
  return Math.max(1, Math.floor(positive));
}

function resolveBudgets(
  budgets: Partial<CsvExportMainThreadBudgets> | undefined,
): CsvExportMainThreadBudgets {
  return {
    timeBudgetMs: sanitizePositiveNumber(
      budgets?.timeBudgetMs,
      DEFAULT_CSV_MAIN_TIME_BUDGET_MS,
    ),
    maxRowsPerSlice: sanitizePositiveInteger(
      budgets?.maxRowsPerSlice,
      DEFAULT_CSV_MAIN_MAX_ROWS_PER_SLICE,
    ),
    maxProjectedBytesPerSlice: sanitizePositiveInteger(
      budgets?.maxProjectedBytesPerSlice,
      DEFAULT_CSV_MAIN_MAX_PROJECTED_BYTES_PER_SLICE,
    ),
    maxEncodedBytesPerSlice: sanitizePositiveInteger(
      budgets?.maxEncodedBytesPerSlice,
      DEFAULT_CSV_MAIN_MAX_ENCODED_BYTES_PER_SLICE,
    ),
    maxCellsPerBatch: Math.min(
      DEFAULT_CSV_MAIN_MAX_CELLS_PER_BATCH,
      sanitizePositiveInteger(
        budgets?.maxCellsPerBatch,
        DEFAULT_CSV_MAIN_MAX_CELLS_PER_BATCH,
      ),
    ),
  };
}

function saturatingAdd(left: number, right: number): number {
  if (left >= MAX_COUNTER - right) return MAX_COUNTER;
  return left + right;
}

class CsvMainThreadExecution implements CsvExportMainThreadHandle {
  private readonly encoder: CsvEncodingSession;
  private readonly budgets: CsvExportMainThreadBudgets;
  private readonly guardedShouldExportRow: CsvExportMainThreadRuntime["shouldExportRow"];
  private readonly rowPlanOutput: number[] = [];
  private readonly projectedValues: CsvProjectedValue[] = [];
  private status: ExecutionStatus = "active";
  private phase: ExecutionPhase = "prependContent";
  private scheduled: ScheduledToken | null = null;
  private writePending = false;
  private closePending = false;
  private sinkAbortStarted = false;
  private activeRow: ActiveProjectionRow | null = null;
  private prependIndex = 0;
  private groupHeaderIndex = 0;
  private leafHeaderStarted = false;
  private rowPlanDone = false;
  private candidateRowIndex = 0;
  private emittedRowIndex = 0;
  private appendIndex = 0;
  private pendingCloseResult: CsvSinkResult | null = null;
  private progressPhase: CsvMainProgressPhase = "projecting";
  private lastProgressAt: number | null = null;
  private emittedBytes = 0;
  private completionProgressEmitted = false;
  private completionCommitted = false;
  private completionFallbackScheduled = false;

  constructor(private readonly input: CsvExportMainThreadInput) {
    this.encoder = new CsvEncodingSession(input.normalized);
    this.budgets = resolveBudgets(input.budgets);
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
    this.scheduleContinuation();
  }

  cancel(reason: unknown): void {
    if (this.completionCommitted) return;
    if (this.status !== "active") return;
    this.status = "cancelled";
    this.cancelScheduledContinuation();
    this.abortSinkOnce(reason);
    this.input.onCancelled(reason);
  }

  private scheduleContinuation(): void {
    if (
      this.status !== "active" ||
      this.scheduled !== null ||
      this.writePending ||
      this.closePending
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
      if (this.completionCommitted) {
        this.scheduleCompletionFallback();
        return;
      }
      this.fail(error);
    }
  }

  private scheduleCompletionFallback(): void {
    if (this.completionFallbackScheduled) return;
    this.completionFallbackScheduled = true;
    queueMicrotask(() => {
      if (!this.completionFallbackScheduled) return;
      this.completionFallbackScheduled = false;
      if (
        this.status !== "active" ||
        !this.completionCommitted ||
        this.phase !== "complete" ||
        this.pendingCloseResult === null
      ) {
        return;
      }
      this.runSlice();
    });
  }

  private cancelScheduledContinuation(): void {
    const scheduled = this.scheduled;
    this.scheduled = null;
    scheduled?.handle?.cancel();
  }

  private runSlice(): void {
    if (this.status !== "active") return;

    // Progress is sampled only at slice entry, phase changes, and completion —
    // never after each work unit on the projection hot path.
    this.maybeReportProgress();

    const slice: SliceCounters = {
      startTime: this.input.now(),
      rowsInspected: 0,
      projectedBytes: 0,
      encodedBytes: 0,
    };

    try {
      while (this.canRunSlice()) {
        this.advanceOneWorkUnit(slice);
        if (!this.canRunSlice()) return;
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
          this.phase = "finish";
        }
        return;

      case "finish": {
        this.enterFinalizingProgress();
        const chunk = this.encoder.finish();
        this.phase = "close";
        this.acceptEncodedChunk(chunk, slice);
        return;
      }

      case "close":
        this.closeSink();
        return;

      case "complete": {
        const result = this.pendingCloseResult;
        if (result === null) {
          throw new Error("CSV main executor: missing asynchronous close result");
        }
        this.pendingCloseResult = null;
        this.complete(result);
      }
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
    values.length = 0;
    try {
      let done = false;

      while (values.length < this.budgets.maxCellsPerBatch && !done) {
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
            slice.projectedBytes >= this.budgets.maxProjectedBytesPerSlice ||
            this.timeCeilingReached(slice)
          ) {
            break;
          }
        } else if (!done) {
          throw new Error(
            "CSV main executor: projection cursor made no progress",
          );
        }
      }

      if (activeRow.dataCursor?.exported === false) {
        this.activeRow = null;
        return;
      }
      if (values.length === 0 && !done) {
        throw new Error(
          "CSV main executor: empty non-terminal projection batch",
        );
      }

      const chunk = this.encoder.encodeRowChunk(values, { endRow: done });
      values.length = 0;
      if (done) {
        if (activeRow.dataCursor?.exported === true) {
          this.emittedRowIndex = saturatingAdd(this.emittedRowIndex, 1);
        }
        this.activeRow = null;
      }
      this.acceptEncodedChunk(chunk, slice);
    } finally {
      values.length = 0;
    }
  }

  private acceptEncodedChunk(
    chunk: Uint8Array<ArrayBuffer>,
    slice: SliceCounters,
  ): void {
    slice.encodedBytes = saturatingAdd(slice.encodedBytes, chunk.byteLength);
    if (chunk.byteLength === 0 || this.status !== "active") return;

    const outcome = this.input.sink.write(chunk);
    if (!(outcome instanceof Promise)) {
      // Sync acceptance only updates the counter; progress is observed at the
      // next slice boundary, phase transition, or final event.
      this.recordAcceptedBytes(chunk.byteLength);
      return;
    }

    this.writePending = true;
    void outcome.then(
      () => {
        // Promise microtasks update counters and reschedule only — never
        // project, encode, close, or invoke onProgress here.
        if (this.status !== "active") return;
        this.writePending = false;
        this.recordAcceptedBytes(chunk.byteLength);
        this.scheduleContinuation();
      },
      (error: unknown) => {
        if (this.status !== "active") return;
        this.writePending = false;
        this.fail(error);
      },
    );
  }

  private closeSink(): void {
    const outcome = this.input.sink.close();
    if (!(outcome instanceof Promise)) {
      this.complete(outcome);
      return;
    }

    this.closePending = true;
    void outcome.then(
      (result) => {
        if (this.status !== "active") return;
        this.closePending = false;
        this.pendingCloseResult = result;
        this.phase = "complete";
        this.commitCompletion(result);
        this.scheduleContinuation();
      },
      (error: unknown) => {
        if (this.status !== "active") return;
        this.closePending = false;
        this.fail(error);
      },
    );
  }

  private sliceCeilingReached(slice: SliceCounters): boolean {
    return (
      slice.rowsInspected >= this.budgets.maxRowsPerSlice ||
      slice.projectedBytes >= this.budgets.maxProjectedBytesPerSlice ||
      slice.encodedBytes >= this.budgets.maxEncodedBytesPerSlice ||
      this.timeCeilingReached(slice)
    );
  }

  private timeCeilingReached(slice: SliceCounters): boolean {
    const now = this.input.now();
    return (
      !Number.isFinite(now) ||
      !Number.isFinite(slice.startTime) ||
      now - slice.startTime >= this.budgets.timeBudgetMs
    );
  }

  private canRunSlice(): boolean {
    return (
      this.status === "active" && !this.writePending && !this.closePending
    );
  }

  private abortSinkOnce(reason: unknown): void {
    if (this.sinkAbortStarted) return;
    this.sinkAbortStarted = true;
    try {
      const outcome = this.input.sink.abort(reason);
      if (outcome instanceof Promise) {
        void outcome.catch(() => undefined);
      }
    } catch {
      // Cancellation/projection/write/close failure remains the primary outcome.
    }
  }

  private fail(error: unknown): void {
    if (this.status !== "active") return;
    this.status = "failed";
    this.cancelScheduledContinuation();
    this.abortSinkOnce(error);
    this.input.onError(error);
  }

  private complete(sinkResult: CsvSinkResult): void {
    if (this.status !== "active") return;
    this.status = "completed";
    this.completionFallbackScheduled = false;
    this.cancelScheduledContinuation();
    const completion = {
      sinkResult,
      rowCount: this.emittedRowIndex,
      columnCount: this.input.plannedColumns.length,
    };
    this.commitCompletion(sinkResult);
    this.emitCompletionProgress(sinkResult);
    this.input.onComplete(completion);
  }

  private commitCompletion(sinkResult: CsvSinkResult): void {
    if (this.completionCommitted) return;
    this.completionCommitted = true;
    try {
      this.input.onCommit?.({
        sinkResult,
        rowCount: this.emittedRowIndex,
        columnCount: this.input.plannedColumns.length,
      });
    } catch {
      // Close success is authoritative; internal commit notification is best-effort.
    }
  }

  private enterFinalizingProgress(): void {
    if (this.progressPhase === "finalizing") return;
    this.progressPhase = "finalizing";
    this.maybeReportProgress({ phaseChanged: true });
  }

  private recordAcceptedBytes(byteLength: number): void {
    this.emittedBytes = saturatingAdd(this.emittedBytes, byteLength);
  }

  private resolveActiveTotalRows(): number {
    const known = this.input.rowPlan.knownRowCount;
    return known === undefined ? 0 : known;
  }

  private shouldEmitForElapsed(now: number): boolean {
    const last = this.lastProgressAt;
    if (last === null) return true;
    if (!Number.isFinite(now) || !Number.isFinite(last)) return false;
    if (now < last) return false;
    return now - last >= DEFAULT_CSV_PROGRESS_INTERVAL_MS;
  }

  private maybeReportProgress(options?: { phaseChanged?: boolean }): void {
    const onProgress = this.input.onProgress;
    if (onProgress === undefined || this.status !== "active") return;

    // One clock sample for both eligibility and lastProgressAt stamping.
    const now = this.input.now();
    if (options?.phaseChanged !== true && !this.shouldEmitForElapsed(now)) {
      return;
    }

    const progress: CsvExportProgress = {
      taskId: this.input.taskId,
      phase: this.progressPhase,
      processedRows: this.candidateRowIndex,
      totalRows: this.resolveActiveTotalRows(),
      emittedBytes: this.emittedBytes,
    };
    this.lastProgressAt = now;
    onProgress(progress);
  }

  private emitCompletionProgress(sinkResult: CsvSinkResult): void {
    const onProgress = this.input.onProgress;
    if (onProgress === undefined || this.completionProgressEmitted) return;
    this.completionProgressEmitted = true;
    this.progressPhase = "finalizing";
    const progress: CsvExportProgress = {
      taskId: this.input.taskId,
      phase: "finalizing",
      processedRows: this.candidateRowIndex,
      totalRows: this.candidateRowIndex,
      emittedBytes: sinkResult.byteLength,
    };
    this.lastProgressAt = this.input.now();
    onProgress(progress);
  }
}

/** Schedule a cooperative main-thread CSV export and return its cancel handle. */
export function executeCsvExportMainThread(
  input: CsvExportMainThreadInput,
): CsvExportMainThreadHandle {
  const execution = new CsvMainThreadExecution(input);
  execution.start();
  return execution;
}
