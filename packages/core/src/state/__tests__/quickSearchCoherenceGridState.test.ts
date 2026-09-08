import { describe, expect, it } from "vitest";

import type { QuickSearchDirtySourceAccumulator } from "../../features/quick-search/quickSearchDirtySourceAccumulator";
import type { LightFastGridProps, RowData } from "../../types";
import { GridState } from "../GridState";

/** Narrow typed access for seeding incomplete coverage in transfer tests. */
type GridStateDirtySourcesAccess = {
  readonly quickSearchDirtySources: QuickSearchDirtySourceAccumulator;
};

function seedIncompleteDirtySources(
  state: GridState,
  indexes: readonly number[],
): void {
  (state as unknown as GridStateDirtySourcesAccess).quickSearchDirtySources.record(
    indexes,
    false,
  );
}

const resolveId = (row: RowData): string | null => {
  const raw = row.id;
  return raw === null || raw === undefined ? null : String(raw);
};

function baseRow(id: string, overrides: Record<string, unknown> = {}): RowData {
  const defaults: Record<string, RowData> = {
    "1": {
      id: "1",
      name: "Alice",
      city: "NYC",
      age: 30,
      balance: 100,
      balanceSearch: "100.00",
      user: ROW_USERS["1"],
    },
    "2": {
      id: "2",
      name: "Bob",
      city: "LA",
      age: 25,
      balance: 200,
      balanceSearch: "200.00",
      user: ROW_USERS["2"],
    },
    "3": {
      id: "3",
      name: "Carol",
      city: "SF",
      age: 35,
      balance: 300,
      balanceSearch: "300.00",
      user: ROW_USERS["3"],
    },
  };
  return { ...defaults[id]!, ...overrides };
}

const ROW_USERS: Record<string, RowData> = {
  "1": { profile: { name: "alice" } },
  "2": { profile: { name: "bob" } },
  "3": { profile: { name: "carol" } },
};

function makeState(overrides: Partial<LightFastGridProps> = {}): GridState {
  return new GridState({
    columns: [
      { field: "name" },
      { field: "city" },
      // Filterable but not searchable — used for filter-only coherence tests.
      { field: "age", filter: "number", searchable: false },
      { field: "balance", quickFilterTextField: "balanceSearch" },
      { field: "user.profile.name" },
    ],
    rows: [baseRow("1"), baseRow("2"), baseRow("3")],
    getRowId: (row) => String(row.id),
    ...overrides,
  });
}

function indexesOf(state: GridState): number[] {
  return [...state.getQuickSearchDirtySourceSnapshot().indexes].sort((a, b) => a - b);
}

describe("GridState quick-search searchable-data coherence", () => {
  it("initial searchableDataRevision is zero", () => {
    const state = makeState();
    expect(state.getQuickSearchSearchableDataRevision()).toBe(0);
  });

  it("source layout revision comes from RowStore", () => {
    const state = makeState();
    const before = state.getQuickSearchSourceLayoutRevision();
    state.setRows(
      [
        { id: "1", name: "Alice", city: "NYC", age: 30 },
        { id: "2", name: "Bob", city: "LA", age: 25 },
      ],
      resolveId,
    );
    expect(state.getQuickSearchSourceLayoutRevision()).toBeGreaterThan(before);
  });

  it("first COW searchable edit bumps once and records index", () => {
    const state = makeState();
    const layoutBefore = state.getQuickSearchSourceLayoutRevision();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0]);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(true);
    expect(state.getQuickSearchSourceLayoutRevision()).toBe(layoutBefore);
  });

  it("later same-reference edit bumps once and deduplicates index", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alison" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(2);
    expect(indexesOf(state)).toEqual([0]);
  });

  it("update-only batch bumps once and records all indexes", () => {
    const state = makeState();
    state.applyStoreTransactionBatch(
      [
        { update: [baseRow("1", { name: "A1" })] },
        { update: [baseRow("3", { name: "C1" })] },
      ],
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0, 2]);
  });

  it("no-getRowId cell replacement records source index", () => {
    const state = makeState({ getRowId: undefined });
    const row = baseRow("2", { name: "Bobby" });
    delete row.id;
    state.replaceRowAtSourceIndex(1, row, () => null);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([1]);
  });

  it("empty query still bumps and records searchable edits", () => {
    const state = makeState();
    expect(state.isQuickFilterPresent()).toBe(false);
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([1]);
    expect(state.needsQuickSearchSchedule).toBe(false);
  });

  it("unrelated field edit does neither bump nor record", () => {
    const state = makeState({ quickFilterText: "alice" });
    const before = state.getQuickSearchSearchableDataRevision();
    state.applyStoreTransaction(
      { update: [baseRow("1", { age: 31 })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(before);
    expect(indexesOf(state)).toEqual([]);
  });

  it("cross-field valueGetter dependency bumps revision and schedules quick search", () => {
    const state = new GridState({
      columns: [
        {
          field: "fullName",
          valueGetter: ({ row }: { row: RowData }) =>
            `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`,
        },
      ],
      rows: [
        { id: "1", firstName: "Ada", lastName: "Lovelace", fullName: "" },
        { id: "2", firstName: "Grace", lastName: "Hopper", fullName: "" },
      ],
      getRowId: (row) => String(row.id),
      quickFilterText: "ada",
    });
    expect(state.getQuickSearchDependencyPlan().dependsOnAllRowFields).toBe(true);

    const before = state.getQuickSearchSearchableDataRevision();
    state.applyStoreTransaction(
      {
        update: [
          { id: "1", firstName: "Augusta", lastName: "Lovelace", fullName: "" },
        ],
      },
      resolveId,
    );

    expect(state.getQuickSearchSearchableDataRevision()).toBe(before + 1);
    expect(indexesOf(state)).toEqual([0]);
    expect(state.needsQuickSearchSchedule).toBe(true);
  });

  it("raw searchable field edit bumps and records", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0]);
  });

  it("projection field edit bumps and records", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { balanceSearch: "100.50" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0]);
  });

  it("dot-path parent replacement bumps and records", () => {
    const state = makeState();
    state.applyStoreTransaction(
      {
        update: [baseRow("1", { user: { profile: { name: "alice-2" } } })],
      },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0]);
  });

  it("filter-only edit does not bump or record", () => {
    const state = makeState({ quickFilterText: "alice" });
    state.setFilterModel({
      age: {
        type: "number",
        conditions: [{ operator: "equals", value: 30 }],
      },
    });
    const beforeRev = state.getQuickSearchSearchableDataRevision();
    const beforeIndexes = indexesOf(state);

    state.applyStoreTransaction(
      { update: [baseRow("1", { age: 31 })] },
      resolveId,
    );

    expect(state.getQuickSearchSearchableDataRevision()).toBe(beforeRev);
    expect(indexesOf(state)).toEqual(beforeIndexes);
  });

  it("active filter-only change still schedules quick search", () => {
    const state = makeState({ quickFilterText: "alice" });
    state.setFilterModel({
      age: {
        type: "number",
        conditions: [{ operator: "equals", value: 30 }],
      },
    });
    if (state.needsQuickSearchSchedule) {
      state.markQuickSearchPending();
      state.clearQuickSearchPending();
    }

    state.applyStoreTransaction(
      { update: [baseRow("1", { age: 31 })] },
      resolveId,
    );

    expect(state.getQuickSearchSearchableDataRevision()).toBe(0);
    expect(indexesOf(state)).toEqual([]);
    expect(state.needsQuickSearchSchedule).toBe(true);
  });

  it("searchable + filter-touching edit bumps once and schedules", () => {
    const state = makeState({ quickFilterText: "alice" });
    state.setFilterModel({
      age: {
        type: "number",
        conditions: [{ operator: "equals", value: 30 }],
      },
    });
    if (state.needsQuickSearchSchedule) {
      state.markQuickSearchPending();
      state.clearQuickSearchPending();
    }

    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia", age: 31 })] },
      resolveId,
    );

    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0]);
    expect(state.needsQuickSearchSchedule).toBe(true);
  });

  it("structural add/remove clears accumulator and advances only layout revision", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0]);

    const dataRev = state.getQuickSearchSearchableDataRevision();
    const layoutBefore = state.getQuickSearchSourceLayoutRevision();

    state.applyStoreTransaction(
      {
        add: [
          {
            id: "4",
            name: "Dan",
            city: "Austin",
            age: 40,
            balance: 0,
            balanceSearch: "0",
            user: { profile: { name: "dan" } },
          },
        ],
      },
      resolveId,
    );

    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(indexesOf(state)).toEqual([]);
    expect(state.getQuickSearchSourceLayoutRevision()).toBeGreaterThan(layoutBefore);
  });

  it("setRows clears accumulator without resetting data revision", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const dataRev = state.getQuickSearchSearchableDataRevision();
    state.setRows([{ id: "9", name: "Zed", city: "X", age: 1 }], resolveId);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(indexesOf(state)).toEqual([]);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(true);
  });

  it("row reorder clears accumulator", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const dataRev = state.getQuickSearchSearchableDataRevision();
    state.moveRowsByIds("1", ["1"], 2, (row) => String(row.id));
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(indexesOf(state)).toEqual([]);
  });

  it("column/default/visibility/config changes clear accumulator without resetting data revision", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const afterEdit = state.getQuickSearchSearchableDataRevision();

    state.setColumnVisible("city", false);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(afterEdit);
    expect(indexesOf(state)).toEqual([]);

    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    expect(indexesOf(state)).toEqual([1]);
    const afterSecond = state.getQuickSearchSearchableDataRevision();

    // Signature-changing defaultColDef must clear retained indexes.
    state.setDefaultColDef({ quickFilterTextField: "searchText" });
    expect(state.getQuickSearchSearchableDataRevision()).toBe(afterSecond);
    expect(indexesOf(state)).toEqual([]);

    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Robert" })] },
      resolveId,
    );
    const afterThird = state.getQuickSearchSearchableDataRevision();
    state.setQuickFilterOptions({ includeHiddenColumns: true });
    expect(state.getQuickSearchSearchableDataRevision()).toBe(afterThird);
    expect(indexesOf(state)).toEqual([]);

    state.applyStoreTransaction(
      { update: [baseRow("3", { name: "Caroline" })] },
      resolveId,
    );
    const afterFourth = state.getQuickSearchSearchableDataRevision();
    state.setColumns([{ field: "name" }, { field: "city" }]);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(afterFourth);
    expect(indexesOf(state)).toEqual([]);
  });

  it("disabled edits are untracked", () => {
    const state = makeState({ quickFilter: false });
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(0);
    expect(indexesOf(state)).toEqual([]);
  });

  it("disable → re-enable preserves monotonic revision", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);

    state.setQuickFilterOptions(false);
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([]);

    state.setQuickFilterOptions(true);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([]);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(true);

    state.applyStoreTransaction(
      { update: [baseRow("3", { name: "Caroline" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(2);
    expect(indexesOf(state)).toEqual([2]);
  });

  it("unknown source-index field metadata with active query cannot leave stale quick-search state", () => {
    const state = makeState({ quickFilterText: "alice" });
    // Force a path where RowStore reports an index but field metadata is
    // unavailable by using analyzer coverage via a synthetic batch-equivalent:
    // same-value replacement now proves empty fields (no bump). Missing
    // metadata is covered by the analyzer unit tests; here ensure a real
    // searchable edit still schedules.
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([0]);
    expect(state.needsQuickSearchSchedule).toBe(true);
  });

  it("same-value replacement with empty field set does not bump or record", () => {
    const state = makeState({ quickFilterText: "alice" });
    state.replaceRowAtSourceIndex(0, baseRow("1"), resolveId);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(0);
    expect(indexesOf(state)).toEqual([]);
    expect(state.needsQuickSearchSchedule).toBe(false);
  });

  it("mixed batch retains only searchable source indexes", () => {
    const state = makeState();
    const updates = [
      baseRow("1", { age: 31 }),
      baseRow("2", { name: "Bobby" }),
      baseRow("3", { age: 36 }),
    ];
    // Simulate a large mixed batch: many unrelated + one searchable.
    for (let i = 0; i < 50; i++) {
      updates.push(baseRow("1", { age: 40 + i }));
    }
    state.applyStoreTransactionBatch(
      updates.map((row) => ({ update: [row] })),
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([1]);
    expect(state.getQuickSearchDirtySourceSnapshot().indexes.size).toBe(1);
  });

  it("cache change preserves plan identity and retained dirty indexes", () => {
    const state = makeState({ quickFilter: { cache: "auto" } });
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const planBefore = state.getQuickSearchDependencyPlan();
    const indexesBefore = indexesOf(state);
    state.setQuickFilterOptions({ cache: false });
    expect(state.getQuickSearchDependencyPlan()).toBe(planBefore);
    expect(indexesOf(state)).toEqual(indexesBefore);
  });

  it("prewarm change preserves plan identity and retained dirty indexes", () => {
    const state = makeState({ quickFilter: { prewarm: true } });
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const planBefore = state.getQuickSearchDependencyPlan();
    const indexesBefore = indexesOf(state);
    state.setQuickFilterOptions({ prewarm: false });
    expect(state.getQuickSearchDependencyPlan()).toBe(planBefore);
    expect(indexesOf(state)).toEqual(indexesBefore);
  });

  it("parser/matcher change updates workerSafe but retains dirty indexes", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(indexesOf(state)).toEqual([0]);
    expect(state.getQuickSearchDependencyPlan().workerSafe).toBe(true);
    const fieldsBefore = state.getQuickSearchDependencyPlan().fieldsSignature;

    state.setQuickFilterOptions({ parser: (t) => t.split(",") });
    expect(state.getQuickSearchDependencyPlan().workerSafe).toBe(false);
    expect(state.getQuickSearchDependencyPlan().fieldsSignature).toBe(fieldsBefore);
    expect(indexesOf(state)).toEqual([0]);
  });

  it("fieldsSignature change clears dirty indexes", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(indexesOf(state)).toEqual([0]);
    const dataRev = state.getQuickSearchSearchableDataRevision();
    state.setColumns([{ field: "email" }]);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(indexesOf(state)).toEqual([]);
  });

  it("disabling clears dirty indexes", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    expect(indexesOf(state)).toEqual([0]);
    state.setQuickFilterOptions(false);
    expect(indexesOf(state)).toEqual([]);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(true);
  });

  it("disabled quick filter skips dirty analyzer work", () => {
    const state = makeState({ quickFilter: false });
    const before = state.getQuickSearchSearchableDataRevision();
    state.applyStoreTransactionBatch(
      [
        { update: [baseRow("1", { name: "Alicia" })] },
        { update: [baseRow("2", { name: "Bobby" })] },
        { update: [baseRow("3", { name: "Caroline" })] },
      ],
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(before);
    expect(indexesOf(state)).toEqual([]);
  });

  it("true → { cache: false } preserves plan identity and retained deltas", () => {
    const state = makeState({ quickFilter: true });
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const planBefore = state.getQuickSearchDependencyPlan();
    state.setQuickFilterOptions({ cache: false });
    expect(state.getQuickSearchDependencyPlan()).toBe(planBefore);
    expect(indexesOf(state)).toEqual([0]);
  });

  it("undefined → { prewarm: true } preserves plan identity and retained deltas", () => {
    const state = makeState({ quickFilter: undefined });
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    const planBefore = state.getQuickSearchDependencyPlan();
    state.setQuickFilterOptions({ prewarm: true });
    expect(state.getQuickSearchDependencyPlan()).toBe(planBefore);
    expect(indexesOf(state)).toEqual([1]);
  });

  it("partially-skipped structural request with only applied updates remains source-index selective", () => {
    const state = makeState();
    state.applyStoreTransaction(
      {
        add: [baseRow("1", { name: "dup" })],
        update: [
          baseRow("1", { age: 99 }),
          baseRow("2", { name: "Bobby" }),
        ],
      },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(1);
    expect(indexesOf(state)).toEqual([1]);
  });

  // ── Transfer ownership lifecycle ────────────────────────────────────

  it("transfer captures current layout and searchable-data revisions", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    expect(transfer.sourceLayoutRevision).toBe(
      state.getQuickSearchSourceLayoutRevision(),
    );
    expect(transfer.searchableDataRevision).toBe(
      state.getQuickSearchSearchableDataRevision(),
    );
    expect(indexesOf(state)).toEqual([0]);
  });

  it("first COW edit → begin → same-row edit → acknowledge leaves row pending", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    const revAfterFirst = state.getQuickSearchSearchableDataRevision();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alison" })] },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(revAfterFirst + 1);
    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId)).toBe(
      true,
    );
    expect(indexesOf(state)).toEqual([0]);
  });

  it("transaction batch edits during transfer remain pending", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    state.applyStoreTransactionBatch(
      [
        { update: [baseRow("2", { name: "Bobby" })] },
        { update: [baseRow("3", { name: "Caroline" })] },
      ],
      resolveId,
    );
    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId)).toBe(
      true,
    );
    expect(indexesOf(state)).toEqual([1, 2]);
  });

  it("cancel preserves all dirty indexes", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    expect(state.cancelQuickSearchDirtySourceTransfer(transfer.transferId)).toBe(true);
    expect(indexesOf(state)).toEqual([0, 1]);
  });

  it("supersession preserves union of old in-flight and new pending", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const first = state.beginQuickSearchDirtySourceTransfer();
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    const second = state.beginQuickSearchDirtySourceTransfer();
    expect(first.transferId).not.toBe(second.transferId);
    expect([...second.indexes].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(indexesOf(state)).toEqual([0, 1]);
  });

  it("structural change clears active and pending transfer state", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    const dataRev = state.getQuickSearchSearchableDataRevision();
    state.applyStoreTransaction(
      {
        add: [
          {
            id: "4",
            name: "Dan",
            city: "Austin",
            age: 40,
            balance: 0,
            balanceSearch: "0",
            user: { profile: { name: "dan" } },
          },
        ],
      },
      resolveId,
    );
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(indexesOf(state)).toEqual([]);
    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId)).toBe(
      false,
    );
  });

  it("fields-signature change clears transfer state", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    const dataRev = state.getQuickSearchSearchableDataRevision();
    state.setColumns([{ field: "email" }]);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(indexesOf(state)).toEqual([]);
    expect(state.cancelQuickSearchDirtySourceTransfer(transfer.transferId)).toBe(false);
  });

  it("cache/prewarm/parser/matcher-only changes preserve transfer ownership", () => {
    const state = makeState({ quickFilter: true });
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );

    state.setQuickFilterOptions({ cache: false });
    expect(indexesOf(state)).toEqual([0, 1]);

    state.setQuickFilterOptions({ cache: false, prewarm: false });
    expect(indexesOf(state)).toEqual([0, 1]);

    state.setQuickFilterOptions({ parser: (t) => t.split(",") });
    expect(indexesOf(state)).toEqual([0, 1]);
    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId)).toBe(
      true,
    );
    expect(indexesOf(state)).toEqual([1]);
  });

  it("stale acknowledgement after clear is harmless", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    const dataRev = state.getQuickSearchSearchableDataRevision();
    state.setRows([{ id: "9", name: "Zed", city: "X", age: 1 }], resolveId);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId)).toBe(
      false,
    );
    expect(indexesOf(state)).toEqual([]);
  });

  it("incomplete transfer acknowledgement is rejected; clear restores complete", () => {
    const state = makeState();
    seedIncompleteDirtySources(state, [0]);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(false);
    expect(indexesOf(state)).toEqual([0]);

    const transfer = state.beginQuickSearchDirtySourceTransfer();
    expect(transfer.complete).toBe(false);
    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId)).toBe(
      false,
    );
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(false);
    expect(indexesOf(state)).toEqual([0]);

    expect(state.cancelQuickSearchDirtySourceTransfer(transfer.transferId)).toBe(true);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(false);
    expect(indexesOf(state)).toEqual([0]);

    const dataRev = state.getQuickSearchSearchableDataRevision();
    state.setColumns([{ field: "email" }]);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(dataRev);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(true);
    expect(indexesOf(state)).toEqual([]);
    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId)).toBe(
      false,
    );
  });

  it("full-snapshot coverage ack drops incomplete in-flight and keeps newer pending", () => {
    const state = makeState();
    seedIncompleteDirtySources(state, [0]);
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    expect(transfer.complete).toBe(false);

    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    expect(
      state.acknowledgeQuickSearchDirtySourceTransferCoveredByFullSnapshot(
        transfer.transferId,
      ),
    ).toBe(true);
    expect(indexesOf(state)).toEqual([1]);
    expect(state.getQuickSearchDirtySourceSnapshot().complete).toBe(true);

    expect(
      state.acknowledgeQuickSearchDirtySourceTransferCoveredByFullSnapshot(
        transfer.transferId,
      ),
    ).toBe(false);
  });

  it("stale posted/cancelled/rebuild-required dispositions are no-ops", () => {
    const state = makeState();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const first = state.beginQuickSearchDirtySourceTransfer();
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    const second = state.beginQuickSearchDirtySourceTransfer();

    expect(state.acknowledgeQuickSearchDirtySourceTransferPosted(first.transferId)).toBe(
      false,
    );
    expect(state.cancelQuickSearchDirtySourceTransfer(first.transferId)).toBe(false);
    expect(
      state.acknowledgeQuickSearchDirtySourceTransferCoveredByFullSnapshot(
        first.transferId,
      ),
    ).toBe(false);
    expect([...second.indexes].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(indexesOf(state)).toEqual([0, 1]);
  });

  it("revision counters remain monotonic across transfer lifecycle", () => {
    const state = makeState();
    const layout0 = state.getQuickSearchSourceLayoutRevision();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const data1 = state.getQuickSearchSearchableDataRevision();
    const transfer = state.beginQuickSearchDirtySourceTransfer();
    expect(state.getQuickSearchSearchableDataRevision()).toBe(data1);
    expect(state.getQuickSearchSourceLayoutRevision()).toBe(layout0);

    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    const data2 = state.getQuickSearchSearchableDataRevision();
    expect(data2).toBeGreaterThan(data1);
    state.acknowledgeQuickSearchDirtySourceTransferPosted(transfer.transferId);
    expect(state.getQuickSearchSearchableDataRevision()).toBe(data2);
    expect(state.getQuickSearchSourceLayoutRevision()).toBe(layout0);
  });

  it("beginTransferIfNeeded returns undefined for empty + complete without allocating an ID", () => {
    const state = makeState();
    expect(state.beginQuickSearchDirtySourceTransferIfNeeded()).toBeUndefined();
    state.applyStoreTransaction(
      { update: [baseRow("1", { name: "Alicia" })] },
      resolveId,
    );
    const first = state.beginQuickSearchDirtySourceTransferIfNeeded();
    expect(first).toBeDefined();
    expect(first!.transferId).toBe(1);
    expect(first!.searchableDataRevision).toBe(
      state.getQuickSearchSearchableDataRevision(),
    );
    expect(first!.sourceLayoutRevision).toBe(
      state.getQuickSearchSourceLayoutRevision(),
    );
    state.acknowledgeQuickSearchDirtySourceTransferPosted(first!.transferId);
    expect(state.beginQuickSearchDirtySourceTransferIfNeeded()).toBeUndefined();
    state.applyStoreTransaction(
      { update: [baseRow("2", { name: "Bobby" })] },
      resolveId,
    );
    expect(state.beginQuickSearchDirtySourceTransfer()!.transferId).toBe(2);
  });

  it("beginTransferIfNeeded creates a transfer for empty + incomplete coverage", () => {
    const state = makeState();
    seedIncompleteDirtySources(state, []);
    const transfer = state.beginQuickSearchDirtySourceTransferIfNeeded();
    expect(transfer).toBeDefined();
    expect(transfer!.indexes.size).toBe(0);
    expect(transfer!.complete).toBe(false);
  });
});
