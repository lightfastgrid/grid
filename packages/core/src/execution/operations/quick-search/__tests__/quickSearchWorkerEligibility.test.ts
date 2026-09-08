import { describe, expect, it } from "vitest";

import { buildQuickSearchDependencyPlan } from "../../../../features/quick-search/quickSearchDependencyPlan";
import type { ColumnDef, QuickFilterOptions } from "../../../../types";
import { resolveQuickSearchWorkerEligibility } from "../quickSearchWorkerEligibility";
import type { QuickSearchOperationInput } from "../types";

function makeInput(
  columns: ColumnDef[],
  overrides?: Partial<
    Omit<QuickSearchOperationInput, "columns" | "dependencyPlan">
  > & { quickFilter?: boolean | QuickFilterOptions },
): QuickSearchOperationInput {
  const quickFilter = overrides?.quickFilter ?? true;
  const dependencyPlan = buildQuickSearchDependencyPlan(columns, quickFilter);
  return {
    rows: [{ name: "Alice", city: "Lahore" }],
    quickFilterText: "alice",
    columns,
    searchableFieldsSignature: dependencyPlan.fieldsSignature,
    filterModel: {},
    filteredOrderVersion: 0,
    sourceLayoutRevision: 0,
    searchableDataRevision: 0,
    ...overrides,
    quickFilter,
    dependencyPlan,
  };
}

describe("resolveQuickSearchWorkerEligibility", () => {
  it("eligible for plain text fields", () => {
    const input = makeInput([{ field: "name" }, { field: "city" }]);
    const result = resolveQuickSearchWorkerEligibility(input);
    expect(result.eligible).toBe(true);
    expect(result.descriptors).toHaveLength(2);
    expect(result.descriptors).toBe(input.dependencyPlan.descriptors);
    expect(result.fieldsSignature).toBe(input.dependencyPlan.fieldsSignature);
  });

  it("reuses exact cached plan descriptors without scanning columns", () => {
    const columns: ColumnDef[] = [{ field: "name" }, { field: "city" }];
    const plan = buildQuickSearchDependencyPlan(columns, true);
    const throwingColumns = new Proxy(columns, {
      get(target, prop, receiver) {
        if (prop === Symbol.iterator || prop === "forEach" || prop === "map") {
          throw new Error("columns must not be scanned during eligibility");
        }
        if (prop === "length") {
          throw new Error("columns must not be scanned during eligibility");
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const input: QuickSearchOperationInput = {
      rows: [{ name: "Alice" }],
      quickFilterText: "alice",
      columns: throwingColumns,
      dependencyPlan: plan,
      searchableFieldsSignature: plan.fieldsSignature,
      filterModel: {},
      filteredOrderVersion: 0,
      sourceLayoutRevision: 0,
      searchableDataRevision: 0,
    };

    const result = resolveQuickSearchWorkerEligibility(input);
    expect(result.eligible).toBe(true);
    expect(result.descriptors).toBe(plan.descriptors);
    expect(result.fieldsSignature).toBe(plan.fieldsSignature);
  });

  it("preserves plan identity into eligibility descriptors", () => {
    const input = makeInput([{ field: "name" }]);
    const result = resolveQuickSearchWorkerEligibility(input);
    expect(result.descriptors).toBe(input.dependencyPlan.descriptors);
  });

  it("ineligible when quickFilter has custom parser", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([{ field: "name" }], {
        quickFilter: { parser: (t: string) => t.split(" ") },
      }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-parser");
  });

  it("ineligible when quickFilter has custom matcher", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([{ field: "name" }], {
        quickFilter: { matcher: () => true },
      }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-matcher");
  });

  it("ineligible when column has getQuickFilterText without projection field", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        { field: "name", getQuickFilterText: () => "custom" },
        { field: "city" },
      ]),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-extractor");
  });

  it("eligible when column has getQuickFilterText with quickFilterTextField", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        {
          field: "name",
          getQuickFilterText: () => "custom",
          quickFilterTextField: "nameSearch",
        },
        { field: "city" },
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.descriptors[0]!.projectionField).toBe("nameSearch");
  });

  it("projection field takes precedence over getQuickFilterText for eligibility", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        {
          field: "amount",
          getQuickFilterText: () => "formatted",
          quickFilterTextField: "amountText",
        },
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.descriptors[0]!.workerEligible).toBe(true);
    expect(result.descriptors[0]!.projectionField).toBe("amountText");
  });

  it("ineligible when no searchable columns remain", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([{ field: "name", searchable: false }]),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("no-searchable-columns");
  });

  it("formatted numeric column with projection field is worker-eligible", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        {
          field: "bankBalance",
          quickFilterTextField: "bankBalanceText",
          valueFormatter: ({ value }: { value: unknown }) =>
            value === null || value === undefined
              ? ""
              : Number(value).toLocaleString(),
        },
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.descriptors[0]!.projectionField).toBe("bankBalanceText");
    expect(result.descriptors[0]!.workerEligible).toBe(true);
  });

  it("rating column with projection field stays worker-eligible despite display shell", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        {
          field: "rating",
          quickFilterTextField: "ratingText",
          cellShell: { kind: "rating", icon: "★" },
        },
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.descriptors[0]!.projectionField).toBe("ratingText");
  });

  it("valueGetter + quickFilterTextField is worker-eligible", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        {
          field: "oct",
          quickFilterTextField: "octText",
          valueGetter: () => "High",
        },
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.descriptors[0]!.projectionField).toBe("octText");
    expect(result.descriptors[0]!.workerEligible).toBe(true);
  });

  it("valueFormatter + valueGetter + quickFilterTextField is worker-eligible", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        {
          field: "game.bought",
          quickFilterTextField: "boughtText",
          valueFormatter: ({ value }: { value: unknown }) =>
            value === true ? "Yes" : "No",
          valueGetter: ({ row }: { row: Record<string, unknown> }) =>
            row["game.bought"],
        },
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.descriptors[0]!.projectionField).toBe("boughtText");
  });

  it("valueGetter without projection is worker-ineligible", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([{ field: "oct", valueGetter: () => "High" }]),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-extractor");
  });

  it("valueFormatter without projection is worker-ineligible", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        {
          field: "amount",
          valueFormatter: ({ value }: { value: unknown }) =>
            value === null || value === undefined ? "" : String(value),
        },
      ]),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("custom-extractor");
  });

  it("searchable: false column is excluded from worker descriptors", () => {
    const result = resolveQuickSearchWorkerEligibility(
      makeInput([
        { field: "name" },
        { field: "jan", searchable: false },
      ]),
    );
    expect(result.eligible).toBe(true);
    expect(result.descriptors).toHaveLength(1);
    expect(result.descriptors[0]!.field).toBe("name");
  });
});
