import type { SortDirection, SortModel } from "@lightfastgrid/core";
import { useEffect, useState } from "react";

import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { PanelDivider } from "../../shell/ui/PanelDivider.tsx";
import { PanelHeader } from "../../shell/ui/PanelHeader.tsx";
import { PanelInfoFooter } from "../../shell/ui/PanelInfoFooter.tsx";
import { PanelMenuItem } from "../../shell/ui/PanelMenuItem.tsx";

import {
  applyDemoMultiSortExample,
  clearDemoSort,
  listSortableColumns,
  readDemoSortRows,
  suggestNextSortColumn,
  writeDemoSortModel,
} from "./commands/sortPanelActions.ts";
import {
  type DemoSortRow,
  moveSortModelEntry,
  withAddedSort,
  withoutSortAt,
  withSortDirectionAt,
  withSortFieldAt,
} from "./commands/sortPanelModel.ts";
import { IconClearSort, IconSortDrag } from "./sortPanelIcons.tsx";

/**
 * Sort panel — sort model only (architecture §5.4).
 * Row order is sort priority; drag-reorder writes a reordered `setSortModel`.
 */
export function SortPanel({ getGrid, onClose }: InteractiveDemoPanelProps) {
  const [rows, setRows] = useState<DemoSortRow[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setRows(readDemoSortRows(getGrid));
    sync();
    const timer = window.setInterval(sync, 250);
    return () => window.clearInterval(timer);
  }, [getGrid]);

  const refresh = () => setRows(readDemoSortRows(getGrid));

  const currentModel = (): SortModel =>
    getGrid()?.getSortModel().map((entry) => ({ ...entry })) ?? [];

  const write = (model: SortModel) => {
    writeDemoSortModel(getGrid, model);
    refresh();
  };

  const sortable = listSortableColumns(getGrid);
  const modelFields = new Set(currentModel().map((entry) => entry.field));
  const canAdd = suggestNextSortColumn(getGrid, modelFields) !== null;

  const fieldOptionsFor = (row: DemoSortRow) => {
    if (sortable.some((column) => column.field === row.field)) return sortable;
    return [
      { field: row.field, label: row.label },
      ...sortable,
    ];
  };

  const addSort = () => {
    const liveModel = currentModel();
    const used = new Set(liveModel.map((entry) => entry.field));
    const next = suggestNextSortColumn(getGrid, used);
    if (!next) return;
    write(withAddedSort(liveModel, next.field, "asc"));
  };

  return (
    <div className="interactive-demo-panel-stack">
      <PanelHeader title={`Sort by (${rows.length})`} onClose={onClose} />

      {rows.length === 0 ? (
        <div className="interactive-demo-panel-placeholder-stack">
          <p className="interactive-demo-panel-placeholder">
            No active sorts. Use + Add sort, or apply the Status → Balance
            example. Header Shift+click also appends multi-sort.
          </p>
          <button
            type="button"
            className="interactive-demo-sort-add"
            onClick={() => {
              applyDemoMultiSortExample(getGrid);
              refresh();
            }}
          >
            Apply Status → Balance
          </button>
        </div>
      ) : (
        <div className="interactive-demo-sort-list">
          {rows.map((row, index) => (
            <div
              key={`${row.field}:${index}`}
              className={`interactive-demo-sort-row${
                dragFrom === index ? " is-dragging" : ""
              }`}
              onDragOver={(event) => {
                if (dragFrom === null || dragFrom === index) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFrom === null || dragFrom === index) return;
                write(moveSortModelEntry(currentModel(), dragFrom, index));
                setDragFrom(null);
              }}
            >
              <button
                type="button"
                className="interactive-demo-sort-drag"
                draggable
                aria-label={`Reorder ${row.label} sort priority`}
                title="Drag to change priority"
                onDragStart={(event) => {
                  setDragFrom(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(index));
                }}
                onDragEnd={() => setDragFrom(null)}
              >
                <IconSortDrag />
              </button>

              <span className="interactive-demo-sort-index" aria-hidden="true">
                {index + 1}
              </span>

              <select
                className="interactive-demo-sort-select"
                aria-label={`Sort column ${index + 1}`}
                value={row.field}
                onChange={(event) => {
                  write(
                    withSortFieldAt(currentModel(), index, event.target.value),
                  );
                }}
              >
                {fieldOptionsFor(row).map((column) => (
                  <option
                    key={column.field}
                    value={column.field}
                    disabled={
                      column.field !== row.field &&
                      modelFields.has(column.field)
                    }
                  >
                    {column.label}
                  </option>
                ))}
              </select>

              <select
                className="interactive-demo-sort-select interactive-demo-sort-dir"
                aria-label={`${row.label} direction`}
                value={row.sort}
                onChange={(event) => {
                  write(
                    withSortDirectionAt(
                      currentModel(),
                      index,
                      event.target.value as SortDirection,
                    ),
                  );
                }}
              >
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </select>

              <button
                type="button"
                className="interactive-demo-sort-remove"
                aria-label={`Remove ${row.label} sort`}
                onClick={() => write(withoutSortAt(currentModel(), index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="interactive-demo-sort-add"
        disabled={!canAdd}
        onClick={addSort}
      >
        <span aria-hidden="true">+</span>
        Add sort
      </button>

      <PanelDivider />

      <div className="interactive-demo-panel-menu">
        <PanelMenuItem
          icon={<IconClearSort />}
          title="Clear sorting"
          disabled={rows.length === 0}
          onClick={() => {
            clearDemoSort(getGrid);
            refresh();
          }}
        />
      </div>

      <PanelInfoFooter>
        Priority is top to bottom. Secondary sorts only change order when
        higher-priority values are equal (e.g. Status, then Balance). Badge
        count should match the rows above.
      </PanelInfoFooter>
    </div>
  );
}
