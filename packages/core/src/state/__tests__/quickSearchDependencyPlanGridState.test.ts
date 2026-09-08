import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { QuickSearchDependencyPlan } from "../../features/quick-search/quickSearchDependencyPlan";
import type {
  LightFastGridProps,
  RowData,
} from "../../types";
import { GridState } from "../GridState";

const here = dirname(fileURLToPath(import.meta.url));
const gridStateSource = readFileSync(join(here, "../GridState.ts"), "utf8");

const resolveId = (row: RowData): string | null => {
  const raw = row.id;
  return raw === null || raw === undefined ? null : String(raw);
};

function makeState(
  overrides: Partial<LightFastGridProps> = {},
): GridState {
  return new GridState({
    columns: [{ field: "name" }, { field: "city" }],
    rows: [
      { id: "1", name: "Alice", city: "NYC" },
      { id: "2", name: "Bob", city: "LA" },
    ],
    getRowId: (row) => String(row.id),
    ...overrides,
  });
}

function getPlan(state: GridState): QuickSearchDependencyPlan {
  return state.getQuickSearchDependencyPlan();
}

describe("GridState QuickSearchDependencyPlan", () => {
  // ── Architecture guard ──────────────────────────────────────────────

  it("architecture: eager plan, pure reads, rebuild only on config mutations", () => {
    expect(gridStateSource).not.toMatch(
      /_quickSearchDependencyPlan\s*:\s*QuickSearchDependencyPlan\s*\|\s*null/,
    );
    expect(gridStateSource).not.toMatch(/\bgetCachedQuickSearchPlan\b/);
    expect(gridStateSource).not.toMatch(/\binvalidateQuickSearchDependencyPlan\b/);

    // Only rebuildQuickSearchDependencyPlan may construct a plan.
    const buildCalls = gridStateSource.match(/\bbuildQuickSearchDependencyPlan\s*\(/g) ?? [];
    expect(buildCalls).toHaveLength(1);

    // Read paths must not construct; they reference the field / analyzer directly.
    expect(gridStateSource).toMatch(
      /getQuickSearchDependencyPlan\(\)[\s\S]*?return this\._quickSearchDependencyPlan;/,
    );
    expect(gridStateSource).toMatch(
      /analyzeQuickSearchDirtyImpact\(\s*this\._quickSearchDependencyPlan/,
    );
    expect(gridStateSource).toMatch(
      /getSearchableFieldsSignature\(\)[\s\S]*?return this\._quickSearchDependencyPlan\.fieldsSignature;/,
    );

    // Post-constructor rebuild sites: the five config mutation setters only.
    const rebuildCalls = [
      ...gridStateSource.matchAll(/this\.rebuildQuickSearchDependencyPlan\s*\(\s*\)/g),
    ];
    expect(rebuildCalls).toHaveLength(6); // constructor + 5 setters

    for (const setter of [
      "setColumns",
      "setDefaultColDef",
      "setColumnVisible",
      "setColumnVisibilityState",
      "setQuickFilterOptions",
    ]) {
      expect(gridStateSource).toMatch(
        new RegExp(`${setter}\\([\\s\\S]*?this\\.rebuildQuickSearchDependencyPlan\\s*\\(`),
      );
    }
  });

  // ── Constructor plan ────────────────────────────────────────────────

  it("constructor builds plan with effective column defs", () => {
    const state = makeState();
    const plan = getPlan(state);
    expect(plan.descriptors).toHaveLength(2);
    expect(plan.exactDirtyFieldWatchSet).toEqual(new Set(["name", "city"]));
  });

  it("constructor plan uses defaultColDef values", () => {
    const state = makeState({
      columns: [
        { field: "name" },
        { field: "balance" },
      ],
      defaultColDef: {
        quickFilterTextField: "searchText",
      },
    });
    const plan = getPlan(state);
    expect(plan.exactDirtyFieldWatchSet.has("searchText")).toBe(true);
  });

  it("projection fields resolve correctly from column defs", () => {
    const state = makeState({
      columns: [
        { field: "balance", quickFilterTextField: "balanceSearch" },
        { field: "name" },
      ],
    });
    const plan = getPlan(state);
    expect(plan.exactDirtyFieldWatchSet).toEqual(
      new Set(["balance", "balanceSearch", "name"]),
    );
  });

  // ── Rebuild triggers ────────────────────────────────────────────────

  it("setColumns rebuilds the plan", () => {
    const state = makeState();
    const before = getPlan(state);
    state.setColumns([{ field: "email" }]);
    const after = getPlan(state);
    expect(after).not.toBe(before);
    expect(after.exactDirtyFieldWatchSet).toEqual(new Set(["email"]));
  });

  it("setDefaultColDef rebuilds the plan", () => {
    const state = makeState();
    const before = getPlan(state);
    state.setDefaultColDef({ searchable: false });
    const after = getPlan(state);
    expect(after).not.toBe(before);
  });

  it("single visibility change rebuilds the plan", () => {
    const state = makeState();
    const before = getPlan(state);
    state.setColumnVisible("name", false);
    const after = getPlan(state);
    expect(after).not.toBe(before);
    expect(after.exactDirtyFieldWatchSet.has("name")).toBe(false);
  });

  it("visibility batch rebuilds the plan once", () => {
    const state = makeState({
      columns: [{ field: "name" }, { field: "city" }, { field: "age" }],
    });
    const before = getPlan(state);
    state.setColumnVisibilityState([
      { field: "name", visible: false },
      { field: "city", visible: false },
    ]);
    const after = getPlan(state);
    expect(after).not.toBe(before);
    expect(after.exactDirtyFieldWatchSet).toEqual(new Set(["age"]));
  });

  it("setQuickFilterOptions rebuilds the plan", () => {
    const state = makeState();
    const before = getPlan(state);
    state.setQuickFilterOptions({ includeHiddenColumns: true });
    const after = getPlan(state);
    expect(after).not.toBe(before);
  });

  // ── No-op setters preserve identity ─────────────────────────────────

  it("no-op visibility setter preserves plan identity", () => {
    const state = makeState();
    const before = getPlan(state);
    const result = state.setColumnVisible("name", true);
    expect(result).toBeNull();
    expect(getPlan(state)).toBe(before);
  });

  it("no-op setDefaultColDef preserves plan identity", () => {
    const state = makeState({ defaultColDef: { sortable: true } });
    const before = getPlan(state);
    state.setDefaultColDef({ sortable: true });
    expect(getPlan(state)).toBe(before);
  });

  it("no-op setQuickFilterOptions preserves plan identity", () => {
    const state = makeState({ quickFilter: true });
    const before = getPlan(state);
    state.setQuickFilterOptions(true);
    expect(getPlan(state)).toBe(before);
  });

  // ── Non-rebuild operations preserve identity ────────────────────────

  it("quick-filter text change preserves plan identity", () => {
    const state = makeState();
    const before = getPlan(state);
    state.setQuickFilterText("alice");
    expect(getPlan(state)).toBe(before);
  });

  it("row update preserves plan identity", () => {
    const state = makeState();
    const before = getPlan(state);
    state.applyStoreTransaction(
      { update: [{ id: "1", name: "Updated" }] },
      resolveId,
    );
    expect(getPlan(state)).toBe(before);
  });

  it("cell replacement preserves plan identity", () => {
    const state = makeState();
    const before = getPlan(state);
    state.replaceRowAtSourceIndex(0, { id: "1", name: "New" }, resolveId);
    expect(getPlan(state)).toBe(before);
  });

  it("filter model change preserves plan identity", () => {
    const state = makeState({
      columns: [
        { field: "name", filter: "text" },
        { field: "city", filter: "text" },
      ],
    });
    const before = getPlan(state);
    state.setFilterModel({ name: { type: "text", conditions: [{ operator: "contains", value: "a" }] } });
    expect(getPlan(state)).toBe(before);
  });

  it("sort model change preserves plan identity", () => {
    const state = makeState({
      columns: [
        { field: "name", sortable: true },
        { field: "city", sortable: true },
      ],
    });
    const before = getPlan(state);
    state.setSortModel([{ field: "name", sort: "asc" }]);
    expect(getPlan(state)).toBe(before);
  });

  it("pin change preserves plan identity", () => {
    const state = makeState();
    const before = getPlan(state);
    state.setColumnPinned("name", "left");
    expect(getPlan(state)).toBe(before);
  });

  it("column order change preserves plan identity", () => {
    const state = makeState();
    const before = getPlan(state);
    state.setColumnOrder({ enabled: true });
    expect(getPlan(state)).toBe(before);
  });

  // ── includeHiddenColumns ────────────────────────────────────────────

  it("includeHiddenColumns true keeps hidden fields in plan", () => {
    const state = makeState({
      columns: [
        { field: "name" },
        { field: "secret", visible: false },
      ],
      quickFilter: { includeHiddenColumns: true },
    });
    const plan = getPlan(state);
    expect(plan.exactDirtyFieldWatchSet.has("secret")).toBe(true);
  });

  // ── Disabled / re-enabled ───────────────────────────────────────────

  it("disabled config produces disabled plan", () => {
    const state = makeState({ quickFilter: false });
    const plan = getPlan(state);
    expect(plan.descriptors).toHaveLength(0);
    expect(plan.workerSafe).toBe(false);
    expect(plan.fieldsSignature).toBe("sf|disabled");
  });

  it("re-enabling produces enabled plan", () => {
    const state = makeState({ quickFilter: false });
    expect(getPlan(state).descriptors).toHaveLength(0);
    state.setQuickFilterOptions(true);
    const plan = getPlan(state);
    expect(plan.descriptors).toHaveLength(2);
    expect(plan.workerSafe).toBe(true);
  });

  it("parser change updates workerSafe", () => {
    const state = makeState();
    expect(getPlan(state).workerSafe).toBe(true);
    expect(getPlan(state).dependsOnAllRowFields).toBe(false);
    state.setQuickFilterOptions({ parser: (t) => t.split(",") });
    expect(getPlan(state).workerSafe).toBe(false);
    expect(getPlan(state).dependsOnAllRowFields).toBe(false);
  });

  it("matcher change updates workerSafe", () => {
    const state = makeState();
    expect(getPlan(state).workerSafe).toBe(true);
    expect(getPlan(state).dependsOnAllRowFields).toBe(false);
    state.setQuickFilterOptions({ matcher: () => true });
    expect(getPlan(state).workerSafe).toBe(false);
    expect(getPlan(state).dependsOnAllRowFields).toBe(false);
  });

  it("valueGetter without projection sets dependsOnAllRowFields", () => {
    const state = makeState({
      columns: [
        {
          field: "fullName",
          valueGetter: ({ row }: { row: RowData }) =>
            `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`,
        },
      ],
    });
    const plan = getPlan(state);
    expect(plan.dependsOnAllRowFields).toBe(true);
    expect(plan.workerSafe).toBe(false);
  });

  it("projection-backed valueGetter stays field-selective", () => {
    const state = makeState({
      columns: [
        {
          field: "fullName",
          valueGetter: ({ row }: { row: RowData }) =>
            `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`,
          quickFilterTextField: "fullNameSearch",
        },
      ],
    });
    const plan = getPlan(state);
    expect(plan.dependsOnAllRowFields).toBe(false);
    expect(plan.workerSafe).toBe(true);
  });

  // ── Dirty matching uses cached sets ─────────────────────────────────

  it("dirty matching uses cached exact/root sets (no descriptor resolution)", () => {
    const state = makeState({
      columns: [{ field: "name" }, { field: "city" }],
      quickFilterText: "alice",
    });
    const plan = getPlan(state);
    const exactBefore = plan.exactDirtyFieldWatchSet;
    const rootBefore = plan.dirtyFieldRootWatchSet;

    state.applyStoreTransaction(
      { update: [{ id: "1", name: "Updated" }] },
      resolveId,
    );
    state.applyStoreTransaction(
      { update: [{ id: "2", city: "SF" }] },
      resolveId,
    );

    expect(getPlan(state).exactDirtyFieldWatchSet).toBe(exactBefore);
    expect(getPlan(state).dirtyFieldRootWatchSet).toBe(rootBefore);
  });

  // ── fields signature getter ─────────────────────────────────────────

  it("fields signature returns cached plan signature", () => {
    const state = makeState();
    const plan = getPlan(state);
    expect(state.getQuickSearchSearchableFieldsSignature()).toBe(
      plan.fieldsSignature,
    );
  });

  // ── Active plan change preserves fallback/scheduling ────────────────

  it("active plan-changing mutation preserves fallback and marks scheduling", () => {
    const state = makeState({ quickFilterText: "alice" });
    expect(state.isQuickFilterPresent()).toBe(true);
    state.setColumns([{ field: "email" }]);
    expect(state.needsQuickSearchSchedule).toBe(true);
  });

  it("inactive query plan changes do not schedule search", () => {
    const state = makeState();
    expect(state.isQuickFilterPresent()).toBe(false);
    state.setColumns([{ field: "email" }]);
    expect(state.needsQuickSearchSchedule).toBe(false);
  });

  // ── Visibility updates plan even with empty query ───────────────────

  it("visibility change updates plan even when query is empty", () => {
    const state = makeState();
    expect(state.isQuickFilterPresent()).toBe(false);
    const before = getPlan(state);
    state.setColumnVisible("name", false);
    const after = getPlan(state);
    expect(after).not.toBe(before);
    expect(after.exactDirtyFieldWatchSet.has("name")).toBe(false);
  });
});
