import { describe, expect, it } from "vitest";

import {
  captureAllMinusExcludedRowSelection,
  captureExplicitRowSelection,
} from "../../../internal/readSnapshots";
import type { RowData } from "../../../types";
import {
  CsvExportDuplicateRowError,
  CsvExportUnknownRowError,
} from "../csvExportErrors";
import { planCsvRowScope } from "../planCsvRowScope";

import {
  drainRowPlan,
  makeCountingResolver,
  makeCountingRowView,
  makeRowView,
  makeSnapshot,
  membership,
} from "./support";

// Source rows: index 0..3 with ids a,b,c,d.
const ROWS: readonly RowData[] = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
  { id: "c", name: "Carol" },
  { id: "d", name: "Dan" },
];

const NO_PIN_OPTS = { includePinnedTopRows: true, includePinnedBottomRows: true };

describe("planCsvRowScope - display order (tests 10-12)", () => {
  it("filteredAndSorted uses full view order", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: makeRowView([2, 0, 1, 3], ROWS),
    });
    const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
    expect(drainRowPlan(plan)).toEqual([2, 0, 1, 3]);
  });

  it("currentPage uses page view, distinct from full view", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: makeRowView([2, 0, 1, 3], ROWS),
      pageView: makeRowView([2, 0], ROWS),
    });
    expect(
      drainRowPlan(planCsvRowScope(snapshot, { mode: "currentPage" }, NO_PIN_OPTS)),
    ).toEqual([2, 0]);
    expect(
      drainRowPlan(
        planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS),
      ),
    ).toEqual([2, 0, 1, 3]);
  });

  it("all uses source order regardless of views", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: makeRowView([3, 2, 1, 0], ROWS),
    });
    const plan = planCsvRowScope(snapshot, { mode: "all" }, NO_PIN_OPTS);
    expect(plan.knownRowCount).toBe(4);
    expect(drainRowPlan(plan)).toEqual([0, 1, 2, 3]);
  });
});

describe("planCsvRowScope - selected (test 13)", () => {
  it("emits selected rows across pages in full display order", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      // full display order c,a,d,b; page would only cover c,a.
      fullView: makeRowView([2, 0, 3, 1], ROWS),
      pageView: makeRowView([2, 0], ROWS),
      selectedRowIds: membership(["b", "c"]),
    });
    const plan = planCsvRowScope(snapshot, { mode: "selected" }, NO_PIN_OPTS);
    // display order c(2) then b(1); selection insertion order irrelevant.
    expect(drainRowPlan(plan)).toEqual([2, 1]);
    expect(plan.knownRowCount).toBeUndefined();
  });

  it("scans a non-empty all-minus view when exclusions are outside it", () => {
    const rows: readonly RowData[] = [
      { id: "old-a" },
      { id: "old-b" },
      { id: "new-c" },
    ];
    const selectedRowIds = captureAllMinusExcludedRowSelection(
      new Set(["old-a", "old-b"]),
      1,
    );
    const snapshot = makeSnapshot({
      sourceRows: rows,
      fullView: makeRowView([2], rows),
      selectedRowIds,
    });

    expect(selectedRowIds.definitelyEmpty).toBe(false);
    expect(
      drainRowPlan(
        planCsvRowScope(snapshot, { mode: "selected" }, NO_PIN_OPTS),
        1,
      ),
    ).toEqual([2]);
  });

  it("treats only a zero-universe all-minus capture as definitely empty", () => {
    const { view, calls } = makeCountingRowView([], ROWS);
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: view,
      selectedRowIds: captureAllMinusExcludedRowSelection(
        new Set(["outside"]),
        0,
      ),
    });
    const plan = planCsvRowScope(snapshot, { mode: "selected" }, NO_PIN_OPTS);

    expect(plan.knownRowCount).toBe(0);
    expect(drainRowPlan(plan)).toEqual([]);
    expect(calls.getSourceIndex).toBe(0);
  });

  it("keeps explicit empty as an O(1) empty fast path", () => {
    const { view, calls } = makeCountingRowView([0, 1, 2, 3], ROWS);
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: view,
      selectedRowIds: captureExplicitRowSelection(new Set(), ROWS.length),
    });
    const plan = planCsvRowScope(snapshot, { mode: "selected" }, NO_PIN_OPTS);

    expect(plan.knownRowCount).toBe(0);
    expect(drainRowPlan(plan)).toEqual([]);
    expect(calls.getSourceIndex).toBe(0);
  });

  it("boundedly scans to empty when exclusions cover every current row", () => {
    const { view, calls } = makeCountingRowView([2, 0, 3, 1], ROWS);
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: view,
      selectedRowIds: captureAllMinusExcludedRowSelection(
        new Set(["a", "b", "c", "d"]),
        ROWS.length,
      ),
    });
    const plan = planCsvRowScope(snapshot, { mode: "selected" }, NO_PIN_OPTS);
    const out: number[] = [];

    expect(plan.step(out, 1)).toBe(false);
    expect(calls.getSourceIndex).toBe(1);
    expect(drainRowPlan(plan, 1)).toEqual([]);
    expect(out).toEqual([]);
    expect(calls.getSourceIndex).toBe(ROWS.length);
  });
});

describe("planCsvRowScope - explicit ids (tests 14-15, 18)", () => {
  it("emits ids in caller order", () => {
    const snapshot = makeSnapshot({ sourceRows: ROWS });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["c", "a"] }, NO_PIN_OPTS);
    expect(plan.knownRowCount).toBe(2);
    expect(drainRowPlan(plan)).toEqual([2, 0]);
  });

  it("one explicit id represents a single-row (one-cell) scope", () => {
    const snapshot = makeSnapshot({ sourceRows: ROWS });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["b"] }, NO_PIN_OPTS);
    expect(drainRowPlan(plan)).toEqual([1]);
  });

  it("unknown id throws CsvExportUnknownRowError", () => {
    const snapshot = makeSnapshot({ sourceRows: ROWS });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["zzz"] }, NO_PIN_OPTS);
    expect(() => drainRowPlan(plan)).toThrow(CsvExportUnknownRowError);
  });

  it("duplicate requested ids throw CsvExportDuplicateRowError during stepping", () => {
    const snapshot = makeSnapshot({ sourceRows: ROWS });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["a", "a"] }, NO_PIN_OPTS);
    expect(() => drainRowPlan(plan)).toThrow(CsvExportDuplicateRowError);
  });
});

describe("planCsvRowScope - pinned lanes (tests 16-17)", () => {
  it("composes pinned top -> center -> bottom exactly once", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      // display order a,b,c,d; pin b bottom, d top.
      fullView: makeRowView([0, 1, 2, 3], ROWS),
      rowPinState: { b: "bottom", d: "top" },
    });
    const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
    // top: d(3); center: a(0),c(2); bottom: b(1).
    expect(drainRowPlan(plan)).toEqual([3, 0, 2, 1]);
    expect(plan.knownRowCount).toBe(4);
  });

  it("omits pinned lanes entirely when disabled", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: makeRowView([0, 1, 2, 3], ROWS),
      rowPinState: { b: "bottom", d: "top" },
    });
    const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, {
      includePinnedTopRows: false,
      includePinnedBottomRows: true,
    });
    // top omitted (d dropped, not moved to center); center a,c; bottom b.
    expect(drainRowPlan(plan)).toEqual([0, 2, 1]);
    expect(plan.knownRowCount).toBeUndefined();
  });
});

describe("planCsvRowScope - allocation & cooperative strategy", () => {
  it("construction performs no row scan", () => {
    const { view, calls } = makeCountingRowView([0, 1, 2, 3], ROWS);
    const snapshot = makeSnapshot({ sourceRows: ROWS, fullView: view });
    planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
    planCsvRowScope(snapshot, { mode: "all" }, NO_PIN_OPTS);
    planCsvRowScope(snapshot, { mode: "ids", ids: ["a", "b"] }, NO_PIN_OPTS);
    expect(calls.getSourceIndex).toBe(0);
    expect(calls.getRow).toBe(0);
  });

  it("identity/no-pin path never materializes RowData (never calls getRow)", () => {
    const throwingView = makeRowView([2, 0, 1, 3], ROWS, { throwOnGetRow: true });
    const snapshot = makeSnapshot({ sourceRows: ROWS, fullView: throwingView });
    const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
    expect(plan.knownRowCount).toBe(4);
    expect(drainRowPlan(plan)).toEqual([2, 0, 1, 3]);
  });

  it("steps are resumable with a tiny budget", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: makeRowView([0, 1, 2, 3], ROWS),
    });
    const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
    const out: number[] = [];
    expect(plan.step(out, 1)).toBe(false);
    expect(plan.step(out, 1)).toBe(false);
    plan.step(out, 10);
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("does not mutate the source rows array", () => {
    const source = Object.freeze([...ROWS]);
    const snapshot = makeSnapshot({ sourceRows: source });
    drainRowPlan(planCsvRowScope(snapshot, { mode: "all" }, NO_PIN_OPTS));
    expect(source).toEqual(ROWS);
  });
});

describe("planCsvRowScope - work-unit budget (inspected work, not emitted rows)", () => {
  function bigRows(n: number): RowData[] {
    return Array.from({ length: n }, (_row, i) => ({ id: String(i) }));
  }

  it("sparse selected match at the end inspects at most one row per unit", () => {
    const rows = bigRows(100_000);
    const order = rows.map((_row, i) => i);
    const { view, calls } = makeCountingRowView(order, rows);
    const snapshot = makeSnapshot({
      sourceRows: rows,
      fullView: view,
      selectedRowIds: membership(["99999"]),
    });
    const plan = planCsvRowScope(snapshot, { mode: "selected" }, NO_PIN_OPTS);
    const out: number[] = [];
    expect(plan.step(out, 1)).toBe(false);
    expect(out).toEqual([]);
    expect(calls.getSourceIndex).toBe(1);
    expect(drainRowPlan(plan, 5000)).toEqual([99999]);
  });

  it("a pinned-top row near the end cannot cause one unbounded step", () => {
    const rows = bigRows(100_000);
    const order = rows.map((_row, i) => i);
    const { view, calls } = makeCountingRowView(order, rows);
    const snapshot = makeSnapshot({
      sourceRows: rows,
      fullView: view,
      rowPinState: { "99999": "top" },
    });
    const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
    expect(plan.step([], 1)).toBe(false);
    expect(calls.getSourceIndex).toBe(1);
  });

  it("explicit-id construction does not iterate ids or resolve row ids", () => {
    const { resolver, calls } = makeCountingResolver(ROWS);
    const snapshot = makeSnapshot({ sourceRows: ROWS, rowIds: resolver });
    // Duplicate ids present: construction must neither throw nor resolve.
    const plan = planCsvRowScope(
      snapshot,
      { mode: "ids", ids: ["a", "a", "b"] },
      NO_PIN_OPTS,
    );
    expect(calls.resolve).toBe(0);
    expect(plan.knownRowCount).toBe(3);
  });

  it("duplicate-id validation progresses through bounded steps", () => {
    const snapshot = makeSnapshot({ sourceRows: ROWS });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["a", "a"] }, NO_PIN_OPTS);
    const out: number[] = [];
    expect(plan.step(out, 1)).toBe(false); // dedup checks first "a"
    expect(() => plan.step(out, 1)).toThrow(CsvExportDuplicateRowError);
  });

  it("empty selected and empty ids scopes perform zero row inspection", () => {
    const { view, calls } = makeCountingRowView([0, 1, 2, 3], ROWS);
    const { resolver, calls: rcalls } = makeCountingResolver(ROWS);
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: view,
      rowIds: resolver,
      selectedRowIds: membership([]),
    });

    const selected = planCsvRowScope(snapshot, { mode: "selected" }, NO_PIN_OPTS);
    expect(selected.knownRowCount).toBe(0);
    expect(drainRowPlan(selected)).toEqual([]);
    expect(calls.getSourceIndex).toBe(0);

    const ids = planCsvRowScope(snapshot, { mode: "ids", ids: [] }, NO_PIN_OPTS);
    expect(drainRowPlan(ids)).toEqual([]);
    expect(rcalls.resolve).toBe(0);
  });

  it("invalid budgets still progress and terminate", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: makeRowView([0, 1, 2, 3], ROWS),
    });
    for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
      const out: number[] = [];
      let guard = 0;
      while (!plan.step(out, budget)) {
        if (++guard > 100) throw new Error("budget did not terminate");
      }
      expect(out).toEqual([0, 1, 2, 3]);
    }
  });
});

describe("planCsvRowScope - pin composition passes (P2)", () => {
  it("preserves exact top -> center -> bottom output with multiple pins", () => {
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: makeRowView([0, 1, 2, 3], ROWS),
      rowPinState: { a: "top", d: "top", b: "bottom" },
    });
    const plan = planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS);
    // tops in display order a(0),d(3); center c(2); bottom b(1).
    expect(drainRowPlan(plan)).toEqual([0, 3, 2, 1]);
  });

  it("uses exactly two view passes when both lanes are enabled", () => {
    const { view, calls } = makeCountingRowView([0, 1, 2, 3], ROWS);
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: view,
      rowPinState: { d: "top", b: "bottom" },
    });
    drainRowPlan(planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS));
    expect(calls.getSourceIndex).toBe(2 * view.rowCount);
  });

  it("uses a single pass with no pins", () => {
    const { view, calls } = makeCountingRowView([0, 1, 2, 3], ROWS);
    const snapshot = makeSnapshot({ sourceRows: ROWS, fullView: view });
    drainRowPlan(planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, NO_PIN_OPTS));
    expect(calls.getSourceIndex).toBe(view.rowCount);
  });

  it("uses a single center pass when top is disabled (collects bottoms inline)", () => {
    const { view, calls } = makeCountingRowView([0, 1, 2, 3], ROWS);
    const snapshot = makeSnapshot({
      sourceRows: ROWS,
      fullView: view,
      rowPinState: { d: "top", b: "bottom" },
    });
    drainRowPlan(
      planCsvRowScope(snapshot, { mode: "filteredAndSorted" }, {
        includePinnedTopRows: false,
        includePinnedBottomRows: true,
      }),
    );
    expect(calls.getSourceIndex).toBe(view.rowCount);
  });
});

describe("planCsvRowScope - explicit-id lookup memory (P2)", () => {
  function bigRows(n: number): RowData[] {
    return Array.from({ length: n }, (_row, i) => ({ id: String(i) }));
  }

  it("stops scanning early once all requested ids resolve", () => {
    const rows = bigRows(100_000);
    const { resolver, calls } = makeCountingResolver(rows);
    const snapshot = makeSnapshot({ sourceRows: rows, rowIds: resolver });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["1", "2"] }, NO_PIN_OPTS);
    expect(drainRowPlan(plan, 5000)).toEqual([1, 2]);
    // Only source rows 0,1,2 are resolved; the other ~100k are never touched.
    expect(calls.resolve).toBeLessThanOrEqual(3);
  });

  it("resolves a single id near the end within the work budget", () => {
    const rows = bigRows(100_000);
    const snapshot = makeSnapshot({ sourceRows: rows });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["99999"] }, NO_PIN_OPTS);
    expect(plan.step([], 1)).toBe(false); // bounded: one unit makes progress
    expect(drainRowPlan(plan, 10_000)).toEqual([99999]);
  });

  it("an unknown id scans to the source end then throws", () => {
    const rows = bigRows(10);
    const { resolver, calls } = makeCountingResolver(rows);
    const snapshot = makeSnapshot({ sourceRows: rows, rowIds: resolver });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["nope"] }, NO_PIN_OPTS);
    expect(() => drainRowPlan(plan)).toThrow(CsvExportUnknownRowError);
    expect(calls.resolve).toBe(10);
  });

  it("preserves caller id order when source order differs", () => {
    const rows: RowData[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const snapshot = makeSnapshot({ sourceRows: rows });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["c", "a"] }, NO_PIN_OPTS);
    expect(drainRowPlan(plan)).toEqual([2, 0]);
  });

  it("never retains unrelated source ids (behavioral: bounded resolution)", () => {
    const rows = bigRows(100_000);
    const { resolver, calls } = makeCountingResolver(rows);
    const snapshot = makeSnapshot({ sourceRows: rows, rowIds: resolver });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["5"] }, NO_PIN_OPTS);
    expect(drainRowPlan(plan, 5000)).toEqual([5]);
    // Scans source rows 0..5 only; unrelated ids are neither resolved nor stored.
    expect(calls.resolve).toBeLessThanOrEqual(6);
  });

  it("keeps first-match behavior for duplicate source ids", () => {
    // Two source rows share id "x"; requested "x" resolves to the first (index 1).
    const rows: RowData[] = [{ id: "a" }, { id: "x" }, { id: "b" }, { id: "x" }];
    const snapshot = makeSnapshot({ sourceRows: rows });
    const plan = planCsvRowScope(snapshot, { mode: "ids", ids: ["x"] }, NO_PIN_OPTS);
    expect(drainRowPlan(plan)).toEqual([1]);
  });
});
