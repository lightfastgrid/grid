import type { ColumnFilterOperator, ColumnFilterType } from "../../types";

const VALID_TEXT_OPS: ReadonlySet<string> = new Set([
  "contains", "notContains", "equals", "notEquals",
  "startsWith", "endsWith", "isEmpty", "isNotEmpty",
  "in", "notIn",
]);

const VALID_NUMBER_OPS: ReadonlySet<string> = new Set([
  "equals", "notEquals", "gt", "gte", "lt", "lte",
  "between", "isNull", "isNotNull", "in", "notIn",
]);

const VALID_DATE_OPS: ReadonlySet<string> = new Set([
  "equals", "notEquals", "before", "after",
  "between", "isNull", "isNotNull", "in", "notIn",
]);

const VALID_BOOLEAN_OPS: ReadonlySet<string> = new Set([
  "equals", "notEquals", "isNull", "isNotNull",
  "in", "notIn",
]);

const VALID_OPS_BY_TYPE: Record<ColumnFilterType, ReadonlySet<string>> = {
  text: VALID_TEXT_OPS,
  number: VALID_NUMBER_OPS,
  date: VALID_DATE_OPS,
  boolean: VALID_BOOLEAN_OPS,
};

export function isColumnFilterOperatorForType(
  op: string,
  type: ColumnFilterType,
): op is ColumnFilterOperator {
  return VALID_OPS_BY_TYPE[type].has(op);
}

const COMMON_ALIASES: Record<string, string> = {
  notEqual: "notEquals",
  greaterThan: "gt",
  greaterThanOrEqual: "gte",
  lessThan: "lt",
  lessThanOrEqual: "lte",
  inRange: "between",
};

const TYPE_BLANK_ALIAS: Record<ColumnFilterType, string> = {
  text: "isEmpty",
  number: "isNull",
  date: "isNull",
  boolean: "isNull",
};

const TYPE_NOT_BLANK_ALIAS: Record<ColumnFilterType, string> = {
  text: "isNotEmpty",
  number: "isNotNull",
  date: "isNotNull",
  boolean: "isNotNull",
};

export function normalizeOperator(
  raw: string,
  type: ColumnFilterType,
): ColumnFilterOperator | null {
  if (raw === "empty") return null;

  let canonical = COMMON_ALIASES[raw] ?? raw;
  if (canonical === "blank") canonical = TYPE_BLANK_ALIAS[type];
  else if (canonical === "notBlank") canonical = TYPE_NOT_BLANK_ALIAS[type];

  if (isColumnFilterOperatorForType(canonical, type)) {
    return canonical;
  }
  return null;
}
