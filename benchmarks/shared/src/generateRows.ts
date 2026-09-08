import type { BenchmarkRow, NeutralColumn } from "./benchmarkProtocol.ts";
import {
  getValuePools,
  SCENARIO_SEED,
} from "./scenarios.ts";

export type GeneratedDataset = {
  readonly rows: BenchmarkRow[];
  readonly columns: NeutralColumn[];
  readonly generationMs: number;
  readonly seed: number;
  readonly scenario: string;
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixSeed(base: number, rowIndex: number, columnIndex: number): number {
  let h = (base ^ Math.imul(rowIndex + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (columnIndex + 1), 0x85ebca6b) >>> 0;
  return h >>> 0;
}

function pick<T>(pool: readonly T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)]!;
}

function formatRowId(index: number): string {
  return `row-${String(index + 1).padStart(7, "0")}`;
}

function formatDate(rng: () => number): string {
  const dayOffset = Math.floor(rng() * 2000);
  const date = new Date(Date.UTC(2020, 0, 1 + dayOffset));
  return date.toISOString().slice(0, 10);
}

function cellValue(
  column: NeutralColumn,
  rowIndex: number,
  columnIndex: number,
  id: string,
): string | number {
  const rng = mulberry32(mixSeed(SCENARIO_SEED, rowIndex, columnIndex));
  const pools = getValuePools();
  switch (column.kind) {
    case "id":
      return id;
    case "number": {
      const min = column.min ?? 0;
      const max = column.max ?? 1000;
      return min + Math.floor(rng() * (max - min + 1));
    }
    case "date":
      return formatDate(rng);
    case "status": {
      const poolName = column.pool ?? "statuses";
      const pool = (pools as Record<string, readonly string[]>)[poolName];
      if (!pool) {
        throw new Error(`Missing value pool "${poolName}"`);
      }
      return pick(pool, rng);
    }
    default: {
      if (column.field === "email") {
        const name = pick(pools.names, rng).toLowerCase().replaceAll(" ", ".");
        return `${name}.${rowIndex + 1}@example.com`;
      }
      const poolName = column.pool ?? "notes";
      const pool = (pools as Record<string, readonly string[]>)[poolName];
      if (!pool) {
        throw new Error(`Missing value pool "${poolName}"`);
      }
      return pick(pool, rng);
    }
  }
}

export function generateRows(
  scenarioName: string,
  columns: readonly NeutralColumn[],
  rowCount: number,
): GeneratedDataset {
  const started = performance.now();
  const rows = new Array<BenchmarkRow>(rowCount);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const id = formatRowId(rowIndex);
    const row: Record<string, string | number> = { id };
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const column = columns[columnIndex]!;
      if (column.field === "id") {
        row.id = id;
        continue;
      }
      row[column.field] = cellValue(column, rowIndex, columnIndex, id);
    }
    rows[rowIndex] = row as BenchmarkRow;
  }
  return {
    rows,
    columns: [...columns],
    generationMs: performance.now() - started,
    seed: SCENARIO_SEED,
    scenario: scenarioName,
  };
}
