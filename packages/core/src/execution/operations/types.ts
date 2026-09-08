/**
 * Generic execution-operation contracts.
 *
 * These types describe a single grid execution operation (sort, filter,
 * search, formula, …) in a uniform shape so the generic
 * {@link OperationExecutionRunner} can route any operation through the
 * same cache / sync / async / worker machinery.
 *
 * Each operation lives in its own module under this directory (e.g.
 * `./sort`) and implements {@link ExecutionOperation}.
 */

import type { RowOrder } from "../../row-model/rowOrder";
import {
  createIdentityRowOrder,
  createIndexedRowOrder,
} from "../../row-model/rowOrder";

// ── Operation identity ────────────────────────────────────────────────

/** Unique name identifying an execution operation (e.g. "sort"). */
export type ExecutionOperationName = string;

// ── Worker eligibility ────────────────────────────────────────────────

/**
 * Result of checking whether an operation's input can be executed in a
 * Worker. Operations with non-serializable inputs (JS callbacks such as
 * `valueGetter` or custom comparators) report `eligible: false`.
 */
export interface WorkerEligibility {
  /** Whether the request can be executed in a Worker. */
  eligible: boolean;
  /** Human-readable reason when `eligible` is `false`. */
  reason?: string;
}

// ── Worker client ─────────────────────────────────────────────────────

/**
 * Lifecycle contract for an operation's worker client.
 *
 * Mirrors the shape of `SortWorkerClient`: a lazily created, reusable
 * Worker that runs one request at a time, silently ignoring stale
 * responses from cancelled or superseded requests.
 */
export interface OperationWorkerClient<Payload, WorkerOutput> {
  /**
   * Post a request to the worker. If a previous request is still
   * active it is superseded and its response will be discarded.
   */
  execute(
    requestId: number,
    payload: Payload,
    onSuccess: (requestId: number, output: WorkerOutput) => void,
    onError: (requestId: number, error: Error) => void,
  ): void;

  /** Cancel the active request; its response will be silently ignored. */
  cancel(): void;

  /** Terminate the worker and release all resources. */
  destroy(): void;
}

// ── Cache ─────────────────────────────────────────────────────────────

/** Which execution path produced a normalized result. */
export type ExecutionResultProducer = "mainThread" | "worker";

/**
 * Optional cache boundary for an operation.
 *
 * Checked before executing and (optionally) written after a result is
 * produced, regardless of which path produced it. Implementations own
 * their invalidation strategy — the contract only describes lookup and
 * recording.
 */
export interface ExecutionOperationCache<Input, NormalizedOutput> {
  /** Return a cached result for `input`, or `null` on miss. */
  tryResolve(input: Input): NormalizedOutput | null;

  /** Record a freshly produced result for future lookups. */
  record?(
    input: Input,
    output: NormalizedOutput,
    producer: ExecutionResultProducer,
  ): void;
}

// ── Parity fixtures ───────────────────────────────────────────────────

/**
 * A named input used by parity tests to assert that the main-thread and
 * worker paths of an operation produce equivalent normalized output.
 */
export interface ExecutionParityFixture<Input> {
  /** Fixture name shown in test output. */
  name: string;
  /** Operation input to execute on both paths. */
  input: Input;
}

// ── Operation contract ────────────────────────────────────────────────

/**
 * Contract a grid execution operation implements to participate in the
 * generic execution pipeline.
 *
 * Type parameters:
 * - `Input` — the full main-thread request (may hold closures).
 * - `MainOutput` — raw result of the main-thread implementation.
 * - `WorkerPayload` — structured-clone-safe request for the worker.
 * - `WorkerOutput` — raw result posted back from the worker.
 * - `NormalizedOutput` — common result shape both paths normalize to.
 * - `Eligibility` — operation-specific eligibility shape extending
 *   {@link WorkerEligibility} (e.g. sort's resolved entries).
 */
export interface ExecutionOperation<
  Input,
  MainOutput,
  WorkerPayload,
  WorkerOutput,
  NormalizedOutput,
  Eligibility extends WorkerEligibility = WorkerEligibility,
> {
  /** Unique operation name (e.g. "sort"). */
  name: ExecutionOperationName;

  /**
   * Work-unit count at or above which the operation should run
   * asynchronously (and in a Worker when eligible).
   */
  threshold: number;

  /** Number of work units (typically rows) the input represents. */
  getWorkUnitCount(input: Input): number;

  /** Main-thread execution path. Always available as the fallback. */
  mainThread: {
    execute(input: Input): MainOutput;
    /**
     * Optional cooperative async main-thread path for operations whose
     * fallback cannot complete synchronously (for example chunked scan).
     */
    executeAsync?(
      input: Input,
      onComplete: (output: MainOutput) => void,
    ): { cancel(): void };
  };

  /**
   * Optional worker execution path. Operations without one always run
   * on the main thread.
   */
  worker?: {
    /** Check whether `input` can be serialized for worker execution. */
    resolveEligibility(input: Input): Eligibility;

    /**
     * Build the structured-clone-safe payload for an eligible input,
     * or `null` when no payload can be produced.
     */
    buildPayload(input: Input, eligibility: Eligibility): WorkerPayload | null;

    /**
     * Run the pure worker algorithm on a payload. Used by the worker
     * script itself and by main-thread parity tests.
     */
    executePayload(payload: WorkerPayload): WorkerOutput;

    /** Create the worker client that owns the Worker lifecycle. */
    createClient(): OperationWorkerClient<WorkerPayload, WorkerOutput>;
  };

  /** Normalize a main-thread result to the common output shape. */
  normalizeMainOutput(output: MainOutput, input: Input): NormalizedOutput;

  /** Normalize a worker result to the common output shape. */
  normalizeWorkerOutput(output: WorkerOutput, input: Input): NormalizedOutput;

  /**
   * Optional cache boundary, consulted by `OperationExecutionRunner`
   * before executing. Like `worker`, operations without one always
   * execute.
   */
  cache?: ExecutionOperationCache<Input, NormalizedOutput>;

  /** Optional inputs for main-thread vs worker parity tests. */
  parityFixtures?: readonly ExecutionParityFixture<Input>[];
}

// ── Row-index results ─────────────────────────────────────────────────

/**
 * Normalized output for operations that produce a row display order
 * (sort, filter, search). Mirrors {@link RowOrder} but stays decoupled
 * from it so worker code never needs row-model imports.
 *
 * - `identity` — display order equals source order; nothing allocated.
 * - `indexes` — `indexes[displayIndex]` is the source index.
 */
export type RowIndexExecutionResult =
  | { kind: "identity"; rowCount: number }
  | { kind: "indexes"; indexes: Uint32Array };

/** Convert a normalized row-index result into a {@link RowOrder}. */
export function rowIndexExecutionResultToRowOrder(
  result: RowIndexExecutionResult,
): RowOrder {
  return result.kind === "identity"
    ? createIdentityRowOrder(result.rowCount)
    : createIndexedRowOrder(result.indexes);
}

/** Convert a {@link RowOrder} into a normalized row-index result. */
export function rowOrderToRowIndexExecutionResult(
  rowOrder: RowOrder,
): RowIndexExecutionResult {
  return rowOrder.kind === "identity"
    ? { kind: "identity", rowCount: rowOrder.length }
    : { kind: "indexes", indexes: rowOrder.indexes };
}
