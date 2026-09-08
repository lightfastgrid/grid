/**
 * Tests for the generic OperationExecutionRunner.
 *
 * Uses fake operations and fake worker clients (no real Web Worker) to
 * verify the cache / main-thread / worker / fallback flow, stale
 * handling, and cancellation.
 */

import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import { OperationExecutionRunner } from "../OperationExecutionRunner";
import type {
  ExecutionOperation,
  OperationWorkerClient,
  WorkerEligibility,
} from "../operations/types";

// ── Fake operation ────────────────────────────────────────────────────

interface FakeInput {
  size: number;
}

type FakePayload = { size: number };

/**
 * Fake worker client that records execute calls and lets tests trigger
 * success/error responses manually.
 */
class FakeWorkerClient implements OperationWorkerClient<FakePayload, string> {
  calls: { requestId: number; payload: FakePayload }[] = [];
  cancelled = 0;
  destroyed = false;

  private onSuccess:
    | ((requestId: number, output: string) => void)
    | null = null;
  private onError: ((requestId: number, error: Error) => void) | null = null;

  execute(
    requestId: number,
    payload: FakePayload,
    onSuccess: (requestId: number, output: string) => void,
    onError: (requestId: number, error: Error) => void,
  ): void {
    this.calls.push({ requestId, payload });
    this.onSuccess = onSuccess;
    this.onError = onError;
  }

  succeed(requestId: number): void {
    this.onSuccess?.(requestId, `worker:${requestId}`);
  }

  fail(requestId: number, message: string): void {
    this.onError?.(requestId, new Error(message));
  }

  cancel(): void {
    this.cancelled++;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

const THRESHOLD = 10;

interface FakeOperationOptions {
  /** Cached output returned by tryResolve (default: always miss). */
  cachedOutput?: string | null;
  /** Whether worker eligibility resolves eligible (default true). */
  eligible?: boolean;
  /** Whether buildPayload returns null (default false). */
  nullPayload?: boolean;
  /** Omit the worker path entirely. */
  noWorker?: boolean;
}

interface FakeOperationHarness {
  operation: ExecutionOperation<
    FakeInput,
    string,
    FakePayload,
    string,
    string,
    WorkerEligibility
  >;
  clients: FakeWorkerClient[];
  mainExecute: Mock<[input: FakeInput], string>;
  cacheRecord: Mock;
}

function makeOperation(opts: FakeOperationOptions = {}): FakeOperationHarness {
  const clients: FakeWorkerClient[] = [];
  const mainExecute = vi.fn(
    (input: FakeInput): string => `main:${input.size}`,
  );
  const cacheRecord = vi.fn();

  const worker = opts.noWorker
    ? undefined
    : {
        resolveEligibility: (): WorkerEligibility =>
          opts.eligible === false
            ? { eligible: false, reason: "test-ineligible" }
            : { eligible: true },
        buildPayload: (input: FakeInput): FakePayload | null =>
          opts.nullPayload ? null : { size: input.size },
        executePayload: (payload: FakePayload): string =>
          `worker-sync:${payload.size}`,
        createClient: (): FakeWorkerClient => {
          const client = new FakeWorkerClient();
          clients.push(client);
          return client;
        },
      };

  const operation: FakeOperationHarness["operation"] = {
    name: "fake",
    threshold: THRESHOLD,
    getWorkUnitCount: (input) => input.size,
    mainThread: { execute: mainExecute },
    worker,
    normalizeMainOutput: (output) => output,
    normalizeWorkerOutput: (output) => output,
    cache: {
      tryResolve: () => opts.cachedOutput ?? null,
      record: cacheRecord,
    },
  };

  return { operation, clients, mainExecute, cacheRecord };
}

function smallInput(): FakeInput {
  return { size: 1 };
}

function largeInput(): FakeInput {
  return { size: THRESHOLD };
}

/** Flush the deferred main-thread path (setTimeout fallback, no rAF). */
async function flushDeferred(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("OperationExecutionRunner", () => {
  it("below threshold runs main immediately with producer mainThread", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients, mainExecute, cacheRecord } = makeOperation();
    const onComplete = vi.fn();

    const requestId = runner.schedule(operation, smallInput(), onComplete);

    expect(requestId).toBe(1);
    expect(mainExecute).toHaveBeenCalledOnce();
    expect(clients.length).toBe(0);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      operationName: "fake",
      requestId: 1,
      output: "main:1",
      producer: "mainThread",
    });
    expect(cacheRecord).toHaveBeenCalledWith(
      smallInput(), "main:1", "mainThread",
    );
    runner.destroy();
  });

  it("cache hit completes with producer cache and skips main/worker", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients, mainExecute } = makeOperation({
      cachedOutput: "cached!",
    });
    const onComplete = vi.fn();

    runner.schedule(operation, largeInput(), onComplete);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      output: "cached!",
      producer: "cache",
    });
    expect(mainExecute).not.toHaveBeenCalled();
    expect(clients.length).toBe(0);
    runner.destroy();
  });

  it("large eligible input runs worker and completes with producer worker", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients, mainExecute, cacheRecord } = makeOperation();
    const onComplete = vi.fn();

    runner.schedule(operation, largeInput(), onComplete);

    expect(clients.length).toBe(1);
    const client = clients[0]!;
    expect(client.calls).toEqual([{ requestId: 1, payload: { size: 10 } }]);
    expect(onComplete).not.toHaveBeenCalled();

    client.succeed(1);

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      requestId: 1,
      output: "worker:1",
      producer: "worker",
    });
    expect(mainExecute).not.toHaveBeenCalled();
    expect(cacheRecord).toHaveBeenCalledWith(
      largeInput(), "worker:1", "worker",
    );
    runner.destroy();
  });

  it("worker-ineligible large input falls back to deferred main-thread", async () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients } = makeOperation({ eligible: false });
    const onComplete = vi.fn();

    runner.schedule(operation, largeInput(), onComplete);
    expect(clients.length).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();

    await flushDeferred();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      requestId: 1,
      output: "main:10",
      producer: "mainThread",
    });
    runner.destroy();
  });

  it("null payload falls back to deferred main-thread", async () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients } = makeOperation({ nullPayload: true });
    const onComplete = vi.fn();

    runner.schedule(operation, largeInput(), onComplete);
    expect(clients.length).toBe(0);

    await flushDeferred();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      producer: "mainThread",
    });
    runner.destroy();
  });

  it("worker error falls back to deferred main-thread with same requestId", async () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients } = makeOperation();
    const onComplete = vi.fn();

    runner.schedule(operation, largeInput(), onComplete);
    clients[0]!.fail(1, "worker crashed");
    expect(onComplete).not.toHaveBeenCalled();

    await flushDeferred();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      requestId: 1,
      output: "main:10",
      producer: "mainThread",
    });
    runner.destroy();
  });

  it("stale worker response after a newer schedule is ignored", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients } = makeOperation();
    const onComplete1 = vi.fn();
    const onComplete2 = vi.fn();

    runner.schedule(operation, largeInput(), onComplete1);
    runner.schedule(operation, largeInput(), onComplete2);

    // Same client reused across requests.
    expect(clients.length).toBe(1);
    const client = clients[0]!;
    expect(client.calls.length).toBe(2);

    // Stale response for request 1 is ignored.
    client.succeed(1);
    expect(onComplete1).not.toHaveBeenCalled();
    expect(onComplete2).not.toHaveBeenCalled();

    // Active response for request 2 completes.
    client.succeed(2);
    expect(onComplete2).toHaveBeenCalledOnce();
    expect(onComplete2.mock.calls[0]![0]).toMatchObject({
      requestId: 2,
      producer: "worker",
    });
    expect(onComplete1).not.toHaveBeenCalled();
    runner.destroy();
  });

  it("cancel prevents pending deferred completion", async () => {
    const runner = new OperationExecutionRunner();
    const { operation, mainExecute } = makeOperation({ eligible: false });
    const onComplete = vi.fn();

    runner.schedule(operation, largeInput(), onComplete);
    runner.cancel("fake");

    await flushDeferred();

    expect(onComplete).not.toHaveBeenCalled();
    expect(mainExecute).not.toHaveBeenCalled();
    runner.destroy();
  });

  it("effectiveThreshold overrides operation.threshold", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients, mainExecute } = makeOperation();
    const onComplete = vi.fn();

    // Input size is THRESHOLD (10) — normally goes to worker.
    // With effectiveThreshold of 100, it stays on main thread.
    runner.schedule(operation, largeInput(), onComplete, 100);

    expect(mainExecute).toHaveBeenCalledOnce();
    expect(clients.length).toBe(0);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      producer: "mainThread",
    });
    runner.destroy();
  });

  it("effectiveThreshold of 0 routes non-empty input to worker path", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients } = makeOperation();
    const onComplete = vi.fn();

    runner.schedule(operation, smallInput(), onComplete, 0);

    expect(clients.length).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();

    clients[0]!.succeed(1);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      producer: "worker",
    });
    runner.destroy();
  });

  it("effectiveThreshold of 0 with empty input stays on immediate main-thread", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients, mainExecute } = makeOperation();
    const onComplete = vi.fn();

    runner.schedule(operation, { size: 0 }, onComplete, 0);

    expect(mainExecute).toHaveBeenCalledOnce();
    expect(clients.length).toBe(0);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      producer: "mainThread",
    });
    runner.destroy();
  });

  it("undefined effectiveThreshold falls back to operation.threshold", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients, mainExecute } = makeOperation();
    const onComplete = vi.fn();

    runner.schedule(operation, smallInput(), onComplete, undefined);

    expect(mainExecute).toHaveBeenCalledOnce();
    expect(clients.length).toBe(0);
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      producer: "mainThread",
    });
    runner.destroy();
  });

  it("destroy destroys worker clients", () => {
    const runner = new OperationExecutionRunner();
    const { operation, clients } = makeOperation();

    runner.schedule(operation, largeInput(), vi.fn());
    expect(clients.length).toBe(1);

    runner.destroy();

    expect(clients[0]!.destroyed).toBe(true);
  });

  it("getWorkerClientIfCreated returns undefined and never constructs before creation", () => {
    const runner = new OperationExecutionRunner();
    const createClient = vi.fn(() => new FakeWorkerClient());

    // Peek before any creation — must not invoke the factory.
    expect(
      runner.getWorkerClientIfCreated<FakePayload, string>("fake"),
    ).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();

    // Explicit creation, then peek returns that same instance.
    const created = runner.getOrCreateWorkerClient<FakePayload, string>(
      "fake",
      createClient,
    );
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(runner.getWorkerClientIfCreated<FakePayload, string>("fake")).toBe(
      created,
    );

    runner.destroy();
  });
});
