/**
 * Generic execution runner for operations.
 *
 * Owns the request tracker and the main-thread/worker executors, and
 * decides the execution flow for any {@link ExecutionOperation}:
 *
 * 1. cache hit → complete immediately with producer "cache"
 * 2. large eligible input → worker, falling back to deferred
 *    main-thread execution (same requestId) on ineligibility, null
 *    payload, or worker error
 * 3. everything else → immediate main-thread execution
 *
 * {@link GridExecutionService} is the grid-facing facade that schedules
 * operations through this runner.
 */

import type {
  ExecutionOperation,
  ExecutionOperationName,
  OperationWorkerClient,
  WorkerEligibility,
} from "./operations/types";
import { MainThreadTaskExecutor } from "./MainThreadTaskExecutor";
import { TaskRequestTracker } from "./TaskRequestTracker";
import { WorkerTaskExecutor } from "./WorkerTaskExecutor";

/** Completion delivered for a scheduled operation request. */
export interface OperationExecutionCompletion<Input, NormalizedOutput> {
  operationName: ExecutionOperationName;
  requestId: number;
  /** The input the result was produced for. */
  input: Input;
  /** The normalized operation output. */
  output: NormalizedOutput;
  /** Which path produced the result. */
  producer: "cache" | "mainThread" | "worker";
}

export class OperationExecutionRunner {
  private readonly tracker = new TaskRequestTracker();
  private readonly mainExecutor = new MainThreadTaskExecutor();
  private readonly workerExecutor = new WorkerTaskExecutor();

  /**
   * Schedule an operation request. Returns the requestId; completion
   * is delivered via `onComplete` unless superseded or cancelled.
   */
  schedule<
    Input,
    MainOutput,
    WorkerPayload,
    WorkerOutput,
    NormalizedOutput,
    Eligibility extends WorkerEligibility,
  >(
    operation: ExecutionOperation<
      Input,
      MainOutput,
      WorkerPayload,
      WorkerOutput,
      NormalizedOutput,
      Eligibility
    >,
    input: Input,
    onComplete: (
      completion: OperationExecutionCompletion<Input, NormalizedOutput>,
    ) => void,
    effectiveThreshold?: number,
  ): number {
    const operationName = operation.name;
    const requestId = this.tracker.next(operationName);
    this.mainExecutor.cancel(operationName);
    this.workerExecutor.cancel(operationName);

    const isLatest = (id: number): boolean =>
      this.tracker.isLatest(operationName, id);

    const complete = (
      id: number,
      output: NormalizedOutput,
      producer: "cache" | "mainThread" | "worker",
    ): void => {
      onComplete({ operationName, requestId: id, input, output, producer });
    };

    // ── Cache path ────────────────────────────────────────────────────
    const cached = operation.cache?.tryResolve(input) ?? null;
    if (cached !== null) {
      complete(requestId, cached, "cache");
      return requestId;
    }

    const fallBackToDeferredMain = (id: number): void => {
      if (operation.mainThread.executeAsync) {
        this.mainExecutor.scheduleAsync(
          operationName,
          id,
          operation,
          input,
          isLatest,
          (doneId, output) => complete(doneId, output, "mainThread"),
        );
      } else {
        this.mainExecutor.scheduleDeferred(
          operationName,
          id,
          operation,
          input,
          isLatest,
          (doneId, output) => complete(doneId, output, "mainThread"),
        );
      }
    };

    // ── Worker path: large eligible inputs ────────────────────────────
    const threshold = effectiveThreshold ?? operation.threshold;
    const workUnitCount = operation.getWorkUnitCount(input);
    const worker = operation.worker;
    if (worker && workUnitCount > 0 && workUnitCount >= threshold) {
      const eligibility = worker.resolveEligibility(input);
      const payload = eligibility.eligible
        ? worker.buildPayload(input, eligibility)
        : null;
      if (payload !== null) {
        this.workerExecutor.execute(
          operation,
          input,
          requestId,
          payload,
          isLatest,
          (doneId, output) => complete(doneId, output, "worker"),
          // Worker failed — fall back to deferred main-thread execution
          // for the same requestId.
          (errorId) => fallBackToDeferredMain(errorId),
        );
      } else {
        fallBackToDeferredMain(requestId);
      }
      return requestId;
    }

    // ── Large main-thread fallback (no worker path) ───────────────────
    if (workUnitCount > 0 && workUnitCount >= threshold) {
      fallBackToDeferredMain(requestId);
      return requestId;
    }

    // ── Immediate main-thread path ────────────────────────────────────
    const output = this.mainExecutor.executeNow(operation, input);
    complete(requestId, output, "mainThread");
    return requestId;
  }

  /** Cancel pending work for the given operation name. */
  cancel(operationName: ExecutionOperationName): void {
    this.tracker.cancel(operationName);
    this.mainExecutor.cancel(operationName);
    this.workerExecutor.cancel(operationName);
  }

  /** Whether `requestId` is the latest request for the operation. */
  isLatest(operationName: ExecutionOperationName, requestId: number): boolean {
    return this.tracker.isLatest(operationName, requestId);
  }

  /** Lazily create or return the reusable worker client for an operation. */
  getOrCreateWorkerClient<WorkerPayload, WorkerOutput>(
    operationName: ExecutionOperationName,
    createClient: () => OperationWorkerClient<WorkerPayload, WorkerOutput>,
  ): OperationWorkerClient<WorkerPayload, WorkerOutput> {
    return this.workerExecutor.getOrCreateWorkerClient(operationName, createClient);
  }

  /** Return the worker client only if one was already created. */
  getWorkerClientIfCreated<WorkerPayload, WorkerOutput>(
    operationName: ExecutionOperationName,
  ): OperationWorkerClient<WorkerPayload, WorkerOutput> | undefined {
    return this.workerExecutor.getWorkerClientIfCreated(operationName);
  }

  /** Cancel everything and release worker resources. */
  destroy(): void {
    this.mainExecutor.destroy();
    this.workerExecutor.destroy();
  }
}
