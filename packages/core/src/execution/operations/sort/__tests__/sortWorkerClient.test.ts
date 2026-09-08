import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SortWorkerClient } from "../sortWorkerClient";
import type { WorkerSortEntry } from "../sortWorkerEligibility";
import type { WorkerSortPayload, WorkerSortRowValue } from "../sortWorkerPayload";
import type { SortWorkerRequest, SortWorkerResponse } from "../sortWorkerTypes";

// ── Fake Worker ───────────────────────────────────────────────────────

type MessageHandler = ((event: MessageEvent<SortWorkerResponse>) => void) | null;
type ErrorHandler = ((event: ErrorEvent) => void) | null;

class FakeWorker {
  static instances: FakeWorker[] = [];
  static failOnConstruct = false;

  onmessage: MessageHandler = null;
  onerror: ErrorHandler = null;
  terminated = false;
  lastPosted: SortWorkerRequest | null = null;

  constructor() {
    if (FakeWorker.failOnConstruct) {
      throw new Error("Worker construction failed");
    }
    FakeWorker.instances.push(this);
  }

  postMessage(data: SortWorkerRequest): void {
    this.lastPosted = data;
  }

  terminate(): void {
    this.terminated = true;
  }

  // Test helpers to simulate worker responses.
  simulateSuccess(requestId: number, indexes: Uint32Array): void {
    const response: SortWorkerResponse = {
      kind: "sort:success",
      requestId,
      indexes,
    };
    this.onmessage?.({ data: response } as MessageEvent<SortWorkerResponse>);
  }

  simulateError(requestId: number, message: string): void {
    const response: SortWorkerResponse = {
      kind: "sort:error",
      requestId,
      message,
    };
    this.onmessage?.({ data: response } as MessageEvent<SortWorkerResponse>);
  }

  simulateWorkerError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────

function makePayload(values: WorkerSortRowValue[] = [3, 1, 2]): WorkerSortPayload {
  const entries: WorkerSortEntry[] = [{ field: "v", dir: 1, pathParts: null }];
  return { valuesByEntry: [values], entries, rowCount: values.length };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("SortWorkerClient", () => {
  let originalWorker: typeof globalThis.Worker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    FakeWorker.instances = [];
    FakeWorker.failOnConstruct = false;
    // Install FakeWorker as globalThis.Worker.
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
  });

  // ── Lazy creation ───────────────────────────────────────────────────

  it("does not create Worker until execute()", () => {
    new SortWorkerClient();
    expect(FakeWorker.instances.length).toBe(0);
  });

  it("creates only one Worker across multiple execute calls", () => {
    const client = new SortWorkerClient();
    const payload = makePayload();
    client.execute(1, payload, vi.fn(), vi.fn());
    client.execute(2, payload, vi.fn(), vi.fn());
    client.execute(3, payload, vi.fn(), vi.fn());
    expect(FakeWorker.instances.length).toBe(1);
    client.destroy();
  });

  // ── Request posting ─────────────────────────────────────────────────

  it("posts SortWorkerRequest with requestId and payload", () => {
    const client = new SortWorkerClient();
    const payload = makePayload();
    client.execute(42, payload, vi.fn(), vi.fn());

    const worker = FakeWorker.instances[0]!;
    expect(worker.lastPosted).not.toBeNull();
    expect(worker.lastPosted!.kind).toBe("sort");
    expect(worker.lastPosted!.requestId).toBe(42);
    expect(worker.lastPosted!.payload).toBe(payload);
    client.destroy();
  });

  // ── Success response ────────────────────────────────────────────────

  it("success response calls onSuccess with Uint32Array indexes", () => {
    const client = new SortWorkerClient();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    client.execute(1, makePayload(), onSuccess, onError);

    const worker = FakeWorker.instances[0]!;
    const indexes = new Uint32Array([1, 2, 0]);
    worker.simulateSuccess(1, indexes);

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(1, indexes);
    expect(onError).not.toHaveBeenCalled();
    client.destroy();
  });

  // ── Error response ──────────────────────────────────────────────────

  it("error response calls onError", () => {
    const client = new SortWorkerClient();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    client.execute(1, makePayload(), onSuccess, onError);

    const worker = FakeWorker.instances[0]!;
    worker.simulateError(1, "sort failed");

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBe(1);
    expect(onError.mock.calls[0]![1]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]![1].message).toBe("sort failed");
    expect(onSuccess).not.toHaveBeenCalled();
    client.destroy();
  });

  // ── Stale response handling ─────────────────────────────────────────

  it("stale success response is ignored after a newer execute()", () => {
    const client = new SortWorkerClient();
    const onSuccess1 = vi.fn();
    const onError1 = vi.fn();
    client.execute(1, makePayload(), onSuccess1, onError1);

    const onSuccess2 = vi.fn();
    const onError2 = vi.fn();
    client.execute(2, makePayload(), onSuccess2, onError2);

    const worker = FakeWorker.instances[0]!;
    // Stale response for request 1
    worker.simulateSuccess(1, new Uint32Array([0, 1, 2]));
    expect(onSuccess1).not.toHaveBeenCalled();
    expect(onSuccess2).not.toHaveBeenCalled();

    // Active response for request 2
    worker.simulateSuccess(2, new Uint32Array([2, 1, 0]));
    expect(onSuccess2).toHaveBeenCalledOnce();
    client.destroy();
  });

  it("stale error response is ignored after cancel()", () => {
    const client = new SortWorkerClient();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    client.execute(1, makePayload(), onSuccess, onError);

    client.cancel();

    const worker = FakeWorker.instances[0]!;
    worker.simulateError(1, "too late");
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    client.destroy();
  });

  // ── Cancel ──────────────────────────────────────────────────────────

  it("cancel ignores later response", () => {
    const client = new SortWorkerClient();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    client.execute(5, makePayload(), onSuccess, onError);

    client.cancel();

    const worker = FakeWorker.instances[0]!;
    worker.simulateSuccess(5, new Uint32Array([0]));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    client.destroy();
  });

  it("cancel does not terminate worker", () => {
    const client = new SortWorkerClient();
    client.execute(1, makePayload(), vi.fn(), vi.fn());
    client.cancel();
    expect(FakeWorker.instances[0]!.terminated).toBe(false);
    client.destroy();
  });

  // ── Destroy ─────────────────────────────────────────────────────────

  it("destroy terminates worker and removes active state", () => {
    const client = new SortWorkerClient();
    const onSuccess = vi.fn();
    client.execute(1, makePayload(), onSuccess, vi.fn());

    const worker = FakeWorker.instances[0]!;
    client.destroy();

    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();

    // Simulating a response after destroy has no effect.
    worker.simulateSuccess(1, new Uint32Array([0]));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("execute after destroy calls onError immediately", () => {
    const client = new SortWorkerClient();
    client.destroy();

    const onError = vi.fn();
    client.execute(1, makePayload(), vi.fn(), onError);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![1].message).toBe("SortWorkerClient destroyed");
  });

  // ── Worker unavailable ──────────────────────────────────────────────

  it("Worker unavailable calls onError", () => {
    // Remove Worker from global scope.
    delete (globalThis as Record<string, unknown>).Worker;

    const client = new SortWorkerClient();
    const onError = vi.fn();
    client.execute(1, makePayload(), vi.fn(), onError);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBe(1);
    expect(onError.mock.calls[0]![1].message).toBe("Worker unavailable");
  });

  // ── Worker constructor failure ──────────────────────────────────────

  it("Worker constructor failure calls onError", () => {
    FakeWorker.failOnConstruct = true;

    const client = new SortWorkerClient();
    const onError = vi.fn();
    client.execute(1, makePayload(), vi.fn(), onError);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBe(1);
    expect(onError.mock.calls[0]![1].message).toBe("Worker construction failed");
    expect(FakeWorker.instances.length).toBe(0);
  });

  // ── worker onerror ──────────────────────────────────────────────────

  it("worker onerror calls onError and terminates/nulls the worker", () => {
    const client = new SortWorkerClient();
    const onError = vi.fn();
    client.execute(1, makePayload(), vi.fn(), onError);

    const worker = FakeWorker.instances[0]!;
    worker.simulateWorkerError("Uncaught exception in worker");

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toBe(1);
    expect(onError.mock.calls[0]![1].message).toBe("Uncaught exception in worker");
    // Worker should be terminated and handlers cleared.
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it("execute after worker onerror creates a new Worker instance", () => {
    const client = new SortWorkerClient();
    client.execute(1, makePayload(), vi.fn(), vi.fn());

    const firstWorker = FakeWorker.instances[0]!;
    firstWorker.simulateWorkerError("crash");

    // First worker is terminated.
    expect(firstWorker.terminated).toBe(true);

    // Next execute should create a fresh worker.
    const onSuccess = vi.fn();
    client.execute(2, makePayload(), onSuccess, vi.fn());
    expect(FakeWorker.instances.length).toBe(2);

    const secondWorker = FakeWorker.instances[1]!;
    expect(secondWorker).not.toBe(firstWorker);
    expect(secondWorker.terminated).toBe(false);

    // New worker can complete requests normally.
    secondWorker.simulateSuccess(2, new Uint32Array([0]));
    expect(onSuccess).toHaveBeenCalledOnce();
    client.destroy();
  });

  it("worker onerror with no active request does not call callbacks but still terminates/nulls worker", () => {
    const client = new SortWorkerClient();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    client.execute(1, makePayload(), onSuccess, onError);

    // Complete the request first.
    const worker = FakeWorker.instances[0]!;
    worker.simulateSuccess(1, new Uint32Array([0]));
    expect(onSuccess).toHaveBeenCalledOnce();

    // Now a stray onerror — should not call callbacks but should
    // defensively tear down the worker.
    worker.simulateWorkerError("stray error");
    expect(onError).not.toHaveBeenCalled();
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  // ── Execute reuses worker after cancel ──────────────────────────────

  it("execute after cancel reuses existing worker", () => {
    const client = new SortWorkerClient();
    client.execute(1, makePayload(), vi.fn(), vi.fn());
    client.cancel();

    const onSuccess = vi.fn();
    client.execute(2, makePayload(), onSuccess, vi.fn());
    expect(FakeWorker.instances.length).toBe(1);

    FakeWorker.instances[0]!.simulateSuccess(2, new Uint32Array([0]));
    expect(onSuccess).toHaveBeenCalledOnce();
    client.destroy();
  });
});
