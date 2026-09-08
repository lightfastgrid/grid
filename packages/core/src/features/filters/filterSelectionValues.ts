import type { RowData } from "../../types";

import type { GetCellValue } from "./filterValueAccess";
import { defaultGetCellValue, toBoolean, toDateString, toNumber } from "./filterValueAccess";
import type { NormalizedColumnFilterConfig } from "./types";

export interface FilterSelectionValue {
  key: string;
  value: string | number | boolean;
  label: string;
  count: number;
  sampleRowIndex: number;
}

export interface FilterSelectionValueResult {
  values: FilterSelectionValue[];
  /** Distinct count after `searchText` filtering, before `maxValues` truncation. */
  totalDistinct: number;
  scannedRowCount: number;
  truncated: boolean;
}

export interface CollectFilterSelectionValuesInput {
  rows: readonly RowData[];
  field: string;
  config: NormalizedColumnFilterConfig;
  getCellValue?: GetCellValue;
  sourceIndexes?: readonly number[] | Uint32Array;
  searchText?: string;
  maxValues?: number;
}

interface DistinctEntry {
  value: string | number | boolean;
  label: string;
  count: number;
  sampleRowIndex: number;
}

function collectText(
  rows: readonly RowData[],
  field: string,
  config: NormalizedColumnFilterConfig,
  getCellValue: GetCellValue,
  sourceIndexes: readonly number[] | Uint32Array | undefined,
): { map: Map<string, DistinctEntry>; scanned: number } {
  const ci = !config.caseSensitive;
  const trim = config.trimInput;
  const map = new Map<string, DistinctEntry>();
  const len = sourceIndexes ? sourceIndexes.length : rows.length;

  for (let i = 0; i < len; i++) {
    const idx = sourceIndexes ? sourceIndexes[i]! : i;
    const raw = getCellValue(rows[idx]!, idx, field);
    if (raw === null || raw === undefined) continue;
    let s = String(raw);
    if (trim) s = s.trim();
    if (s === "") continue;
    const key = ci ? s.toLowerCase() : s;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { value: s, label: s, count: 1, sampleRowIndex: idx });
    }
  }

  return { map, scanned: len };
}

function collectNumber(
  rows: readonly RowData[],
  field: string,
  getCellValue: GetCellValue,
  sourceIndexes: readonly number[] | Uint32Array | undefined,
): { map: Map<string, DistinctEntry>; scanned: number } {
  const map = new Map<string, DistinctEntry>();
  const len = sourceIndexes ? sourceIndexes.length : rows.length;

  for (let i = 0; i < len; i++) {
    const idx = sourceIndexes ? sourceIndexes[i]! : i;
    const v = toNumber(getCellValue(rows[idx]!, idx, field));
    if (v === null) continue;
    const key = String(v);
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { value: v, label: key, count: 1, sampleRowIndex: idx });
    }
  }

  return { map, scanned: len };
}

function collectDate(
  rows: readonly RowData[],
  field: string,
  getCellValue: GetCellValue,
  sourceIndexes: readonly number[] | Uint32Array | undefined,
): { map: Map<string, DistinctEntry>; scanned: number } {
  const map = new Map<string, DistinctEntry>();
  const len = sourceIndexes ? sourceIndexes.length : rows.length;

  for (let i = 0; i < len; i++) {
    const idx = sourceIndexes ? sourceIndexes[i]! : i;
    const v = toDateString(getCellValue(rows[idx]!, idx, field));
    if (v === null) continue;
    const existing = map.get(v);
    if (existing) {
      existing.count++;
    } else {
      map.set(v, { value: v, label: v, count: 1, sampleRowIndex: idx });
    }
  }

  return { map, scanned: len };
}

function collectBoolean(
  rows: readonly RowData[],
  field: string,
  getCellValue: GetCellValue,
  sourceIndexes: readonly number[] | Uint32Array | undefined,
): { map: Map<string, DistinctEntry>; scanned: number } {
  const map = new Map<string, DistinctEntry>();
  const len = sourceIndexes ? sourceIndexes.length : rows.length;

  for (let i = 0; i < len; i++) {
    const idx = sourceIndexes ? sourceIndexes[i]! : i;
    const v = toBoolean(getCellValue(rows[idx]!, idx, field));
    if (v === null) continue;
    const key = String(v);
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { value: v, label: key, count: 1, sampleRowIndex: idx });
    }
  }

  return { map, scanned: len };
}

export function collectFilterSelectionValues(
  input: CollectFilterSelectionValuesInput,
): FilterSelectionValueResult {
  const {
    rows,
    field,
    config,
    sourceIndexes,
    searchText,
    maxValues,
  } = input;
  const getCellValue = input.getCellValue ?? defaultGetCellValue;

  let collected: { map: Map<string, DistinctEntry>; scanned: number };

  switch (config.type) {
    case "text":
      collected = collectText(rows, field, config, getCellValue, sourceIndexes);
      break;
    case "number":
      collected = collectNumber(rows, field, getCellValue, sourceIndexes);
      break;
    case "date":
      collected = collectDate(rows, field, getCellValue, sourceIndexes);
      break;
    case "boolean":
      collected = collectBoolean(rows, field, getCellValue, sourceIndexes);
      break;
  }

  let entries = Array.from(collected.map.entries());

  if (searchText) {
    const needle = searchText.toLowerCase();
    entries = entries.filter(([, e]) => e.label.toLowerCase().includes(needle));
  }

  const totalDistinct = entries.length;
  const floored = typeof maxValues === "number" && isFinite(maxValues) ? Math.floor(maxValues) : 0;
  const limit = floored > 0 ? floored : undefined;
  const truncated = limit !== undefined && totalDistinct > limit;
  if (truncated) {
    entries = entries.slice(0, limit);
  }

  const values: FilterSelectionValue[] = entries.map(([key, e]) => ({
    key,
    value: e.value,
    label: e.label,
    count: e.count,
    sampleRowIndex: e.sampleRowIndex,
  }));

  return {
    values,
    totalDistinct,
    scannedRowCount: collected.scanned,
    truncated,
  };
}
