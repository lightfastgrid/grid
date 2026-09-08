import type {
  ColumnFilterModel,
  ColumnFilterOperator,
  ColumnFilterType,
  FilterModel,
} from "@lightfastgrid/core";

export type DemoFilterRowKind = "condition" | "selection";

export type DemoFilterRow = {
  field: string;
  label: string;
  type: ColumnFilterType;
  kind: DemoFilterRowKind;
  /** Present for condition rows. */
  operator: ColumnFilterOperator | null;
  /** Scalar display value for condition rows. */
  valueText: string;
  /** Chip values for selection / multi-value rows. */
  chips: string[];
};

export type DemoFilterableColumn = {
  field: string;
  label: string;
  type: ColumnFilterType;
  defaultOperator: ColumnFilterOperator;
  /** Preset values from floatingFilter.select options (Status, Country, …). */
  selectOptions: string[];
};

/** Local incomplete filter — grid rejects empty values, so drafts stay in the panel. */
export type DemoFilterDraft = {
  id: string;
  field: string;
  kind: DemoFilterRowKind;
  operator: ColumnFilterOperator;
  valueText: string;
  chips: string[];
};

export type DemoFilterEditorRow = DemoFilterRow & {
  key: string;
  draftId: string | null;
  selectOptions: string[];
};

function formatChip(value: string | number | boolean): string {
  return String(value);
}

export function readSelectOptions(
  floatingFilter: unknown,
): string[] {
  if (!floatingFilter || typeof floatingFilter !== "object") return [];
  const options = (floatingFilter as { options?: unknown }).options;
  if (!Array.isArray(options)) return [];
  const values: string[] = [];
  for (const option of options) {
    if (typeof option === "string") {
      values.push(option);
      continue;
    }
    if (option && typeof option === "object" && "value" in option) {
      values.push(String((option as { value: unknown }).value));
    }
  }
  return values;
}

/** Pure: turn a live filter model into panel rows. */
export function buildDemoFilterRows(input: {
  filterModel: FilterModel;
  columns: readonly {
    field: string;
    headerName?: string;
    internal?: string;
  }[];
}): DemoFilterRow[] {
  const labelByField = new Map(
    input.columns
      .filter((column) => !column.internal)
      .map((column) => [
        column.field,
        column.headerName?.trim() || column.field,
      ]),
  );

  const rows: DemoFilterRow[] = [];
  for (const [field, model] of Object.entries(input.filterModel)) {
    const selection = model.selection;
    if (selection && selection.values.length > 0) {
      rows.push({
        field,
        label: labelByField.get(field) ?? field,
        type: model.type,
        kind: "selection",
        operator: selection.operator,
        valueText: "",
        chips: selection.values.map(formatChip),
      });
      continue;
    }

    const condition = model.conditions[0];
    const rawValue = condition?.value;
    const chips =
      Array.isArray(rawValue)
        ? rawValue.map(formatChip)
        : [];
    const isMulti =
      condition &&
      (condition.operator === "in" || condition.operator === "notIn") &&
      chips.length > 0;

    rows.push({
      field,
      label: labelByField.get(field) ?? field,
      type: model.type,
      kind: isMulti ? "selection" : "condition",
      operator: condition?.operator ?? null,
      valueText:
        rawValue === null || rawValue === undefined || Array.isArray(rawValue)
          ? ""
          : String(rawValue),
      chips: isMulti ? chips : [],
    });
  }

  return rows;
}

export function createDemoFilterDraft(
  column: DemoFilterableColumn,
  id: string,
): DemoFilterDraft {
  const isSelection = column.selectOptions.length > 0;
  return {
    id,
    field: column.field,
    kind: isSelection ? "selection" : "condition",
    operator: isSelection ? "in" : column.defaultOperator,
    valueText: "",
    chips: [],
  };
}

export function draftFromCommittedRow(
  row: DemoFilterRow,
  id: string,
): DemoFilterDraft {
  return {
    id,
    field: row.field,
    kind: row.kind,
    operator: row.operator ?? (row.kind === "selection" ? "in" : "contains"),
    valueText: row.valueText,
    chips: [...row.chips],
  };
}

export function mergeFilterEditorRows(input: {
  committed: DemoFilterRow[];
  drafts: DemoFilterDraft[];
  columns: DemoFilterableColumn[];
}): DemoFilterEditorRow[] {
  const byField = new Map(
    input.columns.map((column) => [column.field, column]),
  );
  const draftFields = new Set(input.drafts.map((draft) => draft.field));
  const rows: DemoFilterEditorRow[] = [];

  for (const row of input.committed) {
    if (draftFields.has(row.field)) continue;
    const column = byField.get(row.field);
    rows.push({
      ...row,
      key: `committed:${row.field}`,
      draftId: null,
      selectOptions: column?.selectOptions ?? [],
    });
  }

  for (const draft of input.drafts) {
    const column = byField.get(draft.field);
    if (!column) continue;
    rows.push({
      key: `draft:${draft.id}`,
      draftId: draft.id,
      field: draft.field,
      label: column.label,
      type: column.type,
      kind: draft.kind,
      operator: draft.operator,
      valueText: draft.valueText,
      chips: draft.chips,
      selectOptions: column.selectOptions,
    });
  }

  return rows;
}

export function operatorsForFilterType(
  type: ColumnFilterType,
): ColumnFilterOperator[] {
  switch (type) {
    case "number":
      return [
        "equals",
        "notEquals",
        "gt",
        "gte",
        "lt",
        "lte",
        "isNull",
        "isNotNull",
      ];
    case "date":
      return [
        "equals",
        "notEquals",
        "before",
        "after",
        "isNull",
        "isNotNull",
      ];
    case "boolean":
      return ["equals", "notEquals", "isNull", "isNotNull"];
    case "text":
    default:
      return [
        "equals",
        "notEquals",
        "contains",
        "notContains",
        "startsWith",
        "endsWith",
        "isEmpty",
        "isNotEmpty",
      ];
  }
}

export function operatorLabel(operator: ColumnFilterOperator): string {
  switch (operator) {
    case "notEquals":
      return "not equals";
    case "notContains":
      return "not contains";
    case "startsWith":
      return "starts with";
    case "endsWith":
      return "ends with";
    case "isEmpty":
      return "is empty";
    case "isNotEmpty":
      return "is not empty";
    case "isNull":
      return "is null";
    case "isNotNull":
      return "is not null";
    case "gt":
      return ">";
    case "gte":
      return "≥";
    case "lt":
      return "<";
    case "lte":
      return "≤";
    case "notIn":
      return "not in";
    default:
      return operator;
  }
}

export function operatorNeedsValue(operator: ColumnFilterOperator): boolean {
  return (
    operator !== "isEmpty" &&
    operator !== "isNotEmpty" &&
    operator !== "isNull" &&
    operator !== "isNotNull"
  );
}

export function createDefaultFilterModel(
  type: ColumnFilterType,
  defaultOperator: ColumnFilterOperator,
): ColumnFilterModel {
  return {
    type,
    operator: "and",
    conditions: [{ operator: defaultOperator, value: "" }],
  };
}

export function withConditionOperator(
  model: ColumnFilterModel,
  operator: ColumnFilterOperator,
): ColumnFilterModel {
  const first = model.conditions[0];
  if (!operatorNeedsValue(operator)) {
    return {
      ...model,
      selection: undefined,
      conditions: [{ operator }],
    };
  }
  return {
    ...model,
    selection: undefined,
    conditions: [
      {
        operator,
        value: first?.value ?? "",
        valueTo: first?.valueTo,
      },
    ],
  };
}

export function withConditionValue(
  model: ColumnFilterModel,
  value: string,
): ColumnFilterModel {
  const first = model.conditions[0];
  const operator = first?.operator ?? "contains";
  let parsed: string | number | boolean = value;
  if (model.type === "number" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    parsed = Number(value);
  } else if (model.type === "boolean") {
    parsed = value === "true";
  }
  return {
    ...model,
    selection: undefined,
    conditions: [{ operator, value: parsed }],
  };
}

export function withoutChipValue(
  model: ColumnFilterModel,
  chip: string,
): ColumnFilterModel | null {
  if (model.selection) {
    const values = model.selection.values.filter((value) => String(value) !== chip);
    if (values.length === 0) return null;
    return {
      ...model,
      selection: { ...model.selection, values },
    };
  }

  const first = model.conditions[0];
  if (!first || !Array.isArray(first.value)) return model;
  const values = first.value.filter((value) => String(value) !== chip);
  if (values.length === 0) return null;
  return {
    ...model,
    conditions: [{ ...first, value: values }],
  };
}

/** Build a grid-persistable model from editor state, or null if still incomplete. */
export function buildCommitModel(input: {
  type: ColumnFilterType;
  kind: DemoFilterRowKind;
  operator: ColumnFilterOperator;
  valueText: string;
  chips: string[];
}): ColumnFilterModel | null {
  if (input.kind === "selection") {
    if (input.chips.length === 0) return null;
    return {
      type: input.type,
      operator: "and",
      conditions: [],
      selection: { operator: "in", values: [...input.chips] },
    };
  }

  if (!operatorNeedsValue(input.operator)) {
    return {
      type: input.type,
      operator: "and",
      conditions: [{ operator: input.operator }],
    };
  }

  if (input.type === "boolean") {
    if (input.valueText !== "true" && input.valueText !== "false") return null;
    return {
      type: input.type,
      operator: "and",
      conditions: [{ operator: input.operator, value: input.valueText === "true" }],
    };
  }

  if (input.type === "number") {
    if (input.valueText.trim() === "") return null;
    const parsed = Number(input.valueText);
    if (Number.isNaN(parsed)) return null;
    return {
      type: input.type,
      operator: "and",
      conditions: [{ operator: input.operator, value: parsed }],
    };
  }

  if (input.valueText.trim() === "") return null;
  return {
    type: input.type,
    operator: "and",
    conditions: [{ operator: input.operator, value: input.valueText }],
  };
}

export function nextAvailableFilterColumn(
  columns: DemoFilterableColumn[],
  usedFields: ReadonlySet<string>,
): DemoFilterableColumn | null {
  return columns.find((column) => !usedFields.has(column.field)) ?? null;
}
