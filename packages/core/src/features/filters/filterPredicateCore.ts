import { BOOL_FALSE, BOOL_NULL_SENTINEL, BOOL_TRUE } from "./filterTypedValueCache";
import { dateStringToEpochDay } from "./filterValueAccess";

export type IndexPredicate = (sourceIndex: number) => boolean;

// ── Cache view interfaces ───────────────────────────────────
// Both main-thread FieldCache and worker WorkerFilterFieldCache
// satisfy these shapes via structural typing.

export interface TextCacheView {
  type: "text";
  values: { readonly [i: number]: string | undefined };
  nullFlags: { readonly [i: number]: number | undefined };
  caseSensitive: boolean;
}

export interface NumberCacheView {
  type: "number";
  values: { readonly [i: number]: number | undefined };
  validFlags: { readonly [i: number]: number | undefined };
}

export interface DateCacheView {
  type: "date";
  dayKeys: { readonly [i: number]: number | undefined };
  validFlags: { readonly [i: number]: number | undefined };
}

export interface BooleanCacheView {
  type: "boolean";
  values: { readonly [i: number]: number | undefined };
}

export type CacheView = TextCacheView | NumberCacheView | DateCacheView | BooleanCacheView;

// ── Column model view ───────────────────────────────────────

export interface ConditionView {
  operator: string;
  value?: unknown;
  valueTo?: unknown;
}

export interface SelectionView {
  operator: string;
  values: unknown;
}

export interface ColumnModelView {
  conditions: readonly ConditionView[];
  operator?: string;
  selection?: SelectionView | null;
}

// ── Text condition ──────────────────────────────────────────

function compileTextCondition(
  op: string,
  value: unknown,
  cache: TextCacheView,
): IndexPredicate | null {
  const { values, nullFlags, caseSensitive } = cache;

  if (op === "isEmpty") {
    return (idx) => nullFlags[idx] === 1 || values[idx] === "";
  }
  if (op === "isNotEmpty") {
    return (idx) => nullFlags[idx] === 0 && values[idx] !== "";
  }

  if (op === "in" || op === "notIn") {
    const arr = value as readonly string[];
    const set = new Set(caseSensitive ? arr : arr.map((s) => s.toLowerCase()));
    if (op === "in") {
      return (idx) => nullFlags[idx] === 0 && set.has(values[idx]!);
    }
    return (idx) => nullFlags[idx] === 0 && !set.has(values[idx]!);
  }

  const fv = caseSensitive ? (value as string) : (value as string).toLowerCase();

  switch (op) {
    case "contains":
      return (idx) => nullFlags[idx] === 0 && values[idx]!.includes(fv);
    case "notContains":
      return (idx) => nullFlags[idx] === 0 && !values[idx]!.includes(fv);
    case "equals":
      return (idx) => nullFlags[idx] === 0 && values[idx] === fv;
    case "notEquals":
      return (idx) => nullFlags[idx] === 0 && values[idx] !== fv;
    case "startsWith":
      return (idx) => nullFlags[idx] === 0 && values[idx]!.startsWith(fv);
    case "endsWith":
      return (idx) => nullFlags[idx] === 0 && values[idx]!.endsWith(fv);
    default:
      return null;
  }
}

// ── Number condition ────────────────────────────────────────

function compileNumberCondition(
  op: string,
  value: unknown,
  valueTo: unknown,
  cache: NumberCacheView,
): IndexPredicate | null {
  const { values, validFlags } = cache;

  if (op === "isNull") return (idx) => validFlags[idx] === 0;
  if (op === "isNotNull") return (idx) => validFlags[idx] === 1;

  if (op === "in" || op === "notIn") {
    const set = new Set(value as readonly number[]);
    if (op === "in") {
      return (idx) => validFlags[idx] === 1 && set.has(values[idx]!);
    }
    return (idx) => validFlags[idx] === 1 && !set.has(values[idx]!);
  }

  if (op === "between") {
    const lo = value as number;
    const hi = valueTo as number;
    return (idx) => validFlags[idx] === 1 && values[idx]! >= lo && values[idx]! <= hi;
  }

  const fv = value as number;

  switch (op) {
    case "equals":
      return (idx) => validFlags[idx] === 1 && values[idx] === fv;
    case "notEquals":
      return (idx) => validFlags[idx] === 1 && values[idx] !== fv;
    case "gt":
      return (idx) => validFlags[idx] === 1 && values[idx]! > fv;
    case "gte":
      return (idx) => validFlags[idx] === 1 && values[idx]! >= fv;
    case "lt":
      return (idx) => validFlags[idx] === 1 && values[idx]! < fv;
    case "lte":
      return (idx) => validFlags[idx] === 1 && values[idx]! <= fv;
    default:
      return null;
  }
}

// ── Date condition ──────────────────────────────────────────

function compileDateCondition(
  op: string,
  value: unknown,
  valueTo: unknown,
  cache: DateCacheView,
): IndexPredicate | null {
  const { dayKeys, validFlags } = cache;

  if (op === "isNull") return (idx) => validFlags[idx] === 0;
  if (op === "isNotNull") return (idx) => validFlags[idx] === 1;

  if (op === "in" || op === "notIn") {
    const arr = value as readonly string[];
    const set = new Set(arr.map(dateStringToEpochDay));
    if (op === "in") {
      return (idx) => validFlags[idx] === 1 && set.has(dayKeys[idx]!);
    }
    return (idx) => validFlags[idx] === 1 && !set.has(dayKeys[idx]!);
  }

  if (op === "between") {
    const lo = dateStringToEpochDay(value as string);
    const hi = dateStringToEpochDay(valueTo as string);
    return (idx) => validFlags[idx] === 1 && dayKeys[idx]! >= lo && dayKeys[idx]! <= hi;
  }

  const fv = dateStringToEpochDay(value as string);

  switch (op) {
    case "equals":
      return (idx) => validFlags[idx] === 1 && dayKeys[idx] === fv;
    case "notEquals":
      return (idx) => validFlags[idx] === 1 && dayKeys[idx] !== fv;
    case "before":
      return (idx) => validFlags[idx] === 1 && dayKeys[idx]! < fv;
    case "after":
      return (idx) => validFlags[idx] === 1 && dayKeys[idx]! > fv;
    default:
      return null;
  }
}

// ── Boolean condition ───────────────────────────────────────

function compileBooleanCondition(
  op: string,
  value: unknown,
  cache: BooleanCacheView,
): IndexPredicate | null {
  const { values } = cache;

  if (op === "isNull") return (idx) => values[idx] === BOOL_NULL_SENTINEL;
  if (op === "isNotNull") return (idx) => values[idx] !== BOOL_NULL_SENTINEL;

  if (op === "in" || op === "notIn") {
    const arr = value as readonly boolean[];
    const wantTrue = arr.includes(true);
    const wantFalse = arr.includes(false);
    if (op === "in") {
      return (idx) => {
        const v = values[idx]!;
        if (v === BOOL_NULL_SENTINEL) return false;
        return v === BOOL_TRUE ? wantTrue : wantFalse;
      };
    }
    return (idx) => {
      const v = values[idx]!;
      if (v === BOOL_NULL_SENTINEL) return false;
      return v === BOOL_TRUE ? !wantTrue : !wantFalse;
    };
  }

  const fv = (value as boolean) ? BOOL_TRUE : BOOL_FALSE;

  switch (op) {
    case "equals":
      return (idx) => values[idx] === fv;
    case "notEquals":
      return (idx) => { const v = values[idx]!; return v !== BOOL_NULL_SENTINEL && v !== fv; };
    default:
      return null;
  }
}

// ── Condition dispatch ──────────────────────────────────────

export function compileCachedCondition(
  op: string,
  value: unknown,
  valueTo: unknown,
  cache: CacheView,
): IndexPredicate | null {
  switch (cache.type) {
    case "text":
      return compileTextCondition(op, value, cache);
    case "number":
      return compileNumberCondition(op, value, valueTo, cache);
    case "date":
      return compileDateCondition(op, value, valueTo, cache);
    case "boolean":
      return compileBooleanCondition(op, value, cache);
  }
}

// ── Column predicate composition ────────────────────────────

export function compileCachedColumnPredicate(
  model: ColumnModelView,
  cache: CacheView,
): IndexPredicate | null {
  const condPreds: IndexPredicate[] = [];
  for (const cond of model.conditions) {
    const p = compileCachedCondition(cond.operator, cond.value, cond.valueTo, cache);
    if (p !== null) condPreds.push(p);
  }

  let condPred: IndexPredicate | null = null;
  if (condPreds.length === 1) {
    condPred = condPreds[0]!;
  } else if (condPreds.length > 1) {
    const isOr = (model.operator ?? "and") === "or";
    if (isOr) {
      condPred = (idx) => {
        for (let i = 0; i < condPreds.length; i++) {
          if (condPreds[i]!(idx)) return true;
        }
        return false;
      };
    } else {
      condPred = (idx) => {
        for (let i = 0; i < condPreds.length; i++) {
          if (!condPreds[i]!(idx)) return false;
        }
        return true;
      };
    }
  }

  let selPred: IndexPredicate | null = null;
  if (model.selection) {
    selPred = compileCachedCondition(
      model.selection.operator,
      model.selection.values,
      undefined,
      cache,
    );
  }

  if (condPred && selPred) {
    return (idx) => condPred!(idx) && selPred!(idx);
  }
  return condPred ?? selPred;
}
