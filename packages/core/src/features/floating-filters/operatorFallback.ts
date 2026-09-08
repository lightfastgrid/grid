import type { ColumnFilterOperator } from "../../types";

const INCOMPATIBLE_OPERATORS: ReadonlySet<string> = new Set([
  "between", "in", "notIn", "isNull", "isNotNull",
]);

const TYPE_FALLBACK_OPERATOR: Readonly<Record<string, ColumnFilterOperator>> = {
  text: "contains",
  number: "equals",
  date: "equals",
  boolean: "equals",
};

export function resolveFloatingFilterOperator(
  type: string,
  defaultOp: ColumnFilterOperator,
): ColumnFilterOperator {
  if (INCOMPATIBLE_OPERATORS.has(defaultOp)) {
    return TYPE_FALLBACK_OPERATOR[type] ?? "equals";
  }
  return defaultOp;
}
