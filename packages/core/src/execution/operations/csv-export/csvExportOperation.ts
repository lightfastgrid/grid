/**
 * CSV Export V1 - scheduled main/Worker execution-path selection (Stage 4F).
 *
 * The API call schedules one user-visible bootstrap and performs no planning,
 * projection, Worker creation, or callback work synchronously. Selection uses
 * O(1) row-count metadata and saturating selected-cell multiplication. Grid
 * integration, public task adaptation, and Worker threshold configuration
 * ownership remain outside this internal operation.
 */

import type { CsvExportSnapshot } from "../../../features/csv-export/csvExportSnapshot";
import type {
  CsvExportProgress,
} from "../../../features/csv-export/csvExportTypes";
import type {
  CsvOutputSink,
  CsvSinkResult,
} from "../../../features/csv-export/csvOutputSink";
import type { NormalizedCsvExportDefaults } from "../../../features/csv-export/normalizeCsvExportOptions";
import type { CsvPlannedColumn } from "../../../features/csv-export/planCsvColumnScope";
import type { CsvGroupHeaderPlan } from "../../../features/csv-export/planCsvGroupHeaders";
import type { CsvRowPlan } from "../../../features/csv-export/planCsvRowScope";
import type {
  CooperativeHandle,
  CooperativeScheduler,
} from "../../../scheduling/CooperativeScheduler";

import type {
  CsvExportMainThreadCompletion,
  CsvExportMainThreadHandle,
} from "./csvExportMainThread";
import { executeCsvExportMainThread } from "./csvExportMainThread";
import type { CsvExportProjectionRuntime } from "./csvExportProjectionProducer";
import type {
  CsvExportWorkerClient,
  CsvExportWorkerOutputType,
} from "./csvExportWorkerClient";
import type { CsvExportWorkerClientOwner } from "./csvExportWorkerClientOwner";
import type {
  CsvExportWorkerExecutionCompletion,
  CsvExportWorkerExecutionHandle,
} from "./csvExportWorkerExecution";
import { executeCsvExportWorker } from "./csvExportWorkerExecution";

export const DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD = 100_000;

export interface CsvExportOperationCompletion {
  sinkResult: CsvSinkResult;
  rowCount: number;
  columnCount: number;
}

export interface CsvExportOperationInput {
  snapshot: CsvExportSnapshot;
  createRowPlan: () => CsvRowPlan;
  /** O(1) selected-row upper bound used when the plan has no exact count. */
  rowCountUpperBound: number;
  plannedColumns: readonly CsvPlannedColumn[];
  groupHeaderPlan: CsvGroupHeaderPlan;
  normalized: NormalizedCsvExportDefaults;
  runtime: CsvExportProjectionRuntime;
  outputType: CsvExportWorkerOutputType;
  sink: CsvOutputSink;
  createFreshSink: () => CsvOutputSink;
  scheduler: CooperativeScheduler;
  now: () => number;
  workerClientOwner: CsvExportWorkerClientOwner;
  workerAllowed: boolean;
  selectedCellThreshold?: number;
  taskId: number;
  onProgress?: (progress: CsvExportProgress) => void;
  onCommit?: (result: CsvExportOperationCompletion) => void;
  onComplete: (result: CsvExportOperationCompletion) => void;
  onCancelled: (reason: unknown) => void;
  onError: (error: unknown) => void;
}

export interface CsvExportOperationHandle {
  cancel(reason: unknown): void;
}

type OperationState =
  | "scheduled"
  | "bootstrapping"
  | "main"
  | "worker"
  | "cancelled"
  | "failed"
  | "completed";

interface ScheduledToken {
  handle: CooperativeHandle | null;
}

interface ChildExecutionHandle {
  cancel(reason: unknown): void;
}

const MAX_COUNT = Number.MAX_SAFE_INTEGER;

function normalizeCount(value: number): number {
  if (Number.isNaN(value) || value <= 0) return 0;
  if (!Number.isFinite(value) || value >= MAX_COUNT) return MAX_COUNT;
  return Math.floor(value);
}

function resolveThreshold(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_CSV_EXPORT_WORKER_CELL_THRESHOLD;
}

/** Saturating selected-row × selected-column work-unit calculation. */
export function calculateCsvExportWorkUnitCount(
  selectedRowCount: number,
  plannedColumnCount: number,
): number {
  const rows = normalizeCount(selectedRowCount);
  const columns = normalizeCount(plannedColumnCount);
  if (rows === 0 || columns === 0) return 0;
  if (rows > Math.floor(MAX_COUNT / columns)) return MAX_COUNT;
  return rows * columns;
}

class CsvExportOperation implements CsvExportOperationHandle {
  private state: OperationState = "scheduled";
  private scheduled: ScheduledToken | null = null;
  private child: ChildExecutionHandle | null = null;
  private initialSinkAbortStarted = false;
  private completionCommitted = false;

  constructor(private readonly input: CsvExportOperationInput) {}

  start(): void {
    if (this.state !== "scheduled" || this.scheduled !== null) return;
    const token: ScheduledToken = { handle: null };
    this.scheduled = token;
    try {
      token.handle = this.input.scheduler.schedule(
        () => {
          if (this.scheduled !== token || this.state !== "scheduled") return;
          this.scheduled = null;
          this.bootstrap();
        },
        { priority: "user-visible" },
      );
    } catch (error) {
      if (this.scheduled === token) this.scheduled = null;
      this.state = "failed";
      this.abortInitialSinkOnce(error);
      queueMicrotask(() => this.input.onError(error));
    }
  }

  cancel(reason: unknown): void {
    if (this.completionCommitted) return;
    if (this.isTerminal()) return;
    const state = this.state;
    this.state = "cancelled";
    this.cancelScheduled();
    const child = this.child;
    this.child = null;
    if (child !== null) {
      child.cancel(reason);
    } else if (state === "scheduled" || state === "bootstrapping") {
      this.abortInitialSinkOnce(reason);
    }
    this.input.onCancelled(reason);
  }

  private bootstrap(): void {
    if (this.state !== "scheduled") return;
    this.state = "bootstrapping";

    let initialPlan: CsvRowPlan;
    try {
      initialPlan = this.input.createRowPlan();
    } catch (error) {
      this.failBootstrap(error);
      return;
    }
    if (!this.isBootstrapping()) return;

    const selectedRowCount =
      initialPlan.knownRowCount === undefined
        ? this.input.rowCountUpperBound
        : initialPlan.knownRowCount;
    const workUnitCount = calculateCsvExportWorkUnitCount(
      selectedRowCount,
      this.input.plannedColumns.length,
    );
    const threshold = resolveThreshold(this.input.selectedCellThreshold);
    const useWorker =
      this.input.workerAllowed &&
      workUnitCount > 0 &&
      workUnitCount >= threshold;

    if (!useWorker) {
      this.startMain(initialPlan);
      return;
    }

    let workerClient: CsvExportWorkerClient;
    try {
      workerClient = this.input.workerClientOwner.getOrCreateWorkerClient();
    } catch {
      if (this.isBootstrapping()) this.startMain(initialPlan);
      return;
    }
    if (!this.isBootstrapping()) return;
    this.startWorker(initialPlan, workerClient);
  }

  private startMain(rowPlan: CsvRowPlan): void {
    if (this.state !== "bootstrapping") return;
    this.state = "main";
    let main: CsvExportMainThreadHandle;
    try {
      main = executeCsvExportMainThread({
        snapshot: this.input.snapshot,
        rowPlan,
        plannedColumns: this.input.plannedColumns,
        groupHeaderPlan: this.input.groupHeaderPlan,
        normalized: this.input.normalized,
        runtime: this.input.runtime,
        sink: this.input.sink,
        scheduler: this.input.scheduler,
        now: this.input.now,
        taskId: this.input.taskId,
        onProgress: this.input.onProgress,
        onCommit: (result) => this.handleMainCommit(result),
        onComplete: (result) => this.handleMainComplete(result),
        onCancelled: (reason) => this.handleChildCancelled("main", reason),
        onError: (error) => this.handleChildError("main", error),
      });
    } catch (error) {
      this.failChildStart("main", error);
      return;
    }
    this.installChild("main", main);
  }

  private startWorker(
    initialPlan: CsvRowPlan,
    workerClient: CsvExportWorkerClient,
  ): void {
    if (this.state !== "bootstrapping") return;
    this.state = "worker";
    let availableInitialPlan: CsvRowPlan | null = initialPlan;
    const createWorkerRowPlan = (): CsvRowPlan => {
      if (availableInitialPlan !== null) {
        const plan = availableInitialPlan;
        availableInitialPlan = null;
        return plan;
      }
      return this.input.createRowPlan();
    };

    let worker: CsvExportWorkerExecutionHandle;
    try {
      worker = executeCsvExportWorker({
        snapshot: this.input.snapshot,
        createRowPlan: createWorkerRowPlan,
        plannedColumns: this.input.plannedColumns,
        groupHeaderPlan: this.input.groupHeaderPlan,
        normalized: this.input.normalized,
        runtime: this.input.runtime,
        scheduler: this.input.scheduler,
        now: this.input.now,
        workerClient,
        taskId: this.input.taskId,
        outputType: this.input.outputType,
        sink: this.input.sink,
        createFreshSink: this.input.createFreshSink,
        onProgress: this.input.onProgress,
        onWorkerClientUnusable: () =>
          this.input.workerClientOwner.invalidateWorkerClient(),
        onCommit: (result) => this.handleWorkerCommit(result),
        onComplete: (result) => this.handleWorkerComplete(result),
        onCancelled: (reason) => this.handleChildCancelled("worker", reason),
        onError: (error) => this.handleChildError("worker", error),
      });
    } catch (error) {
      this.failChildStart("worker", error);
      return;
    }
    this.installChild("worker", worker);
  }

  private installChild(
    expectedState: Extract<OperationState, "main" | "worker">,
    child: ChildExecutionHandle,
  ): void {
    if (this.state === expectedState) {
      this.child = child;
    } else {
      child.cancel(new Error("CSV export operation ownership superseded"));
    }
  }

  private handleMainComplete(result: CsvExportMainThreadCompletion): void {
    if (this.state !== "main" && !this.completionCommitted) return;
    this.complete(result);
  }

  private handleMainCommit(result: CsvExportMainThreadCompletion): void {
    if (this.state !== "main") return;
    this.commit(result);
  }

  private handleWorkerComplete(result: CsvExportWorkerExecutionCompletion): void {
    if (this.state !== "worker" && !this.completionCommitted) return;
    this.complete(result);
  }

  private handleWorkerCommit(result: CsvExportWorkerExecutionCompletion): void {
    if (this.state !== "worker") return;
    this.commit(result);
  }

  private commit(result: CsvExportOperationCompletion): void {
    if (this.completionCommitted) return;
    this.completionCommitted = true;
    this.child = null;
    this.input.onCommit?.(result);
  }

  private complete(result: CsvExportOperationCompletion): void {
    this.state = "completed";
    this.child = null;
    this.input.onComplete(result);
  }

  private handleChildCancelled(
    expectedState: Extract<OperationState, "main" | "worker">,
    reason: unknown,
  ): void {
    if (this.completionCommitted) return;
    if (this.state !== expectedState) return;
    this.state = "cancelled";
    this.child = null;
    this.input.onCancelled(reason);
  }

  private handleChildError(
    expectedState: Extract<OperationState, "main" | "worker">,
    error: unknown,
  ): void {
    if (this.completionCommitted) return;
    if (this.state !== expectedState) return;
    this.state = "failed";
    this.child = null;
    this.input.onError(error);
  }

  private failChildStart(
    expectedState: Extract<OperationState, "main" | "worker">,
    error: unknown,
  ): void {
    if (this.state !== expectedState) return;
    this.state = "failed";
    this.abortInitialSinkOnce(error);
    this.input.onError(error);
  }

  private failBootstrap(error: unknown): void {
    if (this.state !== "bootstrapping") return;
    this.state = "failed";
    this.abortInitialSinkOnce(error);
    this.input.onError(error);
  }

  private abortInitialSinkOnce(reason: unknown): void {
    if (this.initialSinkAbortStarted) return;
    this.initialSinkAbortStarted = true;
    try {
      const outcome = this.input.sink.abort(reason);
      if (outcome instanceof Promise) void outcome.catch(() => undefined);
    } catch {
      // Cancellation/bootstrap failure remains primary.
    }
  }

  private cancelScheduled(): void {
    const scheduled = this.scheduled;
    this.scheduled = null;
    scheduled?.handle?.cancel();
  }

  private isTerminal(): boolean {
    return (
      this.state === "cancelled" ||
      this.state === "failed" ||
      this.state === "completed"
    );
  }

  private isBootstrapping(): boolean {
    return this.state === "bootstrapping";
  }
}

/** Schedule path selection and return one idempotent cancellation handle. */
export function executeCsvExportOperation(
  input: CsvExportOperationInput,
): CsvExportOperationHandle {
  const operation = new CsvExportOperation(input);
  operation.start();
  return operation;
}
