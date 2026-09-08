import type {
  ColumnFilterCondition,
  ColumnFilterModel,
  ColumnFilterOperator,
  ColumnFilterSelection,
  FilterModel,
  RowData,
} from "../../types";

import type { IndexPredicate } from "./filterPredicateCore";
import { compileCachedColumnPredicate as compileCoreColumnPredicate } from "./filterPredicateCore";
import type { FilterTypedValueCache } from "./filterTypedValueCache";
import type { GetCellValue } from "./filterValueAccess";
import { toBoolean, toDateString, toNumber } from "./filterValueAccess";
import type { NormalizedColumnFilterConfig } from "./types";

export type { IndexPredicate } from "./filterPredicateCore";
export type RowPredicate = (row: RowData, sourceIndex: number) => boolean;

// ── text predicates ──────────────────────────────────────────

function compileTextCondition(
  cond: ColumnFilterCondition,
  config: NormalizedColumnFilterConfig,
  getCellValue: GetCellValue,
  field: string,
): RowPredicate | null {
  const op = cond.operator;
  const ci = !config.caseSensitive;

  if (op === "isEmpty") {
    return (row, idx) => {
      const v = getCellValue(row, idx, field);
      return v === null || v === undefined || String(v) === "";
    };
  }
  if (op === "isNotEmpty") {
    return (row, idx) => {
      const v = getCellValue(row, idx, field);
      return v !== null && v !== undefined && String(v) !== "";
    };
  }

  if (op === "in" || op === "notIn") {
    const arr = cond.value as readonly string[];
    const set = new Set(ci ? arr.map((s) => s.toLowerCase()) : arr);
    const getText = ci
      ? (row: RowData, idx: number): string | null => {
          const v = getCellValue(row, idx, field);
          if (v === null || v === undefined) return null;
          return String(v).toLowerCase();
        }
      : (row: RowData, idx: number): string | null => {
          const v = getCellValue(row, idx, field);
          if (v === null || v === undefined) return null;
          return String(v);
        };
    if (op === "in") {
      return (row, idx) => { const s = getText(row, idx); return s !== null && set.has(s); };
    }
    return (row, idx) => { const s = getText(row, idx); return s !== null && !set.has(s); };
  }

  const filterVal = cond.value as string;
  const fv = ci ? filterVal.toLowerCase() : filterVal;

  const getText = ci
    ? (row: RowData, idx: number): string | null => {
        const v = getCellValue(row, idx, field);
        if (v === null || v === undefined) return null;
        return String(v).toLowerCase();
      }
    : (row: RowData, idx: number): string | null => {
        const v = getCellValue(row, idx, field);
        if (v === null || v === undefined) return null;
        return String(v);
      };

  switch (op as ColumnFilterOperator) {
    case "contains":
      return (row, idx) => { const s = getText(row, idx); return s !== null && s.includes(fv); };
    case "notContains":
      return (row, idx) => { const s = getText(row, idx); return s !== null && !s.includes(fv); };
    case "equals":
      return (row, idx) => { const s = getText(row, idx); return s !== null && s === fv; };
    case "notEquals":
      return (row, idx) => { const s = getText(row, idx); return s !== null && s !== fv; };
    case "startsWith":
      return (row, idx) => { const s = getText(row, idx); return s !== null && s.startsWith(fv); };
    case "endsWith":
      return (row, idx) => { const s = getText(row, idx); return s !== null && s.endsWith(fv); };
    default:
      return null;
  }
}

// ── number predicates ────────────────────────────────────────

function compileNumberCondition(
  cond: ColumnFilterCondition,
  getCellValue: GetCellValue,
  field: string,
): RowPredicate | null {
  const op = cond.operator;

  if (op === "isNull") {
    return (row, idx) => toNumber(getCellValue(row, idx, field)) === null;
  }
  if (op === "isNotNull") {
    return (row, idx) => toNumber(getCellValue(row, idx, field)) !== null;
  }

  if (op === "in" || op === "notIn") {
    const set = new Set(cond.value as readonly number[]);
    if (op === "in") {
      return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && set.has(v); };
    }
    return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && !set.has(v); };
  }

  if (op === "between") {
    const lo = cond.value as number;
    const hi = cond.valueTo as number;
    return (row, idx) => {
      const v = toNumber(getCellValue(row, idx, field));
      return v !== null && v >= lo && v <= hi;
    };
  }

  const fv = cond.value as number;

  switch (op as ColumnFilterOperator) {
    case "equals":
      return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && v === fv; };
    case "notEquals":
      return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && v !== fv; };
    case "gt":
      return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && v > fv; };
    case "gte":
      return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && v >= fv; };
    case "lt":
      return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && v < fv; };
    case "lte":
      return (row, idx) => { const v = toNumber(getCellValue(row, idx, field)); return v !== null && v <= fv; };
    default:
      return null;
  }
}

// ── date predicates ──────────────────────────────────────────

function compileDateCondition(
  cond: ColumnFilterCondition,
  getCellValue: GetCellValue,
  field: string,
): RowPredicate | null {
  const op = cond.operator;

  if (op === "isNull") {
    return (row, idx) => toDateString(getCellValue(row, idx, field)) === null;
  }
  if (op === "isNotNull") {
    return (row, idx) => toDateString(getCellValue(row, idx, field)) !== null;
  }

  if (op === "in" || op === "notIn") {
    const set = new Set(cond.value as readonly string[]);
    if (op === "in") {
      return (row, idx) => { const v = toDateString(getCellValue(row, idx, field)); return v !== null && set.has(v); };
    }
    return (row, idx) => { const v = toDateString(getCellValue(row, idx, field)); return v !== null && !set.has(v); };
  }

  if (op === "between") {
    const lo = cond.value as string;
    const hi = cond.valueTo as string;
    return (row, idx) => {
      const v = toDateString(getCellValue(row, idx, field));
      return v !== null && v >= lo && v <= hi;
    };
  }

  const fv = cond.value as string;

  switch (op as ColumnFilterOperator) {
    case "equals":
      return (row, idx) => { const v = toDateString(getCellValue(row, idx, field)); return v !== null && v === fv; };
    case "notEquals":
      return (row, idx) => { const v = toDateString(getCellValue(row, idx, field)); return v !== null && v !== fv; };
    case "before":
      return (row, idx) => { const v = toDateString(getCellValue(row, idx, field)); return v !== null && v < fv; };
    case "after":
      return (row, idx) => { const v = toDateString(getCellValue(row, idx, field)); return v !== null && v > fv; };
    default:
      return null;
  }
}

// ── boolean predicates ───────────────────────────────────────

function compileBooleanCondition(
  cond: ColumnFilterCondition,
  getCellValue: GetCellValue,
  field: string,
): RowPredicate | null {
  const op = cond.operator;

  if (op === "isNull") {
    return (row, idx) => toBoolean(getCellValue(row, idx, field)) === null;
  }
  if (op === "isNotNull") {
    return (row, idx) => toBoolean(getCellValue(row, idx, field)) !== null;
  }

  if (op === "in" || op === "notIn") {
    const arr = cond.value as readonly boolean[];
    const wantTrue = arr.includes(true);
    const wantFalse = arr.includes(false);
    if (op === "in") {
      return (row, idx) => {
        const v = toBoolean(getCellValue(row, idx, field));
        if (v === null) return false;
        return v ? wantTrue : wantFalse;
      };
    }
    return (row, idx) => {
      const v = toBoolean(getCellValue(row, idx, field));
      if (v === null) return false;
      return v ? !wantTrue : !wantFalse;
    };
  }

  const fv = cond.value as boolean;

  switch (op as ColumnFilterOperator) {
    case "equals":
      return (row, idx) => toBoolean(getCellValue(row, idx, field)) === fv;
    case "notEquals":
      return (row, idx) => { const v = toBoolean(getCellValue(row, idx, field)); return v !== null && v !== fv; };
    default:
      return null;
  }
}

// ── column predicate ─────────────────────────────────────────

function compileCondition(
  cond: ColumnFilterCondition,
  config: NormalizedColumnFilterConfig,
  getCellValue: GetCellValue,
  field: string,
): RowPredicate | null {
  switch (config.type) {
    case "text":
      return compileTextCondition(cond, config, getCellValue, field);
    case "number":
      return compileNumberCondition(cond, getCellValue, field);
    case "date":
      return compileDateCondition(cond, getCellValue, field);
    case "boolean":
      return compileBooleanCondition(cond, getCellValue, field);
  }
}

function compileSelectionPredicate(
  selection: ColumnFilterSelection,
  config: NormalizedColumnFilterConfig,
  getCellValue: GetCellValue,
  field: string,
): RowPredicate | null {
  const cond: ColumnFilterCondition = {
    operator: selection.operator,
    value: selection.values,
  };
  return compileCondition(cond, config, getCellValue, field);
}

function compileColumnPredicate(
  model: ColumnFilterModel,
  config: NormalizedColumnFilterConfig,
  getCellValue: GetCellValue,
  field: string,
): RowPredicate | null {
  const condPreds: RowPredicate[] = [];
  for (const cond of model.conditions) {
    const p = compileCondition(cond, config, getCellValue, field);
    if (p !== null) condPreds.push(p);
  }

  let condPred: RowPredicate | null = null;
  if (condPreds.length === 1) {
    condPred = condPreds[0]!;
  } else if (condPreds.length > 1) {
    const isOr = (model.operator ?? "and") === "or";
    if (isOr) {
      condPred = (row, idx) => {
        for (let i = 0; i < condPreds.length; i++) {
          if (condPreds[i]!(row, idx)) return true;
        }
        return false;
      };
    } else {
      condPred = (row, idx) => {
        for (let i = 0; i < condPreds.length; i++) {
          if (!condPreds[i]!(row, idx)) return false;
        }
        return true;
      };
    }
  }

  const selPred = model.selection
    ? compileSelectionPredicate(model.selection, config, getCellValue, field)
    : null;

  if (condPred && selPred) {
    return (row, idx) => condPred!(row, idx) && selPred(row, idx);
  }
  return condPred ?? selPred;
}

// ── full model compilation ───────────────────────────────────

export interface CompileFilterModelInput {
  filterModel: FilterModel;
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>;
  getCellValue: GetCellValue;
}

export function compileFilterModel(
  input: CompileFilterModelInput,
): RowPredicate | null {
  const { filterModel, columnsByField, getCellValue } = input;
  const columnPreds: RowPredicate[] = [];

  for (const field of Object.keys(filterModel)) {
    const config = columnsByField.get(field);
    if (!config) continue;
    const model = filterModel[field]!;
    const pred = compileColumnPredicate(model, config, getCellValue, field);
    if (pred !== null) columnPreds.push(pred);
  }

  if (columnPreds.length === 0) return null;
  if (columnPreds.length === 1) return columnPreds[0]!;

  return (row, idx) => {
    for (let i = 0; i < columnPreds.length; i++) {
      if (!columnPreds[i]!(row, idx)) return false;
    }
    return true;
  };
}

// ── cached predicate compilation ─────────────────────────────

export interface CompileFilterModelCachedInput {
  filterModel: FilterModel;
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>;
  cache: FilterTypedValueCache;
}

export function compileFilterModelCached(
  input: CompileFilterModelCachedInput,
): IndexPredicate | null {
  const { filterModel, columnsByField, cache } = input;
  const columnPreds: IndexPredicate[] = [];

  for (const field of Object.keys(filterModel)) {
    const config = columnsByField.get(field);
    if (!config) continue;
    const fieldCache = cache.fields.get(field);
    if (!fieldCache) continue;
    const model = filterModel[field]!;
    const pred = compileCoreColumnPredicate(model, fieldCache);
    if (pred !== null) columnPreds.push(pred);
  }

  if (columnPreds.length === 0) return null;
  if (columnPreds.length === 1) return columnPreds[0]!;

  return (idx) => {
    for (let i = 0; i < columnPreds.length; i++) {
      if (!columnPreds[i]!(idx)) return false;
    }
    return true;
  };
}
