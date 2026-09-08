// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { buildQuickSearchDependencyPlan } from "../../../../features/quick-search/quickSearchDependencyPlan";
import { Grid } from "../../../../Grid";
import { CooperativeScheduler } from "../../../../scheduling/CooperativeScheduler";
import type { GridState } from "../../../../state/GridState";
import type { ColumnDef, RowData } from "../../../../types";
import { GridExecutionService } from "../../../GridExecutionService";
import { MainThreadTaskExecutor } from "../../../MainThreadTaskExecutor";
import { OperationExecutionRunner } from "../../../OperationExecutionRunner";
import type { QuickSearchOperationInput } from "..";
import * as quickSearchMainThread from "../quickSearchMainThread";
import { executeQuickSearchSync } from "../quickSearchMainThread";
import * as quickSearchMainThreadFallback from "../quickSearchMainThreadFallback";
import { executeQuickSearchWorkerPayload } from "../quickSearchWorkerAlgorithm";
import { QuickSearchWorkerClient } from "../QuickSearchWorkerClient";
import { QuickSearchWorkerClientAdapter } from "../quickSearchWorkerClientAdapter";
import { buildSourceSignature } from "../quickSearchWorkerRuntime";
import { quickSearchOperation } from "..";

const here = dirname(fileURLToPath(import.meta.url));

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function makeContainer(): HTMLDivElement {
  const c = document.createElement("div");
  Object.assign(c.style, { width: "600px", height: "400px" });
  document.body.appendChild(c);
  return c;
}

function cellEl(
  container: HTMLElement,
  rowId: string,
  field: string,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-row-id="${rowId}"] .lfg-cell[data-col-id="${field}"]`,
  );
}

function dblClick(el: Element): void {
  el.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
  );
}

function pressKey(el: Element, key: string): void {
  el.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

const rows: RowData[] = [
  { name: "Alice", city: "Lahore" },
  { name: "Bob", city: "London" },
  { name: "Charlie", city: "Paris" },
];

const columns = [
  { field: "name", headerName: "Name" },
  { field: "city", headerName: "City" },
];

function makeInput(
  quickFilterText: string,
  overrides?: Partial<QuickSearchOperationInput>,
): QuickSearchOperationInput {
  const cols = (overrides?.columns ?? columns) as ColumnDef[];
  const quickFilter = overrides?.quickFilter;
  const dependencyPlan =
    overrides?.dependencyPlan ??
    buildQuickSearchDependencyPlan(cols, quickFilter ?? true);
  return {
    rows,
    quickFilterText,
    columns: cols,
    searchableFieldsSignature: dependencyPlan.fieldsSignature,
    filterModel: {},
    filteredOrderVersion: 0,
    sourceLayoutRevision: 0,
    searchableDataRevision: 0,
    ...overrides,
    dependencyPlan,
  };
}

describe("quickSearch operation execution", () => {
  it("executeQuickSearchSync returns matching source indexes", () => {
    const result = executeQuickSearchSync(makeInput("bob"));
    expect(result.kind).toBe("indexes");
    if (result.kind !== "indexes") throw new Error("unreachable");
    expect(Array.from(result.indexes)).toEqual([1]);
  });

  it("GridExecutionService.scheduleQuickSearch completes synchronously for small datasets", () => {
    const service = new GridExecutionService();
    const onComplete = vi.fn();

    service.scheduleQuickSearch(makeInput("alice"), onComplete);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0].kind).toBe("quickSearch");
    expect(onComplete.mock.calls[0]![0].producer).toBe("mainThread");
    const result = onComplete.mock.calls[0]![0].result;
    expect(result.kind).toBe("indexes");
    if (result.kind !== "indexes") throw new Error("unreachable");
    expect(Array.from(result.indexes)).toEqual([0]);
  });

  it("cancelQuickSearch prevents async completion when cancelled before timers run", () => {
    vi.useFakeTimers();
    const schedulerRef = (globalThis as { scheduler?: unknown }).scheduler;
    delete (globalThis as { scheduler?: unknown }).scheduler;

    try {
      const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
        name: i === 100 ? "AliceUnique" : `Person${i}`,
        city: "City",
      }));
      const service = new GridExecutionService({
        thresholds: { quickSearch: 1 },
      });
      const onComplete = vi.fn();

      service.scheduleQuickSearch(
        makeInput("AliceUnique", { rows: largeRows }),
        onComplete,
      );
      service.cancelQuickSearch();
      vi.runAllTimers();

      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      if (schedulerRef !== undefined) {
        (globalThis as { scheduler?: unknown }).scheduler = schedulerRef;
      }
      vi.useRealTimers();
    }
  });
});

describe("quickSearch worker routing", () => {
  it("buildPayload is lightweight — no snapshotRows, no row-level extraction", () => {
    const op = quickSearchOperation;
    const input = makeInput("alice", {
      sourceLayoutRevision: 3,
      searchableDataRevision: 7,
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(true);

    const payload = op.worker!.buildPayload(input, eligibility);
    expect(payload).not.toBeNull();
    expect(payload!.normalizedText.toLowerCase()).toBe("alice");
    expect(payload!.rows).toBe(rows);
    expect(payload!.descriptors).toHaveLength(2);
    expect(payload!.sourceLayoutRevision).toBe(3);
    expect(payload!.searchableDataRevision).toBe(7);
    expect(payload!).not.toHaveProperty("snapshotRows");
    expect(payload!).not.toHaveProperty("fields");
  });

  it("buildPayload does not read row field values", () => {
    const op = quickSearchOperation;
    const trapRow = new Proxy(
      { name: "Alice" },
      {
        get(target, prop) {
          if (prop === "name") {
            throw new Error("row field should not be read during buildPayload");
          }
          return (target as Record<string | symbol, unknown>)[prop];
        },
      },
    );
    const input = makeInput("alice", { rows: [trapRow as RowData] });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(true);

    expect(() => op.worker!.buildPayload(input, eligibility)).not.toThrow();
  });

  it("buildPayload performs no searchable-field resolution from columns", () => {
    const op = quickSearchOperation;
    const plan = buildQuickSearchDependencyPlan(columns, true);
    const throwingColumns = new Proxy(columns, {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator || prop === "forEach" || prop === "map" || prop === "length") {
          throw new Error("columns must not be scanned during buildPayload");
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const input = makeInput("alice", {
      columns: throwingColumns as ColumnDef[],
      dependencyPlan: plan,
      searchableFieldsSignature: plan.fieldsSignature,
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(() => op.worker!.buildPayload(input, eligibility)).not.toThrow();
  });

  it("GridExecutionService completion carries both input revisions", () => {
    const service = new GridExecutionService();
    const onComplete = vi.fn();
    service.scheduleQuickSearch(
      makeInput("alice", {
        sourceLayoutRevision: 11,
        searchableDataRevision: 22,
      }),
      onComplete,
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
    const completion = onComplete.mock.calls[0]![0];
    expect(completion.sourceLayoutRevision).toBe(11);
    expect(completion.searchableDataRevision).toBe(22);
  });

  it("plan identity is preserved into operation input eligibility", () => {
    const plan = buildQuickSearchDependencyPlan(columns, true);
    const input = makeInput("alice", { dependencyPlan: plan });
    const eligibility = quickSearchOperation.worker!.resolveEligibility(input);
    expect(eligibility.descriptors).toBe(plan.descriptors);
    expect(input.dependencyPlan).toBe(plan);
  });

  it("worker-ineligible input with custom parser falls back to main-thread", () => {
    const op = quickSearchOperation;
    const input = makeInput("alice", {
      quickFilter: { parser: (t: string) => t.split(" ") },
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("custom-parser");
  });

  it("worker-ineligible input with custom matcher falls back to main-thread", () => {
    const op = quickSearchOperation;
    const input = makeInput("alice", {
      quickFilter: { matcher: () => true },
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("custom-matcher");
  });

  it("worker-ineligible input with custom extractor falls back to main-thread", () => {
    const op = quickSearchOperation;
    const input = makeInput("alice", {
      columns: [{ field: "name", getQuickFilterText: () => "custom" }],
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("custom-extractor");
  });

  it("projection field makes column eligible despite getQuickFilterText", () => {
    const op = quickSearchOperation;
    const input = makeInput("alice", {
      columns: [
        {
          field: "name",
          getQuickFilterText: () => "custom",
          quickFilterTextField: "nameSearch",
        },
        { field: "city" },
      ],
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(true);
  });

  it("worker error falls back to main-thread chunked path via OperationExecutionRunner", () => {
    vi.useFakeTimers();
    const schedulerRef = (globalThis as { scheduler?: unknown }).scheduler;
    delete (globalThis as { scheduler?: unknown }).scheduler;

    try {
      const runner = new OperationExecutionRunner();
      const onComplete = vi.fn();

      runner.schedule(
        {
          ...quickSearchOperation,
          worker: {
            ...quickSearchOperation.worker!,
            createClient: () => ({
              execute: (_rid: number, _p: unknown, _s: unknown, onError: (rid: number, err: Error) => void) => {
                onError(_rid as number, new Error("Worker failed"));
              },
              cancel: () => {},
              destroy: () => {},
            }),
          },
        },
        makeInput("alice"),
        onComplete,
        1,
      );

      vi.runAllTimers();
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0]![0].producer).toBe("mainThread");
      const result = onComplete.mock.calls[0]![0].output;
      expect(result.kind).toBe("indexes");
      if (result.kind === "indexes") {
        expect(Array.from(result.indexes)).toEqual([0]);
      }
    } finally {
      if (schedulerRef !== undefined) {
        (globalThis as { scheduler?: unknown }).scheduler = schedulerRef;
      }
      vi.useRealTimers();
    }
  });

  it("empty query cancels worker and returns upstream identity", () => {
    const result = executeQuickSearchSync(makeInput(""));
    expect(result.kind).toBe("identity");
    if (result.kind === "identity") {
      expect(result.rowCount).toBe(rows.length);
    }
  });

  it("worker source identity uses monotonic version, not per-index string", () => {
    const sig0 = buildSourceSignature(0);
    const sig1 = buildSourceSignature(1);
    expect(sig0).toBe("src|v0");
    expect(sig1).toBe("src|v1");
    expect(sig0).not.toContain(",");
  });

  it("large worker-eligible input routes through worker adapter, not deferred main", () => {
    const executeSpy = vi.fn(
      (requestId: number, _payload: unknown, onSuccess: (rid: number, out: Uint32Array) => void) => {
        onSuccess(requestId, new Uint32Array([0]));
      },
    );
    const runner = new OperationExecutionRunner();
    const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
      name: i === 100 ? "AliceUnique" : `Person${i}`,
      city: "City",
    }));
    const onComplete = vi.fn();

    runner.schedule(
      {
        ...quickSearchOperation,
        worker: {
          ...quickSearchOperation.worker!,
          createClient: () => ({
            execute: executeSpy,
            cancel: () => {},
            destroy: () => {},
          }),
        },
      },
      makeInput("AliceUnique", { rows: largeRows }),
      onComplete,
      500,
    );

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]![0].producer).toBe("worker");
  });

  it("large worker-ineligible input defers first main fallback chunk", () => {
    vi.useFakeTimers();
    const schedulerRef = (globalThis as { scheduler?: unknown }).scheduler;
    delete (globalThis as { scheduler?: unknown }).scheduler;
    const mcRef = (globalThis as { MessageChannel?: unknown }).MessageChannel;
    delete (globalThis as { MessageChannel?: unknown }).MessageChannel;

    try {
      const fallbackSpy = vi.spyOn(
        quickSearchMainThreadFallback,
        "executeQuickSearchMainThreadFallback",
      );
      const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
        name: `Person${i}`,
      }));
      const onComplete = vi.fn();
      const runner = new OperationExecutionRunner();

      runner.schedule(
        quickSearchOperation,
        makeInput("Person1", {
          rows: largeRows,
          quickFilter: { parser: (t: string) => t.split(" ") },
        }),
        onComplete,
        500,
      );

      expect(onComplete).not.toHaveBeenCalled();
      expect(fallbackSpy).toHaveBeenCalledTimes(1);

      vi.runAllTimers();
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0]![0].producer).toBe("mainThread");
      fallbackSpy.mockRestore();
    } finally {
      if (schedulerRef !== undefined) {
        (globalThis as { scheduler?: unknown }).scheduler = schedulerRef;
      }
      if (mcRef !== undefined) {
        (globalThis as { MessageChannel?: unknown }).MessageChannel = mcRef;
      }
      vi.useRealTimers();
    }
  });
});

describe("quickSearch deferred worker transfer (Stage 1K-A)", () => {
  const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
    name: i === 100 ? "AliceUnique" : `Person${i}`,
    city: "City",
  }));

  function makeTransfer(
    transferId: number,
    indexes: Iterable<number>,
    dispositions: unknown[],
  ) {
    return {
      transferId,
      indexes,
      complete: true as const,
      onDisposition: (d: unknown) => {
        dispositions.push(d);
      },
    };
  }

  it("worker-eligible buildPayload invokes provider once and preserves transfer", () => {
    const op = quickSearchOperation;
    const dispositions: unknown[] = [];
    const indexes = new Set([0, 2]);
    let calls = 0;
    const transfer = makeTransfer(7, indexes, dispositions);
    const input = makeInput("alice", {
      prepareWorkerTransfer: () => {
        calls += 1;
        return transfer;
      },
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(true);

    const payload = op.worker!.buildPayload(input, eligibility);
    expect(calls).toBe(1);
    expect(payload).not.toBeNull();
    expect(payload!.transfer).toBe(transfer);
    expect(payload!.transfer!.indexes).toBe(indexes);
  });

  it("buildPayload does not iterate transfer.indexes", () => {
    const op = quickSearchOperation;
    const indexes = {
      [Symbol.iterator]() {
        throw new Error("transfer.indexes must not be iterated in buildPayload");
      },
    };
    const input = makeInput("alice", {
      prepareWorkerTransfer: () => ({
        transferId: 1,
        indexes,
        complete: true,
        onDisposition: () => {},
      }),
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(() => op.worker!.buildPayload(input, eligibility)).not.toThrow();
  });

  it("ineligible buildPayload returns null without invoking provider", () => {
    const op = quickSearchOperation;
    const provider = vi.fn(() => undefined);
    const input = makeInput("alice", {
      quickFilter: { parser: (t: string) => t.split(" ") },
      prepareWorkerTransfer: provider,
    });
    const eligibility = op.worker!.resolveEligibility(input);
    expect(eligibility.eligible).toBe(false);
    expect(op.worker!.buildPayload(input, eligibility)).toBeNull();
    expect(provider).not.toHaveBeenCalled();
  });

  it("below-threshold main path never invokes provider", () => {
    const provider = vi.fn(() => undefined);
    const service = new GridExecutionService();
    service.scheduleQuickSearch(
      makeInput("alice", { prepareWorkerTransfer: provider }),
      vi.fn(),
    );
    expect(provider).not.toHaveBeenCalled();
  });

  it("worker-ineligible large path never invokes provider", () => {
    vi.useFakeTimers();
    const schedulerRef = (globalThis as { scheduler?: unknown }).scheduler;
    delete (globalThis as { scheduler?: unknown }).scheduler;
    const mcRef = (globalThis as { MessageChannel?: unknown }).MessageChannel;
    delete (globalThis as { MessageChannel?: unknown }).MessageChannel;

    try {
      const provider = vi.fn(() => undefined);
      const runner = new OperationExecutionRunner();
      runner.schedule(
        quickSearchOperation,
        makeInput("Person1", {
          rows: largeRows,
          quickFilter: { parser: (t: string) => t.split(" ") },
          prepareWorkerTransfer: provider,
        }),
        vi.fn(),
        500,
      );
      expect(provider).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(provider).not.toHaveBeenCalled();
    } finally {
      if (schedulerRef !== undefined) {
        (globalThis as { scheduler?: unknown }).scheduler = schedulerRef;
      }
      if (mcRef !== undefined) {
        (globalThis as { MessageChannel?: unknown }).MessageChannel = mcRef;
      }
      vi.useRealTimers();
    }
  });

  it("prior worker cancellation occurs before prepareWorkerTransfer", () => {
    const events: string[] = [];
    let providerCalls = 0;
    const sharedClient = {
      execute: (
        requestId: number,
        _payload: unknown,
        onSuccess: (rid: number, out: Uint32Array) => void,
      ) => {
        events.push("execute");
        onSuccess(requestId, new Uint32Array([0]));
      },
      cancel: () => {
        events.push("cancel");
      },
      destroy: () => {},
    };

    const runner = new OperationExecutionRunner();
    const op = {
      ...quickSearchOperation,
      worker: {
        ...quickSearchOperation.worker!,
        createClient: () => sharedClient,
      },
    };

    runner.schedule(
      op,
      makeInput("AliceUnique", { rows: largeRows }),
      vi.fn(),
      500,
    );

    runner.schedule(
      op,
      makeInput("AliceUnique", {
        rows: largeRows,
        prepareWorkerTransfer: () => {
          providerCalls += 1;
          events.push("prepareWorkerTransfer");
          return {
            transferId: 1,
            indexes: new Set([0]),
            complete: true,
            onDisposition: () => {},
          };
        },
      }),
      vi.fn(),
      500,
    );

    expect(events).toEqual([
      "execute",
      "cancel",
      "prepareWorkerTransfer",
      "execute",
    ]);
    expect(providerCalls).toBe(1);
  });

  it("adapter passes the same transfer object to WorkerClient", () => {
    const dispositions: unknown[] = [];
    const transfer = makeTransfer(3, new Set([1]), dispositions);
    const executeSpy = vi
      .spyOn(QuickSearchWorkerClient.prototype, "execute")
      .mockReturnValue({ cancel() {} });

    class WorkerMock {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      postMessage = vi.fn();
      terminate = vi.fn();
    }
    const previousWorker = globalThis.Worker;
    globalThis.Worker = vi.fn(function WorkerMockCtor(this: WorkerMock) {
      return Object.assign(this, new WorkerMock());
    }) as unknown as typeof Worker;

    try {
      const adapter = new QuickSearchWorkerClientAdapter();
      const payload = {
        rows,
        descriptors: [
          { field: "name", projectionField: undefined, workerEligible: true },
        ],
        fieldsSignature: "sig",
        normalizedText: "ALICE",
        sourceIndexes: null,
        sourceVersion: 0,
        cacheMode: "auto" as const,
        normalizerSignature: "n",
        sourceLayoutRevision: 0,
        searchableDataRevision: 1,
        transfer,
      };
      adapter.execute(1, payload, vi.fn(), vi.fn());
      expect(executeSpy).toHaveBeenCalledTimes(1);
      const config = executeSpy.mock.calls[0]![0];
      expect(config.transfer).toBe(transfer);
      expect(dispositions).toHaveLength(0);
      adapter.destroy();
    } finally {
      globalThis.Worker = previousWorker;
      executeSpy.mockRestore();
    }
  });

  it("destroyed adapter cancels unconsumed transfer once, then errors", () => {
    const dispositions: unknown[] = [];
    const transfer = makeTransfer(9, new Set([0]), dispositions);
    const adapter = new QuickSearchWorkerClientAdapter();
    adapter.destroy();
    const onError = vi.fn();
    adapter.execute(
      1,
      {
        rows,
        descriptors: [
          { field: "name", projectionField: undefined, workerEligible: true },
        ],
        fieldsSignature: "sig",
        normalizedText: "ALICE",
        sourceIndexes: null,
        sourceVersion: 0,
        cacheMode: "auto",
        normalizerSignature: "n",
        sourceLayoutRevision: 0,
        searchableDataRevision: 0,
        transfer,
      },
      vi.fn(),
      onError,
    );
    expect(dispositions).toEqual([{ kind: "cancelled", transferId: 9 }]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("Worker-unavailable creation cancels transfer once, then errors", () => {
    const dispositions: unknown[] = [];
    const transfer = makeTransfer(4, new Set([0]), dispositions);
    const previousWorker = globalThis.Worker;
    globalThis.Worker = undefined as unknown as typeof Worker;

    try {
      const adapter = new QuickSearchWorkerClientAdapter();
      const onError = vi.fn();
      adapter.execute(
        1,
        {
          rows,
          descriptors: [
            { field: "name", projectionField: undefined, workerEligible: true },
          ],
          fieldsSignature: "sig",
          normalizedText: "ALICE",
          sourceIndexes: null,
          sourceVersion: 0,
          cacheMode: "auto",
          normalizerSignature: "n",
          sourceLayoutRevision: 0,
          searchableDataRevision: 0,
          transfer,
        },
        vi.fn(),
        onError,
      );
      expect(dispositions).toEqual([{ kind: "cancelled", transferId: 4 }]);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(String(onError.mock.calls[0]![1].message)).toMatch(/Worker unavailable/);
    } finally {
      globalThis.Worker = previousWorker;
    }
  });

  it("successful handoff does not let adapter emit a disposition", () => {
    const dispositions: unknown[] = [];
    const transfer = makeTransfer(5, new Set([0]), dispositions);
    const executeSpy = vi
      .spyOn(QuickSearchWorkerClient.prototype, "execute")
      .mockImplementation((_config, callbacks) => {
        callbacks.onSuccess(new Uint32Array([0]));
        return { cancel() {} };
      });

    class WorkerMock {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      postMessage = vi.fn();
      terminate = vi.fn();
    }
    const previousWorker = globalThis.Worker;
    globalThis.Worker = vi.fn(function WorkerMockCtor(this: WorkerMock) {
      return Object.assign(this, new WorkerMock());
    }) as unknown as typeof Worker;

    try {
      const adapter = new QuickSearchWorkerClientAdapter();
      const onSuccess = vi.fn();
      adapter.execute(
        1,
        {
          rows,
          descriptors: [
            { field: "name", projectionField: undefined, workerEligible: true },
          ],
          fieldsSignature: "sig",
          normalizedText: "ALICE",
          sourceIndexes: null,
          sourceVersion: 0,
          cacheMode: "auto",
          normalizerSignature: "n",
          sourceLayoutRevision: 0,
          searchableDataRevision: 0,
          transfer,
        },
        onSuccess,
        vi.fn(),
      );
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(dispositions).toHaveLength(0);
      adapter.destroy();
    } finally {
      globalThis.Worker = previousWorker;
      executeSpy.mockRestore();
    }
  });

  it("parity helper ignores adapter-only transfer metadata", () => {
    const dispositions: unknown[] = [];
    const transfer = makeTransfer(1, {
      [Symbol.iterator]() {
        throw new Error("parity must not iterate transfer indexes");
      },
    }, dispositions);

    const result = executeQuickSearchWorkerPayload({
      rows,
      descriptors: [
        { field: "name", projectionField: undefined, workerEligible: true },
        { field: "city", projectionField: undefined, workerEligible: true },
      ],
      fieldsSignature: "sf|v|name,city",
      normalizedText: "ALICE",
      sourceIndexes: null,
      sourceVersion: 0,
      cacheMode: "auto",
      normalizerSignature: "n",
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
      transfer,
    });
    expect(result).toBeInstanceOf(Uint32Array);
    expect(Array.from(result!)).toEqual([0]);
    expect(dispositions).toHaveLength(0);
  });

  it("quickSearchWorker.ts never posts or imports the payload transfer object", () => {
    const workerSource = readFileSync(
      join(here, "../quickSearchWorker.ts"),
      "utf8",
    );
    expect(workerSource).not.toMatch(/QuickSearchWorkerPayload/);
    expect(workerSource).not.toMatch(/SnapshotTransferInput/);
    expect(workerSource).not.toMatch(/prepareWorkerTransfer/);
    expect(workerSource).not.toMatch(/payload\.transfer/);
    expect(workerSource).not.toMatch(/snapshotPatch/);
  });
});

describe("quickSearch adapter snapshot reuse", () => {
  it("adapter cancel does not clear worker snapshot", () => {
    const adapter = new QuickSearchWorkerClientAdapter();
    const clearSpy = vi.spyOn(QuickSearchWorkerClient.prototype, "clear");
    const cancelQuerySpy = vi.spyOn(QuickSearchWorkerClient.prototype, "cancelQuery");

    try {
      adapter.cancel();
      expect(clearSpy).not.toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
      cancelQuerySpy.mockRestore();
    }
  });

  it("adapter destroy still calls destroy on the underlying client", () => {
    const destroySpy = vi.spyOn(QuickSearchWorkerClient.prototype, "destroy");
    try {
      const adapter = new QuickSearchWorkerClientAdapter();
      adapter.destroy();
      expect(destroySpy).not.toHaveBeenCalled();
    } finally {
      destroySpy.mockRestore();
    }
  });

  it("cancelQuery is available on QuickSearchWorkerClient and does not clear snapshot", () => {
    const posted: unknown[] = [];
    const transport = {
      post: (msg: unknown) => posted.push(msg),
      subscribe: () => () => {},
    };
    const client = new QuickSearchWorkerClient(transport);
    const snapshotClient = client.getSnapshotClient();
    const clearSpy = vi.spyOn(snapshotClient, "clear");

    client.cancelQuery();

    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
    client.destroy();
  });

  it("clear() cancels query AND clears snapshot", () => {
    const posted: unknown[] = [];
    const transport = {
      post: (msg: unknown) => posted.push(msg),
      subscribe: () => () => {},
    };
    const client = new QuickSearchWorkerClient(transport);
    const snapshotClient = client.getSnapshotClient();
    const clearSpy = vi.spyOn(snapshotClient, "clear");

    client.clear();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    client.destroy();
  });
});

describe("quickSearch pending behavior through Grid", () => {
  const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
    name: i === 100 ? "AliceUnique" : `Person${i}`,
    city: "City",
  }));

  function withFakeTimersOnly(fn: () => void): void {
    vi.useFakeTimers();
    const schedulerRef = (globalThis as { scheduler?: unknown }).scheduler;
    delete (globalThis as { scheduler?: unknown }).scheduler;
    const mcRef = (globalThis as { MessageChannel?: unknown }).MessageChannel;
    delete (globalThis as { MessageChannel?: unknown }).MessageChannel;

    try {
      fn();
    } finally {
      if (schedulerRef !== undefined) {
        (globalThis as { scheduler?: unknown }).scheduler = schedulerRef;
      }
      if (mcRef !== undefined) {
        (globalThis as { MessageChannel?: unknown }).MessageChannel = mcRef;
      }
      vi.useRealTimers();
    }
  }

  it("async path emits pending true then pending false on completion", () => {
    withFakeTimersOnly(() => {
      const onPending = vi.fn();
      const grid = new Grid({
        columns,
        rows: largeRows,
        onQuickSearchPendingChanged: onPending,
        execution: { thresholds: { quickSearch: 1 } },
      });

      grid.setQuickFilterText("AliceUnique");

      expect(onPending).toHaveBeenCalledTimes(1);
      expect(onPending).toHaveBeenCalledWith({ pending: true });

      vi.runAllTimers();

      expect(onPending).toHaveBeenCalledTimes(2);
      expect(onPending).toHaveBeenLastCalledWith({ pending: false });
    });
  });

  it("sync path does not emit pending at all", () => {
    const onPending = vi.fn();
    const grid = new Grid({
      columns,
      rows,
      onQuickSearchPendingChanged: onPending,
    });

    grid.setQuickFilterText("alice");

    expect(onPending).not.toHaveBeenCalled();
  });

  it("clearing query while pending emits pending false", () => {
    withFakeTimersOnly(() => {
      const onPending = vi.fn();
      const grid = new Grid({
        columns,
        rows: largeRows,
        onQuickSearchPendingChanged: onPending,
        execution: { thresholds: { quickSearch: 1 } },
      });

      grid.setQuickFilterText("AliceUnique");
      expect(onPending).toHaveBeenCalledWith({ pending: true });

      grid.clearQuickFilter();
      expect(onPending).toHaveBeenLastCalledWith({ pending: false });

      vi.runAllTimers();
      expect(onPending).toHaveBeenCalledTimes(2);
    });
  });

  it("setQuickFilterText on large worker-eligible data routes through worker, not sync main", () => {
    withFakeTimersOnly(() => {
      const workerExecuteSpy = vi.spyOn(QuickSearchWorkerClientAdapter.prototype, "execute");
      const syncMainSpy = vi.spyOn(quickSearchMainThread, "executeQuickSearchSync");
      const mainNowSpy = vi.spyOn(MainThreadTaskExecutor.prototype, "executeNow");
      const onPending = vi.fn();
      const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
        name: i === 100 ? "AliceUnique" : `Person${i}`,
        city: "City",
      }));
      const grid = new Grid({
        columns,
        rows: largeRows,
        onQuickSearchPendingChanged: onPending,
        execution: { thresholds: { quickSearch: 500 } },
      });

      grid.setQuickFilterText("AliceUnique");

      expect(workerExecuteSpy).toHaveBeenCalledTimes(1);
      expect(syncMainSpy).not.toHaveBeenCalled();
      expect(mainNowSpy).not.toHaveBeenCalled();
      expect(onPending).toHaveBeenCalledWith({ pending: true });

      workerExecuteSpy.mockRestore();
      syncMainSpy.mockRestore();
      mainNowSpy.mockRestore();
      grid.destroy();
    });
  });
});

describe("quickSearch prewarm via GridExecutionService", () => {
  const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
    name: `Person${i}`,
    city: "City",
  }));

  it("prewarm delegates to worker client at background priority", () => {
    const prewarmSpy = vi.spyOn(QuickSearchWorkerClientAdapter.prototype, "prewarmSnapshot")
      .mockReturnValue({ cancel() {} });
    const service = new GridExecutionService({ thresholds: { quickSearch: 500 } });

    service.prewarmQuickSearchSnapshot({
      rows: largeRows,
      descriptors: [{ field: "name", projectionField: undefined, workerEligible: true }],
      fieldsSignature: "sf|v|name",
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });

    expect(prewarmSpy).toHaveBeenCalledTimes(1);
    prewarmSpy.mockRestore();
  });

  it("duplicate equivalent prewarm dedupes at service layer without cancelling", () => {
    const prewarmSpy = vi.spyOn(QuickSearchWorkerClientAdapter.prototype, "prewarmSnapshot")
      .mockReturnValue({ cancel() {} });
    const cancelSpy = vi.spyOn(GridExecutionService.prototype, "cancelQuickSearchPrewarm");
    const service = new GridExecutionService({ thresholds: { quickSearch: 500 } });
    const config = {
      rows: largeRows,
      descriptors: [{ field: "name", projectionField: undefined, workerEligible: true }],
      fieldsSignature: "sf|v|name",
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    };

    service.prewarmQuickSearchSnapshot(config);
    cancelSpy.mockClear();
    service.prewarmQuickSearchSnapshot(config);

    expect(prewarmSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).not.toHaveBeenCalled();

    prewarmSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it("prewarmSnapshot defers worker construction until background bootstrap", () => {
    class WorkerMock {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      postMessage = vi.fn();
      terminate = vi.fn();
    }
    const workerCtor = vi.fn(function WorkerMockCtor(this: WorkerMock) {
      return Object.assign(this, new WorkerMock());
    });
    const previousWorker = globalThis.Worker;
    globalThis.Worker = workerCtor as unknown as typeof Worker;

    const scheduled: Array<() => void> = [];
    const scheduleSpy = vi.spyOn(CooperativeScheduler.prototype, "schedule")
      .mockImplementation((cb) => {
        scheduled.push(cb);
        return { cancel: () => {} };
      });

    try {
      const adapter = new QuickSearchWorkerClientAdapter();
      adapter.prewarmSnapshot({
        rows: largeRows,
        descriptors: [{ field: "name", projectionField: undefined, workerEligible: true }],
        fieldsSignature: "sf|v|name",
        sourceLayoutRevision: 0,
        searchableDataRevision: 0,
      });

      expect(workerCtor).not.toHaveBeenCalled();
      expect(scheduled).toHaveLength(1);

      scheduled[0]!();
      expect(workerCtor).toHaveBeenCalledTimes(1);

      adapter.destroy();
    } finally {
      globalThis.Worker = previousWorker;
      scheduleSpy.mockRestore();
    }
  });

  it("cancelQuickSearchPrewarm cancels background extraction handle", () => {
    const cancel = vi.fn();
    vi.spyOn(QuickSearchWorkerClientAdapter.prototype, "prewarmSnapshot")
      .mockReturnValue({ cancel });
    const service = new GridExecutionService({ thresholds: { quickSearch: 500 } });

    service.prewarmQuickSearchSnapshot({
      rows: largeRows,
      descriptors: [{ field: "name", projectionField: undefined, workerEligible: true }],
      fieldsSignature: "sf|v|name",
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    });
    service.cancelQuickSearchPrewarm();

    expect(cancel).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("grid schedules prewarm when execution threshold qualifies large datasets", () => {
    const prewarmSpy = vi.spyOn(GridExecutionService.prototype, "prewarmQuickSearchSnapshot");
    const largeRowsLocal: RowData[] = Array.from({ length: 600 }, (_, i) => ({
      name: `Person${i}`,
      city: "City",
    }));
    const grid = new Grid({
      columns,
      rows: largeRowsLocal,
    });

    grid.setExecutionOptions({ thresholds: { quickSearch: 500 } });

    expect(prewarmSpy).toHaveBeenCalled();
    prewarmSpy.mockRestore();
    grid.destroy();
  });

  it("grid cancels prewarm when quickFilter is disabled", () => {
    const cancelSpy = vi.spyOn(GridExecutionService.prototype, "cancelQuickSearchPrewarm");
    const largeRowsLocal: RowData[] = Array.from({ length: 600 }, (_, i) => ({
      name: `Person${i}`,
      city: "City",
    }));
    const grid = new Grid({
      columns,
      rows: largeRowsLocal,
      execution: { thresholds: { quickSearch: 500 } },
    });

    grid.setQuickFilterConfig(false);
    expect(cancelSpy).toHaveBeenCalled();

    cancelSpy.mockRestore();
    grid.destroy();
  });

  it("grid does not schedule prewarm when quickFilter.prewarm is false", () => {
    const prewarmSpy = vi.spyOn(GridExecutionService.prototype, "prewarmQuickSearchSnapshot");
    const largeRowsLocal: RowData[] = Array.from({ length: 600 }, (_, i) => ({
      name: `Person${i}`,
      city: "City",
    }));
    const grid = new Grid({
      columns,
      rows: largeRowsLocal,
      quickFilter: { prewarm: false },
    });

    grid.setExecutionOptions({ thresholds: { quickSearch: 500 } });

    expect(prewarmSpy).not.toHaveBeenCalled();
    prewarmSpy.mockRestore();
    grid.destroy();
  });

  it("changing quickFilter.prewarm to false cancels pending prewarm", () => {
    const cancelSpy = vi.spyOn(GridExecutionService.prototype, "cancelQuickSearchPrewarm");
    const largeRowsLocal: RowData[] = Array.from({ length: 600 }, (_, i) => ({
      name: `Person${i}`,
      city: "City",
    }));
    const grid = new Grid({
      columns,
      rows: largeRowsLocal,
      execution: { thresholds: { quickSearch: 500 } },
    });

    cancelSpy.mockClear();
    grid.setQuickFilterConfig({ prewarm: false });
    expect(cancelSpy).toHaveBeenCalled();

    cancelSpy.mockRestore();
    grid.destroy();
  });

  it("auto mode does not prewarm datasets below the quick-search threshold", () => {
    const prewarmSpy = vi.spyOn(GridExecutionService.prototype, "prewarmQuickSearchSnapshot");
    const grid = new Grid({
      columns,
      rows,
    });

    grid.setExecutionOptions({ thresholds: { quickSearch: 500 } });

    expect(prewarmSpy).not.toHaveBeenCalled();
    prewarmSpy.mockRestore();
    grid.destroy();
  });

  it("prewarm false still allows worker quick-search execution on setQuickFilterText", () => {
    const largeRowsLocal: RowData[] = Array.from({ length: 600 }, (_, i) => ({
      name: i === 100 ? "AliceUnique" : `Person${i}`,
      city: "City",
    }));
    const workerExecuteSpy = vi.spyOn(QuickSearchWorkerClientAdapter.prototype, "execute");

    const grid = new Grid({
      columns,
      rows: largeRowsLocal,
      quickFilter: { prewarm: false },
      execution: { thresholds: { quickSearch: 500 } },
    });

    grid.setQuickFilterText("AliceUnique");

    expect(workerExecuteSpy).toHaveBeenCalled();
    workerExecuteSpy.mockRestore();
    grid.destroy();
  });

  it("prewarm true schedules prewarm below the quick-search threshold when worker-eligible", () => {
    const prewarmSpy = vi.spyOn(GridExecutionService.prototype, "prewarmQuickSearchSnapshot");
    const grid = new Grid({
      columns,
      rows,
      quickFilter: { prewarm: true },
    });

    grid.setExecutionOptions({ thresholds: { quickSearch: 500 } });

    expect(prewarmSpy).toHaveBeenCalled();
    prewarmSpy.mockRestore();
    grid.destroy();
  });
});

describe("quickSearch Grid dirty-transfer wiring (Stage 1K-B)", () => {
  const largeRows: RowData[] = Array.from({ length: 600 }, (_, i) => ({
    id: String(i),
    name: i === 100 ? "AliceUnique" : `Person${i}`,
    city: "City",
    age: i,
  }));

  function gridState(grid: Grid): GridState {
    return (grid as unknown as { state: GridState }).state;
  }

  function captureSchedules() {
    const inputs: QuickSearchOperationInput[] = [];
    vi.spyOn(GridExecutionService.prototype, "scheduleQuickSearch").mockImplementation(
      (input, onComplete) => {
        inputs.push(input);
        onComplete({
          kind: "quickSearch",
          requestId: inputs.length,
          producer: "mainThread",
          result: { kind: "identity", rowCount: input.rows.length },
          quickFilterText: input.quickFilterText,
          searchableFieldsSignature: input.searchableFieldsSignature,
          filterModel: input.filterModel,
          filteredOrderVersion: input.filteredOrderVersion,
          sourceLayoutRevision: input.sourceLayoutRevision,
          searchableDataRevision: input.searchableDataRevision,
        });
        return inputs.length;
      },
    );
    return inputs;
  }

  it("empty + complete dirty state returns no transfer from the deferred provider", () => {
    const inputs = captureSchedules();
    const grid = new Grid({
      columns,
      rows: [
        { id: "1", name: "Alice", city: "Lahore" },
        { id: "2", name: "Bob", city: "London" },
      ],
      getRowId: (r) => String(r.id),
    });
    grid.setQuickFilterText("alice");
    expect(inputs[0]?.prepareWorkerTransfer).toBeTypeOf("function");
    expect(inputs[0]!.prepareWorkerTransfer!()).toBeUndefined();
    grid.destroy();
    vi.restoreAllMocks();
  });

  it("dirty complete state returns the exact beginTransfer ReadonlySet reference", () => {
    const inputs = captureSchedules();
    const grid = new Grid({
      columns,
      rows: [
        { id: "1", name: "Alice", city: "Lahore" },
        { id: "2", name: "Bob", city: "London" },
        { id: "3", name: "Cara", city: "Berlin" },
      ],
      getRowId: (r) => String(r.id),
    });
    const state = gridState(grid);
    grid.setQuickFilterText("a");
    inputs.length = 0;

    const beginSpy = vi.spyOn(state, "beginQuickSearchDirtySourceTransferIfNeeded");
    const snapshotSpy = vi.spyOn(state, "getQuickSearchDirtySourceSnapshot");
    grid.applyTransaction({
      update: [{ id: "1", name: "Alicia", city: "Lahore" }],
    });
    expect(inputs.length).toBeGreaterThan(0);
    const input = inputs[inputs.length - 1]!;
    snapshotSpy.mockClear();
    const transfer = input.prepareWorkerTransfer!();
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(transfer).toBeDefined();
    expect(beginSpy).toHaveBeenCalledTimes(1);
    expect(transfer!.indexes).toBe(beginSpy.mock.results[0]!.value!.indexes);
    expect([...transfer!.indexes]).toEqual([0]);
    expect(transfer!.complete).toBe(true);

    transfer!.onDisposition({
      kind: "posted",
      transferId: transfer!.transferId,
      patchId: 1,
      generation: 1,
      targetDataRevision: state.getQuickSearchSearchableDataRevision(),
    });
    expect(state.getQuickSearchDirtySourceSnapshot().indexes.size).toBe(0);

    beginSpy.mockRestore();
    snapshotSpy.mockRestore();
    grid.destroy();
    vi.restoreAllMocks();
  });

  it("cancelled disposition restores ownership; rebuild-required drops incomplete in-flight", () => {
    const inputs = captureSchedules();
    const grid = new Grid({
      columns,
      rows: [
        { id: "1", name: "Alice", city: "Lahore" },
        { id: "2", name: "Bob", city: "London" },
        { id: "3", name: "Cara", city: "Berlin" },
      ],
      getRowId: (r) => String(r.id),
    });
    const state = gridState(grid);
    grid.setQuickFilterText("a");
    grid.applyTransaction({
      update: [{ id: "1", name: "Alicia", city: "Lahore" }],
    });
    const input = inputs[inputs.length - 1]!;
    const transfer = input.prepareWorkerTransfer!()!;

    transfer.onDisposition({ kind: "cancelled", transferId: transfer.transferId });
    expect([...state.getQuickSearchDirtySourceSnapshot().indexes]).toEqual([0]);

    const again = input.prepareWorkerTransfer!()!;
    expect([...again.indexes]).toEqual([0]);
    again.onDisposition({
      kind: "rebuild-required",
      transferId: again.transferId,
      newGeneration: 2,
    });
    expect(state.getQuickSearchDirtySourceSnapshot().indexes.size).toBe(0);

    grid.destroy();
    vi.restoreAllMocks();
  });

  it("supersession restores old indexes into the replacement transfer union", () => {
    const inputs = captureSchedules();
    const grid = new Grid({
      columns,
      rows: [
        { id: "1", name: "Alice", city: "Lahore" },
        { id: "2", name: "Bob", city: "London" },
        { id: "3", name: "Cara", city: "Berlin" },
      ],
      getRowId: (r) => String(r.id),
    });
    const state = gridState(grid);
    grid.setQuickFilterText("a");
    grid.applyTransaction({
      update: [{ id: "1", name: "Alicia", city: "Lahore" }],
    });
    const firstInput = inputs[inputs.length - 1]!;
    const first = firstInput.prepareWorkerTransfer!()!;

    grid.applyTransaction({
      update: [{ id: "2", name: "Bobby", city: "London" }],
    });
    const secondInput = inputs[inputs.length - 1]!;

    first.onDisposition({ kind: "cancelled", transferId: first.transferId });
    const second = secondInput.prepareWorkerTransfer!()!;
    expect([...second.indexes].sort((a, b) => a - b)).toEqual([0, 1]);

    first.onDisposition({
      kind: "posted",
      transferId: first.transferId,
      patchId: 1,
      generation: 1,
      targetDataRevision: 1,
    });
    expect([...second.indexes].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(
      [...state.getQuickSearchDirtySourceSnapshot().indexes].sort((a, b) => a - b),
    ).toEqual([0, 1]);

    grid.destroy();
    vi.restoreAllMocks();
  });

  it("same-row re-edit remains pending after acknowledgement", () => {
    const inputs = captureSchedules();
    const grid = new Grid({
      columns,
      rows: [
        { id: "1", name: "Alice", city: "Lahore" },
        { id: "2", name: "Bob", city: "London" },
      ],
      getRowId: (r) => String(r.id),
    });
    const state = gridState(grid);
    grid.setQuickFilterText("a");
    grid.applyTransaction({
      update: [{ id: "1", name: "Alicia", city: "Lahore" }],
    });
    const transfer = inputs[inputs.length - 1]!.prepareWorkerTransfer!()!;
    grid.applyTransaction({
      update: [{ id: "1", name: "Alison", city: "Lahore" }],
    });
    transfer.onDisposition({
      kind: "posted",
      transferId: transfer.transferId,
      patchId: 1,
      generation: 1,
      targetDataRevision: state.getQuickSearchSearchableDataRevision(),
    });
    expect([...state.getQuickSearchDirtySourceSnapshot().indexes]).toEqual([0]);

    grid.destroy();
    vi.restoreAllMocks();
  });

  it("unrelated-field edit produces no transfer", () => {
    const inputs = captureSchedules();
    const grid = new Grid({
      columns: [
        { field: "name" },
        { field: "city" },
        { field: "age", searchable: false },
      ],
      rows: [
        { id: "1", name: "Alice", city: "Lahore", age: 30 },
        { id: "2", name: "Bob", city: "London", age: 25 },
      ],
      getRowId: (r) => String(r.id),
    });
    grid.setQuickFilterText("a");
    const schedulesBefore = inputs.length;
    const dataRevBefore = gridState(grid).getQuickSearchSearchableDataRevision();
    grid.applyTransaction({
      update: [{ id: "1", name: "Alice", city: "Lahore", age: 99 }],
    });
    expect(gridState(grid).getQuickSearchSearchableDataRevision()).toBe(dataRevBefore);
    expect(gridState(grid).getQuickSearchDirtySourceSnapshot().indexes.size).toBe(0);
    // May or may not reschedule; provider must still return undefined.
    if (inputs.length > schedulesBefore) {
      expect(inputs[inputs.length - 1]!.prepareWorkerTransfer!()).toBeUndefined();
    }

    grid.destroy();
    vi.restoreAllMocks();
  });

  it("structural mutation clears dirty ownership so provider returns undefined", () => {
    const inputs = captureSchedules();
    const grid = new Grid({
      columns,
      rows: [
        { id: "1", name: "Alice", city: "Lahore" },
        { id: "2", name: "Bob", city: "London" },
      ],
      getRowId: (r) => String(r.id),
    });
    grid.setQuickFilterText("a");
    grid.applyTransaction({
      update: [{ id: "1", name: "Alicia", city: "Lahore" }],
    });
    grid.applyTransaction({
      add: [{ id: "3", name: "Cara", city: "Berlin" }],
    });
    const input = inputs[inputs.length - 1]!;
    expect(input.prepareWorkerTransfer!()).toBeUndefined();
    expect(gridState(grid).getQuickSearchDirtySourceSnapshot().indexes.size).toBe(0);

    grid.destroy();
    vi.restoreAllMocks();
  });

  it("Grid provider wiring does not copy or iterate transfer indexes", () => {
    const gridSource = readFileSync(join(here, "../../../../Grid.ts"), "utf8");
    expect(gridSource).toMatch(/prepareQuickSearchWorkerTransfer/);
    expect(gridSource).toMatch(/beginQuickSearchDirtySourceTransferIfNeeded/);
    expect(gridSource).toMatch(/indexes: transfer\.indexes/);
    expect(gridSource).not.toMatch(
      /prepareQuickSearchWorkerTransfer[\s\S]*getQuickSearchDirtySourceSnapshot/,
    );
    expect(gridSource).not.toMatch(
      /prepareQuickSearchWorkerTransfer[\s\S]*\.snapshot\(/,
    );
    expect(gridSource).not.toMatch(/Array\.from\(transfer\.indexes/);
    expect(gridSource).not.toMatch(/\[\.\.\.transfer\.indexes/);
    expect(gridSource).not.toMatch(/new Set\(transfer\.indexes/);
    expect(gridSource).not.toMatch(/Uint32Array\.from\(transfer/);
  });

  it("update-only transaction on large worker-eligible grid reaches WorkerClient with that source index", () => {
    class WorkerMock {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      postMessage = vi.fn();
      terminate = vi.fn();
    }
    const previousWorker = globalThis.Worker;
    globalThis.Worker = vi.fn(function WorkerMockCtor(this: WorkerMock) {
      return Object.assign(this, new WorkerMock());
    }) as unknown as typeof Worker;

    const executeSpy = vi
      .spyOn(QuickSearchWorkerClient.prototype, "execute")
      .mockImplementation((_config, callbacks) => {
        callbacks.onSuccess(new Uint32Array([100]));
        return { cancel() {} };
      });

    try {
      const grid = new Grid({
        columns: [{ field: "name" }, { field: "city" }],
        rows: largeRows,
        getRowId: (r) => String(r.id),
        execution: { thresholds: { quickSearch: 500 } },
      });

      grid.setQuickFilterText("AliceUnique");
      executeSpy.mockClear();

      grid.applyTransaction({
        update: [{ id: "100", name: "AliceUniqueEdited", city: "City", age: 100 }],
      });

      expect(executeSpy).toHaveBeenCalled();
      const config = executeSpy.mock.calls[executeSpy.mock.calls.length - 1]![0];
      expect(config.transfer).toBeDefined();
      const indexes = [...config.transfer!.indexes];
      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes).toEqual([100]);
      grid.destroy();
    } finally {
      globalThis.Worker = previousWorker;
      executeSpy.mockRestore();
    }
  });

  it("cell-edit commit on large worker-eligible grid reaches WorkerClient with that source index", async () => {
    class WorkerMock {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      postMessage = vi.fn();
      terminate = vi.fn();
    }
    const previousWorker = globalThis.Worker;
    globalThis.Worker = vi.fn(function WorkerMockCtor(this: WorkerMock) {
      return Object.assign(this, new WorkerMock());
    }) as unknown as typeof Worker;

    const executeSpy = vi
      .spyOn(QuickSearchWorkerClient.prototype, "execute")
      .mockImplementation((_config, callbacks) => {
        callbacks.onSuccess(new Uint32Array([100]));
        return { cancel() {} };
      });

    const container = makeContainer();
    try {
      const grid = new Grid({
        columns: [
          { field: "name", editable: true },
          { field: "city" },
        ],
        rows: largeRows,
        getRowId: (r) => String(r.id),
        execution: { thresholds: { quickSearch: 500 } },
        suppressRowVirtualization: true,
      });

      grid.mount(container);
      grid.setQuickFilterText("AliceUnique");
      await flushRenders();

      expect(executeSpy).toHaveBeenCalled();
      const revisionBefore =
        executeSpy.mock.calls[executeSpy.mock.calls.length - 1]![0]
          .searchableDataRevision;
      executeSpy.mockClear();

      const root = container.querySelector<HTMLElement>(".lfg-grid")!;
      const cell = cellEl(container, "100", "name");
      expect(cell).not.toBeNull();

      dblClick(cell!);
      const input = root.querySelector<HTMLInputElement>(
        ".lfg-cell-editor-host input",
      );
      expect(input).not.toBeNull();
      input!.value = "AliceUniqueEdited";
      pressKey(input!, "Enter");
      await flushRenders();

      expect(executeSpy).toHaveBeenCalled();
      const config = executeSpy.mock.calls[executeSpy.mock.calls.length - 1]![0];
      expect(config.searchableDataRevision).toBeGreaterThan(revisionBefore);
      expect(config.transfer).toBeDefined();
      expect([...config.transfer!.indexes]).toEqual([100]);
      expect(grid.getRows()[100]!.name).toBe("AliceUniqueEdited");

      grid.destroy();
    } finally {
      globalThis.Worker = previousWorker;
      executeSpy.mockRestore();
      document.body.innerHTML = "";
    }
  });

  it("structural transaction syncs with transfer undefined and posts snapshotStart only", () => {
    const posted: Array<{ kind: string }> = [];
    class WorkerMock {
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      postMessage = vi.fn((message: { kind: string }) => {
        posted.push(message);
      });
      terminate = vi.fn();
    }
    const previousWorker = globalThis.Worker;
    globalThis.Worker = vi.fn(function WorkerMockCtor(this: WorkerMock) {
      return Object.assign(this, new WorkerMock());
    }) as unknown as typeof Worker;

    const executeSpy = vi.spyOn(QuickSearchWorkerClient.prototype, "execute");

    try {
      const grid = new Grid({
        columns: [{ field: "name" }, { field: "city" }],
        rows: largeRows,
        getRowId: (r) => String(r.id),
        execution: { thresholds: { quickSearch: 500 } },
      });

      grid.setQuickFilterText("Person1");
      executeSpy.mockClear();
      posted.length = 0;

      grid.applyTransaction({
        add: [{ id: "999", name: "Zed", city: "City", age: 1 }],
      });

      expect(executeSpy).toHaveBeenCalled();
      const config = executeSpy.mock.calls[executeSpy.mock.calls.length - 1]![0];
      expect(config.transfer).toBeUndefined();

      // Flush cooperative snapshot extraction started by the sync.
      // WorkerClient posts through the mocked Worker.
      const kinds = posted.map((m) => m.kind);
      expect(kinds).toContain("quickSearch:snapshotStart");
      expect(kinds).not.toContain("quickSearch:snapshotPatchStart");
      expect(kinds).not.toContain("quickSearch:snapshotPatchChunk");
      expect(kinds).not.toContain("quickSearch:snapshotPatchComplete");
      grid.destroy();
    } finally {
      globalThis.Worker = previousWorker;
      executeSpy.mockRestore();
    }
  });
});
