import type { ColumnFilterOperator } from "@lightfastgrid/core";

import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import { preservePanelFocus } from "../../shell/preservePanelFocus.ts";
import { bindFocusStealGuard } from "../../shell/ToolbarIcons.ts";
import {
  mountPanelDivider,
  mountPanelHeader,
  mountPanelInfoFooter,
  mountPanelMenuItem,
  mountPanelToggleRow,
} from "../../shell/ui/panelPrimitives.ts";

import {
  clearAllDemoFilters,
  clearDemoColumnFilter,
  listFilterableColumns,
  readDemoFilterRows,
  writeDemoColumnFilter,
} from "./commands/filterPanelActions.ts";
import {
  buildCommitModel,
  createDemoFilterDraft,
  type DemoFilterableColumn,
  type DemoFilterDraft,
  type DemoFilterEditorRow,
  type DemoFilterRow,
  mergeFilterEditorRows,
  nextAvailableFilterColumn,
  operatorLabel,
  operatorNeedsValue,
  operatorsForFilterType,
} from "./commands/filterPanelModel.ts";

function filterRowsSignature(rows: readonly DemoFilterRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      field: row.field,
      kind: row.kind,
      operator: row.operator,
      valueText: row.valueText,
      chips: row.chips,
    })),
  );
}

/**
 * Filters panel — filter model + floating filters (architecture §5.3).
 * Vanilla DOM port of React FiltersPanel.tsx.
 */
export function mountFiltersPanel(
  host: HTMLElement,
  props: InteractiveDemoPanelProps,
): () => void {
  const { getGrid, onClose, onStatus } = props;
  let floatingFiltersEnabled = props.floatingFiltersEnabled ?? true;
  const onFloatingFiltersChange = props.onFloatingFiltersChange;

  const root = el("div", "interactive-demo-panel-stack");
  const cleanups: (() => void)[] = [];

  let committed: DemoFilterRow[] = [];
  let drafts: DemoFilterDraft[] = [];
  let draftSeq = 0;
  let lastPollSignature = "";

  function nextDraftId(): string {
    return `draft-${draftSeq++}`;
  }

  function refreshCommitted() {
    committed = readDemoFilterRows(getGrid);
  }

  function getFilterable(): DemoFilterableColumn[] {
    return listFilterableColumns(getGrid);
  }

  function getEditorRows(): DemoFilterEditorRow[] {
    return mergeFilterEditorRows({
      committed,
      drafts,
      columns: getFilterable(),
    });
  }

  const headerHandle = mountPanelHeader(root, {
    title: "Current filters (0)",
    onClose,
  });
  cleanups.push(headerHandle.destroy);
  const titleEl = headerHandle.root.querySelector(
    ".interactive-demo-panel-heading-title",
  );

  const placeholder = el(
    "p",
    "interactive-demo-panel-placeholder",
    "No active filters. Add one below or use floating filters.",
  );
  root.append(placeholder);

  const filterListContainer = el("div", "interactive-demo-filter-list");
  root.append(filterListContainer);

  const addBtn = el("button", "interactive-demo-filter-add");
  addBtn.type = "button";
  const addBtnPlus = el("span", undefined, "+");
  addBtnPlus.setAttribute("aria-hidden", "true");
  addBtn.append(addBtnPlus, document.createTextNode(" Add filter"));
  const unguardAdd = bindFocusStealGuard(addBtn);
  cleanups.push(unguardAdd);
  addBtn.addEventListener("click", addFilter);
  cleanups.push(() => addBtn.removeEventListener("click", addFilter));
  root.append(addBtn);

  mountPanelDivider(root);

  const menuContainer = el("div", "interactive-demo-panel-menu");
  root.append(menuContainer);

  const clearCleanup = mountPanelMenuItem(menuContainer, {
    label: "Clear all filters",
    disabled: true,
    onClick: () => {
      drafts = [];
      clearAllDemoFilters(getGrid);
      refreshCommitted();
      lastPollSignature = filterRowsSignature(committed);
      onStatus?.("Filters cleared");
      render();
    },
  });
  cleanups.push(clearCleanup);
  const clearBtn = menuContainer.querySelector<HTMLButtonElement>(
    ".interactive-demo-panel-menu-item",
  );

  const floatingCleanup = mountPanelToggleRow(menuContainer, {
    label: "Floating filters",
    checked: floatingFiltersEnabled,
    onChange: (enabled) => {
      floatingFiltersEnabled = enabled;
      onFloatingFiltersChange?.(enabled);
    },
  });
  cleanups.push(floatingCleanup);

  mountPanelInfoFooter(
    root,
    "Filters are combined using AND logic. All conditions must match.",
  );

  function addFilter() {
    const filterable = getFilterable();
    const editorRows = getEditorRows();
    const usedFields = new Set(editorRows.map((r) => r.field));
    const column = nextAvailableFilterColumn(filterable, usedFields);
    if (!column) return;
    drafts = [...drafts, createDemoFilterDraft(column, nextDraftId())];
    render();
  }

  function removeRow(row: DemoFilterEditorRow) {
    if (row.draftId) {
      drafts = drafts.filter((d) => d.id !== row.draftId);
      render();
      return;
    }
    clearDemoColumnFilter(getGrid, row.field);
    refreshCommitted();
    lastPollSignature = filterRowsSignature(committed);
    render();
  }

  function applyEditorState(
    row: DemoFilterEditorRow,
    next: {
      field?: string;
      operator?: ColumnFilterOperator;
      valueText?: string;
      chips?: string[];
      kind?: DemoFilterEditorRow["kind"];
    },
  ) {
    const filterable = getFilterable();
    const field = next.field ?? row.field;
    const column = filterable.find((c) => c.field === field);
    if (!column) return;

    const fieldChanged = field !== row.field;
    const kind =
      next.kind ??
      (fieldChanged
        ? column.selectOptions.length > 0
          ? "selection"
          : "condition"
        : row.kind);
    const operator =
      next.operator ??
      (fieldChanged
        ? kind === "selection"
          ? "in"
          : column.defaultOperator
        : (row.operator ??
          (kind === "selection" ? "in" : column.defaultOperator)));
    const valueText = fieldChanged
      ? (next.valueText ?? "")
      : (next.valueText ?? row.valueText);
    const chips = fieldChanged
      ? (next.chips ?? [])
      : (next.chips ?? row.chips);

    const model = buildCommitModel({
      type: column.type,
      kind,
      operator,
      valueText,
      chips,
    });

    if (row.field !== field) {
      clearDemoColumnFilter(getGrid, row.field);
    }

    const draft: DemoFilterDraft = {
      id: row.draftId ?? nextDraftId(),
      field,
      kind,
      operator,
      valueText,
      chips,
    };

    if (model) {
      writeDemoColumnFilter(getGrid, field, model);
    } else {
      clearDemoColumnFilter(getGrid, field);
    }

    drafts = drafts.filter(
      (d) => d.id !== draft.id && d.field !== field,
    );
    if (row.draftId && row.draftId !== draft.id) {
      drafts = drafts.filter((d) => d.id !== row.draftId);
    }
    drafts = [...drafts, draft];
    refreshCommitted();
    lastPollSignature = filterRowsSignature(committed);
    render();
  }

  function renderFilterRow(
    parent: HTMLElement,
    row: DemoFilterEditorRow,
    filterable: DemoFilterableColumn[],
    usedFields: ReadonlySet<string>,
  ): () => void {
    const rowCleanups: (() => void)[] = [];
    const rowEl = el("div", "interactive-demo-filter-row");

    const dragHandle = el("span", "interactive-demo-filter-drag");
    dragHandle.setAttribute("aria-hidden", "true");
    dragHandle.title = "Reorder not available yet";
    dragHandle.textContent = "⠿";
    rowEl.append(dragHandle);

    const body = el("div", "interactive-demo-filter-body");
    const topRow = el("div", "interactive-demo-filter-top");

    const fieldSelect = el("select", "interactive-demo-filter-select");
    fieldSelect.setAttribute("aria-label", "Filter column");
    for (const col of filterable) {
      const opt = el("option", undefined, col.label);
      opt.value = col.field;
      if (col.field === row.field) opt.selected = true;
      if (col.field !== row.field && usedFields.has(col.field))
        opt.disabled = true;
      fieldSelect.append(opt);
    }
    const unguardField = bindFocusStealGuard(fieldSelect);
    rowCleanups.push(unguardField);
    const onFieldChange = () =>
      applyEditorState(row, { field: fieldSelect.value });
    fieldSelect.addEventListener("change", onFieldChange);
    rowCleanups.push(() =>
      fieldSelect.removeEventListener("change", onFieldChange),
    );
    topRow.append(fieldSelect);

    const showOperator = row.kind === "condition" && row.operator !== null;
    if (showOperator) {
      const opSelect = el(
        "select",
        "interactive-demo-filter-select interactive-demo-filter-op",
      );
      opSelect.setAttribute("aria-label", "Filter operator");
      for (const op of operatorsForFilterType(row.type)) {
        const opt = el("option", undefined, operatorLabel(op));
        opt.value = op;
        if (op === row.operator) opt.selected = true;
        opSelect.append(opt);
      }
      const unguardOp = bindFocusStealGuard(opSelect);
      rowCleanups.push(unguardOp);
      const onOpChange = () =>
        applyEditorState(row, {
          operator: opSelect.value as ColumnFilterOperator,
        });
      opSelect.addEventListener("change", onOpChange);
      rowCleanups.push(() =>
        opSelect.removeEventListener("change", onOpChange),
      );
      topRow.append(opSelect);
    }

    const removeBtn = el("button", "interactive-demo-filter-remove", "×");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove ${row.label} filter`);
    const unguardRemove = bindFocusStealGuard(removeBtn);
    rowCleanups.push(unguardRemove);
    const onRemove = () => removeRow(row);
    removeBtn.addEventListener("click", onRemove);
    rowCleanups.push(() =>
      removeBtn.removeEventListener("click", onRemove),
    );
    topRow.append(removeBtn);

    body.append(topRow);

    if (row.kind === "selection") {
      const selectionContainer = el("div", "interactive-demo-filter-selection");

      if (row.chips.length > 0) {
        const chipsContainer = el("div", "interactive-demo-filter-chips");
        for (const chip of row.chips) {
          const chipBtn = el("button", "interactive-demo-filter-chip");
          chipBtn.type = "button";
          chipBtn.append(
            document.createTextNode(chip),
            (() => {
              const x = el("span", undefined, "×");
              x.setAttribute("aria-hidden", "true");
              return x;
            })(),
          );
          const unguardChip = bindFocusStealGuard(chipBtn);
          rowCleanups.push(unguardChip);
          const onChipClick = () =>
            applyEditorState(row, {
              chips: row.chips.filter((v) => v !== chip),
            });
          chipBtn.addEventListener("click", onChipClick);
          rowCleanups.push(() =>
            chipBtn.removeEventListener("click", onChipClick),
          );
          chipsContainer.append(chipBtn);
        }
        selectionContainer.append(chipsContainer);
      }

      const valueSelect = el(
        "select",
        "interactive-demo-filter-select interactive-demo-filter-value-select",
      );
      valueSelect.setAttribute("aria-label", `${row.label} value`);
      const defaultOpt = el(
        "option",
        undefined,
        row.chips.length === 0 ? "Select value…" : "Add value…",
      );
      defaultOpt.value = "";
      defaultOpt.disabled = true;
      defaultOpt.selected = true;
      valueSelect.append(defaultOpt);
      for (const option of row.selectOptions.filter(
        (o) => !row.chips.includes(o),
      )) {
        const opt = el("option", undefined, option);
        opt.value = option;
        valueSelect.append(opt);
      }
      const unguardValueSelect = bindFocusStealGuard(valueSelect);
      rowCleanups.push(unguardValueSelect);
      const onValueSelectChange = () => {
        const value = valueSelect.value;
        if (!value || row.chips.includes(value)) return;
        applyEditorState(row, { chips: [...row.chips, value] });
      };
      valueSelect.addEventListener("change", onValueSelectChange);
      rowCleanups.push(() =>
        valueSelect.removeEventListener("change", onValueSelectChange),
      );
      selectionContainer.append(valueSelect);
      body.append(selectionContainer);
    } else {
      const needsValue =
        row.operator !== null && operatorNeedsValue(row.operator);
      if (needsValue) {
        if (row.type === "boolean") {
          const boolSelect = el(
            "select",
            "interactive-demo-filter-select interactive-demo-filter-value-select",
          );
          boolSelect.setAttribute("aria-label", `${row.label} value`);
          const boolDefault = el("option", undefined, "Select value…");
          boolDefault.value = "";
          boolDefault.disabled = true;
          if (!row.valueText) boolDefault.selected = true;
          boolSelect.append(boolDefault);
          for (const val of ["true", "false"]) {
            const opt = el("option", undefined, val);
            opt.value = val;
            if (row.valueText === val) opt.selected = true;
            boolSelect.append(opt);
          }
          const unguardBool = bindFocusStealGuard(boolSelect);
          rowCleanups.push(unguardBool);
          const onBoolChange = () =>
            applyEditorState(row, { valueText: boolSelect.value });
          boolSelect.addEventListener("change", onBoolChange);
          rowCleanups.push(() =>
            boolSelect.removeEventListener("change", onBoolChange),
          );
          body.append(boolSelect);
        } else {
          const valueInput = el("input", "interactive-demo-filter-value");
          valueInput.type =
            row.type === "number"
              ? "number"
              : row.type === "date"
                ? "date"
                : "text";
          valueInput.value = row.valueText;
          valueInput.placeholder = "Value";
          valueInput.setAttribute("aria-label", `${row.label} value`);
          const unguardInput = bindFocusStealGuard(valueInput);
          rowCleanups.push(unguardInput);
          const onValueInput = () =>
            applyEditorState(row, { valueText: valueInput.value });
          valueInput.addEventListener("input", onValueInput);
          rowCleanups.push(() =>
            valueInput.removeEventListener("input", onValueInput),
          );
          body.append(valueInput);
        }
      }
    }

    rowEl.append(body);
    parent.append(rowEl);

    return () => {
      for (const fn of rowCleanups) fn();
      rowEl.remove();
    };
  }

  let listCleanups: (() => void)[] = [];

  function render() {
    preservePanelFocus(root, () => {
      for (const fn of listCleanups) fn();
      listCleanups = [];

      const filterable = getFilterable();
      const editorRows = getEditorRows();
      const usedFields = new Set(editorRows.map((r) => r.field));
      const canAdd = nextAvailableFilterColumn(filterable, usedFields) !== null;

      if (titleEl) {
        titleEl.textContent = `Current filters (${editorRows.length})`;
      }

      placeholder.style.display = editorRows.length === 0 ? "" : "none";
      filterListContainer.replaceChildren();

      for (const row of editorRows) {
        listCleanups.push(
          renderFilterRow(filterListContainer, row, filterable, usedFields),
        );
      }

      addBtn.disabled = !canAdd;
      if (clearBtn) clearBtn.disabled = editorRows.length === 0;
    });
  }

  refreshCommitted();
  lastPollSignature = filterRowsSignature(committed);
  render();

  const timer = window.setInterval(() => {
    refreshCommitted();
    const signature = filterRowsSignature(committed);
    if (signature === lastPollSignature) return;
    lastPollSignature = signature;
    render();
  }, 250);

  host.append(root);

  return () => {
    window.clearInterval(timer);
    for (const fn of listCleanups) fn();
    for (const fn of cleanups) fn();
    root.remove();
  };
}
