import type {
  ColumnFilterConfig,
  ColumnFilterInput,
  ColumnFilterOperator,
  ColumnFilterType,
} from "../../types";

import type { NormalizedColumnFilterConfig } from "./types";

const DEFAULT_OPERATORS: Record<ColumnFilterType, ColumnFilterOperator> = {
  text: "contains",
  number: "equals",
  date: "equals",
  boolean: "equals",
};

const VALID_OPERATORS: Record<ColumnFilterType, ReadonlySet<string>> = {
  text: new Set<string>([
    "contains", "notContains", "equals", "notEquals",
    "startsWith", "endsWith", "isEmpty", "isNotEmpty",
  ]),
  number: new Set<string>([
    "equals", "notEquals", "gt", "gte", "lt", "lte",
    "between", "isNull", "isNotNull",
  ]),
  date: new Set<string>([
    "equals", "notEquals", "before", "after",
    "between", "isNull", "isNotNull",
  ]),
  boolean: new Set<string>([
    "equals", "notEquals", "isNull", "isNotNull",
  ]),
};

function isColumnFilterType(v: unknown): v is ColumnFilterType {
  return v === "text" || v === "number" || v === "date" || v === "boolean";
}

function resolveDefaultOperator(
  type: ColumnFilterType,
  requested: ColumnFilterOperator | undefined,
): ColumnFilterOperator {
  if (!requested) return DEFAULT_OPERATORS[type];
  if (VALID_OPERATORS[type].has(requested)) return requested;
  return DEFAULT_OPERATORS[type];
}

function normalizeInput(input: ColumnFilterInput): {
  type: ColumnFilterType;
  config: ColumnFilterConfig | undefined;
} | null {
  if (input === false) return null;
  if (input === true) return { type: "text", config: undefined };
  if (typeof input === "string") {
    if (!isColumnFilterType(input)) return null;
    return { type: input, config: undefined };
  }
  if (typeof input === "object") {
    const type = input.type && isColumnFilterType(input.type) ? input.type : "text";
    return { type, config: input };
  }
  return null;
}

function makeTextDefault(): NormalizedColumnFilterConfig {
  return {
    type: "text",
    defaultOperator: DEFAULT_OPERATORS.text,
    caseSensitive: false,
    trimInput: true,
  };
}

export interface ResolveColumnFilterArgs {
  columnFilterable?: boolean;
  columnFilter?: ColumnFilterInput;
  defaultFilterable?: boolean;
  defaultFilter?: ColumnFilterInput;
}

export function resolveColumnFilterConfig(
  args: ResolveColumnFilterArgs,
): NormalizedColumnFilterConfig | null {
  const { columnFilterable, columnFilter, defaultFilterable, defaultFilter } = args;

  if (columnFilterable === false) return null;

  // Column-level filter config takes priority over defaults.
  if (columnFilter !== undefined) {
    const parsed = normalizeInput(columnFilter);
    if (parsed) {
      return {
        type: parsed.type,
        defaultOperator: resolveDefaultOperator(parsed.type, parsed.config?.defaultOperator),
        caseSensitive: parsed.config?.caseSensitive ?? false,
        trimInput: parsed.config?.trimInput ?? true,
      };
    }
    // columnFilter: false — disabled unless columnFilterable: true
    if (columnFilterable === true) {
      return makeTextDefault();
    }
    return null;
  }

  // Fall through to defaults.
  // columnFilterable === true still enables filtering, but prefer defaultFilter
  // config when available before falling back to text/contains.
  if (defaultFilterable === false && columnFilterable !== true) return null;

  if (defaultFilter !== undefined) {
    const parsed = normalizeInput(defaultFilter);
    if (parsed) {
      return {
        type: parsed.type,
        defaultOperator: resolveDefaultOperator(parsed.type, parsed.config?.defaultOperator),
        caseSensitive: parsed.config?.caseSensitive ?? false,
        trimInput: parsed.config?.trimInput ?? true,
      };
    }
    if (columnFilterable === true || defaultFilterable === true) {
      return makeTextDefault();
    }
    return null;
  }

  if (columnFilterable === true || defaultFilterable === true) {
    return makeTextDefault();
  }

  return null;
}
