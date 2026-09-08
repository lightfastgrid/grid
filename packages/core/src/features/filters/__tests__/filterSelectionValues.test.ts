import { describe, expect, it, vi } from "vitest";

import type { ColumnDef, ColumnFilterCondition, ColumnFilterModel, ColumnFilterOperator, FilterModel } from "../../../types";
import { createFilterDisplayValueAccessor } from "../filterDisplayValueAccess";
import { createFilterSelectionValueProvider } from "../filterSelectionValueProvider";
import {
  collectFilterSelectionValues,
} from "../filterSelectionValues";
import type { NormalizedColumnFilterConfig } from "../types";

function textConfig(overrides?: Partial<NormalizedColumnFilterConfig>): NormalizedColumnFilterConfig {
  return { type: "text", defaultOperator: "contains", caseSensitive: false, trimInput: true, ...overrides };
}

function numberConfig(): NormalizedColumnFilterConfig {
  return { type: "number", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

function dateConfig(): NormalizedColumnFilterConfig {
  return { type: "date", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

function booleanConfig(): NormalizedColumnFilterConfig {
  return { type: "boolean", defaultOperator: "equals", caseSensitive: false, trimInput: true };
}

describe("collectFilterSelectionValues", () => {
  // ── text ──────────────────────────────────────────────────

  it("text merges case-insensitive duplicates and counts them", () => {
    const rows = [
      { name: "Alice" },
      { name: "alice" },
      { name: "ALICE" },
      { name: "Bob" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
    });
    expect(result.values).toHaveLength(2);
    expect(result.totalDistinct).toBe(2);
    expect(result.scannedRowCount).toBe(4);
    expect(result.truncated).toBe(false);

    const alice = result.values.find((v) => v.key === "alice");
    expect(alice).toBeDefined();
    expect(alice!.count).toBe(3);
    expect(alice!.label).toBe("Alice");
    expect(alice!.value).toBe("Alice");
    expect(alice!.sampleRowIndex).toBe(0);

    const bob = result.values.find((v) => v.key === "bob");
    expect(bob).toBeDefined();
    expect(bob!.count).toBe(1);
    expect(bob!.sampleRowIndex).toBe(3);
  });

  it("keeps the first matching sampleRowIndex while counting duplicates", () => {
    const rows = [
      { name: "Skip" },
      { name: "Pending" },
      { name: "pending" },
      { name: "Active" },
      { name: "PENDING" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
      sourceIndexes: [1, 2, 3, 4],
    });

    const pending = result.values.find((v) => v.key === "pending");
    expect(pending).toBeDefined();
    expect(pending!.count).toBe(3);
    expect(pending!.sampleRowIndex).toBe(1);
  });

  it("text caseSensitive keeps separate values", () => {
    const rows = [
      { name: "Alice" },
      { name: "alice" },
      { name: "Bob" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig({ caseSensitive: true }),
    });
    expect(result.values).toHaveLength(3);
    expect(result.values.find((v) => v.key === "Alice")).toBeDefined();
    expect(result.values.find((v) => v.key === "alice")).toBeDefined();
    expect(result.values.find((v) => v.key === "Bob")).toBeDefined();
  });

  it("trimInput removes surrounding spaces and skips empty", () => {
    const rows = [
      { name: "  Alice  " },
      { name: "   " },
      { name: "" },
      { name: "Bob" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
    });
    expect(result.values).toHaveLength(2);
    expect(result.values.find((v) => v.label === "Alice")).toBeDefined();
    expect(result.values.find((v) => v.label === "Bob")).toBeDefined();
  });

  it("text skips null and undefined", () => {
    const rows = [
      { name: "Alice" },
      { name: null },
      { name: undefined },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
    });
    expect(result.values).toHaveLength(1);
    expect(result.scannedRowCount).toBe(3);
  });

  // ── number ────────────────────────────────────────────────

  it("number normalization collects distinct finite numbers", () => {
    const rows = [
      { val: 10 },
      { val: 20 },
      { val: 10 },
      { val: "30" },
      { val: null },
      { val: NaN },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "val",
      config: numberConfig(),
    });
    expect(result.values).toHaveLength(3);
    expect(result.totalDistinct).toBe(3);

    const ten = result.values.find((v) => v.value === 10);
    expect(ten).toBeDefined();
    expect(ten!.count).toBe(2);

    const thirty = result.values.find((v) => v.value === 30);
    expect(thirty).toBeDefined();
    expect(thirty!.count).toBe(1);
  });

  // ── date ──────────────────────────────────────────────────

  it("date normalization collects valid dates", () => {
    const rows = [
      { val: "2024-01-15" },
      { val: "2024-06-01" },
      { val: "2024-01-15" },
      { val: null },
      { val: "not-a-date" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "val",
      config: dateConfig(),
    });
    expect(result.values).toHaveLength(2);
    const jan = result.values.find((v) => v.value === "2024-01-15");
    expect(jan).toBeDefined();
    expect(jan!.count).toBe(2);
  });

  // ── boolean ───────────────────────────────────────────────

  it("boolean normalization collects true/false", () => {
    const rows = [
      { val: true },
      { val: false },
      { val: "true" },
      { val: null },
      { val: "yes" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "val",
      config: booleanConfig(),
    });
    expect(result.values).toHaveLength(2);
    const t = result.values.find((v) => v.value === true);
    expect(t).toBeDefined();
    expect(t!.count).toBe(2);
    expect(t!.label).toBe("true");

    const f = result.values.find((v) => v.value === false);
    expect(f).toBeDefined();
    expect(f!.count).toBe(1);
  });

  // ── sourceIndexes ─────────────────────────────────────────

  it("sourceIndexes limits scanned rows", () => {
    const rows = [
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
      { name: "Diana" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
      sourceIndexes: [0, 2],
    });
    expect(result.scannedRowCount).toBe(2);
    expect(result.values).toHaveLength(2);
    expect(result.values.find((v) => v.label === "Alice")).toBeDefined();
    expect(result.values.find((v) => v.label === "Charlie")).toBeDefined();
    expect(result.values.find((v) => v.label === "Bob")).toBeUndefined();
  });

  // ── searchText ────────────────────────────────────────────

  it("searchText filters returned distinct values case-insensitively", () => {
    const rows = [
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
      { name: "Alex" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
      searchText: "al",
    });
    expect(result.values).toHaveLength(2);
    expect(result.totalDistinct).toBe(2);
    expect(result.values.find((v) => v.label === "Alice")).toBeDefined();
    expect(result.values.find((v) => v.label === "Alex")).toBeDefined();
  });

  it("searchText with no matches returns empty", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
      searchText: "zzz",
    });
    expect(result.values).toHaveLength(0);
    expect(result.totalDistinct).toBe(0);
  });

  // ── maxValues ─────────────────────────────────────────────

  it("maxValues truncates and sets truncated flag", () => {
    const rows = [
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
      { name: "Diana" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
      maxValues: 2,
    });
    expect(result.values).toHaveLength(2);
    expect(result.totalDistinct).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it("maxValues not truncated when under limit", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
      maxValues: 10,
    });
    expect(result.values).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("maxValues applied after searchText", () => {
    const rows = [
      { name: "Alice" },
      { name: "Alex" },
      { name: "Anna" },
      { name: "Bob" },
    ];
    const result = collectFilterSelectionValues({
      rows,
      field: "name",
      config: textConfig(),
      searchText: "a",
      maxValues: 2,
    });
    expect(result.totalDistinct).toBe(3);
    expect(result.values).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("maxValues: 0 does not truncate", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const result = collectFilterSelectionValues({
      rows, field: "name", config: textConfig(), maxValues: 0,
    });
    expect(result.values).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("maxValues: -1 does not truncate", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const result = collectFilterSelectionValues({
      rows, field: "name", config: textConfig(), maxValues: -1,
    });
    expect(result.values).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("maxValues: NaN does not truncate", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const result = collectFilterSelectionValues({
      rows, field: "name", config: textConfig(), maxValues: NaN,
    });
    expect(result.values).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("maxValues: Infinity does not truncate", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const result = collectFilterSelectionValues({
      rows, field: "name", config: textConfig(), maxValues: Infinity,
    });
    expect(result.values).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("maxValues: 0.5 floors to 0 and does not truncate", () => {
    const rows = [{ name: "Alice" }, { name: "Bob" }];
    const result = collectFilterSelectionValues({
      rows, field: "name", config: textConfig(), maxValues: 0.5,
    });
    expect(result.values).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("maxValues: 2.7 truncates to 2", () => {
    const rows = [
      { name: "Alice" },
      { name: "Bob" },
      { name: "Charlie" },
    ];
    const result = collectFilterSelectionValues({
      rows, field: "name", config: textConfig(), maxValues: 2.7,
    });
    expect(result.values).toHaveLength(2);
    expect(result.totalDistinct).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("text filter with valueGetter + valueFormatter collects formatted display values", () => {
    const rows = [
      { jan: 38031 },
      { jan: 30000 },
      { jan: 30400 },
    ];
    const progressColumn: ColumnDef = {
      field: "jan",
      valueGetter: ({ row }) => Math.round((Number(row.jan) / 100000) * 100),
      valueFormatter: ({ value }) => `${String(value)}%`,
    };
    const cfg = textConfig();
    const getCellValue = createFilterDisplayValueAccessor({
      columns: [progressColumn],
      columnsByField: new Map([["jan", cfg]]),
      fields: ["jan"],
    })!;

    const result = collectFilterSelectionValues({
      rows,
      field: "jan",
      config: cfg,
      getCellValue,
    });

    expect(result.values).toHaveLength(2);
    expect(result.values.find((v) => v.label === "38%")).toMatchObject({
      key: "38%",
      value: "38%",
      count: 1,
      sampleRowIndex: 0,
    });
    expect(result.values.find((v) => v.label === "30%")).toMatchObject({
      key: "30%",
      value: "30%",
      count: 2,
      sampleRowIndex: 1,
    });
  });

  it("text filter search matches formatted labels and not raw row values", () => {
    const rows = [{ jan: 38031 }, { jan: 30000 }];
    const progressColumn: ColumnDef = {
      field: "jan",
      valueGetter: ({ row }) => Math.round((Number(row.jan) / 100000) * 100),
      valueFormatter: ({ value }) => `${String(value)}%`,
    };
    const cfg = textConfig();
    const getCellValue = createFilterDisplayValueAccessor({
      columns: [progressColumn],
      columnsByField: new Map([["jan", cfg]]),
      fields: ["jan"],
    })!;

    const match = collectFilterSelectionValues({
      rows,
      field: "jan",
      config: cfg,
      getCellValue,
      searchText: "38%",
    });
    expect(match.values).toHaveLength(1);
    expect(match.values[0]!.label).toBe("38%");

    const noMatch = collectFilterSelectionValues({
      rows,
      field: "jan",
      config: cfg,
      getCellValue,
      searchText: "38031",
    });
    expect(noMatch.values).toHaveLength(0);
  });
});

// ── createFilterSelectionValueProvider ─────────────────────

describe("createFilterSelectionValueProvider", () => {
  const rows = [
    { name: "Alice" },
    { name: "Bob" },
    { name: "Charlie" },
  ];
  const cfg = textConfig();
  const columns: ColumnDef[] = [{ field: "name" }, { field: "city" }];

  function makeDeps(overrides?: { rows?: typeof rows; config?: NormalizedColumnFilterConfig | null }) {
    const getRows = vi.fn(() => overrides?.rows ?? rows);
    const getColumns = vi.fn(() => columns);
    const getFilterConfig = vi.fn((_field: string) => overrides?.config !== undefined ? overrides.config : cfg);
    return { getRows, getColumns, getFilterConfig };
  }

  it("returns cached result for same rows/config/field/search/max", () => {
    const deps = makeDeps();
    const provider = createFilterSelectionValueProvider(deps);

    const first = provider({ field: "name" });
    const second = provider({ field: "name" });

    expect(second).toBe(first);
    expect(deps.getRows).toHaveBeenCalledTimes(2);
    expect(first.values).toHaveLength(3);
  });

  it("recollects when searchText changes", () => {
    const deps = makeDeps();
    const provider = createFilterSelectionValueProvider(deps);

    const first = provider({ field: "name" });
    const second = provider({ field: "name", searchText: "ali" });

    expect(second).not.toBe(first);
    expect(second.values).toHaveLength(1);
    expect(second.values[0]!.label).toBe("Alice");
  });

  it("recollects when rows reference changes", () => {
    const rows1 = [{ name: "Alice" }];
    const rows2 = [{ name: "Alice" }, { name: "Bob" }];
    let currentRows = rows1;
    const deps = {
      getRows: vi.fn(() => currentRows),
      getColumns: vi.fn(() => columns),
      getFilterConfig: vi.fn(() => cfg),
    };
    const provider = createFilterSelectionValueProvider(deps);

    const first = provider({ field: "name" });
    expect(first.values).toHaveLength(1);

    currentRows = rows2;
    const second = provider({ field: "name" });
    expect(second).not.toBe(first);
    expect(second.values).toHaveLength(2);
  });

  it("recollects when field changes", () => {
    const multiRows = [{ name: "Alice", city: "NY" }];
    const deps = {
      getRows: vi.fn(() => multiRows),
      getColumns: vi.fn(() => columns),
      getFilterConfig: vi.fn(() => cfg),
    };
    const provider = createFilterSelectionValueProvider(deps);

    const first = provider({ field: "name" });
    const second = provider({ field: "city" });

    expect(second).not.toBe(first);
    expect(second.values[0]!.label).toBe("NY");
  });

  it("returns empty result when config is null", () => {
    const deps = makeDeps({ config: null });
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "name" });
    expect(result.values).toHaveLength(0);
    expect(result.totalDistinct).toBe(0);
  });

  it("uses valueGetter and valueFormatter for formatted text selection values", () => {
    const progressRows = [
      { jan: 38031 },
      { jan: 30000 },
      { jan: 30400 },
    ];
    const progressColumn: ColumnDef = {
      field: "jan",
      filter: "text",
      valueGetter: ({ row }) => Math.round((Number(row.jan) / 100000) * 100),
      valueFormatter: ({ value }) => `${String(value)}%`,
    };
    const deps = {
      getRows: vi.fn(() => progressRows),
      getColumns: vi.fn(() => [progressColumn]),
      getFilterConfig: vi.fn(() => cfg),
      getColumnFilterConfigs: vi.fn(() => new Map([["jan", cfg]])),
    };
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "jan", searchText: "30%" });

    expect(result.values).toHaveLength(1);
    expect(result.values[0]).toMatchObject({
      key: "30%",
      value: "30%",
      label: "30%",
      count: 2,
      sampleRowIndex: 1,
    });
  });
});

describe("createFilterSelectionValueProvider — faceted values", () => {
  const cfg = textConfig();
  const numCfg = numberConfig();

  const allRows = [
    { name: "Alice", city: "NY", age: 30 },
    { name: "Bob", city: "LA", age: 25 },
    { name: "Charlie", city: "NY", age: 35 },
    { name: "Diana", city: "SF", age: 25 },
    { name: "Eve", city: "LA", age: 30 },
  ];

  const columnConfigs = new Map<string, NormalizedColumnFilterConfig>([
    ["name", cfg],
    ["city", cfg],
    ["age", numCfg],
  ]);
  const columns: ColumnDef[] = [
    { field: "name" },
    { field: "city" },
    { field: "age" },
  ];

  function cfm(type: string, operator: string, value: unknown): ColumnFilterModel {
    return { type: type as ColumnFilterModel["type"], conditions: [{ operator: operator as ColumnFilterOperator, value: value as ColumnFilterCondition["value"] }] };
  }

  function makeFacetedDeps(filterModel: FilterModel) {
    return {
      getRows: vi.fn(() => allRows),
      getColumns: vi.fn(() => columns),
      getFilterConfig: vi.fn((field: string) => columnConfigs.get(field) ?? null),
      getFilterModel: vi.fn(() => filterModel),
      getColumnFilterConfigs: vi.fn(() => columnConfigs),
    };
  }

  it("excludes target field from effective filter model", () => {
    const deps = makeFacetedDeps({
      city: cfm("text", "equals", "NY"),
    });
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "city" });
    expect(result.values).toHaveLength(3);
    expect(result.values.map((v) => v.label).sort()).toEqual(["LA", "NY", "SF"]);
  });

  it("facets values by other active filters", () => {
    const deps = makeFacetedDeps({
      city: cfm("text", "equals", "NY"),
    });
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "name" });
    expect(result.values).toHaveLength(2);
    expect(result.values.map((v) => v.label).sort()).toEqual(["Alice", "Charlie"]);
  });

  it("returns all values when no other filters are active", () => {
    const deps = makeFacetedDeps({});
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "name" });
    expect(result.values).toHaveLength(5);
  });

  it("facets with multiple cross-field filters", () => {
    const deps = makeFacetedDeps({
      city: cfm("text", "equals", "LA"),
      age: cfm("number", "equals", 25),
    });
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "name" });
    expect(result.values).toHaveLength(1);
    expect(result.values[0]!.label).toBe("Bob");
  });

  it("invalidates cache when filterModel reference changes", () => {
    const model1: FilterModel = { city: cfm("text", "equals", "NY") };
    const model2: FilterModel = { city: cfm("text", "equals", "LA") };
    let currentModel = model1;
    const deps = {
      getRows: vi.fn(() => allRows),
      getColumns: vi.fn(() => columns),
      getFilterConfig: vi.fn((field: string) => columnConfigs.get(field) ?? null),
      getFilterModel: vi.fn(() => currentModel),
      getColumnFilterConfigs: vi.fn(() => columnConfigs),
    };
    const provider = createFilterSelectionValueProvider(deps);

    const first = provider({ field: "name" });
    expect(first.values).toHaveLength(2);

    currentModel = model2;
    const second = provider({ field: "name" });
    expect(second).not.toBe(first);
    expect(second.values).toHaveLength(2);
    expect(second.values.map((v) => v.label).sort()).toEqual(["Bob", "Eve"]);
  });

  it("faceted values span full filtered source, not a page-sized subset", () => {
    const sourceRows = Array.from({ length: 20 }, (_, i) => ({
      name: `Person${i}`,
      city: i % 3 === 0 ? "NY" : i % 3 === 1 ? "LA" : "SF",
      age: 20 + i,
    }));
    const pageSize = 5;
    const filteredByCity = sourceRows.filter((r) => r.city === "NY");
    expect(filteredByCity.length).toBeGreaterThan(pageSize);

    const deps = {
      getRows: vi.fn(() => sourceRows),
      getColumns: vi.fn(() => columns),
      getFilterConfig: vi.fn((field: string) => columnConfigs.get(field) ?? null),
      getFilterModel: vi.fn(() => ({
        city: cfm("text", "equals", "NY"),
      })),
      getColumnFilterConfigs: vi.fn(() => columnConfigs),
    };
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "name" });
    expect(result.values).toHaveLength(filteredByCity.length);
    const labels = result.values.map((v) => v.label).sort();
    const expected = filteredByCity.map((r) => r.name).sort();
    expect(labels).toEqual(expected);
  });

  it("works without faceting when getFilterModel is not provided", () => {
    const deps = {
      getRows: vi.fn(() => allRows),
      getColumns: vi.fn(() => columns),
      getFilterConfig: vi.fn((field: string) => columnConfigs.get(field) ?? null),
    };
    const provider = createFilterSelectionValueProvider(deps);

    const result = provider({ field: "name" });
    expect(result.values).toHaveLength(5);
  });
});
