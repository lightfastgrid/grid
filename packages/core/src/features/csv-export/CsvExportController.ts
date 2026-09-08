/**
 * Feature-owned CSV export task controller.
 *
 * The public call performs bounded option work and schedules one bootstrap.
 * Snapshot capture, planning, sink creation, and operation execution begin only
 * from that user-visible continuation. The headless CSV feature owns Grid
 * registration without moving controller policy into Grid or the renderer.
 */

import {
  type CsvExportOperationCompletion,
  type CsvExportOperationHandle,
  executeCsvExportOperation,
} from "../../execution/operations/csv-export/csvExportOperation";
import type { CsvExportProjectionRuntime } from "../../execution/operations/csv-export/csvExportProjectionProducer";
import type { CsvExportWorkerClientOwner } from "../../execution/operations/csv-export/csvExportWorkerClientOwner";
import type {
  CooperativeHandle,
  CooperativeScheduler,
} from "../../scheduling/CooperativeScheduler";

import { createCsvOutputSink } from "./createCsvOutputSink";
import {
  CsvExportCancelledError,
  CsvExportDisabledError,
  CsvExportInvalidOptionsError,
} from "./csvExportErrors";
import type { CsvExportSnapshot } from "./csvExportSnapshot";
import type {
  CsvExportCapability,
  CsvExportDefaults,
  CsvExportParams,
  CsvExportProgress,
  CsvExportResult,
  CsvExportTask,
  CsvOutputTarget,
} from "./csvExportTypes";
import type { CsvOutputSink } from "./csvOutputSink";
import {
  normalizeCsvExportOptions,
  type NormalizedCsvExportDefaults,
  resolveMaxOutputBytes,
} from "./normalizeCsvExportOptions";
import { planCsvColumnScope } from "./planCsvColumnScope";
import { planCsvGroupHeaders } from "./planCsvGroupHeaders";
import { planCsvRowScope } from "./planCsvRowScope";

export interface CsvExportOutputSinkFactory {
  (
    target: CsvOutputTarget,
    options: { maxOutputBytes: number; fileName: string },
  ): CsvOutputSink;
}

export interface CsvExportControllerDependencies {
  getConfig(): boolean | CsvExportDefaults | undefined;
  captureSnapshot(): CsvExportSnapshot;
  scheduler: CooperativeScheduler;
  workerClientOwner: CsvExportWorkerClientOwner;
  getSelectedCellThreshold(): number | undefined;
  now(): number;
  createOutputSink?: CsvExportOutputSinkFactory;
  onProgress?: (progress: CsvExportProgress) => void;
  onCompleted?: (result: CsvExportResult) => void;
  onCancelled?: (event: { taskId: number }) => void;
  onError?: (event: { taskId: number; error: unknown }) => void;
}

type ControllerTaskState =
  | "scheduled"
  | "bootstrapping"
  | "running"
  | "committed"
  | "completed"
  | "cancelled"
  | "failed";

interface ScheduledBootstrap {
  handle: CooperativeHandle | null;
}

interface ControllerTask {
  readonly id: number;
  readonly token: object;
  readonly normalized: NormalizedCsvExportDefaults;
  readonly output: CsvOutputTarget;
  readonly runtime: CsvExportProjectionRuntime;
  readonly onProgress: ((progress: CsvExportProgress) => void) | undefined;
  readonly signal: AbortSignal | undefined;
  readonly promise: Promise<CsvExportResult>;
  readonly resolve: (result: CsvExportResult) => void;
  readonly reject: (error: unknown) => void;
  state: ControllerTaskState;
  bootstrap: ScheduledBootstrap | null;
  operation: CsvExportOperationHandle | null;
  removeAbortListener: (() => void) | null;
  terminalPublished: boolean;
  completionCommitted: boolean;
  startedAt: number;
}

const DEFAULT_OUTPUT: CsvOutputTarget = { type: "download" };

function safeNotify<T>(observer: ((value: T) => void) | undefined, value: T): void {
  if (observer === undefined) return;
  try {
    observer(value);
  } catch {
    // Observer failure never replaces task ownership or its primary outcome.
  }
}

function defaultsFromConfig(
  config: boolean | CsvExportDefaults | undefined,
): CsvExportDefaults {
  return config === undefined || config === true || config === false
    ? {}
    : config;
}

function isConfigDisabled(
  config: boolean | CsvExportDefaults | undefined,
): boolean {
  return config === false || (typeof config === "object" && config.enabled === false);
}

function mergeCsvDefaults(
  config: boolean | CsvExportDefaults | undefined,
  params: CsvExportParams | undefined,
): CsvExportDefaults {
  const base = defaultsFromConfig(config);
  const call = params ?? {};
  return {
    enabled: isConfigDisabled(config)
      ? false
      : call.enabled ?? base.enabled,
    fileName: call.fileName ?? base.fileName,
    rows: call.rows ?? base.rows,
    columns: call.columns ?? base.columns,
    includeColumnHeaders:
      call.includeColumnHeaders ?? base.includeColumnHeaders,
    includeColumnGroupHeaders:
      call.includeColumnGroupHeaders ?? base.includeColumnGroupHeaders,
    includePinnedTopRows:
      call.includePinnedTopRows ?? base.includePinnedTopRows,
    includePinnedBottomRows:
      call.includePinnedBottomRows ?? base.includePinnedBottomRows,
    includeInternalColumns:
      call.includeInternalColumns ?? base.includeInternalColumns,
    includeUtilityColumns:
      call.includeUtilityColumns ?? base.includeUtilityColumns,
    includeRowNumbers: call.includeRowNumbers ?? base.includeRowNumbers,
    useValueFormatter: call.useValueFormatter ?? base.useValueFormatter,
    delimiter: call.delimiter ?? base.delimiter,
    quoteMode: call.quoteMode ?? base.quoteMode,
    lineEnding: call.lineEnding ?? base.lineEnding,
    utf8Bom: call.utf8Bom ?? base.utf8Bom,
    formulaProtection:
      call.formulaProtection ?? base.formulaProtection,
    maxOutputBytes: call.maxOutputBytes ?? base.maxOutputBytes,
  };
}

function projectionRuntime(params: CsvExportParams | undefined): CsvExportProjectionRuntime {
  return {
    prependContent: params?.prependContent,
    appendContent: params?.appendContent,
    shouldExportRow: params?.shouldExportRow,
    processCell: params?.processCell,
    processHeader: params?.processHeader,
    processGroupHeader: params?.processGroupHeader,
  };
}

function cancellationError(
  reason: unknown,
  message = "CSV export was cancelled.",
): CsvExportCancelledError {
  return reason instanceof CsvExportCancelledError
    ? reason
    : new CsvExportCancelledError(message, { cause: reason });
}

function elapsedDuration(now: number, startedAt: number): number {
  const elapsed = now - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

/** Internal Stage 5B controller; intentionally absent from public barrels. */
export class CsvExportController implements CsvExportCapability {
  private active: ControllerTask | null = null;
  private nextTaskId: number | null = 0;
  private destroyed = false;
  private workerOwnerDestroyed = false;

  constructor(private readonly deps: CsvExportControllerDependencies) {}

  exportDataAsCsv(params?: CsvExportParams): CsvExportTask {
    return this.startTask(params, params?.output ?? DEFAULT_OUTPUT);
  }

  getDataAsCsv(params?: Omit<CsvExportParams, "output">): Promise<string> {
    const task = this.startTask(
      params === undefined ? undefined : { ...params },
      { type: "text" },
    );
    return task.promise.then((result) => result.text ?? "");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const active = this.active;
    if (active !== null) {
      this.cancelTask(
        active,
        new CsvExportCancelledError("CSV export cancelled by controller destroy."),
      );
    }
    if (!this.workerOwnerDestroyed) {
      this.workerOwnerDestroyed = true;
      this.deps.workerClientOwner.destroy();
    }
  }

  private startTask(
    params: CsvExportParams | undefined,
    output: CsvOutputTarget,
  ): CsvExportTask {
    const normalized = normalizeCsvExportOptions(
      mergeCsvDefaults(this.deps.getConfig(), params),
    );
    const id = this.allocateTaskId();
    const task = this.createTask(id, normalized, output, params);

    if (this.destroyed || !normalized.enabled) {
      const error = new CsvExportDisabledError(
        this.destroyed
          ? "CSV export controller is destroyed."
          : "CSV export is disabled.",
      );
      this.failTaskDeferred(task, error);
      return this.publicHandle(task);
    }

    if (task.signal?.aborted === true) {
      this.cancelTask(
        task,
        cancellationError(
          task.signal.reason,
          "CSV export was cancelled by an already-aborted signal.",
        ),
      );
      return this.publicHandle(task);
    }

    const previous = this.active;
    if (previous !== null) {
      this.cancelTask(
        previous,
        new CsvExportCancelledError(
          "CSV export was cancelled by a replacement task.",
        ),
      );
    }
    this.active = task;

    this.attachAbortSignal(task);
    this.scheduleBootstrap(task);
    return this.publicHandle(task);
  }

  private allocateTaskId(): number {
    const id = this.nextTaskId;
    if (id === null) {
      throw new CsvExportInvalidOptionsError(
        "CSV export task id space is exhausted for this controller.",
      );
    }
    this.nextTaskId =
      id === Number.MAX_SAFE_INTEGER ? null : id + 1;
    return id;
  }

  private createTask(
    id: number,
    normalized: NormalizedCsvExportDefaults,
    output: CsvOutputTarget,
    params: CsvExportParams | undefined,
  ): ControllerTask {
    let resolve!: (result: CsvExportResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<CsvExportResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return {
      id,
      token: {},
      normalized,
      output,
      runtime: projectionRuntime(params),
      onProgress: params?.onProgress,
      signal: params?.signal,
      promise,
      resolve,
      reject,
      state: "scheduled",
      bootstrap: null,
      operation: null,
      removeAbortListener: null,
      terminalPublished: false,
      completionCommitted: false,
      startedAt: 0,
    };
  }

  private publicHandle(task: ControllerTask): CsvExportTask {
    return {
      id: task.id,
      promise: task.promise,
      cancel: () => {
        this.cancelTask(task, new CsvExportCancelledError());
      },
    };
  }

  private attachAbortSignal(task: ControllerTask): void {
    const signal = task.signal;
    if (signal === undefined) return;
    const onAbort = (): void => {
      this.cancelTask(
        task,
        cancellationError(signal.reason, "CSV export was cancelled by AbortSignal."),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    task.removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  }

  private scheduleBootstrap(task: ControllerTask): void {
    const scheduled: ScheduledBootstrap = { handle: null };
    task.bootstrap = scheduled;
    try {
      scheduled.handle = this.deps.scheduler.schedule(
        () => {
          if (task.bootstrap !== scheduled || !this.owns(task, "scheduled")) {
            return;
          }
          task.bootstrap = null;
          this.bootstrap(task);
        },
        { priority: "user-visible" },
      );
    } catch (error) {
      if (task.bootstrap === scheduled) task.bootstrap = null;
      this.failTaskDeferred(task, error);
    }
  }

  private bootstrap(task: ControllerTask): void {
    if (!this.owns(task, "scheduled")) return;
    task.state = "bootstrapping";
    task.startedAt = this.deps.now();

    let sink: CsvOutputSink | null = null;
    try {
      const snapshot = this.deps.captureSnapshot();
      if (!this.owns(task, "bootstrapping")) return;
      this.emitProgress(task, {
        taskId: task.id,
        phase: "planning",
        processedRows: 0,
        totalRows: 0,
        emittedBytes: 0,
      });
      if (!this.owns(task, "bootstrapping")) return;
      const plannedColumns = planCsvColumnScope(
        snapshot,
        task.normalized.columns,
        task.normalized,
      );
      const groupHeaderPlan = planCsvGroupHeaders(
        snapshot,
        plannedColumns,
        task.normalized.includeColumnGroupHeaders,
      );
      const createRowPlan = () =>
        planCsvRowScope(snapshot, task.normalized.rows, {
          includePinnedTopRows: task.normalized.includePinnedTopRows,
          includePinnedBottomRows: task.normalized.includePinnedBottomRows,
        });
      const sinkOptions = {
        maxOutputBytes: resolveMaxOutputBytes(
          task.normalized.maxOutputBytes,
          task.output.type,
        ),
        fileName: task.normalized.fileName,
      };
      const sinkFactory = this.deps.createOutputSink ?? createCsvOutputSink;
      const createFreshSink = (): CsvOutputSink =>
        sinkFactory(task.output, sinkOptions);
      sink = createFreshSink();
      if (!this.owns(task, "bootstrapping")) {
        this.abortSinkQuietly(sink, new CsvExportCancelledError());
        return;
      }

      task.state = "running";
      const operation = executeCsvExportOperation({
        snapshot,
        createRowPlan,
        rowCountUpperBound: snapshot.fullView.rowCount,
        plannedColumns,
        groupHeaderPlan,
        normalized: task.normalized,
        runtime: task.runtime,
        outputType: task.output.type,
        sink,
        createFreshSink,
        scheduler: this.deps.scheduler,
        now: () => this.deps.now(),
        workerClientOwner: this.deps.workerClientOwner,
        workerAllowed: true,
        selectedCellThreshold: this.deps.getSelectedCellThreshold(),
        taskId: task.id,
        onProgress: (progress) => this.handleOperationProgress(task, progress),
        onCommit: (result) => this.commitTask(task, result),
        onComplete: (result) => this.completeTask(task, result),
        onCancelled: (reason) => this.handleOperationCancelled(task, reason),
        onError: (error) => this.failTask(task, error),
      });
      if (this.owns(task, "running")) {
        task.operation = operation;
      } else {
        operation.cancel(
          new CsvExportCancelledError("CSV operation ownership was superseded."),
        );
      }
    } catch (error) {
      if (sink !== null) this.abortSinkQuietly(sink, error);
      this.failTask(task, error);
    }
  }

  private handleOperationProgress(
    task: ControllerTask,
    progress: CsvExportProgress,
  ): void {
    if (!this.owns(task, "running") && !this.owns(task, "committed")) return;
    this.emitProgress(task, progress);
  }

  private emitProgress(task: ControllerTask, progress: CsvExportProgress): void {
    if (
      !task.completionCommitted &&
      (this.active !== task || task.token !== this.active.token)
    ) {
      return;
    }
    safeNotify(task.onProgress, progress);
    safeNotify(this.deps.onProgress, progress);
  }

  private commitTask(
    task: ControllerTask,
    _completion: CsvExportOperationCompletion,
  ): void {
    if (!this.owns(task, "running")) return;
    task.completionCommitted = true;
    task.state = "committed";
    task.operation = null;
    task.removeAbortListener?.();
    task.removeAbortListener = null;
  }

  private completeTask(
    task: ControllerTask,
    completion: CsvExportOperationCompletion,
  ): void {
    if (!this.owns(task, "running") && !task.completionCommitted) return;
    task.state = "completed";
    task.operation = null;
    this.releaseTask(task);
    const sinkResult = completion.sinkResult;
    const result: CsvExportResult = {
      taskId: task.id,
      outputType: sinkResult.outputType,
      rowCount: completion.rowCount,
      columnCount: completion.columnCount,
      byteLength: sinkResult.byteLength,
      durationMs: elapsedDuration(this.deps.now(), task.startedAt),
      fileName: sinkResult.fileName,
      text: sinkResult.text,
      blob: sinkResult.blob,
    };
    if (task.terminalPublished) return;
    task.terminalPublished = true;
    safeNotify(this.deps.onCompleted, result);
    task.resolve(result);
  }

  private handleOperationCancelled(task: ControllerTask, reason: unknown): void {
    if (!this.owns(task, "running")) return;
    this.cancelTask(task, cancellationError(reason));
  }

  private cancelTask(task: ControllerTask, reason: unknown): void {
    if (task.completionCommitted) return;
    if (
      task.state === "completed" ||
      task.state === "cancelled" ||
      task.state === "failed"
    ) {
      return;
    }
    task.state = "cancelled";
    const error = cancellationError(reason);
    const bootstrap = task.bootstrap;
    task.bootstrap = null;
    bootstrap?.handle?.cancel();
    const operation = task.operation;
    task.operation = null;
    operation?.cancel(error);
    this.releaseTask(task);
    queueMicrotask(() => this.publishCancellation(task, error));
  }

  private publishCancellation(
    task: ControllerTask,
    error: CsvExportCancelledError,
  ): void {
    if (task.terminalPublished) return;
    task.terminalPublished = true;
    safeNotify(this.deps.onCancelled, { taskId: task.id });
    task.reject(error);
  }

  private failTaskDeferred(task: ControllerTask, error: unknown): void {
    if (
      task.state === "completed" ||
      task.state === "cancelled" ||
      task.state === "failed"
    ) {
      return;
    }
    task.state = "failed";
    const bootstrap = task.bootstrap;
    task.bootstrap = null;
    bootstrap?.handle?.cancel();
    this.releaseTask(task);
    queueMicrotask(() => this.publishFailure(task, error));
  }

  private failTask(task: ControllerTask, error: unknown): void {
    if (!this.owns(task, "bootstrapping") && !this.owns(task, "running")) {
      return;
    }
    task.state = "failed";
    task.operation = null;
    this.releaseTask(task);
    this.publishFailure(task, error);
  }

  private publishFailure(task: ControllerTask, error: unknown): void {
    if (task.terminalPublished) return;
    task.terminalPublished = true;
    safeNotify(this.deps.onError, { taskId: task.id, error });
    task.reject(error);
  }

  private releaseTask(task: ControllerTask): void {
    task.removeAbortListener?.();
    task.removeAbortListener = null;
    if (this.active === task) this.active = null;
  }

  private owns(task: ControllerTask, state: ControllerTaskState): boolean {
    return this.active === task && this.active.token === task.token && task.state === state;
  }

  private abortSinkQuietly(sink: CsvOutputSink, reason: unknown): void {
    try {
      const outcome = sink.abort(reason);
      if (outcome instanceof Promise) void outcome.catch(() => undefined);
    } catch {
      // The primary controller/assembly outcome wins.
    }
  }
}
