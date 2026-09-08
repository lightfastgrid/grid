import type { ColumnFilterModel } from "../../types";

import type { ResolvedFloatingFilterControl } from "./types";

export function readSimpleModelValue(model: ColumnFilterModel | null): string {
  if (!model) return "";
  if (model.conditions.length > 1) return "";
  const cond = model.conditions[0];
  if (!cond) return "";
  const v = cond.value;
  if (v === undefined || v === null) return "";
  return String(v);
}

export interface RangeValues {
  min: string;
  max: string;
}

const MIN_OPERATORS = new Set(["gte", "gt", "after"]);
const MAX_OPERATORS = new Set(["lte", "lt", "before"]);

export function readRangeModelValues(model: ColumnFilterModel | null): RangeValues {
  if (!model) return { min: "", max: "" };
  if (model.conditions.length !== 1) return { min: "", max: "" };
  const cond = model.conditions[0];
  if (!cond) return { min: "", max: "" };

  if (cond.operator === "between") {
    return {
      min: cond.value !== null && cond.value !== undefined ? String(cond.value) : "",
      max: cond.valueTo !== null && cond.valueTo !== undefined ? String(cond.valueTo) : "",
    };
  }

  if (MIN_OPERATORS.has(cond.operator)) {
    return { min: cond.value !== null && cond.value !== undefined ? String(cond.value) : "", max: "" };
  }

  if (MAX_OPERATORS.has(cond.operator)) {
    return { min: "", max: cond.value !== null && cond.value !== undefined ? String(cond.value) : "" };
  }

  return { min: "", max: "" };
}

const TEXT_REPRESENTABLE_OPS: ReadonlySet<string> = new Set([
  "contains", "notContains", "equals", "notEquals", "startsWith", "endsWith",
]);

const SELECT_REPRESENTABLE_OPS: ReadonlySet<string> = new Set([
  "equals",
]);

const RANGE_REPRESENTABLE_OPS: ReadonlySet<string> = new Set([
  "gte", "gt", "lte", "lt", "between", "after", "before",
]);

export function canControlRepresent(
  model: ColumnFilterModel | null,
  control: ResolvedFloatingFilterControl,
): boolean {
  if (!model) return true;
  if (model.selection !== undefined) return false;
  if (model.conditions.length !== 1) return false;
  const cond = model.conditions[0];
  if (!cond) return true;

  switch (control) {
    case "text":
      return TEXT_REPRESENTABLE_OPS.has(cond.operator);
    case "select":
    case "booleanSelect":
      return SELECT_REPRESENTABLE_OPS.has(cond.operator);
    case "numberRange":
    case "dateRange":
      return RANGE_REPRESENTABLE_OPS.has(cond.operator);
    case "dateButton":
      // Opens the dedicated filter panel — any model is fine.
      return true;
  }
}
