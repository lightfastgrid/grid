import type {
  ColumnFilterCondition,
  ColumnFilterModel,
  ColumnFilterOperator,
  ColumnFilterSelection,
  ColumnFilterType,
  FilterChangeSource,
  FilterJoinOperator,
} from "../../types";

import {
  filterConditionEndingValueName,
  filterConditionOperatorName,
  filterConditionValueName,
  filterJoinName,
  filterSelectionSearchName,
  filterSelectionValueName,
  resolveFilterColumnLabel,
} from "./filterControlAccessibleName";
import type { FilterSelectionValueResult } from "./filterSelectionValues";
import type { NormalizedColumnFilterConfig } from "./types";

const NO_VALUE_OPS: ReadonlySet<string> = new Set([
  "isEmpty", "isNotEmpty", "isNull", "isNotNull",
]);

interface OperatorEntry {
  value: ColumnFilterOperator;
  label: string;
}

const TEXT_OPERATORS: OperatorEntry[] = [
  { value: "contains", label: "Contains" },
  { value: "notContains", label: "Not contains" },
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Not equals" },
  { value: "startsWith", label: "Starts with" },
  { value: "endsWith", label: "Ends with" },
  { value: "isEmpty", label: "Is empty" },
  { value: "isNotEmpty", label: "Is not empty" },
];

const NUMBER_OPERATORS: OperatorEntry[] = [
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Not equals" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "Greater than or equal" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "Less than or equal" },
  { value: "between", label: "Between" },
  { value: "isNull", label: "Is null" },
  { value: "isNotNull", label: "Is not null" },
];

const DATE_OPERATORS: OperatorEntry[] = [
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Not equals" },
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "between", label: "Between" },
  { value: "isNull", label: "Is null" },
  { value: "isNotNull", label: "Is not null" },
];

const BOOLEAN_OPERATORS: OperatorEntry[] = [
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Not equals" },
  { value: "isNull", label: "Is null" },
  { value: "isNotNull", label: "Is not null" },
];

const OPERATORS_BY_TYPE: Record<ColumnFilterType, OperatorEntry[]> = {
  text: TEXT_OPERATORS,
  number: NUMBER_OPERATORS,
  date: DATE_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
};

export interface GetSelectionValuesArgs {
  field: string;
  searchText?: string;
  maxValues?: number;
}

export interface FilterSelectionValuePreviewContext {
  field: string;
  value: string | number | boolean;
  label: string;
  sampleRowIndex: number;
}

export interface FilterMenuFormOptions {
  field: string;
  headerName?: string;
  config: NormalizedColumnFilterConfig;
  currentModel: ColumnFilterModel | null;
  setColumnFilterModel: (field: string, model: ColumnFilterModel | null, source?: FilterChangeSource) => void;
  clearColumnFilter: (field: string, source?: FilterChangeSource) => void;
  close: () => void;
  formatBooleanLabel?: (value: boolean) => string;
  getSelectionValues?: (args: GetSelectionValuesArgs) => FilterSelectionValueResult;
  renderSelectionValuePreview?: (ctx: FilterSelectionValuePreviewContext) => HTMLElement | null;
  showConditions?: boolean;
  showSelectionList?: boolean;
}

export interface FilterMenuFormResult {
  element: HTMLElement;
  cleanup: () => void;
}

// ── Condition row helper ───────────────────────────────────

interface ConditionRowControls {
  container: HTMLElement;
  operatorSelect: HTMLSelectElement;
  valueControl: HTMLInputElement | HTMLSelectElement;
  valueToInput: HTMLInputElement;
  syncVisibility: () => void;
  cleanup: () => void;
}

let nextFilterFormInstanceId = 1;

function allocateFilterFormInstanceId(): number {
  if (!Number.isSafeInteger(nextFilterFormInstanceId)) {
    throw new Error("Filter form id space exhausted");
  }
  const id = nextFilterFormInstanceId;
  nextFilterFormInstanceId =
    id === Number.MAX_SAFE_INTEGER ? Number.POSITIVE_INFINITY : id + 1;
  return id;
}

function appendFilterField(
  parent: HTMLElement,
  control: HTMLElement,
  labelText: string | null,
): void {
  const field = document.createElement("div");
  field.className = "lfg-filter-field";
  if (labelText !== null) {
    const label = document.createElement("div");
    label.className = "lfg-filter-field-label";
    label.textContent = labelText;
    field.appendChild(label);
  }
  field.appendChild(control);
  parent.appendChild(field);
}

function createConditionRow(
  config: NormalizedColumnFilterConfig,
  initialCondition: ColumnFilterCondition | undefined,
  columnLabel: string,
  conditionNumber: 1 | 2,
  formatBooleanLabel?: (value: boolean) => string,
): ConditionRowControls {
  const operators = OPERATORS_BY_TYPE[config.type];
  const isBoolean = config.type === "boolean";
  const inputType = config.type === "number" ? "number" : config.type === "date" ? "date" : "text";

  const container = document.createElement("div");
  container.className = "lfg-filter-condition-row";
  container.dataset.condition = String(conditionNumber);

  const initialOp = initialCondition?.operator ?? config.defaultOperator;
  const initialValue = initialCondition?.value ?? "";
  const initialValueTo = initialCondition?.valueTo ?? "";
  // Design: second condition starts as "Select an option" with no value field
  // until the user picks an operator (or an existing model restores one).
  const useOperatorPlaceholder = conditionNumber === 2 && !initialCondition;

  const operatorSelect = document.createElement("select");
  operatorSelect.className = "lfg-filter-form-operator";
  operatorSelect.setAttribute(
    "aria-label",
    filterConditionOperatorName(columnLabel, conditionNumber),
  );
  if (useOperatorPlaceholder) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an option";
    placeholder.selected = true;
    operatorSelect.appendChild(placeholder);
  }
  for (const op of operators) {
    const option = document.createElement("option");
    option.value = op.value;
    option.textContent = op.label;
    if (!useOperatorPlaceholder && op.value === initialOp) option.selected = true;
    operatorSelect.appendChild(option);
  }
  appendFilterField(
    container,
    operatorSelect,
    conditionNumber === 2 ? "Filter by" : null,
  );

  let valueControl: HTMLInputElement | HTMLSelectElement;

  if (isBoolean) {
    const boolSelect = document.createElement("select");
    boolSelect.className = "lfg-filter-form-value";
    boolSelect.setAttribute(
      "aria-label",
      filterConditionValueName(columnLabel, conditionNumber),
    );
    for (const [val, fallback] of [["true", "True"], ["false", "False"]] as const) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = formatBooleanLabel ? formatBooleanLabel(val === "true") : fallback;
      if (String(initialValue) === val) opt.selected = true;
      boolSelect.appendChild(opt);
    }
    valueControl = boolSelect;
  } else {
    const input = document.createElement("input");
    input.className = "lfg-filter-form-value";
    input.type = inputType;
    input.setAttribute(
      "aria-label",
      filterConditionValueName(columnLabel, conditionNumber),
    );
    input.placeholder = config.type === "date" ? "YYYY-MM-DD" : "Enter text…";
    input.value = !Array.isArray(initialValue) ? String(initialValue) : "";
    valueControl = input;
  }
  appendFilterField(container, valueControl, "Filter value");

  const valueToInput = document.createElement("input");
  valueToInput.className = "lfg-filter-form-value-to";
  valueToInput.type = inputType;
  valueToInput.setAttribute(
    "aria-label",
    filterConditionEndingValueName(columnLabel, conditionNumber),
  );
  valueToInput.placeholder = config.type === "date" ? "YYYY-MM-DD" : "To value…";
  valueToInput.value = String(initialValueTo);
  appendFilterField(container, valueToInput, "To value");

  function syncVisibility(): void {
    const op = operatorSelect.value;
    const inactive = op === "";
    const noValue = inactive || NO_VALUE_OPS.has(op);
    const isBetween = !inactive && op === "between";
    valueControl.hidden = noValue;
    valueToInput.hidden = !isBetween;
    const valueField = valueControl.closest(".lfg-filter-field");
    const valueToField = valueToInput.closest(".lfg-filter-field");
    if (valueField instanceof HTMLElement) valueField.hidden = noValue;
    if (valueToField instanceof HTMLElement) valueToField.hidden = !isBetween;
    if (noValue && !inactive) {
      valueControl.value = isBoolean ? "true" : "";
      valueToInput.value = "";
    }
  }

  syncVisibility();
  operatorSelect.addEventListener("change", syncVisibility);

  const cleanup = (): void => {
    operatorSelect.removeEventListener("change", syncVisibility);
  };

  return { container, operatorSelect, valueControl, valueToInput, syncVisibility, cleanup };
}

// ── Condition activity check ───────────────────────────────

function isConditionActive(
  row: ConditionRowControls,
  hadInitialCondition: boolean,
  touched: boolean,
  type: ColumnFilterType,
): boolean {
  const op = row.operatorSelect.value;
  if (op === "") return false;

  if (NO_VALUE_OPS.has(op)) {
    return hadInitialCondition || touched;
  }

  if (type === "boolean") {
    return hadInitialCondition || touched;
  }

  if (op === "between") {
    return row.valueControl.value !== "" && row.valueToInput.value !== "";
  }

  return row.valueControl.value !== "";
}

// ── Main form ──────────────────────────────────────────────

export function createFilterMenuForm(options: FilterMenuFormOptions): FilterMenuFormResult {
  const { field, config, currentModel, close } = options;
  const columnLabel = resolveFilterColumnLabel(field, options.headerName);
  const conditionsVisible = options.showConditions !== false;
  const selectionVisible = options.showSelectionList !== false && !!options.getSelectionValues;

  const form = document.createElement("div");
  form.className = "lfg-filter-form";

  const cond1Initial = currentModel?.conditions[0];
  const cond2Initial = currentModel?.conditions[1];
  const initialJoin: FilterJoinOperator = currentModel?.operator ?? "and";

  let row1: ConditionRowControls | null = null;
  let row2: ConditionRowControls | null = null;
  let row2Touched = false;
  let orRadio: HTMLInputElement | null = null;
  let onRow2Change: (() => void) | null = null;

  if (conditionsVisible) {
    const formInstanceId = allocateFilterFormInstanceId();
    const joinGroupName = `lfg-filter-join-${formInstanceId}`;

    row1 = createConditionRow(
      config,
      cond1Initial,
      columnLabel,
      1,
      options.formatBooleanLabel,
    );
    form.appendChild(row1.container);

    const joinRow = document.createElement("div");
    joinRow.className = "lfg-filter-join-row";

    const joinCaption = document.createElement("div");
    joinCaption.className = "lfg-filter-field-label";
    joinCaption.textContent = "Match";
    joinRow.appendChild(joinCaption);

    const joinToggle = document.createElement("div");
    joinToggle.className = "lfg-filter-join-toggle";
    joinToggle.setAttribute("role", "radiogroup");
    joinToggle.setAttribute("aria-label", `Match conditions for ${columnLabel}`);

    const andRadio = document.createElement("input");
    andRadio.type = "radio";
    andRadio.name = joinGroupName;
    andRadio.value = "and";
    andRadio.id = `${joinGroupName}-and`;
    andRadio.className = "lfg-filter-join-input";
    andRadio.setAttribute("aria-label", filterJoinName(columnLabel, "AND"));
    andRadio.checked = initialJoin === "and";

    const andLabel = document.createElement("label");
    andLabel.htmlFor = andRadio.id;
    andLabel.textContent = "AND";
    andLabel.className = "lfg-filter-join-label";

    orRadio = document.createElement("input");
    orRadio.type = "radio";
    orRadio.name = joinGroupName;
    orRadio.value = "or";
    orRadio.id = `${joinGroupName}-or`;
    orRadio.className = "lfg-filter-join-input";
    orRadio.setAttribute("aria-label", filterJoinName(columnLabel, "OR"));
    orRadio.checked = initialJoin === "or";

    const orLabel = document.createElement("label");
    orLabel.htmlFor = orRadio.id;
    orLabel.textContent = "OR";
    orLabel.className = "lfg-filter-join-label";

    joinToggle.appendChild(andRadio);
    joinToggle.appendChild(andLabel);
    joinToggle.appendChild(orRadio);
    joinToggle.appendChild(orLabel);
    joinRow.appendChild(joinToggle);
    form.appendChild(joinRow);

    row2 = createConditionRow(
      config,
      cond2Initial,
      columnLabel,
      2,
      options.formatBooleanLabel,
    );
    form.appendChild(row2.container);

    onRow2Change = (): void => { row2Touched = true; };
    row2.container.addEventListener("change", onRow2Change);
    row2.container.addEventListener("input", onRow2Change);
  }

  let selection: SelectionHelpers | null = null;
  if (selectionVisible) {
    selection = renderSelectionSection(form, options, columnLabel);
  }

  const footer = document.createElement("div");
  footer.className = "lfg-filter-form-footer";

  if (selection) {
    footer.appendChild(selection.statusEl);
  }

  const btnRow = document.createElement("div");
  btnRow.className = "lfg-filter-form-buttons";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "lfg-filter-form-apply";
  applyBtn.textContent = "Apply";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "lfg-filter-form-clear";
  clearBtn.textContent = "Clear";

  btnRow.appendChild(clearBtn);
  btnRow.appendChild(applyBtn);
  footer.appendChild(btnRow);
  form.appendChild(footer);

  function onApply(): void {
    let conditions: ColumnFilterCondition[] | undefined;
    let join: FilterJoinOperator = "and";

    if (conditionsVisible && row1 && row2) {
      conditions = [];

      if (isConditionActive(row1, true, true, config.type)) {
        conditions.push(buildCondition(
          row1.operatorSelect.value as ColumnFilterOperator,
          config.type,
          row1.valueControl.value,
          row1.valueToInput.value,
        ));
      }

      if (isConditionActive(row2, cond2Initial !== undefined, row2Touched, config.type)) {
        conditions.push(buildCondition(
          row2.operatorSelect.value as ColumnFilterOperator,
          config.type,
          row2.valueControl.value,
          row2.valueToInput.value,
        ));
      }

      if (conditions.length > 1) {
        join = orRadio!.checked ? "or" : "and";
      }
    }

    let sel: ColumnFilterSelection | undefined;
    if (selectionVisible && selection?.hasCheckedSelection()) {
      sel = { operator: "in", values: selection.getCheckedSelectionValues() };
    }

    const hasConditions = conditions !== undefined && conditions.length > 0;

    if (!hasConditions && !sel) {
      if (conditionsVisible && selectionVisible) {
        options.clearColumnFilter(field, "ui");
        close();
        return;
      }

      if (conditionsVisible && !selectionVisible) {
        const preserved = currentModel?.selection;
        if (preserved) {
          options.setColumnFilterModel(field, {
            type: config.type,
            operator: currentModel.operator ?? "and",
            conditions: [],
            selection: preserved,
          }, "ui");
        } else {
          options.clearColumnFilter(field, "ui");
        }
        close();
        return;
      }

      if (!conditionsVisible && selectionVisible) {
        const preservedConds = currentModel?.conditions ?? [];
        if (preservedConds.length > 0) {
          options.setColumnFilterModel(field, {
            type: config.type,
            operator: currentModel?.operator ?? "and",
            conditions: preservedConds,
          }, "ui");
        } else {
          options.clearColumnFilter(field, "ui");
        }
        close();
        return;
      }
    }

    const model: ColumnFilterModel = {
      type: config.type,
      operator: hasConditions ? join : (currentModel?.operator ?? "and"),
      conditions: conditions ?? currentModel?.conditions ?? [],
    };

    if (sel) {
      model.selection = sel;
    } else if (!selectionVisible && currentModel?.selection) {
      model.selection = currentModel.selection;
    }

    options.setColumnFilterModel(field, model, "ui");
    close();
  }

  function onClear(): void {
    selection?.clearSelectionDraft();
    options.clearColumnFilter(field, "ui");
    close();
  }

  applyBtn.addEventListener("click", onApply);
  clearBtn.addEventListener("click", onClear);

  const cleanups: (() => void)[] = [];

  if (row1) cleanups.push(row1.cleanup);
  if (row2 && onRow2Change) {
    cleanups.push(row2.cleanup);
    const r2Container = row2.container;
    const handler = onRow2Change;
    cleanups.push(() => {
      r2Container.removeEventListener("change", handler);
      r2Container.removeEventListener("input", handler);
    });
  }

  cleanups.push(() => {
    applyBtn.removeEventListener("click", onApply);
    clearBtn.removeEventListener("click", onClear);
  });

  if (selection) {
    cleanups.push(selection.cleanup);
  }

  const cleanup = (): void => {
    for (const fn of cleanups) fn();
  };

  return { element: form, cleanup };
}

// ── Selection section ──────────────────────────────────────

const SELECTION_MAX_VALUES = 200;
const SELECTION_KEY_ATTR = "data-sel-key";

interface SelectionHelpers {
  statusEl: HTMLElement;
  hasCheckedSelection: () => boolean;
  getCheckedSelectionValues: () => (string | number | boolean)[];
  clearSelectionDraft: () => void;
  cleanup: () => void;
}

function renderSelectionSection(
  form: HTMLElement,
  options: FilterMenuFormOptions,
  columnLabel: string,
): SelectionHelpers {
  const { field, config, currentModel } = options;
  const getSelectionValues = options.getSelectionValues!;

  const section = document.createElement("div");
  section.className = "lfg-filter-selection";
  form.appendChild(section);

  const separator = document.createElement("div");
  separator.className = "lfg-filter-selection-separator";
  section.appendChild(separator);

  const label = document.createElement("div");
  label.className = "lfg-filter-selection-label lfg-filter-field-label";
  label.textContent = "Filter by selection";
  section.appendChild(label);

  const searchWrap = document.createElement("div");
  searchWrap.className = "lfg-filter-selection-search-wrap";
  section.appendChild(searchWrap);

  const searchInput = document.createElement("input");
  searchInput.className = "lfg-filter-selection-search";
  searchInput.type = "text";
  searchInput.placeholder = `Search ${columnLabel}…`;
  searchInput.setAttribute(
    "aria-label",
    filterSelectionSearchName(columnLabel),
  );
  searchWrap.appendChild(searchInput);

  const listContainer = document.createElement("div");
  listContainer.className = "lfg-filter-selection-list";
  section.appendChild(listContainer);

  const statusEl = document.createElement("div");
  statusEl.className = "lfg-filter-selection-status";
  // Mounted into `.lfg-filter-form-footer` by the form so status + actions share one block.

  const checked = new Map<string, string | number | boolean>();
  const visibleValuesByKey = new Map<string, string | number | boolean>();

  const activeInValues = extractInValues(currentModel);
  if (activeInValues) {
    for (const v of activeInValues) {
      checked.set(toSelectionKey(v, config), v);
    }
  }

  function populateList(searchText?: string): void {
    const result = getSelectionValues({
      field,
      searchText,
      maxValues: SELECTION_MAX_VALUES,
    });

    listContainer.textContent = "";
    visibleValuesByKey.clear();

    const frag = document.createDocumentFragment();
    for (const sv of result.values) {
      visibleValuesByKey.set(sv.key, sv.value);

      const row = document.createElement("label");
      row.className = "lfg-filter-selection-item";
      row.setAttribute(SELECTION_KEY_ATTR, sv.key);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked.has(sv.key);
      cb.setAttribute(
        "aria-label",
        filterSelectionValueName(columnLabel, sv.label),
      );

      const text = document.createElement("span");
      text.className = "lfg-filter-selection-item-label";
      text.setAttribute("aria-label", sv.label);

      const preview = options.renderSelectionValuePreview?.({
        field,
        value: sv.value,
        label: sv.label,
        sampleRowIndex: sv.sampleRowIndex,
      }) ?? null;
      if (preview) {
        text.appendChild(preview);
      } else {
        text.textContent = sv.label;
      }

      const count = document.createElement("span");
      count.className = "lfg-filter-selection-item-count";
      count.textContent = `(${sv.count})`;

      row.appendChild(cb);
      row.appendChild(text);
      row.appendChild(count);
      frag.appendChild(row);
    }
    listContainer.appendChild(frag);

    if (result.truncated) {
      statusEl.textContent = `Showing ${result.values.length} of ${result.totalDistinct} values`;
      statusEl.hidden = false;
    } else {
      statusEl.hidden = true;
    }
  }

  populateList();

  function onListChange(e: Event): void {
    const target = e.target as HTMLInputElement;
    if (target.type !== "checkbox") return;
    const item = target.closest(`[${SELECTION_KEY_ATTR}]`) as HTMLElement | null;
    if (!item) return;
    const key = item.getAttribute(SELECTION_KEY_ATTR)!;
    if (target.checked) {
      const value = visibleValuesByKey.get(key);
      if (value !== undefined) checked.set(key, value);
    } else {
      checked.delete(key);
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function onSearchInput(): void {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      populateList(searchInput.value || undefined);
    }, 150);
  }

  listContainer.addEventListener("change", onListChange);
  searchInput.addEventListener("input", onSearchInput);

  return {
    statusEl,
    hasCheckedSelection: () => checked.size > 0,
    getCheckedSelectionValues: () => Array.from(checked.values()),
    clearSelectionDraft: () => {
      checked.clear();
      const cbs = listContainer.querySelectorAll("input[type=checkbox]") as NodeListOf<HTMLInputElement>;
      for (let i = 0; i < cbs.length; i++) cbs[i]!.checked = false;
    },
    cleanup: () => {
      if (searchTimer !== null) clearTimeout(searchTimer);
      listContainer.removeEventListener("change", onListChange);
      searchInput.removeEventListener("input", onSearchInput);
    },
  };
}

function extractInValues(
  model: ColumnFilterModel | null,
): readonly (string | number | boolean)[] | null {
  if (!model) return null;
  if (model.selection) return model.selection.values;
  return null;
}

function toSelectionKey(
  value: string | number | boolean,
  config: NormalizedColumnFilterConfig,
): string {
  if (config.type === "text" && typeof value === "string") {
    return config.caseSensitive ? value : value.toLowerCase();
  }
  return String(value);
}

function buildCondition(
  op: ColumnFilterOperator,
  type: ColumnFilterType,
  rawValue: string,
  rawValueTo: string,
): ColumnFilterCondition {
  if (NO_VALUE_OPS.has(op)) {
    return { operator: op };
  }

  if (type === "boolean") {
    return { operator: op, value: rawValue === "true" };
  }

  if (type === "number") {
    const v = Number(rawValue);
    if (op === "between") {
      return { operator: op, value: v, valueTo: Number(rawValueTo) };
    }
    return { operator: op, value: v };
  }

  if (op === "between") {
    return { operator: op, value: rawValue, valueTo: rawValueTo };
  }

  return { operator: op, value: rawValue };
}
