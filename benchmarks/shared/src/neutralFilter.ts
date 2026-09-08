import type {
  BenchmarkRow,
  NeutralFilterCondition,
  NeutralFilterModel,
} from "./benchmarkProtocol.ts";

export type {
  NeutralFilterCondition,
  NeutralFilterModel,
  NeutralNumberFilterCondition,
  NeutralTextFilterCondition,
} from "./benchmarkProtocol.ts";

export const EMPTY_NEUTRAL_FILTER_MODEL: NeutralFilterModel = {
  logic: "and",
  conditions: [],
};

export function textContainsFilter(field: string, value: string): NeutralFilterModel {
  return {
    logic: "and",
    conditions: [{ field, kind: "text", operator: "contains", value }],
  };
}

export function numberBetweenFilter(
  field: string,
  minimum: number,
  maximum: number,
): NeutralFilterModel {
  return {
    logic: "and",
    conditions: [
      {
        field,
        kind: "number",
        operator: "between",
        minimum,
        maximum,
        inclusive: true,
      },
    ],
  };
}

export function andFilter(
  ...models: readonly NeutralFilterModel[]
): NeutralFilterModel {
  return {
    logic: "and",
    conditions: models.flatMap((model) => model.conditions),
  };
}

export function filterFieldsOf(model: NeutralFilterModel): readonly string[] {
  return [...new Set(model.conditions.map((condition) => condition.field))];
}

export function isEmptyNeutralFilter(model: NeutralFilterModel | null | undefined): boolean {
  return !model || model.conditions.length === 0;
}

export function rowMatchesNeutralCondition(
  row: BenchmarkRow,
  condition: NeutralFilterCondition,
): boolean {
  const raw = row[condition.field];
  if (condition.kind === "text") {
    return String(raw ?? "")
      .toLowerCase()
      .includes(condition.value.toLowerCase());
  }
  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric)) return false;
  return numeric >= condition.minimum && numeric <= condition.maximum;
}

export function rowMatchesNeutralFilter(
  row: BenchmarkRow,
  model: NeutralFilterModel,
): boolean {
  if (model.logic !== "and") return false;
  return model.conditions.every((condition) => rowMatchesNeutralCondition(row, condition));
}

export function countRowsMatchingNeutralFilter(
  rows: readonly BenchmarkRow[],
  model: NeutralFilterModel,
): number {
  let count = 0;
  for (const row of rows) {
    if (rowMatchesNeutralFilter(row, model)) count += 1;
  }
  return count;
}

export function neutralFilterEquals(
  actual: NeutralFilterModel | null | undefined,
  expected: NeutralFilterModel,
): boolean {
  const current = actual ?? EMPTY_NEUTRAL_FILTER_MODEL;
  if (current.logic !== expected.logic) return false;
  if (current.conditions.length !== expected.conditions.length) return false;
  return expected.conditions.every((want, index) => {
    const got = current.conditions[index];
    if (!got || got.field !== want.field || got.kind !== want.kind || got.operator !== want.operator) {
      return false;
    }
    if (want.kind === "text") {
      return got.kind === "text" && got.value === want.value;
    }
    return (
      got.kind === "number" &&
      got.minimum === want.minimum &&
      got.maximum === want.maximum &&
      got.inclusive === true
    );
  });
}

export function formatNeutralFilter(model: NeutralFilterModel): string {
  return JSON.stringify(model);
}

type LfgColumnFilterModel = {
  readonly type?: string;
  readonly conditions?: ReadonlyArray<{
    readonly operator?: string;
    readonly value?: unknown;
    readonly valueTo?: unknown;
  }>;
};

export function toLightFastGridFilterModel(
  model: NeutralFilterModel,
): Record<string, LfgColumnFilterModel> {
  const next: Record<string, LfgColumnFilterModel> = {};
  for (const condition of model.conditions) {
    if (condition.kind === "text") {
      next[condition.field] = {
        type: "text",
        conditions: [{ operator: "contains", value: condition.value }],
      };
      continue;
    }
    next[condition.field] = {
      type: "number",
      conditions: [
        {
          operator: "between",
          value: condition.minimum,
          valueTo: condition.maximum,
        },
      ],
    };
  }
  return next;
}

export function fromLightFastGridFilterModel(
  model: Record<string, unknown> | null | undefined,
): NeutralFilterModel {
  if (!model) return EMPTY_NEUTRAL_FILTER_MODEL;
  const conditions: NeutralFilterCondition[] = [];
  for (const [field, raw] of Object.entries(model)) {
    const column = raw as LfgColumnFilterModel | undefined;
    const first = column?.conditions?.[0];
    if (!first) continue;
    if (column.type === "number" || first.operator === "between") {
      const minimum = Number(first.value);
      const maximum = Number(first.valueTo);
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) continue;
      conditions.push({
        field,
        kind: "number",
        operator: "between",
        minimum,
        maximum,
        inclusive: true,
      });
      continue;
    }
    conditions.push({
      field,
      kind: "text",
      operator: "contains",
      value: String(first.value ?? ""),
    });
  }
  return { logic: "and", conditions };
}

type AgGridColumnFilter =
  | {
      readonly filterType?: string;
      readonly type?: string;
      readonly filter?: unknown;
      readonly filterTo?: unknown;
      readonly operator?: string;
      readonly conditions?: ReadonlyArray<{
        readonly filterType?: string;
        readonly type?: string;
        readonly filter?: unknown;
        readonly filterTo?: unknown;
      }>;
    }
  | null;

function agGridInclusiveNumberFilter(
  minimum: number,
  maximum: number,
): Exclude<AgGridColumnFilter, null> {
  return {
    filterType: "number",
    operator: "AND",
    conditions: [
      { filterType: "number", type: "greaterThanOrEqual", filter: minimum },
      { filterType: "number", type: "lessThanOrEqual", filter: maximum },
    ],
  };
}

function numberBetweenFromAgGridColumn(
  field: string,
  column: Exclude<AgGridColumnFilter, null>,
): NeutralFilterCondition | null {
  const nested = column.conditions;
  if (nested && nested.length >= 2) {
    const lower = nested.find((entry) => entry.type === "greaterThanOrEqual" || entry.type === "greaterThan");
    const upper = nested.find((entry) => entry.type === "lessThanOrEqual" || entry.type === "lessThan");
    const minimum = Number(lower?.filter);
    const maximum = Number(upper?.filter);
    if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
      return {
        field,
        kind: "number",
        operator: "between",
        minimum,
        maximum,
        inclusive: true,
      };
    }
  }
  if (column.type === "inRange" || (column.filterType === "number" && column.filterTo != null)) {
    const minimum = Number(column.filter);
    const maximum = Number(column.filterTo);
    if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
      return {
        field,
        kind: "number",
        operator: "between",
        minimum,
        maximum,
        inclusive: true,
      };
    }
  }
  return null;
}

export function toAgGridFilterModel(
  model: NeutralFilterModel,
): Record<string, Exclude<AgGridColumnFilter, null>> {
  const next: Record<string, Exclude<AgGridColumnFilter, null>> = {};
  for (const condition of model.conditions) {
    if (condition.kind === "text") {
      next[condition.field] = {
        filterType: "text",
        type: "contains",
        filter: condition.value,
      };
      continue;
    }
    next[condition.field] = agGridInclusiveNumberFilter(condition.minimum, condition.maximum);
  }
  return next;
}

export function fromAgGridFilterModel(
  model: Record<string, unknown> | null | undefined,
): NeutralFilterModel {
  if (!model) return EMPTY_NEUTRAL_FILTER_MODEL;
  const conditions: NeutralFilterCondition[] = [];
  for (const [field, raw] of Object.entries(model)) {
    const column = raw as AgGridColumnFilter;
    if (!column) continue;
    const numberCondition = numberBetweenFromAgGridColumn(field, column);
    if (numberCondition) {
      conditions.push(numberCondition);
      continue;
    }
    conditions.push({
      field,
      kind: "text",
      operator: "contains",
      value: String(column.filter ?? ""),
    });
  }
  return { logic: "and", conditions };
}
