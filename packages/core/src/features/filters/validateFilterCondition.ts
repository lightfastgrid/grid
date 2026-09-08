import type {
  ColumnFilterCondition,
  ColumnFilterOperator,
  ColumnFilterType,
} from "../../types";

import { normalizeOperator } from "./filterOperators";
import { isStrictDateString } from "./filterValueAccess";
import type { NormalizedColumnFilterConfig } from "./types";

export interface RawFilterCondition {
  operator?: string;
  value?: unknown;
  valueTo?: unknown;
}

interface ValidatedCondition {
  operator: ColumnFilterOperator;
  value?: string | number | boolean | null | readonly (string | number | boolean)[];
  valueTo?: string | number | null;
}

const NO_VALUE_OPS: ReadonlySet<string> = new Set([
  "isEmpty", "isNotEmpty", "isNull", "isNotNull",
]);

const VALUE_REQUIRED_TEXT_OPS: ReadonlySet<string> = new Set([
  "contains", "notContains", "equals", "notEquals", "startsWith", "endsWith",
]);

function isValidDate(v: unknown): v is string {
  return typeof v === "string" && isStrictDateString(v);
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  return null;
}

function validateText(
  op: ColumnFilterOperator,
  raw: RawFilterCondition,
  config: NormalizedColumnFilterConfig,
): ValidatedCondition | null {
  if (NO_VALUE_OPS.has(op)) {
    return { operator: op };
  }
  if (op === "in" || op === "notIn") {
    if (!Array.isArray(raw.value)) return null;
    const vals: string[] = [];
    for (const item of raw.value) {
      if (typeof item !== "string") return null;
      const v = config.trimInput ? item.trim() : item;
      if (v !== "") vals.push(v);
    }
    if (vals.length === 0) return null;
    return { operator: op, value: vals };
  }
  if (!VALUE_REQUIRED_TEXT_OPS.has(op)) return null;

  if (typeof raw.value !== "string") return null;
  const val = config.trimInput ? raw.value.trim() : raw.value;
  if (val === "") return null;
  return { operator: op, value: val };
}

function validateNumber(
  op: ColumnFilterOperator,
  raw: RawFilterCondition,
): ValidatedCondition | null {
  if (NO_VALUE_OPS.has(op)) {
    return { operator: op };
  }
  if (op === "in" || op === "notIn") {
    if (!Array.isArray(raw.value)) return null;
    const vals: number[] = [];
    for (const item of raw.value) {
      const n = toFiniteNumber(item);
      if (n === null) return null;
      vals.push(n);
    }
    if (vals.length === 0) return null;
    return { operator: op, value: vals };
  }
  if (op === "between") {
    const v = toFiniteNumber(raw.value);
    const vTo = toFiniteNumber(raw.valueTo);
    if (v === null || vTo === null) return null;
    if (v > vTo) return null;
    return { operator: op, value: v, valueTo: vTo };
  }
  const v = toFiniteNumber(raw.value);
  if (v === null) return null;
  return { operator: op, value: v };
}

function validateDate(
  op: ColumnFilterOperator,
  raw: RawFilterCondition,
): ValidatedCondition | null {
  if (NO_VALUE_OPS.has(op)) {
    return { operator: op };
  }
  if (op === "in" || op === "notIn") {
    if (!Array.isArray(raw.value)) return null;
    const vals: string[] = [];
    for (const item of raw.value) {
      if (!isValidDate(item)) return null;
      vals.push(item);
    }
    if (vals.length === 0) return null;
    return { operator: op, value: vals };
  }
  if (op === "between") {
    if (!isValidDate(raw.value) || !isValidDate(raw.valueTo)) return null;
    if (raw.value > raw.valueTo) return null;
    return { operator: op, value: raw.value, valueTo: raw.valueTo };
  }
  if (!isValidDate(raw.value)) return null;
  return { operator: op, value: raw.value };
}

function validateBoolean(
  op: ColumnFilterOperator,
  raw: RawFilterCondition,
): ValidatedCondition | null {
  if (NO_VALUE_OPS.has(op)) {
    return { operator: op };
  }
  if (op === "in" || op === "notIn") {
    if (!Array.isArray(raw.value)) return null;
    const vals: boolean[] = [];
    for (let item of raw.value) {
      if (item === "true") item = true;
      else if (item === "false") item = false;
      if (typeof item !== "boolean") return null;
      vals.push(item);
    }
    if (vals.length === 0) return null;
    return { operator: op, value: vals };
  }
  let val = raw.value;
  if (val === "true") val = true;
  else if (val === "false") val = false;
  if (typeof val !== "boolean") return null;
  return { operator: op, value: val };
}

const VALIDATORS: Record<
  ColumnFilterType,
  (op: ColumnFilterOperator, raw: RawFilterCondition, config: NormalizedColumnFilterConfig) => ValidatedCondition | null
> = {
  text: validateText,
  number: (op, raw) => validateNumber(op, raw),
  date: (op, raw) => validateDate(op, raw),
  boolean: (op, raw) => validateBoolean(op, raw),
};

export function validateFilterCondition(
  raw: RawFilterCondition,
  config: NormalizedColumnFilterConfig,
): ColumnFilterCondition | null {
  if (!raw.operator || typeof raw.operator !== "string") return null;

  const op = normalizeOperator(raw.operator, config.type);
  if (op === null) return null;

  return VALIDATORS[config.type](op, raw, config);
}
