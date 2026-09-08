import type { ColumnFilterOperator } from "@lightfastgrid/core";
import { useEffect, useId, useRef, useState } from "react";

import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { PanelDivider } from "../../shell/ui/PanelDivider.tsx";
import { PanelHeader } from "../../shell/ui/PanelHeader.tsx";
import { PanelInfoFooter } from "../../shell/ui/PanelInfoFooter.tsx";
import { PanelMenuItem } from "../../shell/ui/PanelMenuItem.tsx";
import { PanelToggleRow } from "../../shell/ui/PanelToggleRow.tsx";

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
import {
  IconClearFilters,
  IconFilterDrag,
  IconFloatingFilters,
} from "./filterPanelIcons.tsx";

export type FiltersPanelProps = InteractiveDemoPanelProps & {
  floatingFiltersEnabled?: boolean;
  onFloatingFiltersChange?: (enabled: boolean) => void;
};

/**
 * Filters panel — filter model + floating filters only (architecture §5.3).
 * Add filter creates a local draft; the grid only stores valid models.
 * Drag handles are visual-only in V1.
 */
export function FiltersPanel({
  getGrid,
  onClose,
  onStatus,
  floatingFiltersEnabled = true,
  onFloatingFiltersChange,
}: FiltersPanelProps) {
  const draftIdPrefix = useId();
  const draftSeqRef = useRef(0);
  const [committed, setCommitted] = useState<DemoFilterRow[]>([]);
  const [drafts, setDrafts] = useState<DemoFilterDraft[]>([]);

  useEffect(() => {
    const sync = () => setCommitted(readDemoFilterRows(getGrid));
    sync();
    const timer = window.setInterval(sync, 250);
    return () => window.clearInterval(timer);
  }, [getGrid]);

  const filterable = listFilterableColumns(getGrid);
  const editorRows = mergeFilterEditorRows({
    committed,
    drafts,
    columns: filterable,
  });
  const usedFields = new Set(editorRows.map((row) => row.field));
  const canAdd = nextAvailableFilterColumn(filterable, usedFields) !== null;

  const refreshCommitted = () => setCommitted(readDemoFilterRows(getGrid));

  const nextDraftId = () => {
    const id = `${draftIdPrefix}-${draftSeqRef.current}`;
    draftSeqRef.current += 1;
    return id;
  };

  const applyEditorState = (
    row: DemoFilterEditorRow,
    next: {
      field?: string;
      operator?: ColumnFilterOperator;
      valueText?: string;
      chips?: string[];
      kind?: DemoFilterEditorRow["kind"];
    },
  ) => {
    const field = next.field ?? row.field;
    const column = filterable.find((entry) => entry.field === field);
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

    if (model) {
      writeDemoColumnFilter(getGrid, field, model);
      // Keep a draft mirror while typing so the row identity stays stable
      // (grid commits are valid, but remounting draft→committed stole focus).
      const draft: DemoFilterDraft = {
        id: row.draftId ?? nextDraftId(),
        field,
        kind,
        operator,
        valueText,
        chips,
      };
      setDrafts((current) => {
        const without = current.filter(
          (entry) => entry.id !== draft.id && entry.field !== field,
        );
        return [...without, draft];
      });
      refreshCommitted();
      return;
    }

    clearDemoColumnFilter(getGrid, field);
    const draft: DemoFilterDraft = {
      id: row.draftId ?? nextDraftId(),
      field,
      kind,
      operator,
      valueText,
      chips,
    };
    setDrafts((current) => {
      const without = current.filter(
        (entry) => entry.id !== draft.id && entry.field !== field,
      );
      if (row.draftId && row.draftId !== draft.id) {
        return [...without.filter((entry) => entry.id !== row.draftId), draft];
      }
      return [...without, draft];
    });
    refreshCommitted();
  };

  const removeRow = (row: DemoFilterEditorRow) => {
    if (row.draftId) {
      setDrafts((current) =>
        current.filter((draft) => draft.id !== row.draftId),
      );
      return;
    }
    clearDemoColumnFilter(getGrid, row.field);
    refreshCommitted();
  };

  const addFilter = () => {
    const column = nextAvailableFilterColumn(filterable, usedFields);
    if (!column) return;
    setDrafts((current) => [
      ...current,
      createDemoFilterDraft(column, nextDraftId()),
    ]);
  };

  return (
    <div className="interactive-demo-panel-stack">
      <PanelHeader
        title={`Current filters (${editorRows.length})`}
        onClose={onClose}
      />

      {editorRows.length === 0 ? (
        <p className="interactive-demo-panel-placeholder">
          No active filters. Add one below or use floating filters.
        </p>
      ) : (
        <div className="interactive-demo-filter-list">
          {editorRows.map((row) => (
            <FilterEditorRowView
              // Stable by field so draft → commit does not remount the value input.
              key={row.field}
              row={row}
              filterable={filterable}
              usedFields={usedFields}
              onChange={(next) => applyEditorState(row, next)}
              onRemove={() => removeRow(row)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="interactive-demo-filter-add"
        disabled={!canAdd}
        onClick={addFilter}
      >
        <span aria-hidden="true">+</span>
        Add filter
      </button>

      <PanelDivider />

      <div className="interactive-demo-panel-menu">
        <PanelMenuItem
          icon={<IconClearFilters />}
          title="Clear all filters"
          disabled={editorRows.length === 0}
          onClick={() => {
            setDrafts([]);
            clearAllDemoFilters(getGrid);
            refreshCommitted();
            onStatus?.("Filters cleared");
          }}
        />
        <PanelToggleRow
          label="Floating filters"
          icon={<IconFloatingFilters />}
          checked={floatingFiltersEnabled}
          onChange={(enabled) => onFloatingFiltersChange?.(enabled)}
        />
      </div>

      <PanelInfoFooter>
        Filters are combined using AND logic. All conditions must match.
      </PanelInfoFooter>
    </div>
  );
}

function FilterEditorRowView({
  row,
  filterable,
  usedFields,
  onChange,
  onRemove,
}: {
  row: DemoFilterEditorRow;
  filterable: DemoFilterableColumn[];
  usedFields: ReadonlySet<string>;
  onChange: (next: {
    field?: string;
    operator?: ColumnFilterOperator;
    valueText?: string;
    chips?: string[];
    kind?: DemoFilterEditorRow["kind"];
  }) => void;
  onRemove: () => void;
}) {
  const showOperator = row.kind === "condition" && row.operator !== null;
  const needsValue =
    row.kind === "condition" &&
    row.operator !== null &&
    operatorNeedsValue(row.operator);

  return (
    <div className="interactive-demo-filter-row">
      <span
        className="interactive-demo-filter-drag"
        aria-hidden="true"
        title="Reorder not available yet"
      >
        <IconFilterDrag />
      </span>

      <div className="interactive-demo-filter-body">
        <div className="interactive-demo-filter-top">
          <select
            className="interactive-demo-filter-select"
            aria-label="Filter column"
            value={row.field}
            onChange={(event) => onChange({ field: event.target.value })}
          >
            {filterable.map((column) => (
              <option
                key={column.field}
                value={column.field}
                disabled={
                  column.field !== row.field && usedFields.has(column.field)
                }
              >
                {column.label}
              </option>
            ))}
          </select>

          {showOperator ? (
            <select
              className="interactive-demo-filter-select interactive-demo-filter-op"
              aria-label="Filter operator"
              value={row.operator ?? undefined}
              onChange={(event) =>
                onChange({
                  operator: event.target.value as ColumnFilterOperator,
                })
              }
            >
              {operatorsForFilterType(row.type).map((operator) => (
                <option key={operator} value={operator}>
                  {operatorLabel(operator)}
                </option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            className="interactive-demo-filter-remove"
            aria-label={`Remove ${row.label} filter`}
            onClick={onRemove}
          >
            ×
          </button>
        </div>

        {row.kind === "selection" ? (
          <div className="interactive-demo-filter-selection">
            {row.chips.length > 0 ? (
              <div className="interactive-demo-filter-chips">
                {row.chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="interactive-demo-filter-chip"
                    onClick={() =>
                      onChange({
                        chips: row.chips.filter((value) => value !== chip),
                      })
                    }
                  >
                    {chip}
                    <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            ) : null}
            <select
              className="interactive-demo-filter-select interactive-demo-filter-value-select"
              aria-label={`${row.label} value`}
              value=""
              onChange={(event) => {
                const value = event.target.value;
                if (!value || row.chips.includes(value)) return;
                onChange({ chips: [...row.chips, value] });
              }}
            >
              <option value="" disabled>
                {row.chips.length === 0 ? "Select value…" : "Add value…"}
              </option>
              {row.selectOptions
                .filter((option) => !row.chips.includes(option))
                .map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
            </select>
          </div>
        ) : needsValue ? (
          row.type === "boolean" ? (
            <select
              className="interactive-demo-filter-select interactive-demo-filter-value-select"
              aria-label={`${row.label} value`}
              value={row.valueText}
              onChange={(event) => onChange({ valueText: event.target.value })}
            >
              <option value="" disabled>
                Select value…
              </option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              className="interactive-demo-filter-value"
              type={
                row.type === "number"
                  ? "number"
                  : row.type === "date"
                    ? "date"
                    : "text"
              }
              value={row.valueText}
              placeholder="Value"
              onChange={(event) => onChange({ valueText: event.target.value })}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
