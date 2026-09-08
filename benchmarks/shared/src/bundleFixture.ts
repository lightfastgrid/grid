import type { BenchmarkRow, NeutralColumn } from "./benchmarkProtocol.ts";
import { createColumns, DEFAULT_SCENARIO_NAME, getScenario } from "./scenarios.ts";

export type BundleFixture = {
  readonly scenario: string;
  readonly rows: BenchmarkRow[];
  readonly columns: NeutralColumn[];
};

function cellValue(column: NeutralColumn, index: number): string | number {
  if (column.kind === "number") return index + 1;
  if (column.kind === "date") return "2026-01-01";
  if (column.kind === "id") return `row-${String(index + 1).padStart(7, "0")}`;
  return `${column.field}-${index + 1}`;
}

/**
 * Tiny representative table for bundle-mode mounts. Not the runtime generator
 * and not a 10k-row scenario — those belong to the protocol apps.
 */
export function createBundleFixture(rowCount = 3): BundleFixture {
  const scenario = getScenario(DEFAULT_SCENARIO_NAME);
  const columns = createColumns(scenario.columnCount);
  const rows: BenchmarkRow[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const row: Record<string, string | number> = {
      id: `row-${String(index + 1).padStart(7, "0")}`,
    };
    for (const column of columns) {
      row[column.field] = cellValue(column, index);
    }
    rows.push(row as BenchmarkRow);
  }
  return {
    scenario: scenario.name,
    rows,
    columns,
  };
}
