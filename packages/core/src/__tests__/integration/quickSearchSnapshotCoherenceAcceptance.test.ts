// @vitest-environment jsdom

/**
 * Quick Search V2 Snapshot Coherence — Stage 1 consolidated acceptance.
 *
 * End-to-end integration through a REAL worker pipeline: Grid → GridState →
 * GridExecutionService → OperationExecutionRunner → QuickSearchWorkerClient →
 * QuickSearchSnapshotClient → (loopback Worker transport) →
 * QuickSearchWorkerRuntime → QuickSearchQueryEngine, with responses flowing
 * back into the Grid completion guards.
 *
 * Closes the integration-level rows of the research test matrix (§14):
 * tests 1, 2, 5, 6, 13, 14, 15, 23, 24, 28 — plus percentage projection
 * patch values (test 10). All other matrix rows are covered by the unit
 * suites listed in the coverage map.
 */

import { describe, expect, it, vi } from "vitest";

import { MainThreadTaskExecutor } from "../../execution/MainThreadTaskExecutor";
import type {
  QuickSearchWorkerRequest,
  QuickSearchWorkerResponse,
  SnapshotPatchChunkMessage,
} from "../../execution/operations/quick-search/quickSearchProtocol";
import { QuickSearchWorkerRuntime } from "../../execution/operations/quick-search/quickSearchWorkerRuntime";
import { Grid } from "../../Grid";
import { GridState } from "../../state/GridState";
import type { LightFastGridProps, RowData } from "../../types";

// ── Loopback worker transport ───────────────────────────────────────────
//
// globalThis.Worker is stubbed with a class that feeds posted messages
// into a real QuickSearchWorkerRuntime and delivers runtime responses back
// to message listeners on a microtask (matching real async worker delivery
// without wall-clock timing).

interface LoopbackControls {
  posted: QuickSearchWorkerRequest[];
  dropPatchChunks: boolean;
  workerInstances: number;
}

function installLoopbackWorker(): {
  controls: LoopbackControls;
  restore: () => void;
} {
  const controls: LoopbackControls = {
    posted: [],
    dropPatchChunks: false,
    workerInstances: 0,
  };
  const previousWorker = globalThis.Worker;

  class LoopbackWorker implements Worker {
    onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
    onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
    onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;

    private readonly listeners = new Set<EventListenerOrEventListenerObject>();
    private readonly runtime: QuickSearchWorkerRuntime;

    constructor() {
      controls.workerInstances++;
      this.runtime = new QuickSearchWorkerRuntime((response) => {
        queueMicrotask(() => {
          this.dispatchEvent(new MessageEvent<QuickSearchWorkerResponse>(
            "message",
            { data: response },
          ));
        });
      });
    }

    postMessage(message: QuickSearchWorkerRequest): void {
      controls.posted.push(message);
      if (
        controls.dropPatchChunks &&
        message.kind === "quickSearch:snapshotPatchChunk"
      ) {
        return;
      }
      this.runtime.handleMessage(message);
    }

    addEventListener<K extends keyof WorkerEventMap>(
      type: K,
      listener: (this: Worker, ev: WorkerEventMap[K]) => unknown,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      _options?: boolean | AddEventListenerOptions,
    ): void {
      if (type === "message") this.listeners.add(listener);
    }

    removeEventListener<K extends keyof WorkerEventMap>(
      type: K,
      listener: (this: Worker, ev: WorkerEventMap[K]) => unknown,
      options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      _options?: boolean | EventListenerOptions,
    ): void {
      if (type === "message") this.listeners.delete(listener);
    }

    terminate(): void {
      this.listeners.clear();
    }

    dispatchEvent(event: Event): boolean {
      for (const listener of [...this.listeners]) {
        if (typeof listener === "function") {
          listener.call(this, event);
        } else {
          listener.handleEvent(event);
        }
      }
      if (event.type === "message" && event instanceof MessageEvent) {
        this.onmessage?.call(this, event);
      }
      return true;
    }
  }

  vi.stubGlobal("Worker", LoopbackWorker);
  return {
    controls,
    restore: () => {
      vi.stubGlobal("Worker", previousWorker);
    },
  };
}

// ── Async settling (no wall-clock assertions) ───────────────────────────

async function settle(
  until: () => boolean,
  what: string,
  maxTicks = 400,
): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (until()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`settle timed out waiting for: ${what}`);
}

/** Drain any pending scheduled callbacks (background bootstrap, chunks). */
async function flushScheduled(ticks = 8): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

// ── Grid helpers ────────────────────────────────────────────────────────

// 120 rows keeps even a half-filtered source (60 rows) at or above the
// worker threshold, so filter-scoped re-queries stay on the worker path.
const ROW_COUNT = 120;
const THRESHOLD = 50;

function makeRows(): RowData[] {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: String(i),
    name: `Person${String(i).padStart(3, "0")}`,
    city: i % 2 === 0 ? "EvenTown" : "OddTown",
  }));
}

function makeGrid(overrides?: Partial<LightFastGridProps>): Grid {
  return new Grid({
    columns: [
      { field: "name" },
      { field: "city", filter: "text" },
    ],
    rows: makeRows(),
    getRowId: (r) => String(r.id),
    execution: { thresholds: { quickSearch: THRESHOLD } },
    quickFilter: true,
    ...overrides,
  });
}

function stateOf(grid: Grid): GridState {
  const candidate = Reflect.get(grid, "state");
  if (!(candidate instanceof GridState)) {
    throw new Error("Grid.state is not a GridState instance");
  }
  return candidate;
}

function visibleRowIds(grid: Grid): string[] {
  const view = stateOf(grid).getSnapshot().rowView;
  return Array.from({ length: view.rowCount }, (_, i) =>
    String(view.getRow(i)?.id),
  );
}

function kinds(messages: readonly QuickSearchWorkerRequest[]): string[] {
  return messages.map((m) => m.kind);
}

function patchChunks(
  messages: readonly QuickSearchWorkerRequest[],
): SnapshotPatchChunkMessage[] {
  return messages.filter(
    (m): m is SnapshotPatchChunkMessage =>
      m.kind === "quickSearch:snapshotPatchChunk",
  );
}

async function runQuery(
  grid: Grid,
  text: string,
  expected: string[],
): Promise<void> {
  grid.setQuickFilterText(text);
  await settle(
    () =>
      !stateOf(grid).isQuickSearchPending() &&
      JSON.stringify(visibleRowIds(grid)) === JSON.stringify(expected),
    `query "${text}" to resolve to [${expected.join(", ")}]`,
  );
}

// ── Mounted-editor helpers (test 24) ────────────────────────────────────

function makeContainer(): HTMLDivElement {
  const c = document.createElement("div");
  Object.assign(c.style, { width: "600px", height: "400px" });
  document.body.appendChild(c);
  return c;
}

async function flushRenders(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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
  el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
}

function pressKey(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

// ── Acceptance scenarios ────────────────────────────────────────────────

describe("Stage 1 snapshot coherence acceptance (Grid + loopback worker)", () => {
  // Matrix 1 (+6): prewarm poisoning path.
  it("prewarm → empty query → searchable edit → first query finds the new value and old text stops matching", async () => {
    const { controls, restore } = installLoopbackWorker();
    const container = makeContainer();
    const grid = makeGrid({
      columns: [
        { field: "name", editable: true },
        { field: "city", filter: "text" },
      ],
      suppressRowVirtualization: true,
    });
    try {
      // Prewarm fires on mount for threshold-qualifying data.
      grid.mount(container);
      await settle(
        () => kinds(controls.posted).includes("quickSearch:snapshotComplete"),
        "prewarm snapshot to complete",
      );

      grid.setQuickFilterText(""); // explicit empty query — no worker query
      expect(kinds(controls.posted)).not.toContain("quickSearch:query");
      const marker = controls.posted.length;

      await flushRenders();
      const root = container.querySelector<HTMLElement>(".lfg-grid")!;
      const cell = cellEl(container, "10", "name");
      expect(cell).not.toBeNull();
      dblClick(cell!);
      const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input");
      expect(input).not.toBeNull();
      input!.value = "ZebraTarget";
      pressKey(input!, "Enter");

      // Allow the automatic edit-time prewarm to run. It must retain the
      // completed revision-N base without posting or extracting anything.
      await flushScheduled();
      expect(controls.posted.slice(marker)).toHaveLength(0);

      await runQuery(grid, "ZebraTarget", ["10"]);
      const delta = controls.posted.slice(marker);
      expect(kinds(delta)).toEqual([
        "quickSearch:snapshotPatchStart",
        "quickSearch:snapshotPatchChunk",
        "quickSearch:snapshotPatchComplete",
        "quickSearch:query",
      ]);
      expect(patchChunks(delta).flatMap((chunk) => chunk.updates)).toHaveLength(1);
      // Old text of the edited row must no longer match anything.
      await runQuery(grid, "Person010", []);
    } finally {
      grid.destroy();
      restore();
      document.body.innerHTML = "";
    }
  });

  // Matrix 2 (+ E2E slice of 7): warm → clear → edit → re-query.
  it("warm worker snapshot → clear query → searchable edit → next query finds the new value; exact pre-edit repeat is not stale", async () => {
    const { restore } = installLoopbackWorker();
    const grid = makeGrid();
    try {
      await runQuery(grid, "Person012", ["12"]);
      grid.setQuickFilterText(""); // clear

      grid.applyTransaction({
        update: [{ id: "12", name: "QuantumRow", city: "EvenTown" }],
      });

      await runQuery(grid, "QuantumRow", ["12"]);
      // Exact repeat of the pre-edit query cannot serve stale cached indexes.
      await runQuery(grid, "Person012", []);
    } finally {
      grid.destroy();
      restore();
    }
  });

  // Matrix 5 + 6 + E2E slice of 3/4: the bug repro.
  it("bug repro: warm snapshot → COW edit patches (not rebuild) → same-ref edit patches → newest text found, older stops matching", async () => {
    const { controls, restore } = installLoopbackWorker();
    const grid = makeGrid();
    try {
      await runQuery(grid, "Person005", ["5"]);
      const marker1 = controls.posted.length;

      // Edit #1 — first mutation after replaceAll COWs the rows array.
      grid.applyTransaction({
        update: [{ id: "5", name: "AlphaEdit", city: "OddTown" }],
      });
      await runQuery(grid, "AlphaEdit", ["5"]);

      const delta1 = kinds(controls.posted.slice(marker1));
      expect(delta1).toContain("quickSearch:snapshotPatchStart");
      expect(delta1).toContain("quickSearch:snapshotPatchComplete");
      expect(delta1).not.toContain("quickSearch:snapshotStart");

      const marker2 = controls.posted.length;

      // Edit #2 — same array reference (already owned). The original bug:
      // reuse keyed on rows identity served stale text here.
      grid.applyTransaction({
        update: [{ id: "5", name: "BetaEdit", city: "OddTown" }],
      });
      await runQuery(grid, "BetaEdit", ["5"]);

      const delta2 = kinds(controls.posted.slice(marker2));
      expect(delta2).toContain("quickSearch:snapshotPatchStart");
      expect(delta2).not.toContain("quickSearch:snapshotStart");

      // Both older generations of the text must no longer match.
      await runQuery(grid, "AlphaEdit", []);
      await runQuery(grid, "Person005", []);
    } finally {
      grid.destroy();
      restore();
    }
  });

  // Matrix 13: one transactional patch sequence per batch, not per row.
  it("multi-row update-only transaction emits exactly one patch sequence covering all edited rows", async () => {
    const { controls, restore } = installLoopbackWorker();
    const grid = makeGrid();
    try {
      await runQuery(grid, "Person", visibleRowIds(grid));
      const marker = controls.posted.length;

      grid.applyTransaction({
        update: [
          { id: "3", name: "BatchThree", city: "OddTown" },
          { id: "7", name: "BatchSeven", city: "OddTown" },
          { id: "9", name: "BatchNine", city: "OddTown" },
        ],
      });
      await runQuery(grid, "BatchSeven", ["7"]);

      const delta = controls.posted.slice(marker);
      const deltaKinds = kinds(delta);
      expect(
        deltaKinds.filter((k) => k === "quickSearch:snapshotPatchStart"),
      ).toHaveLength(1);
      expect(
        deltaKinds.filter((k) => k === "quickSearch:snapshotPatchComplete"),
      ).toHaveLength(1);
      expect(deltaKinds).not.toContain("quickSearch:snapshotStart");

      const patchedIndexes = patchChunks(delta)
        .flatMap((chunk) => chunk.updates.map((u) => u.rowIndex))
        .sort((a, b) => a - b);
      expect(patchedIndexes).toEqual([3, 7, 9]);
    } finally {
      grid.destroy();
      restore();
    }
  });

  // Matrix 14 (transport level): unrelated edit is a protocol no-op.
  it("unrelated-field edit posts no worker messages and does not bump searchableDataRevision", async () => {
    const { controls, restore } = installLoopbackWorker();
    const grid = makeGrid();
    try {
      await runQuery(grid, "Person02", ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"]);
      const revisionBefore = stateOf(grid).getQuickSearchSearchableDataRevision();
      const marker = controls.posted.length;

      // "score" is not a column — not searchable, not filterable.
      grid.applyTransaction({
        update: [{ id: "20", name: "Person020", city: "EvenTown", score: 99 }],
      });
      // Give any (incorrect) scheduling a chance to run.
      await settle(() => !stateOf(grid).isQuickSearchPending(), "no pending work");

      expect(stateOf(grid).getQuickSearchSearchableDataRevision()).toBe(revisionBefore);
      expect(controls.posted.slice(marker)).toEqual([]);
      expect(visibleRowIds(grid)).toEqual([
        "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
      ]);
    } finally {
      grid.destroy();
      restore();
    }
  });

  // Matrix 15 (transport level): filter-only change re-queries only.
  it("filter-only scope change re-queries without patch, rebuild, or data-revision bump", async () => {
    const { controls, restore } = installLoopbackWorker();
    const grid = makeGrid();
    try {
      await runQuery(grid, "Person00", ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
      const revisionBefore = stateOf(grid).getQuickSearchSearchableDataRevision();
      const marker = controls.posted.length;

      grid.setFilterModel({
        city: { type: "text", conditions: [{ operator: "contains", value: "EvenTown" }] },
      });
      await settle(
        () =>
          !stateOf(grid).isQuickSearchPending() &&
          JSON.stringify(visibleRowIds(grid)) ===
            JSON.stringify(["0", "2", "4", "6", "8"]),
        "filter-scoped quick search over even rows",
      );

      const deltaKinds = kinds(controls.posted.slice(marker));
      expect(deltaKinds).not.toContain("quickSearch:snapshotStart");
      expect(deltaKinds).not.toContain("quickSearch:snapshotPatchStart");
      expect(deltaKinds).toContain("quickSearch:query");
      expect(stateOf(grid).getQuickSearchSearchableDataRevision()).toBe(revisionBefore);
    } finally {
      grid.destroy();
      restore();
    }
  });

  // Matrix 23 (+29 E2E slice): typed patch rejection → exactly one worker
  // rebuild, no main-thread fallback, correct final results.
  it("dropped patch chunk → typed rejection → exactly one worker rebuild, no main-thread fallback, correct results", async () => {
    const { controls, restore } = installLoopbackWorker();
    const deferredSpy = vi.spyOn(MainThreadTaskExecutor.prototype, "scheduleDeferred");
    const grid = makeGrid();
    try {
      await runQuery(grid, "Person033", ["33"]);
      const marker = controls.posted.length;

      controls.dropPatchChunks = true;
      grid.applyTransaction({
        update: [{ id: "33", name: "RecoveryTarget", city: "OddTown" }],
      });
      await runQuery(grid, "RecoveryTarget", ["33"]);

      const deltaKinds = kinds(controls.posted.slice(marker));
      // The patch was attempted, rejected (missing chunk), and recovered
      // through exactly one full worker rebuild.
      expect(deltaKinds).toContain("quickSearch:snapshotPatchStart");
      expect(
        deltaKinds.filter((k) => k === "quickSearch:snapshotStart"),
      ).toHaveLength(1);

      const quickSearchFallbacks = deferredSpy.mock.calls.filter(
        (call) => call[0] === "quickSearch",
      );
      expect(quickSearchFallbacks).toHaveLength(0);

      // Recovery must not leave stale text behind.
      await runQuery(grid, "Person033", []);
    } finally {
      grid.destroy();
      restore();
      deferredSpy.mockRestore();
    }
  });

  // Matrix 28: disable → edits → re-enable must not reuse the pre-disable
  // snapshot (§9: disable clears the worker snapshot; re-enable is a fresh
  // generation; disabled-window edits are untracked by design).
  it("disable → searchable edits → re-enable starts a fresh snapshot and finds text edited while disabled", async () => {
    const { controls, restore } = installLoopbackWorker();
    const grid = makeGrid();
    try {
      await runQuery(grid, "Person040", ["40"]);

      grid.setQuickFilterConfig(false);
      // §9: disabling must clear the worker snapshot.
      await settle(
        () => kinds(controls.posted).includes("quickSearch:clearSnapshot"),
        "clearSnapshot on disable",
      );

      // Untracked edit during the disabled window.
      grid.applyTransaction({
        update: [{ id: "40", name: "PhoenixRow", city: "EvenTown" }],
      });

      // Re-enable schedules the retained query immediately, so mark first.
      const marker = controls.posted.length;
      grid.setQuickFilterConfig(true);

      await runQuery(grid, "PhoenixRow", ["40"]);
      // The query ran against a freshly built snapshot, not stale reuse.
      expect(kinds(controls.posted.slice(marker))).toContain(
        "quickSearch:snapshotStart",
      );
      await runQuery(grid, "Person040", []);
    } finally {
      grid.destroy();
      restore();
    }
  });

  // §9 lifecycle safety: disabling must never spin up a worker just to
  // clear a snapshot that was never created.
  it("disable before any worker exists creates no worker and posts no snapshot/clear messages", async () => {
    const { controls, restore } = installLoopbackWorker();
    // Enabled Grid, but never mounted and never queried — nothing has
    // caused a worker client to be constructed yet.
    const grid = makeGrid();
    try {
      expect(controls.workerInstances).toBe(0);

      grid.setQuickFilterConfig(false);
      await flushScheduled();

      expect(controls.workerInstances).toBe(0);
      expect(kinds(controls.posted)).not.toContain("quickSearch:snapshotStart");
      expect(kinds(controls.posted)).not.toContain("quickSearch:clearSnapshot");
    } finally {
      grid.destroy();
      restore();
    }
  });

  it("disable while prewarm bootstrap is pending cancels it and creates no worker", async () => {
    const { controls, restore } = installLoopbackWorker();
    const container = makeContainer();
    const grid = makeGrid();
    try {
      // Mount schedules a background prewarm bootstrap. Disable before it
      // fires: the pending bootstrap must be cancelled and no worker built.
      grid.mount(container);
      grid.setQuickFilterConfig(false);
      await flushScheduled();

      expect(controls.workerInstances).toBe(0);
      const posted = kinds(controls.posted);
      expect(posted).not.toContain("quickSearch:snapshotStart");
      expect(posted).not.toContain("quickSearch:snapshotChunk");
      expect(posted).not.toContain("quickSearch:snapshotComplete");
    } finally {
      grid.destroy();
      restore();
      document.body.innerHTML = "";
    }
  });

  // Matrix 10 + 24.
  it("mounted cell-editor commit with onBeforeCellEditCommit percentage projection patches the formatted value", async () => {
    const { controls, restore } = installLoopbackWorker();
    const container = makeContainer();
    const grid = makeGrid({
      columns: [
        { field: "name" },
        { field: "pct", editable: true, quickFilterTextField: "pctText" },
      ],
      rows: Array.from({ length: ROW_COUNT }, (_, i) => ({
        id: String(i),
        name: `Person${String(i).padStart(3, "0")}`,
        pct: "0",
        pctText: "0%",
      })),
      suppressRowVirtualization: true,
      onBeforeCellEditCommit: (e) => {
        if (e.columnId !== "pct") return;
        const row = e.row as Record<string, unknown>;
        row.pctText =
          e.newValue === null || e.newValue === undefined
            ? ""
            : `${String(e.newValue)}%`;
      },
    });
    try {
      grid.mount(container);
      await flushRenders();
      await runQuery(grid, "Person007", ["7"]);
      const marker = controls.posted.length;

      const root = container.querySelector<HTMLElement>(".lfg-grid")!;
      const cell = cellEl(container, "7", "pct");
      expect(cell).not.toBeNull();
      dblClick(cell!);
      const input = root.querySelector<HTMLInputElement>(".lfg-cell-editor-host input");
      expect(input).not.toBeNull();
      input!.value = "45";
      pressKey(input!, "Enter");
      await flushRenders();

      // The formatted projection must be searchable through the worker.
      await runQuery(grid, "45%", ["7"]);

      const delta = controls.posted.slice(marker);
      expect(kinds(delta)).toContain("quickSearch:snapshotPatchStart");
      expect(kinds(delta)).not.toContain("quickSearch:snapshotStart");
      const values = patchChunks(delta).flatMap((chunk) =>
        chunk.updates.flatMap((u) => u.values),
      );
      expect(values.some((v) => v.includes("45%"))).toBe(true);
    } finally {
      grid.destroy();
      restore();
      document.body.innerHTML = "";
    }
  });
});
