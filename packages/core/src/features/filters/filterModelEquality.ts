import type {
  ColumnFilterCondition,
  ColumnFilterModel,
  ColumnFilterSelection,
  FilterModel,
} from "../../types";

function valuesEqual(
  a: ColumnFilterCondition["value"],
  b: ColumnFilterCondition["value"],
): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return false;
}

function conditionsEqual(
  a: ColumnFilterCondition,
  b: ColumnFilterCondition,
): boolean {
  return a.operator === b.operator
    && valuesEqual(a.value, b.value)
    && a.valueTo === b.valueTo;
}

function selectionsEqual(
  a: ColumnFilterSelection | undefined,
  b: ColumnFilterSelection | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.operator !== b.operator) return false;
  if (a.values.length !== b.values.length) return false;
  for (let i = 0; i < a.values.length; i++) {
    if (a.values[i] !== b.values[i]) return false;
  }
  return true;
}

function columnModelsEqual(
  a: ColumnFilterModel,
  b: ColumnFilterModel,
): boolean {
  if (a.type !== b.type) return false;
  if ((a.operator ?? "and") !== (b.operator ?? "and")) return false;
  if (a.conditions.length !== b.conditions.length) return false;
  for (let i = 0; i < a.conditions.length; i++) {
    if (!conditionsEqual(a.conditions[i]!, b.conditions[i]!)) return false;
  }
  if (!selectionsEqual(a.selection, b.selection)) return false;
  return true;
}

export function filterModelsEqual(a: FilterModel, b: FilterModel): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const modelB = b[key];
    if (!modelB) return false;
    if (!columnModelsEqual(a[key]!, modelB)) return false;
  }
  return true;
}

function cloneValue(v: ColumnFilterCondition["value"]): ColumnFilterCondition["value"] {
  if (Array.isArray(v)) return v.slice();
  return v;
}

function cloneCondition(c: ColumnFilterCondition): ColumnFilterCondition {
  const out: ColumnFilterCondition = { operator: c.operator };
  if (c.value !== undefined) out.value = cloneValue(c.value);
  if (c.valueTo !== undefined) out.valueTo = c.valueTo;
  return out;
}

function cloneColumnModel(m: ColumnFilterModel): ColumnFilterModel {
  const out: ColumnFilterModel = {
    type: m.type,
    operator: m.operator,
    conditions: m.conditions.map(cloneCondition),
  };
  if (m.selection) {
    out.selection = {
      operator: m.selection.operator,
      values: m.selection.values.slice(),
    };
  }
  return out;
}

export function cloneFilterModel(model: FilterModel): FilterModel {
  const out: FilterModel = {};
  for (const key of Object.keys(model)) {
    out[key] = cloneColumnModel(model[key]!);
  }
  return out;
}

export function cloneColumnFilterModel(
  model: ColumnFilterModel,
): ColumnFilterModel {
  return cloneColumnModel(model);
}
