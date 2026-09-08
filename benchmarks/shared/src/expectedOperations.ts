import type { BenchmarkRow, NeutralColumn, NeutralFilterModel } from "./benchmarkProtocol.ts";
import { checksumColumnSchema, checksumDataset } from "./checksum.ts";
import {
  FILTER_COMBINED_MODEL,
  FILTER_NUMBER_MODEL,
  FILTER_TEXT_MODEL,
  FILTER_TYPING_FIELD,
  FILTER_TYPING_FINAL_TEXT,
  FILTER_TYPING_INTERVAL_MS,
  FILTER_TYPING_PREFIXES,
} from "./filterScenarios.ts";
import { countRowsMatchingNeutralFilter, textContainsFilter } from "./neutralFilter.ts";
import { QUICK_SEARCH_PRIMING_TEXT } from "./quickSearchScenarios.ts";
import { QUICK_SEARCH_TYPING_INTERVAL_MS, QUICK_SEARCH_TYPING_PREFIXES } from "./typingSession.ts";
import { generateRows } from "./generateRows.ts";
import { createColumns, getScenario, SCENARIO_SEED } from "./scenarios.ts";
import {
  HEADER_HEIGHT_PX,
  OVERSCAN_ROWS_PER_SIDE,
  ROW_HEIGHT_PX,
  VIEWPORT_HEIGHT_PX,
} from "./viewport.ts";

export const SCROLL_TOP_TOLERANCE_PX = 2;

export type ExpectedFilterScenario = {
  readonly model: NeutralFilterModel;
  readonly displayedRowCount: number;
};

export type ExpectedOperations = {
  readonly scenario: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly seed: number;
  readonly datasetSha256: string;
  readonly columnSchemaSha256: string;
  readonly sort: {
    readonly field: string;
    readonly direction: "asc";
    readonly minName: string;
    readonly representativeRowIds: readonly string[];
  };
  readonly filter: ExpectedFilterScenario;
  readonly filters: {
    readonly text: ExpectedFilterScenario;
    readonly numberRange: ExpectedFilterScenario;
    readonly combined: ExpectedFilterScenario;
    readonly typing: {
      readonly field: string;
      readonly model: NeutralFilterModel;
      readonly prefixes: readonly string[];
      readonly intervalMs: number;
      readonly displayedRowCounts: Readonly<Record<string, number>>;
      readonly finalDisplayedRowCount: number;
    };
  };
  readonly quickSearch: {
    readonly text: string;
    readonly displayedRowCount: number;
    readonly primingText: string;
    readonly primingDisplayedRowCount: number;
    readonly typingPrefixes: readonly string[];
    readonly typingIntervalMs: number;
    readonly typingDisplayedRowCounts: Readonly<Record<string, number>>;
  };
  readonly scroll: {
    readonly top: number;
    readonly left: number;
    readonly tolerancePx: number;
    readonly expectedFirstIndex0: number;
    readonly expectedIndex0Low: number;
    readonly expectedIndex0High: number;
  };
};

export const RUNTIME_OPERATIONS = {
  sort: { field: "name", direction: "asc" as const },
  filter: { field: "status", value: "Active" },
  quickSearch: { text: "Patel" },
  quickSearchPriming: { text: QUICK_SEARCH_PRIMING_TEXT },
  quickSearchTyping: {
    prefixes: QUICK_SEARCH_TYPING_PREFIXES,
    intervalMs: QUICK_SEARCH_TYPING_INTERVAL_MS,
  },
  filterTyping: {
    field: FILTER_TYPING_FIELD,
    prefixes: FILTER_TYPING_PREFIXES,
    intervalMs: FILTER_TYPING_INTERVAL_MS,
  },
  scrollTo: { top: 10_000, left: 0 },
};

function rowMatchesQuickSearch(row: BenchmarkRow, text: string): boolean {
  const needle = text.toLowerCase();
  return Object.values(row).some((cell) => String(cell).toLowerCase().includes(needle));
}

function compareNameAsc(left: BenchmarkRow, right: BenchmarkRow): number {
  const leftName = String(left.name ?? "");
  const rightName = String(right.name ?? "");
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;
  return String(left.id).localeCompare(String(right.id));
}

export function computeExpectedOperations(scenarioName: string): ExpectedOperations {
  const scenario = getScenario(scenarioName);
  const columns: NeutralColumn[] = createColumns(scenario.columnCount);
  const dataset = generateRows(scenarioName, columns, scenario.rowCount);
  const rows = dataset.rows;
  const { quickSearch, sort, scrollTo } = RUNTIME_OPERATIONS;
  const typingFilterModel = textContainsFilter(FILTER_TYPING_FIELD, FILTER_TYPING_FINAL_TEXT);

  let quickSearchCount = 0;
  let primingCount = 0;
  const typingDisplayedRowCounts: Record<string, number> = {};
  const filterTypingCounts: Record<string, number> = {};
  for (const prefix of RUNTIME_OPERATIONS.quickSearchTyping.prefixes) {
    typingDisplayedRowCounts[prefix] = 0;
  }
  for (const prefix of FILTER_TYPING_PREFIXES) {
    filterTypingCounts[prefix] = 0;
  }
  let minName = "";
  for (const row of rows) {
    if (rowMatchesQuickSearch(row, quickSearch.text)) quickSearchCount += 1;
    if (rowMatchesQuickSearch(row, RUNTIME_OPERATIONS.quickSearchPriming.text)) primingCount += 1;
    for (const prefix of RUNTIME_OPERATIONS.quickSearchTyping.prefixes) {
      if (rowMatchesQuickSearch(row, prefix)) {
        typingDisplayedRowCounts[prefix] += 1;
      }
    }
    for (const prefix of FILTER_TYPING_PREFIXES) {
      if (rowMatchesNeutralPrefix(row, FILTER_TYPING_FIELD, prefix)) {
        filterTypingCounts[prefix] += 1;
      }
    }
    const name = String(row.name ?? "");
    if (minName.length === 0 || name < minName) minName = name;
  }

  const representativeRowIds = rows
    .filter((row) => String(row.name ?? "") === minName)
    .sort(compareNameAsc)
    .map((row) => row.id);

  const expectedFirstIndex0 = Math.floor(scrollTo.top / ROW_HEIGHT_PX);
  const visibleRows = Math.max(
    1,
    Math.ceil((VIEWPORT_HEIGHT_PX - HEADER_HEIGHT_PX) / ROW_HEIGHT_PX),
  );
  const expectedIndex0Low = Math.max(0, expectedFirstIndex0 - OVERSCAN_ROWS_PER_SIDE - 2);
  const expectedIndex0High =
    expectedFirstIndex0 + visibleRows + OVERSCAN_ROWS_PER_SIDE + 2;

  const textCount = countRowsMatchingNeutralFilter(rows, FILTER_TEXT_MODEL);
  const numberCount = countRowsMatchingNeutralFilter(rows, FILTER_NUMBER_MODEL);
  const combinedCount = countRowsMatchingNeutralFilter(rows, FILTER_COMBINED_MODEL);
  const typingFinalCount = filterTypingCounts[FILTER_TYPING_FINAL_TEXT] ?? 0;
  const datasetSha256 = checksumDataset(rows, columns);
  const columnSchemaSha256 = checksumColumnSchema(columns);

  rows.length = 0;

  const text = { model: FILTER_TEXT_MODEL, displayedRowCount: textCount };

  return {
    scenario: scenarioName,
    rowCount: scenario.rowCount,
    columnCount: scenario.columnCount,
    seed: dataset.seed,
    datasetSha256,
    columnSchemaSha256,
    sort: {
      field: sort.field,
      direction: sort.direction,
      minName,
      representativeRowIds,
    },
    filter: text,
    filters: {
      text,
      numberRange: { model: FILTER_NUMBER_MODEL, displayedRowCount: numberCount },
      combined: { model: FILTER_COMBINED_MODEL, displayedRowCount: combinedCount },
      typing: {
        field: FILTER_TYPING_FIELD,
        model: typingFilterModel,
        prefixes: FILTER_TYPING_PREFIXES,
        intervalMs: FILTER_TYPING_INTERVAL_MS,
        displayedRowCounts: filterTypingCounts,
        finalDisplayedRowCount: typingFinalCount,
      },
    },
    quickSearch: {
      text: quickSearch.text,
      displayedRowCount: quickSearchCount,
      primingText: RUNTIME_OPERATIONS.quickSearchPriming.text,
      primingDisplayedRowCount: primingCount,
      typingPrefixes: RUNTIME_OPERATIONS.quickSearchTyping.prefixes,
      typingIntervalMs: RUNTIME_OPERATIONS.quickSearchTyping.intervalMs,
      typingDisplayedRowCounts,
    },
    scroll: {
      top: scrollTo.top,
      left: scrollTo.left,
      tolerancePx: SCROLL_TOP_TOLERANCE_PX,
      expectedFirstIndex0,
      expectedIndex0Low,
      expectedIndex0High,
    },
  };
}

function rowMatchesNeutralPrefix(row: BenchmarkRow, field: string, prefix: string): boolean {
  return String(row[field] ?? "")
    .toLowerCase()
    .includes(prefix.toLowerCase());
}

export function parseRowIndex0(rowId: string | null): number | null {
  if (rowId == null) return null;
  const match = /^row-(\d+)$/.exec(rowId);
  if (!match) return null;
  const oneBased = Number(match[1]);
  if (!Number.isFinite(oneBased) || oneBased < 1) return null;
  return oneBased - 1;
}

export { SCENARIO_SEED };
