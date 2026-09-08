import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { makeSnapshot } from "../../../../features/csv-export/__tests__/support";
import type { CsvExportSnapshot } from "../../../../features/csv-export/csvExportSnapshot";
import type {
  CsvContentRow,
  CsvExportDefaults,
} from "../../../../features/csv-export/csvExportTypes";
import { normalizeCsvExportOptions } from "../../../../features/csv-export/normalizeCsvExportOptions";
import type { CsvPlannedColumn } from "../../../../features/csv-export/planCsvColumnScope";
import type { CsvGroupHeaderPlan } from "../../../../features/csv-export/planCsvGroupHeaders";
import type { CsvRowPlan } from "../../../../features/csv-export/planCsvRowScope";
import type {
  CooperativeScheduleOptions,
  CooperativeSchedulerBackend,
} from "../../../../scheduling/CooperativeScheduler";
import { CooperativeScheduler } from "../../../../scheduling/CooperativeScheduler";
import type { ColumnDef, RowData } from "../../../../types";
import {
  createCsvExportProjectionProducer,
  type CsvExportProjectionBudgets,
  type CsvExportProjectionCompletion,
  type CsvExportProjectionProducerHandle,
  type CsvExportProjectionRuntime,
} from "../csvExportProjectionProducer";
import type { CsvChunkRequest } from "../csvExportProtocol";
import type { CsvProjectionChunkLimits } from "../csvProjectionChunk";

interface ManualSchedulerBackend extends CooperativeSchedulerBackend {
  flushOne(): boolean;
  flushAll(limit?: number): number;
  pendingCount(): number;
  readonly options: Array<CooperativeScheduleOptions | undefined>;
}

function manualSchedulerBackend(): ManualSchedulerBackend {
  const queue: Array<{ callback: () => void; cancelled: boolean }> = [];
  const options: Array<CooperativeScheduleOptions | undefined> = [];
  return {
    options,
    schedule(callback, scheduleOptions) {
      const entry = { callback, cancelled: false };
      queue.push(entry);
      options.push(scheduleOptions);
      return {
        cancel() {
          entry.cancelled = true;
        },
      };
    },
    flushOne() {
      while (queue.length > 0) {
        const entry = queue.shift()!;
        if (entry.cancelled) continue;
        entry.callback();
        return true;
      }
      return false;
    },
    flushAll(limit = 10_000) {
      let count = 0;
      while (this.flushOne()) {
        count++;
        if (count > limit) throw new Error("scheduler did not quiesce");
      }
      return count;
    },
    pendingCount() {
      return queue.filter((entry) => !entry.cancelled).length;
    },
  };
}

class ArrayRowPlan implements CsvRowPlan {
  readonly knownRowCount: number;
  stepCount = 0;
  private index = 0;

  constructor(private readonly indexes: readonly number[]) {
    this.knownRowCount = indexes.length;
  }

  step(out: number[], maxWorkUnits: number): boolean {
    this.stepCount++;
    let remaining = Math.max(1, Math.floor(maxWorkUnits));
    while (remaining > 0 && this.index < this.indexes.length) {
      out.push(this.indexes[this.index++]!);
      remaining--;
    }
    return this.index >= this.indexes.length;
  }
}

function dataColumn(column: ColumnDef): CsvPlannedColumn {
  return { kind: "data", column, field: column.field };
}

function rowNumberColumn(startAt = 1): CsvPlannedColumn {
  return { kind: "rowNumber", headerName: "Row", startAt };
}

interface HarnessOptions {
  rows?: readonly RowData[];
  snapshot?: CsvExportSnapshot;
  rowPlan?: CsvRowPlan;
  plannedColumns?: readonly CsvPlannedColumn[];
  groupHeaderPlan?: CsvGroupHeaderPlan;
  runtime?: CsvExportProjectionRuntime;
  budgets?: Partial<CsvExportProjectionBudgets>;
  chunkLimits?: Partial<CsvProjectionChunkLimits>;
  normalizedOverrides?: CsvExportDefaults;
  now?: () => number;
  onChunk?: (chunk: CsvChunkRequest) => boolean;
}

interface Harness {
  backend: ManualSchedulerBackend;
  handle: CsvExportProjectionProducerHandle;
  chunks: CsvChunkRequest[];
  completions: CsvExportProjectionCompletion[];
  cancellations: unknown[];
  errors: unknown[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const rows = options.rows ?? [];
  const snapshot = options.snapshot ?? makeSnapshot({ sourceRows: rows });
  const rowPlan = options.rowPlan ?? new ArrayRowPlan(rows.map((_row, i) => i));
  const backend = manualSchedulerBackend();
  const chunks: CsvChunkRequest[] = [];
  const completions: CsvExportProjectionCompletion[] = [];
  const cancellations: unknown[] = [];
  const errors: unknown[] = [];
  const handle = createCsvExportProjectionProducer({
    snapshot,
    rowPlan,
    plannedColumns: options.plannedColumns ?? [],
    groupHeaderPlan: options.groupHeaderPlan ?? { rows: [] },
    normalized: normalizeCsvExportOptions({
      includeColumnHeaders: false,
      ...options.normalizedOverrides,
    }),
    runtime: options.runtime ?? {},
    scheduler: new CooperativeScheduler(backend),
    now: options.now ?? (() => 0),
    taskId: 41,
    budgets: options.budgets,
    chunkLimits: options.chunkLimits,
    onChunk: (chunk) => {
      chunks.push(chunk);
      return options.onChunk?.(chunk) ?? true;
    },
    onProjectionComplete: (result) => completions.push(result),
    onCancelled: (reason) => cancellations.push(reason),
    onError: (error) => errors.push(error),
  });
  return { backend, handle, chunks, completions, cancellations, errors };
}

function drain(harness: Harness): void {
  let acknowledged = 0;
  let guard = 0;
  harness.handle.start();
  while (
    harness.completions.length === 0 &&
    harness.cancellations.length === 0 &&
    harness.errors.length === 0
  ) {
    harness.backend.flushAll();
    const chunk = harness.chunks[acknowledged];
    if (chunk !== undefined) {
      acknowledged++;
      harness.handle.acknowledgeChunk(chunk.sequence, chunk.final);
    } else if (harness.backend.pendingCount() === 0) {
      throw new Error("projection producer stalled");
    }
    if (++guard > 100_000) throw new Error("projection producer did not finish");
  }
}

function flattenChunkRows(
  chunks: readonly CsvChunkRequest[],
): Array<Array<CsvChunkRequest["values"][number]>> {
  const rows: Array<Array<CsvChunkRequest["values"][number]>> = [];
  let openRow: Array<CsvChunkRequest["values"][number]> = [];
  for (const chunk of chunks) {
    let valueIndex = 0;
    for (const rowEnd of chunk.rowEnds) {
      openRow.push(...chunk.values.slice(valueIndex, rowEnd));
      rows.push(openRow);
      openRow = [];
      valueIndex = rowEnd;
    }
    openRow.push(...chunk.values.slice(valueIndex));
  }
  expect(openRow).toEqual([]);
  return rows;
}

describe("csvExportProjectionProducer - scheduling and phases", () => {
  it("constructs and starts without synchronous planning or projection", () => {
    const rowPlan = new ArrayRowPlan([0]);
    const valueGetter = vi.fn(() => "A");
    const shouldExportRow = vi.fn(() => true);
    const harness = createHarness({
      rows: [{ id: "a" }],
      rowPlan,
      plannedColumns: [dataColumn({ field: "name", valueGetter })],
      runtime: { shouldExportRow },
    });

    expect(rowPlan.stepCount).toBe(0);
    harness.handle.start();
    expect(rowPlan.stepCount).toBe(0);
    expect(valueGetter).not.toHaveBeenCalled();
    expect(shouldExportRow).not.toHaveBeenCalled();
    expect(harness.chunks).toEqual([]);
    expect(harness.backend.options).toEqual([{ priority: "user-visible" }]);
  });

  it("preserves prepend, group, leaf, data, append, and final order", () => {
    const callbackOrder: string[] = [];
    const groupHeaderPlan: CsvGroupHeaderPlan = {
      rows: [
        {
          level: 0,
          segments: [
            {
              run: {
                groupId: "group",
                headerName: "Group",
                level: 0,
                fields: ["name"],
              },
              startColumnIndex: 0,
              span: 1,
            },
          ],
        },
      ],
    };
    const harness = createHarness({
      rows: [{ name: "data" }],
      plannedColumns: [dataColumn({ field: "name", headerName: "Name" })],
      groupHeaderPlan,
      normalizedOverrides: { includeColumnHeaders: true },
      runtime: {
        prependContent: [[{ value: "prepend" }]],
        appendContent: [[{ value: "append" }]],
        processGroupHeader: ({ headerName }) => {
          callbackOrder.push("group");
          return `group:${headerName}`;
        },
        processHeader: ({ headerName }) => {
          callbackOrder.push("leaf");
          return `leaf:${headerName}`;
        },
        shouldExportRow: () => {
          callbackOrder.push("should");
          return true;
        },
        processCell: ({ rawValue }) => {
          callbackOrder.push("cell");
          return `cell:${String(rawValue)}`;
        },
      },
    });

    drain(harness);

    expect(flattenChunkRows(harness.chunks)).toEqual([
      ["prepend"],
      ["group:Group"],
      ["leaf:Name"],
      ["cell:data"],
      ["append"],
    ]);
    expect(callbackOrder).toEqual(["group", "leaf", "should", "cell"]);
    expect(harness.chunks[harness.chunks.length - 1]?.final).toBe(true);
  });
});

describe("csvExportProjectionProducer - acknowledgement backpressure", () => {
  it("retains one in-flight chunk and schedules exact acknowledgement continuation", () => {
    const processCell = vi.fn(({ rawValue }: { rawValue: unknown }) =>
      String(rawValue),
    );
    const harness = createHarness({
      rows: [{ a: "aa", b: "bb" }],
      plannedColumns: [
        dataColumn({ field: "a" }),
        dataColumn({ field: "b" }),
      ],
      runtime: { processCell },
      budgets: { maxFieldsPerBatch: 1 },
      chunkLimits: { maxEstimatedBytes: 1 },
    });
    harness.handle.start();
    harness.backend.flushOne();

    const first = harness.chunks[0]!;
    expect(first.final).toBe(false);
    expect(processCell).toHaveBeenCalledTimes(1);
    expect(harness.backend.pendingCount()).toBe(0);
    harness.backend.flushAll();
    expect(harness.chunks).toHaveLength(1);

    harness.handle.acknowledgeChunk(first.sequence + 1, first.final);
    harness.handle.acknowledgeChunk(first.sequence, !first.final);
    expect(harness.backend.pendingCount()).toBe(0);
    expect(processCell).toHaveBeenCalledTimes(1);

    harness.handle.acknowledgeChunk(first.sequence, first.final);
    expect(processCell).toHaveBeenCalledTimes(1);
    expect(harness.backend.pendingCount()).toBe(1);
    harness.handle.acknowledgeChunk(first.sequence, first.final);
    expect(harness.backend.pendingCount()).toBe(1);

    harness.backend.flushOne();
    expect(processCell).toHaveBeenCalledTimes(2);
    expect(harness.chunks).toHaveLength(2);
  });

  it("does not project directly from a reentrant acknowledgement", () => {
    const processCell = vi.fn(({ rawValue }: { rawValue: unknown }) =>
      String(rawValue),
    );
    const rows: RowData[] = [{ a: "aa", b: "bb" }];
    const backend = manualSchedulerBackend();
    const chunks: CsvChunkRequest[] = [];
    const handle = createCsvExportProjectionProducer({
      snapshot: makeSnapshot({ sourceRows: rows }),
      rowPlan: new ArrayRowPlan([0]),
      plannedColumns: [dataColumn({ field: "a" }), dataColumn({ field: "b" })],
      groupHeaderPlan: { rows: [] },
      normalized: normalizeCsvExportOptions({ includeColumnHeaders: false }),
      runtime: { processCell },
      scheduler: new CooperativeScheduler(backend),
      now: () => 0,
      taskId: 42,
      budgets: { maxFieldsPerBatch: 1 },
      chunkLimits: { maxEstimatedBytes: 1 },
      onChunk: (chunk) => {
        chunks.push(chunk);
        handle.acknowledgeChunk(chunk.sequence, chunk.final);
        return true;
      },
      onProjectionComplete: vi.fn(),
      onCancelled: vi.fn(),
      onError: vi.fn(),
    });

    handle.start();
    backend.flushOne();

    expect(chunks).toHaveLength(1);
    expect(processCell).toHaveBeenCalledTimes(1);
    expect(backend.pendingCount()).toBe(1);
    backend.flushOne();
    expect(processCell).toHaveBeenCalledTimes(2);
  });
});

describe("csvExportProjectionProducer - cooperative ceilings", () => {
  it("yields independently for time, row, and projected-byte ceilings", () => {
    let clock = 0;
    const timeHarness = createHarness({
      rows: [{ v: "a" }, { v: "b" }],
      plannedColumns: [dataColumn({ field: "v" })],
      now: () => clock++,
      budgets: {
        timeBudgetMs: 1,
        maxRowsPerSlice: 1_000,
        maxProjectedBytesPerSlice: 1_000_000,
      },
    });
    drain(timeHarness);
    expect(timeHarness.backend.options.length).toBeGreaterThan(1);

    const rowPlan = new ArrayRowPlan([0, 1, 2]);
    const rowHarness = createHarness({
      rows: [{ v: 1 }, { v: 2 }, { v: 3 }],
      rowPlan,
      plannedColumns: [dataColumn({ field: "v" })],
      budgets: {
        maxRowsPerSlice: 1,
        maxProjectedBytesPerSlice: 1_000_000,
      },
    });
    rowHarness.handle.start();
    let previousSteps = 0;
    while (rowHarness.chunks.length === 0) {
      expect(rowHarness.backend.flushOne()).toBe(true);
      expect(rowPlan.stepCount - previousSteps).toBeLessThanOrEqual(1);
      previousSteps = rowPlan.stepCount;
    }

    const byteCalls = vi.fn();
    const byteHarness = createHarness({
      rows: [{ a: "large", b: "large", c: "large" }],
      plannedColumns: [
        dataColumn({ field: "a" }),
        dataColumn({ field: "b" }),
        dataColumn({ field: "c" }),
      ],
      runtime: {
        processCell: ({ rawValue }) => {
          byteCalls();
          return String(rawValue);
        },
      },
      budgets: {
        maxProjectedBytesPerSlice: 1,
        maxRowsPerSlice: 1_000,
      },
    });
    drain(byteHarness);
    expect(byteCalls).toHaveBeenCalledTimes(3);
    expect(byteHarness.backend.options.length).toBeGreaterThan(1);
  });

  it("sanitizes invalid budgets and still progresses with an exhausted clock", () => {
    const harness = createHarness({
      rows: [{ v: "value" }],
      plannedColumns: [dataColumn({ field: "v" })],
      now: () => Number.POSITIVE_INFINITY,
      budgets: {
        timeBudgetMs: 0,
        maxRowsPerSlice: Number.NaN,
        maxProjectedBytesPerSlice: -1,
        maxFieldsPerBatch: 0,
      },
    });

    drain(harness);

    expect(flattenChunkRows(harness.chunks)).toEqual([["value"]]);
    expect(harness.backend.options.length).toBeGreaterThan(1);
    expect(harness.backend.options).toEqual(
      harness.backend.options.map(() => ({ priority: "user-visible" })),
    );
  });
});

describe("csvExportProjectionProducer - continuation correctness", () => {
  it("resumes wide rows and huge mergeAcross spans without skips or duplicates", () => {
    const wideRow: RowData = {};
    const columns: CsvPlannedColumn[] = [];
    for (let i = 0; i < 100; i++) {
      wideRow[`c${i}`] = i;
      columns.push(dataColumn({ field: `c${i}` }));
    }
    const wide = createHarness({
      rows: [wideRow],
      plannedColumns: columns,
      budgets: { maxFieldsPerBatch: 3 },
      chunkLimits: { maxValues: 7 },
    });
    drain(wide);
    expect(flattenChunkRows(wide.chunks)).toEqual([
      Array.from({ length: 100 }, (_value, i) => i),
    ]);

    const content: CsvContentRow = [{ value: "merged", mergeAcross: 9_999 }];
    const merged = createHarness({
      runtime: { prependContent: [content] },
      budgets: { maxFieldsPerBatch: 5 },
      chunkLimits: { maxValues: 11 },
    });
    drain(merged);
    const mergedRow = flattenChunkRows(merged.chunks)[0]!;
    expect(mergedRow).toHaveLength(10_000);
    expect(mergedRow[0]).toBe("merged");
    expect(mergedRow.slice(1).every((value) => value === undefined)).toBe(true);
  });

  it("keeps synthetic row numbers contiguous after skipped candidates", () => {
    const shouldExportRow = vi.fn(({ row }: { row: RowData }) => row.keep === true);
    const harness = createHarness({
      rows: [
        { name: "A", keep: true },
        { name: "B", keep: false },
        { name: "C", keep: true },
      ],
      plannedColumns: [rowNumberColumn(), dataColumn({ field: "name" })],
      runtime: { shouldExportRow },
      chunkLimits: { maxValues: 1 },
    });

    drain(harness);

    expect(flattenChunkRows(harness.chunks)).toEqual([
      [1, "A"],
      [2, "C"],
    ]);
    expect(shouldExportRow).toHaveBeenCalledTimes(3);
    expect(harness.completions).toEqual([
      { exportedRowCount: 2, candidateRowCount: 3, columnCount: 2 },
    ]);
  });

  it("invokes group, leaf, row, getter, formatter, and cell callbacks once", () => {
    const getter = vi.fn(() => "raw");
    const formatter = vi.fn(({ value }: { value: unknown }) => `f:${String(value)}`);
    const processCell = vi.fn(
      ({ rawValue }: { rawValue: unknown }) => `p:${String(rawValue)}`,
    );
    const shouldExportRow = vi.fn(() => true);
    const processHeader = vi.fn(() => "leaf");
    const processGroupHeader = vi.fn(() => "group");
    const column = dataColumn({
      field: "value",
      valueGetter: getter,
      valueFormatter: formatter,
    });
    const harness = createHarness({
      rows: [{ value: "ignored" }],
      plannedColumns: [column],
      groupHeaderPlan: {
        rows: [
          {
            level: 0,
            segments: [
              {
                run: {
                  groupId: "g",
                  headerName: "G",
                  level: 0,
                  fields: ["value"],
                },
                startColumnIndex: 0,
                span: 1,
              },
            ],
          },
        ],
      },
      normalizedOverrides: { includeColumnHeaders: true },
      runtime: {
        shouldExportRow,
        processCell,
        processHeader,
        processGroupHeader,
      },
      chunkLimits: { maxValues: 1 },
    });

    drain(harness);

    expect(shouldExportRow).toHaveBeenCalledTimes(1);
    expect(getter).toHaveBeenCalledTimes(1);
    expect(formatter).toHaveBeenCalledTimes(1);
    expect(processCell).toHaveBeenCalledTimes(1);
    expect(processHeader).toHaveBeenCalledTimes(1);
    expect(processGroupHeader).toHaveBeenCalledTimes(1);
  });
});

describe("csvExportProjectionProducer - cancellation and terminal ownership", () => {
  it("cancels scheduled and acknowledgement-waiting work exactly once", () => {
    const scheduled = createHarness({
      rows: [{ v: "a" }],
      plannedColumns: [dataColumn({ field: "v" })],
    });
    const scheduledReason = new Error("scheduled");
    scheduled.handle.start();
    scheduled.handle.cancel(scheduledReason);
    scheduled.handle.cancel(new Error("again"));
    scheduled.backend.flushAll();
    expect(scheduled.cancellations).toEqual([scheduledReason]);
    expect(scheduled.chunks).toEqual([]);

    const waiting = createHarness({
      rows: [{ v: "oversized" }],
      plannedColumns: [dataColumn({ field: "v" })],
      chunkLimits: { maxEstimatedBytes: 1 },
    });
    waiting.handle.start();
    waiting.backend.flushAll();
    const chunk = waiting.chunks[0]!;
    const waitingReason = new Error("waiting");
    waiting.handle.cancel(waitingReason);
    waiting.handle.acknowledgeChunk(chunk.sequence, chunk.final);
    waiting.backend.flushAll();
    expect(waiting.cancellations).toEqual([waitingReason]);
    expect(waiting.chunks).toHaveLength(1);
    expect(waiting.completions).toEqual([]);
    expect(waiting.errors).toEqual([]);
  });

  it("stops cell projection after reentrant row-decision cancellation", () => {
    const processCell = vi.fn();
    const reason = new Error("reentrant row cancellation");
    const backend = manualSchedulerBackend();
    const cancellations: unknown[] = [];
    const handle = createCsvExportProjectionProducer({
      snapshot: makeSnapshot({ sourceRows: [{ v: "a" }] }),
      rowPlan: new ArrayRowPlan([0]),
      plannedColumns: [dataColumn({ field: "v" })],
      groupHeaderPlan: { rows: [] },
      normalized: normalizeCsvExportOptions({ includeColumnHeaders: false }),
      runtime: {
        shouldExportRow: () => {
          handle.cancel(reason);
          return true;
        },
        processCell,
      },
      scheduler: new CooperativeScheduler(backend),
      now: () => 0,
      taskId: 43,
      onChunk: () => true,
      onProjectionComplete: vi.fn(),
      onCancelled: (value) => cancellations.push(value),
      onError: vi.fn(),
    });

    handle.start();
    backend.flushAll();

    expect(cancellations).toEqual([reason]);
    expect(processCell).not.toHaveBeenCalled();
  });

  it("makes reentrant chunk cancellation and a false chunk result terminal", () => {
    const cancelReason = new Error("chunk callback cancellation");
    const cancellations: unknown[] = [];
    const backend = manualSchedulerBackend();
    const cancellingHandle = createCsvExportProjectionProducer({
      snapshot: makeSnapshot(),
      rowPlan: new ArrayRowPlan([]),
      plannedColumns: [],
      groupHeaderPlan: { rows: [] },
      normalized: normalizeCsvExportOptions({ includeColumnHeaders: false }),
      runtime: {},
      scheduler: new CooperativeScheduler(backend),
      now: () => 0,
      taskId: 44,
      onChunk: () => {
        cancellingHandle.cancel(cancelReason);
        return true;
      },
      onProjectionComplete: vi.fn(),
      onCancelled: (reason) => cancellations.push(reason),
      onError: vi.fn(),
    });
    cancellingHandle.start();
    backend.flushAll();
    expect(cancellations).toEqual([cancelReason]);

    const rejected = createHarness({ onChunk: () => false });
    rejected.handle.start();
    rejected.backend.flushAll();
    expect(rejected.errors).toHaveLength(1);
    expect(rejected.completions).toEqual([]);
    expect(rejected.cancellations).toEqual([]);
  });

  it("propagates callback errors once without later projection", () => {
    const failure = new Error("getter failed");
    const processCell = vi.fn();
    const harness = createHarness({
      rows: [{ v: "a" }],
      plannedColumns: [
        dataColumn({
          field: "v",
          valueGetter: () => {
            throw failure;
          },
        }),
      ],
      runtime: { processCell },
    });
    harness.handle.start();
    harness.backend.flushAll();
    harness.handle.cancel(new Error("late"));
    expect(harness.errors).toEqual([failure]);
    expect(processCell).not.toHaveBeenCalled();
    expect(harness.chunks).toEqual([]);
  });
});

describe("csvExportProjectionProducer - final handshake and boundaries", () => {
  it("emits an empty final marker and settles once only after exact final ack", () => {
    const harness = createHarness();
    harness.handle.start();
    harness.backend.flushAll();

    expect(harness.chunks).toHaveLength(1);
    const finalChunk = harness.chunks[0]!;
    expect(finalChunk).toMatchObject({
      kind: "csv:chunk",
      sequence: 0,
      values: [],
      estimatedBytes: 0,
      final: true,
    });
    expect(Array.from(finalChunk.rowEnds)).toEqual([]);
    expect(harness.completions).toEqual([]);

    harness.handle.acknowledgeChunk(finalChunk.sequence, false);
    expect(harness.completions).toEqual([]);
    harness.handle.acknowledgeChunk(finalChunk.sequence, true);
    harness.handle.acknowledgeChunk(finalChunk.sequence, true);
    expect(harness.completions).toEqual([
      { exportedRowCount: 0, candidateRowCount: 0, columnCount: 0 },
    ]);
  });

  it("contains no eager projection or forbidden feature dependencies", () => {
    const source = readFileSync(
      new URL("../csvExportProjectionProducer.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/projectCsv(Row|Headers)/u);
    expect(source).not.toMatch(
      /renderer|filters|quick-search|column-menu|react|CsvOutputSink/u,
    );
    expect(source).toContain("private readonly projectedValues");
    expect(source).toContain("DEFAULT_CSV_PROJECTION_MAX_FIELDS_PER_BATCH = 64");
  });
});
