import {
  FLOATING_FILTER_HEADER_ADDON_KIND,
  HEADER_ADDON_CELL_ATTRIBUTE,
  HEADER_ADDON_ROW_KIND_ATTRIBUTE,
} from "../../internal/headerAddonDomMetadata";
import { isInternalColumn } from "../../internal/internalColumns";
import type { DomGridFeatureContext } from "../../internal/layoutTypes";
import { ROW_HEIGHT } from "../../rendering/helpers/gridConstants";
import type {
  CellEditorConfig,
  ColumnDef,
  ColumnFilterModel,
  FilterChangeSource,
  FloatingFilterSelectOption,
  NormalizedColumnFilterConfig,
} from "../../types";
import { isColumnFilterEligible } from "../filters/filterColumnEligibility";
import {
  floatingFilterEndDateName,
  floatingFilterMaximumName,
  floatingFilterMinimumName,
  floatingFilterStartDateName,
  floatingFilterValueName,
  openFilterMenuName,
  resolveFilterColumnLabel,
} from "../filters/filterControlAccessibleName";
import { initializePopupTrigger } from "../menu/popupSemantics";
import type {
  DomGridFeature,
  FloatingFilterCapability,
  HeaderAddonCapability,
  HeaderAddonSyncContext,
  HeaderLaneRefs,
} from "../types";

import { canControlRepresent, readRangeModelValues, readSimpleModelValue } from "./filterModelReader";
import { resolveFloatingFilterOperator } from "./operatorFallback";
import { resolveFloatingFilterConfig } from "./resolveFloatingFilterConfig";
import type { FloatingFiltersOptions, NormalizedFloatingFilterConfig } from "./types";

export interface FloatingFilterControllerOptions {
  getColumns: () => ColumnDef[];
  getFloatingFiltersOption: () => boolean | FloatingFiltersOptions | undefined;
  getColumnFilterModel: (field: string) => ColumnFilterModel | null;
  setColumnFilterModel: (field: string, model: ColumnFilterModel | null, source?: FilterChangeSource) => void;
  clearColumnFilter: (field: string, source?: FilterChangeSource) => void;
  getFilterConfig: (field: string) => NormalizedColumnFilterConfig | null;
}

const FLOATING_FILTER_ROW_CLASS = "lfg-floating-filter-row";
const FLOATING_FILTERS_ACTIVE_CLASS = "lfg-floating-filters-active";
const FLOATING_FILTER_CELL_CLASS = "lfg-floating-filter-cell";
const UTILITY_COLUMN_ATTR = "data-lfg-utility-column";
const FILTER_TRIGGER_CLASS = "lfg-column-filter-trigger";
const RANGE_WRAPPER_CLASS = "lfg-floating-filter-range";
const RANGE_SEP_CLASS = "lfg-floating-filter-range-sep";
const DATE_BUTTON_CLASS = "lfg-floating-filter-date-button";
const DATE_BUTTON_ACTIVE_CLASS = "lfg-floating-filter-date-button-active";

interface SingleElements {
  kind: "single";
  input: HTMLInputElement | HTMLSelectElement;
}

interface RangeElements {
  kind: "range";
  inputMin: HTMLInputElement;
  inputMax: HTMLInputElement;
  wrapper: HTMLDivElement;
}

interface DateButtonElements {
  kind: "dateButton";
  button: HTMLButtonElement;
}

type CellElements = SingleElements | RangeElements | DateButtonElements;

interface CellState {
  field: string;
  config: NormalizedFloatingFilterConfig;
  elements: CellElements;
  menuBtn: HTMLButtonElement | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

export function floatingFilterFeature(
  options: FloatingFilterControllerOptions,
): DomGridFeature & FloatingFilterCapability & HeaderAddonCapability {
  let ctx: DomGridFeatureContext | null = null;
  let centerRow: HTMLDivElement | null = null;
  let pinnedLeftRow: HTMLDivElement | null = null;
  let pinnedRightRow: HTMLDivElement | null = null;
  const cellStates = new Map<string, CellState>();

  function isEnabled(): boolean {
    const opt = options.getFloatingFiltersOption();
    if (opt === undefined || opt === false) return false;
    if (opt === true) return true;
    return opt.enabled !== false;
  }

  function extractEditorSelectOptions(
    col: ColumnDef,
  ): ReadonlyArray<FloatingFilterSelectOption> | undefined {
    const editor = col.editor;
    if (!editor || typeof editor !== "object") return undefined;
    const cfg = editor as CellEditorConfig;
    if (cfg.type !== "select" || !cfg.options) return undefined;
    return cfg.options as ReadonlyArray<FloatingFilterSelectOption>;
  }

  function resolveConfig(col: ColumnDef): NormalizedFloatingFilterConfig | null {
    const globalOpt = options.getFloatingFiltersOption();
    const filterConfig = options.getFilterConfig(col.field);
    return resolveFloatingFilterConfig({
      field: col.field,
      global: globalOpt,
      column: col.floatingFilter,
      defaultColDef: undefined,
      filterConfig,
      isInternal: isInternalColumn(col),
      editorSelectOptions: extractEditorSelectOptions(col),
    });
  }

  function getModel(field: string): ColumnFilterModel | null {
    return options.getColumnFilterModel(field);
  }

  // ── Build controls ──────────────────────────────────────────────────

  function buildTextInput(
    config: NormalizedFloatingFilterConfig,
    ariaLabel: string,
  ): HTMLInputElement {
    const inp = document.createElement("input");
    inp.className = "lfg-floating-filter-input";
    inp.type = "text";
    inp.tabIndex = -1;
    inp.placeholder = config.placeholder ?? "Search...";
    inp.setAttribute("aria-label", ariaLabel);
    return inp;
  }

  function buildRangeInputs(
    config: NormalizedFloatingFilterConfig,
    columnLabel: string,
  ): RangeElements {
    const isDate = config.control === "dateRange";
    const wrapper = document.createElement("div");
    wrapper.className = RANGE_WRAPPER_CLASS;
    wrapper.dataset.lfgRangeKind = isDate ? "date" : "number";

    const inputMin = document.createElement("input");
    inputMin.className = "lfg-floating-filter-input";
    inputMin.type = isDate ? "date" : "number";
    inputMin.tabIndex = -1;
    if (isDate) {
      inputMin.placeholder = "Start date";
    } else {
      inputMin.placeholder = "Min";
    }
    inputMin.setAttribute(
      "aria-label",
      isDate
        ? floatingFilterStartDateName(columnLabel)
        : floatingFilterMinimumName(columnLabel),
    );

    const sep = document.createElement("span");
    sep.className = RANGE_SEP_CLASS;
    sep.setAttribute("aria-hidden", "true");

    const inputMax = document.createElement("input");
    inputMax.className = "lfg-floating-filter-input";
    inputMax.type = isDate ? "date" : "number";
    inputMax.tabIndex = -1;
    if (isDate) {
      inputMax.placeholder = "End date";
    } else {
      inputMax.placeholder = "Max";
    }
    inputMax.setAttribute(
      "aria-label",
      isDate
        ? floatingFilterEndDateName(columnLabel)
        : floatingFilterMaximumName(columnLabel),
    );

    wrapper.appendChild(inputMin);
    wrapper.appendChild(sep);
    wrapper.appendChild(inputMax);

    return { kind: "range", inputMin, inputMax, wrapper };
  }

  function buildDateButton(
    field: string,
    headerName: string | undefined,
  ): DateButtonElements {
    const columnLabel = resolveFilterColumnLabel(field, headerName);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${FILTER_TRIGGER_CLASS} ${DATE_BUTTON_CLASS}`;
    button.setAttribute("data-col-id", field);
    button.setAttribute("aria-label", openFilterMenuName(columnLabel));
    initializePopupTrigger(button, "dialog");
    button.tabIndex = -1;
    return { kind: "dateButton", button };
  }

  function buildBooleanSelect(ariaLabel: string): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.className = "lfg-floating-filter-input";
    sel.tabIndex = -1;
    sel.setAttribute("aria-label", ariaLabel);
    for (const [val, label] of [["", "All"], ["true", "Yes"], ["false", "No"]] as const) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      sel.appendChild(opt);
    }
    return sel;
  }

  function buildSelectControl(
    selectOptions: ReadonlyArray<FloatingFilterSelectOption>,
    ariaLabel: string,
  ): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.className = "lfg-floating-filter-input";
    sel.tabIndex = -1;
    sel.setAttribute("aria-label", ariaLabel);
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "All";
    sel.appendChild(allOpt);

    for (const item of selectOptions) {
      const opt = document.createElement("option");
      if (typeof item === "string") {
        opt.value = item;
        opt.textContent = item;
      } else {
        opt.value = String(item.value);
        opt.textContent = item.label;
      }
      sel.appendChild(opt);
    }
    return sel;
  }

  function buildCellElements(
    config: NormalizedFloatingFilterConfig,
    columnLabel: string,
    field: string,
    headerName: string | undefined,
  ): CellElements {
    const singleValueName = floatingFilterValueName(columnLabel);
    switch (config.control) {
      case "numberRange":
      case "dateRange":
        return buildRangeInputs(config, columnLabel);
      case "dateButton":
        return buildDateButton(field, headerName);
      case "booleanSelect":
        return { kind: "single", input: buildBooleanSelect(singleValueName) };
      case "select": {
        if (config.selectOptions && config.selectOptions.length > 0) {
          return {
            kind: "single",
            input: buildSelectControl(config.selectOptions, singleValueName),
          };
        }
        return {
          kind: "single",
          input: buildTextInput(config, singleValueName),
        };
      }
      default:
        return {
          kind: "single",
          input: buildTextInput(config, singleValueName),
        };
    }
  }

  function buildMenuButton(field: string, headerName: string | undefined): HTMLButtonElement {
    const columnLabel = resolveFilterColumnLabel(field, headerName);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = FILTER_TRIGGER_CLASS;
    btn.setAttribute("data-col-id", field);
    btn.setAttribute("aria-label", openFilterMenuName(columnLabel));
    initializePopupTrigger(btn, "dialog");
    btn.tabIndex = -1;
    return btn;
  }

  // ── Apply filters ───────────────────────────────────────────────────

  function applySingleFilter(field: string, config: NormalizedFloatingFilterConfig, value: string): void {
    if (value === "") {
      options.clearColumnFilter(field, "ui");
      return;
    }

    let typedValue: string | number | boolean = value;
    if (config.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      typedValue = n;
    } else if (config.type === "boolean") {
      typedValue = value === "true";
    }

    const filterConfig = options.getFilterConfig(field);
    if (!filterConfig) return;

    const operator = config.control === "select" || config.control === "booleanSelect"
      ? "equals"
      : resolveFloatingFilterOperator(config.type, filterConfig.defaultOperator);
    const model: ColumnFilterModel = {
      type: config.type,
      conditions: [{ operator, value: typedValue }],
    };
    options.setColumnFilterModel(field, model, "ui");
  }

  function applyRangeFilter(field: string, config: NormalizedFloatingFilterConfig, minStr: string, maxStr: string): void {
    if (minStr === "" && maxStr === "") {
      options.clearColumnFilter(field, "ui");
      return;
    }

    const isDate = config.control === "dateRange";

    if (isDate) {
      if (minStr !== "" && maxStr !== "") {
        const model: ColumnFilterModel = {
          type: "date",
          conditions: [{ operator: "between", value: minStr, valueTo: maxStr }],
        };
        options.setColumnFilterModel(field, model, "ui");
      } else if (minStr !== "") {
        const model: ColumnFilterModel = {
          type: "date",
          conditions: [{ operator: "after", value: minStr }],
        };
        options.setColumnFilterModel(field, model, "ui");
      } else {
        const model: ColumnFilterModel = {
          type: "date",
          conditions: [{ operator: "before", value: maxStr }],
        };
        options.setColumnFilterModel(field, model, "ui");
      }
      return;
    }

    const minNum = minStr !== "" ? Number(minStr) : null;
    const maxNum = maxStr !== "" ? Number(maxStr) : null;

    if (minNum !== null && !Number.isFinite(minNum)) return;
    if (maxNum !== null && !Number.isFinite(maxNum)) return;

    if (minNum !== null && maxNum !== null) {
      const model: ColumnFilterModel = {
        type: "number",
        conditions: [{ operator: "between", value: minNum, valueTo: maxNum }],
      };
      options.setColumnFilterModel(field, model, "ui");
    } else if (minNum !== null) {
      const model: ColumnFilterModel = {
        type: "number",
        conditions: [{ operator: "gte", value: minNum }],
      };
      options.setColumnFilterModel(field, model, "ui");
    } else if (maxNum !== null) {
      const model: ColumnFilterModel = {
        type: "number",
        conditions: [{ operator: "lte", value: maxNum }],
      };
      options.setColumnFilterModel(field, model, "ui");
    }
  }

  // ── Build cell ──────────────────────────────────────────────────────

  function buildCell(col: ColumnDef, config: NormalizedFloatingFilterConfig): HTMLDivElement {
    const cell = document.createElement("div");
    cell.className = FLOATING_FILTER_CELL_CLASS;
    cell.setAttribute("data-col-id", col.field);
    cell.setAttribute(HEADER_ADDON_CELL_ATTRIBUTE, "");

    const columnLabel = resolveFilterColumnLabel(col.field, col.headerName);
    const elements = buildCellElements(
      config,
      columnLabel,
      col.field,
      col.headerName,
    );
    const complex = !canControlRepresent(getModel(col.field), config.control);
    const forceDisabled = config.disabled;

    if (elements.kind === "range") {
      if (complex || forceDisabled) {
        elements.inputMin.disabled = true;
        elements.inputMax.disabled = true;
      }
      if (!complex) {
        const vals = readRangeModelValues(getModel(col.field));
        elements.inputMin.value = vals.min;
        elements.inputMax.value = vals.max;
      }
      cell.appendChild(elements.wrapper);
    } else if (elements.kind === "dateButton") {
      const hasFilter = getModel(col.field) !== null;
      elements.button.classList.toggle(DATE_BUTTON_ACTIVE_CLASS, hasFilter);
      elements.button.disabled = forceDisabled;
      cell.appendChild(elements.button);
    } else {
      if (complex) {
        if (elements.input instanceof HTMLInputElement) {
          elements.input.value = "";
          elements.input.disabled = true;
          elements.input.placeholder = "Filtered";
        } else {
          elements.input.disabled = true;
        }
      } else {
        elements.input.value = readSimpleModelValue(getModel(col.field));
        if (forceDisabled) {
          elements.input.disabled = true;
        }
      }
      cell.appendChild(elements.input);
    }

    // dateButton is itself the dedicated-filter trigger — skip the funnel.
    let menuBtn: HTMLButtonElement | null = null;
    if (
      config.menuButton &&
      !forceDisabled &&
      elements.kind !== "dateButton"
    ) {
      menuBtn = buildMenuButton(col.field, col.headerName);
      cell.appendChild(menuBtn);
    }

    const state: CellState = {
      field: col.field,
      config,
      elements,
      menuBtn,
      debounceTimer: null,
    };
    cellStates.set(col.field, state);

    return cell;
  }

  // ── Event listeners ─────────────────────────────────────────────────

  function attachInputListeners(state: CellState): void {
    const { config, field } = state;

    if (config.disabled) return;

    if (state.elements.kind === "range") {
      attachRangeListeners(state, state.elements);
      return;
    }

    if (state.elements.kind === "dateButton") {
      return;
    }

    const { input } = state.elements;

    if (input instanceof HTMLSelectElement) {
      input.addEventListener("change", () => {
        applySingleFilter(field, config, input.value);
      });
      return;
    }

    const commitValue = (): void => {
      if (state.debounceTimer !== null) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }
      if (!canControlRepresent(getModel(field), config.control)) return;
      applySingleFilter(field, config, input.value);
    };

    input.addEventListener("input", () => {
      if (!canControlRepresent(getModel(field), config.control)) return;
      if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
      if (config.debounceMs > 0) {
        state.debounceTimer = setTimeout(commitValue, config.debounceMs);
      } else {
        commitValue();
      }
    });

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitValue();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = readSimpleModelValue(getModel(field));
        input.blur();
      }
    });

    input.addEventListener("blur", () => {
      if (state.debounceTimer !== null) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
        commitValue();
      }
    });
  }

  function attachRangeListeners(state: CellState, elements: RangeElements): void {
    const { config, field } = state;
    const { inputMin, inputMax } = elements;

    const commitRange = (): void => {
      if (state.debounceTimer !== null) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }
      if (!canControlRepresent(getModel(field), config.control)) return;
      applyRangeFilter(field, config, inputMin.value, inputMax.value);
    };

    const scheduleCommit = (): void => {
      if (!canControlRepresent(getModel(field), config.control)) return;
      if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
      if (config.debounceMs > 0) {
        state.debounceTimer = setTimeout(commitRange, config.debounceMs);
      } else {
        commitRange();
      }
    };

    for (const inp of [inputMin, inputMax]) {
      if (config.control === "dateRange") {
        inp.addEventListener("change", () => {
          commitRange();
        });
      } else {
        inp.addEventListener("input", scheduleCommit);
      }

      inp.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitRange();
        } else if (e.key === "Escape") {
          e.preventDefault();
          const vals = readRangeModelValues(getModel(field));
          inputMin.value = vals.min;
          inputMax.value = vals.max;
          inp.blur();
        }
      });

      inp.addEventListener("blur", () => {
        if (state.debounceTimer !== null) {
          clearTimeout(state.debounceTimer);
          state.debounceTimer = null;
          commitRange();
        }
      });
    }
  }

  // ── Row building ────────────────────────────────────────────────────

  function buildRow(columns: ColumnDef[]): HTMLDivElement {
    const row = document.createElement("div");
    row.className = FLOATING_FILTER_ROW_CLASS;
    row.setAttribute(
      HEADER_ADDON_ROW_KIND_ATTRIBUTE,
      FLOATING_FILTER_HEADER_ADDON_KIND,
    );

    for (const col of columns) {
      if (!isColumnFilterEligible(col)) {
        const emptyCell = document.createElement("div");
        emptyCell.className = FLOATING_FILTER_CELL_CLASS;
        emptyCell.setAttribute("data-col-id", col.field);
        emptyCell.setAttribute(UTILITY_COLUMN_ATTR, "");
        emptyCell.setAttribute(HEADER_ADDON_CELL_ATTRIBUTE, "");
        row.appendChild(emptyCell);
        continue;
      }

      const config = resolveConfig(col);
      if (!config) {
        const emptyCell = document.createElement("div");
        emptyCell.className = FLOATING_FILTER_CELL_CLASS;
        emptyCell.setAttribute("data-col-id", col.field);
        emptyCell.setAttribute(HEADER_ADDON_CELL_ATTRIBUTE, "");
        row.appendChild(emptyCell);
        continue;
      }
      const cell = buildCell(col, config);
      row.appendChild(cell);
    }

    return row;
  }

  function insertRowAfterLeaf(
    leafRow: HTMLDivElement | null,
    row: HTMLDivElement,
  ): void {
    if (!leafRow) return;
    const parent = leafRow.parentElement;
    if (!parent) return;
    const next = leafRow.nextSibling;
    if (next) {
      parent.insertBefore(row, next);
    } else {
      parent.appendChild(row);
    }
  }

  function clearCellStates(): void {
    for (const state of cellStates.values()) {
      if (state.debounceTimer !== null) clearTimeout(state.debounceTimer);
    }
    cellStates.clear();
  }

  function removeRows(): void {
    clearCellStates();
    centerRow?.remove();
    centerRow = null;
    pinnedLeftRow?.remove();
    pinnedLeftRow = null;
    pinnedRightRow?.remove();
    pinnedRightRow = null;
    ctx?.root.classList.remove(FLOATING_FILTERS_ACTIVE_CLASS);
  }

  function resolveLaneRefs(
    preferred?: HeaderLaneRefs | null,
  ): HeaderLaneRefs | null {
    if (!ctx) return null;
    const fromSyncOrCtx = preferred ?? ctx.getHeaderLaneRefs?.() ?? null;
    // Prefer live lane refs only while the center leaf is still connected.
    if (fromSyncOrCtx?.center.leafRow.isConnected) return fromSyncOrCtx;

    // Test / rebuild fallback when lane refs are stale or not wired:
    // synthesize from leaf-row getters (center container = leaf parent).
    const centerLeaf = ctx.getHeaderRowEl();
    if (!centerLeaf?.parentElement) return null;
    const leftLeaf = ctx.getPinnedHeaderRowEl();
    const rightLeaf = ctx.getPinnedRightHeaderRowEl();
    return {
      center: {
        container: centerLeaf.parentElement as HTMLDivElement,
        leafRow: centerLeaf,
      },
      left:
        leftLeaf?.isConnected && leftLeaf.parentElement
          ? {
              container: leftLeaf.parentElement as HTMLDivElement,
              leafRow: leftLeaf,
            }
          : null,
      right:
        rightLeaf?.isConnected && rightLeaf.parentElement
          ? {
              container: rightLeaf.parentElement as HTMLDivElement,
              leafRow: rightLeaf,
            }
          : null,
    };
  }

  function rebuildAll(preferredLanes?: HeaderLaneRefs | null): void {
    removeRows();
    if (!ctx || !isEnabled()) return;

    const { center: centerCols, left: leftCols, right: rightCols } = partitionColumns(
      options.getColumns(),
    );
    const lanes = resolveLaneRefs(preferredLanes);

    if (centerCols.length > 0 || leftCols.length > 0 || rightCols.length > 0) {
      centerRow = buildRow(centerCols);
      insertRowAfterLeaf(lanes?.center.leafRow ?? ctx.getHeaderRowEl(), centerRow);
    }

    if (leftCols.length > 0) {
      pinnedLeftRow = buildRow(leftCols);
      insertRowAfterLeaf(
        lanes?.left?.leafRow ?? ctx.getPinnedHeaderRowEl(),
        pinnedLeftRow,
      );
    }

    if (rightCols.length > 0) {
      pinnedRightRow = buildRow(rightCols);
      insertRowAfterLeaf(
        lanes?.right?.leafRow ?? ctx.getPinnedRightHeaderRowEl(),
        pinnedRightRow,
      );
    }

    ctx.root.classList.toggle(
      FLOATING_FILTERS_ACTIVE_CLASS,
      centerRow !== null || pinnedLeftRow !== null || pinnedRightRow !== null,
    );

    ctx.syncColumnSelectionClasses?.();

    for (const state of cellStates.values()) {
      attachInputListeners(state);
    }
  }

  function syncInputValues(): void {
    for (const state of cellStates.values()) {
      const complex = !canControlRepresent(getModel(state.field), state.config.control);
      const forceDisabled = state.config.disabled;

      if (state.elements.kind === "range") {
        if (complex || forceDisabled) {
          state.elements.inputMin.disabled = true;
          state.elements.inputMax.disabled = true;
        } else {
          state.elements.inputMin.disabled = false;
          state.elements.inputMax.disabled = false;
        }
        if (!complex) {
          if (document.activeElement !== state.elements.inputMin &&
              document.activeElement !== state.elements.inputMax) {
            const vals = readRangeModelValues(getModel(state.field));
            state.elements.inputMin.value = vals.min;
            state.elements.inputMax.value = vals.max;
          }
        }
        continue;
      }

      if (state.elements.kind === "dateButton") {
        const hasFilter = getModel(state.field) !== null;
        state.elements.button.classList.toggle(DATE_BUTTON_ACTIVE_CLASS, hasFilter);
        state.elements.button.disabled = forceDisabled;
        continue;
      }

      const { input } = state.elements;

      if (complex) {
        if (input instanceof HTMLInputElement) {
          input.value = "";
          input.disabled = true;
          input.placeholder = "Filtered";
        } else {
          input.disabled = true;
        }
        continue;
      }

      input.disabled = forceDisabled;
      const val = readSimpleModelValue(getModel(state.field));
      if (input instanceof HTMLSelectElement) {
        input.value = val;
      } else {
        if (document.activeElement !== input) {
          input.value = val;
          if (state.config.placeholder !== undefined) {
            input.placeholder = state.config.placeholder;
          }
        }
      }
    }
  }

  let lastStructureSignature = "";

  function partitionColumns(columns: ColumnDef[]): {
    center: ColumnDef[];
    left: ColumnDef[];
    right: ColumnDef[];
  } {
    const center: ColumnDef[] = [];
    const left: ColumnDef[] = [];
    const right: ColumnDef[] = [];
    for (const col of columns) {
      if (col.pinned === "left") left.push(col);
      else if (col.pinned === "right") right.push(col);
      else center.push(col);
    }
    return { center, left, right };
  }

  function isRowAttachedAfterLeaf(
    row: HTMLDivElement | null,
    leafRow: HTMLDivElement | null,
  ): boolean {
    if (!row?.isConnected || !leafRow?.isConnected) return false;
    return (
      row.parentElement === leafRow.parentElement &&
      leafRow.nextElementSibling === row
    );
  }

  /** True when expected floating-filter rows are missing or no longer under the current header DOM. */
  function needsReattach(preferredLanes?: HeaderLaneRefs | null): boolean {
    if (!ctx || !isEnabled()) return false;

    const { center, left, right } = partitionColumns(options.getColumns());
    const lanes = resolveLaneRefs(preferredLanes);

    if (center.length > 0 || left.length > 0 || right.length > 0) {
      if (
        !centerRow ||
        !isRowAttachedAfterLeaf(
          centerRow,
          lanes?.center.leafRow ?? ctx.getHeaderRowEl(),
        )
      ) {
        return true;
      }
    } else if (centerRow !== null) {
      return true;
    }

    if (left.length > 0) {
      if (
        !pinnedLeftRow ||
        !isRowAttachedAfterLeaf(
          pinnedLeftRow,
          lanes?.left?.leafRow ?? ctx.getPinnedHeaderRowEl(),
        )
      ) {
        return true;
      }
    } else if (pinnedLeftRow !== null) {
      return true;
    }

    if (right.length > 0) {
      if (
        !pinnedRightRow ||
        !isRowAttachedAfterLeaf(
          pinnedRightRow,
          lanes?.right?.leafRow ?? ctx.getPinnedRightHeaderRowEl(),
        )
      ) {
        return true;
      }
    } else if (pinnedRightRow !== null) {
      return true;
    }

    return false;
  }

  function computeStructureSignature(): string {
    const globalOpt = options.getFloatingFiltersOption();
    if (globalOpt === undefined || globalOpt === false) return "off";

    const columns = options.getColumns();
    const parts: string[] = [];
    for (const col of columns) {
      if (!isColumnFilterEligible(col)) {
        parts.push(`${col.field}:skip:${col.pinned ?? ""}`);
        continue;
      }
      const cfg = resolveConfig(col);
      if (!cfg) {
        parts.push(`${col.field}:off:${col.pinned ?? ""}`);
        continue;
      }
      let sig = `${col.field}:${cfg.control}:${col.pinned ?? ""}:${cfg.debounceMs}:${cfg.menuButton ? 1 : 0}:${cfg.disabled ? 1 : 0}:${cfg.placeholder ?? ""}`;
      const columnLabel = resolveFilterColumnLabel(col.field, col.headerName);
      sig += `:${columnLabel.length}:${columnLabel}`;
      if (cfg.selectOptions) {
        sig += ":" + cfg.selectOptions.map(o => typeof o === "string" ? o : `${o.value}=${o.label}`).join(",");
      }
      parts.push(sig);
    }
    return parts.join("|");
  }

  return {
    name: "floating-filters",

    attach(featureCtx: DomGridFeatureContext): void {
      ctx = featureCtx;
      rebuildAll();
      lastStructureSignature = computeStructureSignature();
    },

    getHeaderAddonHeight(): number {
      if (!centerRow && !pinnedLeftRow && !pinnedRightRow) return 0;
      return ctx?.layoutMetrics?.rowHeight ?? ROW_HEIGHT;
    },

    hasFloatingFilterRow(): boolean {
      return centerRow !== null || pinnedLeftRow !== null || pinnedRightRow !== null;
    },

    syncHeaderAddon(context: HeaderAddonSyncContext): void {
      // Geometry for floating filters is structural (sibling after leaf).
      // Prefer lane refs from the sync bag; fall back via resolveLaneRefs.
      if (!ctx) return;
      const lanes = context.headerLaneRefs;
      const sig = computeStructureSignature();
      if (sig !== lastStructureSignature) {
        lastStructureSignature = sig;
        rebuildAll(lanes);
      } else if (needsReattach(lanes)) {
        rebuildAll(lanes);
      } else {
        syncInputValues();
      }
    },

    syncFloatingFilters(): void {
      if (!ctx) return;
      const sig = computeStructureSignature();
      if (sig !== lastStructureSignature) {
        lastStructureSignature = sig;
        rebuildAll();
      } else if (needsReattach()) {
        rebuildAll();
      } else {
        syncInputValues();
      }
    },

    detach(): void {
      removeRows();
      ctx = null;
      lastStructureSignature = "";
    },
  };
}
