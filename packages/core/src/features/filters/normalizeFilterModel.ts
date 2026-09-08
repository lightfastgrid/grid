import type {
  ColumnFilterCondition,
  ColumnFilterModel,
  ColumnFilterSelection,
  FilterModel,
} from "../../types";

import type { NormalizedColumnFilterConfig } from "./types";
import type { RawFilterCondition } from "./validateFilterCondition";
import { validateFilterCondition } from "./validateFilterCondition";

const MAX_CONDITIONS = 2;

export interface RawColumnFilterModel {
  type?: string;
  operator?: string;
  conditions?: RawFilterCondition[];
  selection?: unknown;
}

export interface NormalizeFilterModelContext {
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>;
}

export function normalizeFilterCondition(
  raw: RawFilterCondition,
  config: NormalizedColumnFilterConfig,
): ColumnFilterCondition | null {
  return validateFilterCondition(raw, config);
}

function validateSelection(
  raw: unknown,
  config: NormalizedColumnFilterConfig,
): ColumnFilterSelection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const sel = raw as Record<string, unknown>;

  const op = sel["operator"];
  if (op !== "in" && op !== "notIn") return null;

  const vals = sel["values"];
  if (!Array.isArray(vals) || vals.length === 0) return null;

  const validated: (string | number | boolean)[] = [];
  for (const v of vals) {
    switch (config.type) {
      case "text":
        if (typeof v !== "string") return null;
        validated.push(v);
        break;
      case "number":
        if (typeof v !== "number" || !isFinite(v)) return null;
        validated.push(v);
        break;
      case "date":
        if (typeof v !== "string") return null;
        validated.push(v);
        break;
      case "boolean":
        if (typeof v !== "boolean") return null;
        validated.push(v);
        break;
    }
  }

  if (validated.length === 0) return null;
  return { operator: op, values: validated };
}

export function normalizeColumnFilterModel(
  raw: ColumnFilterModel | RawColumnFilterModel,
  config: NormalizedColumnFilterConfig,
): ColumnFilterModel | null {
  const rawConditions = raw.conditions;

  const valid: ColumnFilterCondition[] = [];
  if (Array.isArray(rawConditions)) {
    for (const rc of rawConditions) {
      if (valid.length >= MAX_CONDITIONS) break;
      const c = validateFilterCondition(rc, config);
      if (c !== null) valid.push(c);
    }
  }

  const selection = validateSelection(raw.selection, config);

  if (valid.length === 0 && selection === null) return null;

  const joinOp = raw.operator === "or" ? "or" as const : "and" as const;

  const result: ColumnFilterModel = {
    type: config.type,
    operator: joinOp,
    conditions: valid,
  };

  if (selection !== null) {
    result.selection = selection;
  }

  return result;
}

export function normalizeFilterModel(
  raw: FilterModel | Record<string, unknown>,
  ctx: NormalizeFilterModelContext,
): FilterModel {
  const result: FilterModel = {};

  for (const field of Object.keys(raw)) {
    const config = ctx.columnsByField.get(field);
    if (!config) continue;

    const rawModel = raw[field];
    if (typeof rawModel !== "object" || rawModel === null) continue;

    const normalized = normalizeColumnFilterModel(
      rawModel as RawColumnFilterModel,
      config,
    );
    if (normalized !== null) {
      result[field] = normalized;
    }
  }

  return result;
}
