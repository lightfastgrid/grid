/**
 * Worker executor for execution operations.
 *
 * Owns one reusable {@link OperationWorkerClient} per operation name,
 * created lazily from `operation.worker.createClient()` on first use.
 * Success/error responses for superseded requests are ignored via the
 * caller-provided `isLatest` check (the clients themselves also drop
 * stale responses internally).
 *
 * Owned by {@link OperationExecutionRunner}, which routes large
 * eligible inputs here and falls back to the main-thread executor on
 * worker error.
 */

import type {
  ExecutionOperation,
  ExecutionOperationName,
  OperationWorkerClient,
  WorkerEligibility,
} from "./operations/types";

export class WorkerTaskExecutor {
  /**
   * Clients keyed by operation name. Payload/output types vary per
   * operation, so entries are stored type-erased and cast back at the
   * single call site that knows the operation's generics.
   */
  private readonly clients = new Map<
    ExecutionOperationName,
    OperationWorkerClient<unknown, unknown>
  >();

  /**
   * Return the reusable worker client for an operation, creating it
   * lazily on first use.
   */
  getOrCreateWorkerClient<WorkerPayload, WorkerOutput>(
    operationName: ExecutionOperationName,
    createClient: () => OperationWorkerClient<WorkerPayload, WorkerOutput>,
  ): OperationWorkerClient<WorkerPayload, WorkerOutput> {
    let client = this.clients.get(operationName) as
      | OperationWorkerClient<WorkerPayload, WorkerOutput>
      | undefined;
    if (!client) {
      client = createClient();
      this.clients.set(
        operationName,
        client as OperationWorkerClient<unknown, unknown>,
      );
    }
    return client;
  }

  /**
   * Return the operation's worker client only if it already exists.
   * Never constructs a worker — lifecycle hooks (e.g. clearing a
   * snapshot on feature disable) must not spawn one as a side effect.
   */
  getWorkerClientIfCreated<WorkerPayload, WorkerOutput>(
    operationName: ExecutionOperationName,
  ): OperationWorkerClient<WorkerPayload, WorkerOutput> | undefined {
    return this.clients.get(operationName) as
      | OperationWorkerClient<WorkerPayload, WorkerOutput>
      | undefined;
  }

  /**
   * Execute a prepared payload on the operation's worker. The
   * operation must declare a worker path.
   */
  execute<
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
    requestId: number,
    payload: WorkerPayload,
    isLatest: (requestId: number) => boolean,
    onComplete: (requestId: number, output: NormalizedOutput) => void,
    onError: (requestId: number, error: Error) => void,
  ): void {
    const worker = operation.worker;
    if (!worker) {
      onError(requestId, new Error(`Operation "${operation.name}" has no worker path`));
      return;
    }

    const client = this.getOrCreateWorkerClient(
      operation.name,
      () => worker.createClient(),
    );

    client.execute(
      requestId,
      payload,
      // onSuccess
      (successId, output) => {
        if (!isLatest(successId)) return;
        const normalized = operation.normalizeWorkerOutput(output, input);
        operation.cache?.record?.(input, normalized, "worker");
        onComplete(successId, normalized);
      },
      // onError
      (errorId, error) => {
        if (!isLatest(errorId)) return;
        onError(errorId, error);
      },
    );
  }

  /** Cancel the active worker request for the given operation name. */
  cancel(operationName: ExecutionOperationName): void {
    this.clients.get(operationName)?.cancel();
  }

  /** Destroy all worker clients and release their resources. */
  destroy(): void {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
  }
}
