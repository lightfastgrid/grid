/**
 * CSV Export V1 - Worker execution orchestration with cooperative main fallback.
 *
 * Connects the bounded main-thread projection producer to the Worker transport
 * client and one output sink. A restartable Worker/protocol failure may replace
 * a buffered sink (or reuse an untouched stream sink) and starts the existing
 * cooperative main executor from a newly-created row plan. Worker creation,
 * execution-path selection, Grid integration, and public API adaptation remain
 * outside this internal layer.
 */

import type { CsvExportSnapshot } from "../../../features/csv-export/csvExportSnapshot";
import type { CsvExportProgress } from "../../../features/csv-export/csvExportTypes";
import type {
  CsvOutputSink,
  CsvSinkResult,
} from "../../../features/csv-export/csvOutputSink";
import type { NormalizedCsvExportDefaults } from "../../../features/csv-export/normalizeCsvExportOptions";
import type { CsvPlannedColumn } from "../../../features/csv-export/planCsvColumnScope";
import type { CsvGroupHeaderPlan } from "../../../features/csv-export/planCsvGroupHeaders";
import type { CsvRowPlan } from "../../../features/csv-export/planCsvRowScope";
import type { CooperativeScheduler } from "../../../scheduling/CooperativeScheduler";

import type {
  CsvExportMainThreadCompletion,
  CsvExportMainThreadHandle,
} from "./csvExportMainThread";
import { executeCsvExportMainThread } from "./csvExportMainThread";
import type {
  CsvExportProjectionCompletion,
  CsvExportProjectionProducerHandle,
  CsvExportProjectionRuntime,
} from "./csvExportProjectionProducer";
import { createCsvExportProjectionProducer } from "./csvExportProjectionProducer";
import type {
  CsvCompleteResponse,
  CsvWorkerEncodingOptions,
} from "./csvExportProtocol";
import type {
  CsvExportWorkerClient,
  CsvExportWorkerFailure,
  CsvExportWorkerOutputType,
  CsvExportWorkerTaskHandle,
} from "./csvExportWorkerClient";

export interface CsvExportWorkerExecutionCompletion {
  sinkResult: CsvSinkResult;
  /** Exported data rows only; headers and custom content are excluded. */
  rowCount: number;
  columnCount: number;
}

export interface CsvExportWorkerExecutionInput {
  snapshot: CsvExportSnapshot;
  createRowPlan: () => CsvRowPlan;
  plannedColumns: readonly CsvPlannedColumn[];
  groupHeaderPlan: CsvGroupHeaderPlan;
  normalized: NormalizedCsvExportDefaults;
  runtime: CsvExportProjectionRuntime;
  scheduler: CooperativeScheduler;
  now: () => number;
  workerClient: CsvExportWorkerClient;
  taskId: number;
  outputType: CsvExportWorkerOutputType;
  sink: CsvOutputSink;
  createFreshSink: () => CsvOutputSink;
  onProgress?: (progress: CsvExportProgress) => void;
  onWorkerClientUnusable?: (failure: CsvExportWorkerFailure) => void;
  onCommit?: (result: CsvExportWorkerExecutionCompletion) => void;
  onComplete: (result: CsvExportWorkerExecutionCompletion) => void;
  onCancelled: (reason: unknown) => void;
  onError: (error: unknown) => void;
}

export interface CsvExportWorkerExecutionHandle {
  cancel(reason: unknown): void;
}

type WorkerExecutionState =
  | "startingWorker"
  | "waitingForReady"
  | "workerProjecting"
  | "startingFallback"
  | "mainFallback"
  | "closing"
  | "cancelled"
  | "failed"
  | "completed";

interface SinkOwnership {
  sink: CsvOutputSink;
  abortStarted: boolean;
}

interface ScheduledToken {
  handle: { cancel(): void } | null;
}

interface PendingWorkerCloseSuccess {
  ownership: SinkOwnership;
  producerCompletion: CsvExportProjectionCompletion;
  sinkResult: CsvSinkResult;
}

const INACTIVE_WORKER_TASK: CsvExportWorkerTaskHandle = {
  postChunk: () => false,
  cancel() {},
};

function workerEncoding(
  normalized: NormalizedCsvExportDefaults,
): CsvWorkerEncodingOptions {
  return {
    delimiter: normalized.delimiter,
    quoteMode: normalized.quoteMode,
    lineEnding: normalized.lineEnding,
    utf8Bom: normalized.utf8Bom,
    formulaProtection: normalized.formulaProtection,
  };
}

function observeAbort(outcome: Promise<void> | void): void {
  if (outcome instanceof Promise) void outcome.catch(() => undefined);
}

class CsvExportWorkerExecution implements CsvExportWorkerExecutionHandle {
  private state: WorkerExecutionState = "startingWorker";
  private sinkOwnership: SinkOwnership;
  private workerTask: CsvExportWorkerTaskHandle = INACTIVE_WORKER_TASK;
  private workerStartPending = false;
  private readyReceivedDuringStart = false;
  private producer: CsvExportProjectionProducerHandle | null = null;
  private mainFallback: CsvExportMainThreadHandle | null = null;
  private fallbackStarted = false;
  private workerClientUnusableReported = false;
  private producerCompletion: CsvExportProjectionCompletion | null = null;
  private workerCompletion: CsvCompleteResponse | null = null;
  private pendingWorkerCloseSuccess: PendingWorkerCloseSuccess | null = null;
  private closePublishScheduled: ScheduledToken | null = null;
  private closePublishFallbackScheduled = false;
  private completionProgressEmitted = false;
  private completionCommitted = false;

  constructor(private readonly input: CsvExportWorkerExecutionInput) {
    this.sinkOwnership = { sink: input.sink, abortStarted: false };
  }

  start(): void {
    if (this.state !== "startingWorker") return;
    this.workerStartPending = true;
    const task = this.input.workerClient.start({
      taskId: this.input.taskId,
      plannedColumnCount: this.input.plannedColumns.length,
      encoding: workerEncoding(this.input.normalized),
      outputType: this.input.outputType,
      callbacks: {
        acceptBytes: (bytes) => this.acceptWorkerBytes(bytes),
        onReady: () => this.handleWorkerReady(),
        onChunkAccepted: ({ sequence, final }) =>
          this.handleWorkerChunkAccepted(sequence, final),
        onComplete: (result) => this.handleWorkerComplete(result),
        onFailure: (failure) => this.handleWorkerFailure(failure),
        onCancelled: () => this.handleWorkerCancelled(),
      },
    });
    this.workerStartPending = false;

    if (!this.isAwaitingWorkerReady()) {
      task.cancel();
      return;
    }

    this.workerTask = task;
    this.state = "waitingForReady";
    if (this.readyReceivedDuringStart) {
      this.readyReceivedDuringStart = false;
      this.startProjectionProducer();
    }
  }

  cancel(reason: unknown): void {
    if (this.isTerminal()) return;
    if (this.completionCommitted || this.pendingWorkerCloseSuccess !== null) return;
    const state = this.state;
    this.state = "cancelled";

    this.producer?.cancel(reason);
    this.workerTask.cancel();
    if (state === "mainFallback") {
      void this.abortSinkOnce(this.sinkOwnership, reason);
      this.mainFallback?.cancel(reason);
    } else {
      void this.abortSinkOnce(this.sinkOwnership, reason);
    }

    this.releaseExecutionState();
    this.input.onCancelled(reason);
  }

  private acceptWorkerBytes(
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<void> | void {
    if (this.state !== "workerProjecting") return;
    return this.sinkOwnership.sink.write(bytes);
  }

  private handleWorkerReady(): void {
    if (this.state !== "startingWorker" && this.state !== "waitingForReady") {
      return;
    }
    if (this.workerStartPending) {
      this.readyReceivedDuringStart = true;
      return;
    }
    this.startProjectionProducer();
  }

  private startProjectionProducer(): void {
    if (this.state !== "waitingForReady") return;
    this.state = "workerProjecting";

    let rowPlan: CsvRowPlan;
    try {
      rowPlan = this.input.createRowPlan();
      const producer = createCsvExportProjectionProducer({
        snapshot: this.input.snapshot,
        rowPlan,
        plannedColumns: this.input.plannedColumns,
        groupHeaderPlan: this.input.groupHeaderPlan,
        normalized: this.input.normalized,
        runtime: this.input.runtime,
        scheduler: this.input.scheduler,
        now: this.input.now,
        taskId: this.input.taskId,
        onChunk: (chunk) => this.workerTask.postChunk(chunk),
        onProjectionComplete: (result) =>
          this.handleProjectionComplete(result),
        onCancelled: (reason) => this.handleProducerCancelled(reason),
        onError: (error) => this.handleProducerError(error),
      });
      this.producer = producer;
      producer.start();
    } catch (error) {
      this.failWorkerPath(error);
    }
  }

  private handleWorkerChunkAccepted(sequence: number, final: boolean): void {
    if (this.state !== "workerProjecting") return;
    this.producer?.acknowledgeChunk(sequence, final);
  }

  private handleProjectionComplete(
    result: CsvExportProjectionCompletion,
  ): void {
    if (this.state !== "workerProjecting") return;
    this.producerCompletion = result;
    this.tryCloseWorkerSink();
  }

  private handleWorkerComplete(result: CsvCompleteResponse): void {
    if (this.state !== "workerProjecting") return;
    this.workerCompletion = result;
    this.tryCloseWorkerSink();
  }

  private tryCloseWorkerSink(): void {
    if (
      this.state !== "workerProjecting" ||
      this.producerCompletion === null ||
      this.workerCompletion === null
    ) {
      return;
    }

    const producerCompletion = this.producerCompletion;
    const workerCompletion = this.workerCompletion;
    const ownership = this.sinkOwnership;
    this.state = "closing";
    this.producer = null;
    this.workerTask = INACTIVE_WORKER_TASK;
    this.producerCompletion = null;
    this.workerCompletion = null;
    this.emitWorkerFinalizingProgress(producerCompletion, workerCompletion);
    if (!this.ownsClosing(ownership)) return;

    let closeResult: Promise<CsvSinkResult> | CsvSinkResult;
    try {
      closeResult = ownership.sink.close();
    } catch (error) {
      this.failClosing(ownership, error);
      return;
    }

    if (!this.ownsClosing(ownership)) return;
    if (closeResult instanceof Promise) {
      void closeResult.then(
        (result) => this.recordWorkerCloseSuccess(ownership, producerCompletion, result),
        (error: unknown) => this.failClosing(ownership, error),
      );
      return;
    }
    this.recordWorkerCloseSuccess(ownership, producerCompletion, closeResult);
  }

  private recordWorkerCloseSuccess(
    ownership: SinkOwnership,
    producerCompletion: CsvExportProjectionCompletion,
    sinkResult: CsvSinkResult,
  ): void {
    if (this.state !== "closing" || this.sinkOwnership !== ownership) return;
    this.pendingWorkerCloseSuccess = {
      ownership,
      producerCompletion,
      sinkResult,
    };
    this.commitWorkerCloseSuccess(producerCompletion, sinkResult);
    this.scheduleClosePublication();
  }

  private scheduleClosePublication(): void {
    if (
      this.state !== "closing" ||
      this.closePublishScheduled !== null ||
      this.pendingWorkerCloseSuccess === null
    ) {
      return;
    }
    const token: ScheduledToken = { handle: null };
    this.closePublishScheduled = token;
    try {
      token.handle = this.input.scheduler.schedule(
        () => {
          if (this.closePublishScheduled !== token) return;
          this.closePublishScheduled = null;
          this.publishWorkerCloseSuccess();
        },
        { priority: "user-visible" },
      );
    } catch {
      if (this.closePublishScheduled === token) {
        this.closePublishScheduled = null;
      }
      this.scheduleClosePublicationFallback();
    }
  }

  private scheduleClosePublicationFallback(): void {
    if (this.closePublishFallbackScheduled) return;
    this.closePublishFallbackScheduled = true;
    queueMicrotask(() => {
      if (!this.closePublishFallbackScheduled) return;
      this.closePublishFallbackScheduled = false;
      this.publishWorkerCloseSuccess();
    });
  }

  private publishWorkerCloseSuccess(): void {
    const pending = this.pendingWorkerCloseSuccess;
    if (
      pending === null ||
      this.state !== "closing" ||
      this.sinkOwnership !== pending.ownership
    ) {
      return;
    }
    this.pendingWorkerCloseSuccess = null;
    this.state = "completed";
    const completion = {
      sinkResult: pending.sinkResult,
      rowCount: pending.producerCompletion.exportedRowCount,
      columnCount: pending.producerCompletion.columnCount,
    };
    this.commitWorkerCloseSuccess(
      pending.producerCompletion,
      pending.sinkResult,
    );
    this.emitWorkerCompletionProgress(
      pending.producerCompletion,
      pending.sinkResult,
    );
    this.input.onComplete(completion);
  }

  private commitWorkerCloseSuccess(
    producerCompletion: CsvExportProjectionCompletion,
    sinkResult: CsvSinkResult,
  ): void {
    if (this.completionCommitted) return;
    this.completionCommitted = true;
    try {
      this.input.onCommit?.({
        sinkResult,
        rowCount: producerCompletion.exportedRowCount,
        columnCount: producerCompletion.columnCount,
      });
    } catch {
      // Close success is authoritative; internal commit notification is best-effort.
    }
  }

  private handleWorkerFailure(failure: CsvExportWorkerFailure): void {
    if (!this.isWorkerOwned()) return;
    this.reportWorkerClientUnusable(failure);
    if (!this.isWorkerOwned()) return;
    if (failure.kind === "sink" || !failure.canRestartOnMain) {
      this.failWorkerPath(failure.error);
      return;
    }
    this.startMainFallback(failure.error);
  }

  private reportWorkerClientUnusable(failure: CsvExportWorkerFailure): void {
    if (
      failure.kind === "sink" ||
      this.workerClientUnusableReported ||
      this.input.onWorkerClientUnusable === undefined
    ) {
      return;
    }
    this.workerClientUnusableReported = true;
    try {
      this.input.onWorkerClientUnusable(failure);
    } catch {
      // Invalidation is secondary; preserve failure/fallback ownership.
    }
  }

  private startMainFallback(workerError: Error): void {
    if (!this.isWorkerOwned() || this.fallbackStarted) return;
    this.fallbackStarted = true;
    this.state = "startingFallback";
    this.producer?.cancel(workerError);
    this.producer = null;
    this.workerTask.cancel();
    this.workerTask = INACTIVE_WORKER_TASK;
    this.producerCompletion = null;
    this.workerCompletion = null;

    if (this.input.outputType !== "stream") {
      const previousOwnership = this.sinkOwnership;
      void this.abortSinkOnce(previousOwnership, workerError);
      let freshSink: CsvOutputSink;
      try {
        freshSink = this.input.createFreshSink();
      } catch (error) {
        this.failFallbackSetup(error);
        return;
      }
      if (!this.isStartingFallback()) {
        this.abortUnownedSink(freshSink, workerError);
        return;
      }
      this.sinkOwnership = { sink: freshSink, abortStarted: false };
    }

    let rowPlan: CsvRowPlan;
    try {
      rowPlan = this.input.createRowPlan();
    } catch (error) {
      this.failFallbackSetup(error);
      return;
    }
    if (!this.isStartingFallback()) return;

    this.state = "mainFallback";
    const ownership = this.sinkOwnership;
    const sinkView = this.createSinkView(ownership);
    let main: CsvExportMainThreadHandle;
    try {
      main = executeCsvExportMainThread({
        snapshot: this.input.snapshot,
        rowPlan,
        plannedColumns: this.input.plannedColumns,
        groupHeaderPlan: this.input.groupHeaderPlan,
        normalized: this.input.normalized,
        runtime: this.input.runtime,
        sink: sinkView,
        scheduler: this.input.scheduler,
        now: this.input.now,
        taskId: this.input.taskId,
        onProgress: this.input.onProgress,
        onCommit: (result) => this.handleMainCommit(ownership, result),
        onComplete: (result) => this.handleMainComplete(ownership, result),
        onCancelled: (reason) => this.handleMainCancelled(ownership, reason),
        onError: (error) => this.handleMainError(ownership, error),
      });
    } catch (error) {
      this.failMainStart(ownership, error);
      return;
    }

    if (this.ownsMainFallback(ownership)) {
      this.mainFallback = main;
    } else {
      main.cancel(workerError);
    }
  }

  private createSinkView(ownership: SinkOwnership): CsvOutputSink {
    return {
      write: (chunk) => ownership.sink.write(chunk),
      close: () => ownership.sink.close(),
      abort: (reason) => this.abortSinkOnce(ownership, reason),
    };
  }

  private handleMainComplete(
    ownership: SinkOwnership,
    result: CsvExportMainThreadCompletion,
  ): void {
    if (this.state !== "mainFallback" || this.sinkOwnership !== ownership) {
      return;
    }
    this.state = "completed";
    this.mainFallback = null;
    this.input.onComplete(result);
  }

  private handleMainCommit(
    ownership: SinkOwnership,
    result: CsvExportMainThreadCompletion,
  ): void {
    if (this.state !== "mainFallback" || this.sinkOwnership !== ownership) {
      return;
    }
    this.completionCommitted = true;
    this.mainFallback = null;
    this.input.onCommit?.(result);
  }

  private handleMainCancelled(
    ownership: SinkOwnership,
    reason: unknown,
  ): void {
    if (this.state !== "mainFallback" || this.sinkOwnership !== ownership) {
      return;
    }
    if (this.completionCommitted) return;
    this.state = "cancelled";
    this.mainFallback = null;
    this.input.onCancelled(reason);
  }

  private handleMainError(ownership: SinkOwnership, error: unknown): void {
    if (this.state !== "mainFallback" || this.sinkOwnership !== ownership) {
      return;
    }
    if (this.completionCommitted) return;
    this.state = "failed";
    this.mainFallback = null;
    this.input.onError(error);
  }

  private handleWorkerCancelled(): void {
    if (!this.isWorkerOwned()) return;
    const reason = new Error("CSV Worker task cancelled");
    this.state = "cancelled";
    this.producer?.cancel(reason);
    void this.abortSinkOnce(this.sinkOwnership, reason);
    this.releaseExecutionState();
    this.input.onCancelled(reason);
  }

  private handleProducerCancelled(reason: unknown): void {
    if (this.state !== "workerProjecting") return;
    this.state = "cancelled";
    this.workerTask.cancel();
    void this.abortSinkOnce(this.sinkOwnership, reason);
    this.releaseExecutionState();
    this.input.onCancelled(reason);
  }

  private handleProducerError(error: unknown): void {
    if (this.state !== "workerProjecting") return;
    this.failWorkerPath(error);
  }

  private failWorkerPath(error: unknown): void {
    if (!this.isWorkerOwned()) return;
    this.state = "failed";
    this.producer?.cancel(error);
    this.workerTask.cancel();
    void this.abortSinkOnce(this.sinkOwnership, error);
    this.releaseExecutionState();
    this.input.onError(error);
  }

  private failFallbackSetup(error: unknown): void {
    if (this.state !== "startingFallback") return;
    this.state = "failed";
    void this.abortSinkOnce(this.sinkOwnership, error);
    this.releaseExecutionState();
    this.input.onError(error);
  }

  private failClosing(ownership: SinkOwnership, error: unknown): void {
    if (this.state !== "closing" || this.sinkOwnership !== ownership) return;
    this.state = "failed";
    this.cancelClosePublication();
    this.pendingWorkerCloseSuccess = null;
    void this.abortSinkOnce(ownership, error);
    this.input.onError(error);
  }

  private failMainStart(ownership: SinkOwnership, error: unknown): void {
    if (!this.ownsMainFallback(ownership)) return;
    this.state = "failed";
    void this.abortSinkOnce(ownership, error);
    this.releaseExecutionState();
    this.input.onError(error);
  }

  private abortSinkOnce(
    ownership: SinkOwnership,
    reason: unknown,
  ): Promise<void> | void {
    if (ownership.abortStarted) return;
    ownership.abortStarted = true;
    try {
      const outcome = ownership.sink.abort(reason);
      observeAbort(outcome);
      return outcome;
    } catch {
      // The cancellation/Worker/projection/sink failure remains primary.
    }
  }

  private abortUnownedSink(sink: CsvOutputSink, reason: unknown): void {
    try {
      observeAbort(sink.abort(reason));
    } catch {
      // The already-owned cancellation remains primary.
    }
  }

  private releaseExecutionState(): void {
    this.producer = null;
    this.mainFallback = null;
    this.workerTask = INACTIVE_WORKER_TASK;
    this.producerCompletion = null;
    this.workerCompletion = null;
    this.pendingWorkerCloseSuccess = null;
    this.cancelClosePublication();
  }

  private cancelClosePublication(): void {
    const scheduled = this.closePublishScheduled;
    this.closePublishScheduled = null;
    this.closePublishFallbackScheduled = false;
    scheduled?.handle?.cancel();
  }

  private emitWorkerFinalizingProgress(
    producerCompletion: CsvExportProjectionCompletion,
    workerCompletion: CsvCompleteResponse,
  ): void {
    this.input.onProgress?.({
      taskId: this.input.taskId,
      phase: "finalizing",
      processedRows: producerCompletion.candidateRowCount,
      totalRows: producerCompletion.candidateRowCount,
      emittedBytes: workerCompletion.byteLength,
    });
  }

  private emitWorkerCompletionProgress(
    producerCompletion: CsvExportProjectionCompletion,
    sinkResult: CsvSinkResult,
  ): void {
    if (this.completionProgressEmitted) return;
    this.completionProgressEmitted = true;
    this.input.onProgress?.({
      taskId: this.input.taskId,
      phase: "finalizing",
      processedRows: producerCompletion.candidateRowCount,
      totalRows: producerCompletion.candidateRowCount,
      emittedBytes: sinkResult.byteLength,
    });
  }

  private isWorkerOwned(): boolean {
    return (
      this.state === "startingWorker" ||
      this.state === "waitingForReady" ||
      this.state === "workerProjecting"
    );
  }

  private isAwaitingWorkerReady(): boolean {
    return (
      this.state === "startingWorker" || this.state === "waitingForReady"
    );
  }

  private isStartingFallback(): boolean {
    return this.state === "startingFallback";
  }

  private ownsMainFallback(ownership: SinkOwnership): boolean {
    return this.state === "mainFallback" && this.sinkOwnership === ownership;
  }

  private ownsClosing(ownership: SinkOwnership): boolean {
    return this.state === "closing" && this.sinkOwnership === ownership;
  }

  private isTerminal(): boolean {
    return (
      this.state === "cancelled" ||
      this.state === "failed" ||
      this.state === "completed"
    );
  }
}

/** Start one Worker-assisted CSV execution with at most one main fallback. */
export function executeCsvExportWorker(
  input: CsvExportWorkerExecutionInput,
): CsvExportWorkerExecutionHandle {
  const execution = new CsvExportWorkerExecution(input);
  execution.start();
  return execution;
}
