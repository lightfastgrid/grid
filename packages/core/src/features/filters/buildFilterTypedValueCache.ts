import type { ColumnFilterType, FilterModel, RowData } from "../../types";

import type { GetCellValue } from "./filterValueAccess";
import { toBoolean, toEpochDay, toNumber } from "./filterValueAccess";
import type { NormalizedColumnFilterConfig } from "./types";

export const BOOL_FALSE = 0 as const;
export const BOOL_TRUE = 1 as const;
export const BOOL_NULL_SENTINEL = 2 as const;

export type ReadFilterCacheValue<TRow extends RowData> = (
  row: TRow,
  rowIndex: number,
  field: string,
) => unknown;

export interface FilterTypedValueCacheInput {
  rows: readonly RowData[];
  filterModel: FilterModel;
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>;
  getCellValue: GetCellValue;
  sourceIndexes?: readonly number[] | Uint32Array;
}

export interface FieldTextCache {
  type: "text";
  values: string[];
  nullFlags: Uint8Array;
  caseSensitive: boolean;
}

export interface FieldNumberCache {
  type: "number";
  values: Float64Array;
  validFlags: Uint8Array;
}

export interface FieldDateCache {
  type: "date";
  dayKeys: Int32Array;
  validFlags: Uint8Array;
}

export interface FieldBooleanCache {
  type: "boolean";
  values: Uint8Array;
}

export type FieldCache = FieldTextCache | FieldNumberCache | FieldDateCache | FieldBooleanCache;

export interface FilterTypedValueCache {
  fields: ReadonlyMap<string, FieldCache>;
}

export interface BuildFilterFieldTypedValueCacheInput<TRow extends RowData> {
  rows: readonly TRow[];
  field: string;
  config: NormalizedColumnFilterConfig;
  readValue: ReadFilterCacheValue<TRow>;
  sourceIndexes?: readonly number[] | Uint32Array | null;
}

function forEachScanIndex(
  rowCount: number,
  sourceIndexes: readonly number[] | Uint32Array | null | undefined,
  visit: (idx: number) => void,
): void {
  if (sourceIndexes) {
    for (let i = 0; i < sourceIndexes.length; i++) visit(sourceIndexes[i]!);
    return;
  }

  for (let idx = 0; idx < rowCount; idx++) visit(idx);
}

function buildTextCache<TRow extends RowData>(
  rows: readonly TRow[],
  field: string,
  config: NormalizedColumnFilterConfig,
  readValue: ReadFilterCacheValue<TRow>,
  sourceIndexes: readonly number[] | Uint32Array | null | undefined,
): FieldTextCache {
  const values = new Array<string>(rows.length);
  const nullFlags = new Uint8Array(rows.length);
  const ci = !config.caseSensitive;

  forEachScanIndex(rows.length, sourceIndexes, (idx) => {
    const v = readValue(rows[idx]!, idx, field);
    if (v === null || v === undefined) {
      values[idx] = "";
      nullFlags[idx] = 1;
    } else {
      const s = String(v);
      values[idx] = ci ? s.toLowerCase() : s;
      nullFlags[idx] = 0;
    }
  });

  return { type: "text", values, nullFlags, caseSensitive: config.caseSensitive };
}

function buildNumberCache<TRow extends RowData>(
  rows: readonly TRow[],
  field: string,
  readValue: ReadFilterCacheValue<TRow>,
  sourceIndexes: readonly number[] | Uint32Array | null | undefined,
): FieldNumberCache {
  const values = new Float64Array(rows.length);
  const validFlags = new Uint8Array(rows.length);

  forEachScanIndex(rows.length, sourceIndexes, (idx) => {
    const v = toNumber(readValue(rows[idx]!, idx, field));
    if (v !== null) {
      values[idx] = v;
      validFlags[idx] = 1;
    }
  });

  return { type: "number", values, validFlags };
}

function buildDateCache<TRow extends RowData>(
  rows: readonly TRow[],
  field: string,
  readValue: ReadFilterCacheValue<TRow>,
  sourceIndexes: readonly number[] | Uint32Array | null | undefined,
): FieldDateCache {
  const dayKeys = new Int32Array(rows.length);
  const validFlags = new Uint8Array(rows.length);

  forEachScanIndex(rows.length, sourceIndexes, (idx) => {
    const v = toEpochDay(readValue(rows[idx]!, idx, field));
    if (v !== null) {
      dayKeys[idx] = v;
      validFlags[idx] = 1;
    }
  });

  return { type: "date", dayKeys, validFlags };
}

function buildBooleanCache<TRow extends RowData>(
  rows: readonly TRow[],
  field: string,
  readValue: ReadFilterCacheValue<TRow>,
  sourceIndexes: readonly number[] | Uint32Array | null | undefined,
): FieldBooleanCache {
  const values = new Uint8Array(rows.length);
  values.fill(BOOL_NULL_SENTINEL);

  forEachScanIndex(rows.length, sourceIndexes, (idx) => {
    const v = toBoolean(readValue(rows[idx]!, idx, field));
    if (v !== null) values[idx] = v ? BOOL_TRUE : BOOL_FALSE;
  });

  return { type: "boolean", values };
}

const BUILDERS: Record<
  ColumnFilterType,
  <TRow extends RowData>(
    rows: readonly TRow[],
    field: string,
    config: NormalizedColumnFilterConfig,
    readValue: ReadFilterCacheValue<TRow>,
    sourceIndexes: readonly number[] | Uint32Array | null | undefined,
  ) => FieldCache
> = {
  text: buildTextCache,
  number: (rows, field, _config, readValue, sourceIndexes) =>
    buildNumberCache(rows, field, readValue, sourceIndexes),
  date: (rows, field, _config, readValue, sourceIndexes) =>
    buildDateCache(rows, field, readValue, sourceIndexes),
  boolean: (rows, field, _config, readValue, sourceIndexes) =>
    buildBooleanCache(rows, field, readValue, sourceIndexes),
};

export function buildFilterFieldTypedValueCache<TRow extends RowData>(
  input: BuildFilterFieldTypedValueCacheInput<TRow>,
): FieldCache {
  const { rows, field, config, readValue, sourceIndexes } = input;
  return BUILDERS[config.type](rows, field, config, readValue, sourceIndexes);
}

export function buildFilterTypedValueCache(
  input: FilterTypedValueCacheInput,
): FilterTypedValueCache {
  const { rows, filterModel, columnsByField, getCellValue } = input;
  const fields = new Map<string, FieldCache>();

  for (const field of Object.keys(filterModel)) {
    const config = columnsByField.get(field);
    if (!config) continue;
    const cache = buildFilterFieldTypedValueCache({
      rows,
      field,
      config,
      readValue: getCellValue,
      sourceIndexes: input.sourceIndexes,
    });
    fields.set(field, cache);
  }

  return { fields };
}
