import { useEffect, useId, useMemo, useState } from "react";

import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { PanelInfoFooter } from "../../shell/ui/PanelInfoFooter.tsx";
import { PanelMenuItem } from "../../shell/ui/PanelMenuItem.tsx";
import { PanelSearchField } from "../../shell/ui/PanelSearchField.tsx";

import {
  autoSizeVisibleDemoColumns,
  clearAllDemoColumnPinning,
  fitDemoColumnsToGrid,
  hideSelectedDemoColumns,
  resetDemoColumnWidths,
  showAllDemoColumns,
} from "./commands/columnBulkActions.ts";
import {
  type DemoColumnListSnapshot,
  type DemoColumnPin,
  filterDemoColumns,
} from "./commands/listDemoColumns.ts";
import { readDemoColumnSnapshot } from "./commands/readDemoColumnSnapshot.ts";
import { setDemoColumnPin } from "./commands/setDemoColumnPin.ts";
import { setDemoColumnVisible } from "./commands/setDemoColumnVisible.ts";
import {
  IconAutoSizeColumns,
  IconClearPinning,
  IconFitColumns,
  IconHideSelectedColumns,
  IconResetColumnWidths,
  IconShowAllColumns,
} from "./columnPanelIcons.tsx";

const EMPTY_SNAPSHOT: DemoColumnListSnapshot = {
  columns: [],
  hiddenCount: 0,
  totalCount: 0,
  selectedColumnIds: [],
};

/**
 * Columns panel — visibility / pin / sizing only (architecture §5.2).
 * Isolated: must not import sibling panels.
 */
export function ColumnsPanel({ getGrid }: InteractiveDemoPanelProps) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<DemoColumnListSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    const sync = () => setSnapshot(readDemoColumnSnapshot(getGrid));
    sync();
    const timer = window.setInterval(sync, 250);
    return () => window.clearInterval(timer);
  }, [getGrid]);

  const visibleRows = useMemo(
    () => filterDemoColumns(snapshot.columns, query),
    [snapshot.columns, query],
  );

  const hasColumnSelection = snapshot.selectedColumnIds.length > 0;

  const onPinChange = (field: string, value: string) => {
    const pinned: DemoColumnPin =
      value === "left" ? "left" : value === "right" ? "right" : false;
    setDemoColumnPin(getGrid, field, pinned);
    setSnapshot(readDemoColumnSnapshot(getGrid));
  };

  return (
    <div className="interactive-demo-panel-stack">
      <PanelSearchField
        id={searchId}
        value={query}
        placeholder="Search columns..."
        onChange={setQuery}
      />

      <div className="interactive-demo-column-list" role="list">
        {visibleRows.length === 0 ? (
          <p className="interactive-demo-panel-placeholder">No columns match.</p>
        ) : (
          visibleRows.map((column) => (
            <div
              key={column.field}
              className="interactive-demo-column-row"
              role="listitem"
            >
              <label className="interactive-demo-column-check">
                <input
                  type="checkbox"
                  checked={column.visible}
                  onChange={(event) => {
                    setDemoColumnVisible(getGrid, column.field, event.target.checked);
                    setSnapshot(readDemoColumnSnapshot(getGrid));
                  }}
                />
                <span className="interactive-demo-column-label">{column.label}</span>
              </label>

              <select
                className="interactive-demo-column-pin"
                aria-label={`Pin ${column.label}`}
                title={
                  column.pinnable
                    ? undefined
                    : "This column is locked and cannot change pin position"
                }
                value={
                  column.pinned === "left"
                    ? "left"
                    : column.pinned === "right"
                      ? "right"
                      : "none"
                }
                disabled={!column.pinnable}
                onChange={(event) => onPinChange(column.field, event.target.value)}
              >
                <option value="left">Left</option>
                <option value="none">None</option>
                <option value="right">Right</option>
              </select>
            </div>
          ))
        )}
      </div>

      <p className="interactive-demo-column-summary">
        {snapshot.hiddenCount} of {snapshot.totalCount} columns hidden
      </p>

      <div className="interactive-demo-panel-menu">
        <PanelMenuItem
          icon={<IconShowAllColumns />}
          title="Show all columns"
          onClick={() => {
            showAllDemoColumns(getGrid);
            setSnapshot(readDemoColumnSnapshot(getGrid));
          }}
        />
        <PanelMenuItem
          icon={<IconHideSelectedColumns />}
          title="Hide selected columns"
          hint={hasColumnSelection ? undefined : "Select columns to hide"}
          disabled={!hasColumnSelection}
          onClick={() => {
            hideSelectedDemoColumns(getGrid);
            setSnapshot(readDemoColumnSnapshot(getGrid));
          }}
        />
        <PanelMenuItem
          icon={<IconAutoSizeColumns />}
          title="Auto-size visible columns"
          onClick={() => autoSizeVisibleDemoColumns(getGrid)}
        />
        <PanelMenuItem
          icon={<IconFitColumns />}
          title="Fit columns to grid"
          onClick={() => fitDemoColumnsToGrid(getGrid)}
        />
        <PanelMenuItem
          icon={<IconResetColumnWidths />}
          title="Reset column widths"
          onClick={() => resetDemoColumnWidths(getGrid)}
        />
        <PanelMenuItem
          icon={<IconClearPinning />}
          title="Clear all pinning"
          onClick={() => {
            clearAllDemoColumnPinning(getGrid);
            setSnapshot(readDemoColumnSnapshot(getGrid));
          }}
        />
      </div>

      <PanelInfoFooter>
        Pinning keeps columns visible while scrolling. Use Left / None / Right to
        control position.
      </PanelInfoFooter>
    </div>
  );
}
