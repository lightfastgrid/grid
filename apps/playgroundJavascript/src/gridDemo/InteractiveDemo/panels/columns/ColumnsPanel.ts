import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import { preservePanelFocus } from "../../shell/preservePanelFocus.ts";
import { bindFocusStealGuard } from "../../shell/ToolbarIcons.ts";
import {
  mountPanelInfoFooter,
  mountPanelMenuItem,
  mountPanelSearchField,
} from "../../shell/ui/panelPrimitives.ts";

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

const EMPTY_SNAPSHOT: DemoColumnListSnapshot = {
  columns: [],
  hiddenCount: 0,
  totalCount: 0,
  selectedColumnIds: [],
};

function columnSnapshotSignature(snapshot: DemoColumnListSnapshot): string {
  return JSON.stringify({
    hiddenCount: snapshot.hiddenCount,
    totalCount: snapshot.totalCount,
    selectedColumnIds: snapshot.selectedColumnIds,
    columns: snapshot.columns.map((column) => ({
      field: column.field,
      visible: column.visible,
      pinned: column.pinned,
      pinnable: column.pinnable,
    })),
  });
}

/**
 * Columns panel — visibility / pin / sizing only (architecture §5.2).
 * Vanilla DOM port of React ColumnsPanel.tsx.
 */
export function mountColumnsPanel(
  host: HTMLElement,
  props: InteractiveDemoPanelProps,
): () => void {
  const { getGrid } = props;
  const root = el("div", "interactive-demo-panel-stack");
  const cleanups: (() => void)[] = [];
  let listCleanups: (() => void)[] = [];
  let menuCleanups: (() => void)[] = [];

  let query = "";
  let snapshot: DemoColumnListSnapshot = EMPTY_SNAPSHOT;
  let lastPollSignature = "";

  const searchHandle = mountPanelSearchField(root, {
    value: "",
    placeholder: "Search columns...",
    ariaLabel: "Search columns",
    onChange: (value) => {
      query = value;
      renderList();
    },
  });
  cleanups.push(searchHandle.destroy);

  const listContainer = el("div", "interactive-demo-column-list");
  listContainer.setAttribute("role", "list");
  root.append(listContainer);

  const summaryEl = el("p", "interactive-demo-column-summary");
  root.append(summaryEl);

  const menuContainer = el("div", "interactive-demo-panel-menu");
  root.append(menuContainer);

  function refreshSnapshot() {
    snapshot = readDemoColumnSnapshot(getGrid);
  }

  function renderList() {
    preservePanelFocus(root, () => {
      for (const fn of listCleanups) fn();
      listCleanups = [];
      listContainer.replaceChildren();

      const visible = filterDemoColumns(snapshot.columns, query);
      if (visible.length === 0) {
        listContainer.append(
          el(
            "p",
            "interactive-demo-panel-placeholder",
            "No columns match.",
          ),
        );
        return;
      }

      for (const column of visible) {
        const row = el("div", "interactive-demo-column-row");
        row.setAttribute("role", "listitem");

        const label = el("label", "interactive-demo-column-check");
        const checkbox = el("input");
        checkbox.type = "checkbox";
        checkbox.checked = column.visible;
        checkbox.setAttribute("aria-label", `Show ${column.label}`);
        const unguard = bindFocusStealGuard(checkbox);
        const onChange = () => {
          setDemoColumnVisible(getGrid, column.field, checkbox.checked);
          refreshSnapshot();
          lastPollSignature = columnSnapshotSignature(snapshot);
          renderList();
          renderMenu();
          renderSummary();
        };
        checkbox.addEventListener("change", onChange);
        listCleanups.push(
          unguard,
          () => checkbox.removeEventListener("change", onChange),
        );

        const labelText = el(
          "span",
          "interactive-demo-column-label",
          column.label,
        );
        label.append(checkbox, labelText);

        const select = el("select", "interactive-demo-column-pin");
        select.setAttribute("aria-label", `Pin ${column.label}`);
        if (!column.pinnable) {
          select.title =
            "This column is locked and cannot change pin position";
          select.disabled = true;
        }
        const pinValue =
          column.pinned === "left"
            ? "left"
            : column.pinned === "right"
              ? "right"
              : "none";
        for (const [val, lab] of [
          ["left", "Left"],
          ["none", "None"],
          ["right", "Right"],
        ] as const) {
          const opt = el("option", undefined, lab);
          opt.value = val;
          if (val === pinValue) opt.selected = true;
          select.append(opt);
        }
        const unguardSelect = bindFocusStealGuard(select);
        const onPinChange = () => {
          const pinned: DemoColumnPin =
            select.value === "left"
              ? "left"
              : select.value === "right"
                ? "right"
                : false;
          setDemoColumnPin(getGrid, column.field, pinned);
          refreshSnapshot();
          lastPollSignature = columnSnapshotSignature(snapshot);
          renderList();
          renderSummary();
        };
        select.addEventListener("change", onPinChange);
        listCleanups.push(
          unguardSelect,
          () => select.removeEventListener("change", onPinChange),
        );

        row.append(label, select);
        listContainer.append(row);
      }
    });
  }

  function renderSummary() {
    summaryEl.textContent = `${snapshot.hiddenCount} of ${snapshot.totalCount} columns hidden`;
  }

  function renderMenu() {
    for (const fn of menuCleanups) fn();
    menuCleanups = [];
    menuContainer.replaceChildren();
    const hasColumnSelection = snapshot.selectedColumnIds.length > 0;

    menuCleanups.push(
      mountPanelMenuItem(menuContainer, {
        label: "Show all columns",
        onClick: () => {
          showAllDemoColumns(getGrid);
          refreshSnapshot();
          lastPollSignature = columnSnapshotSignature(snapshot);
          renderList();
          renderSummary();
          renderMenu();
        },
      }),
      mountPanelMenuItem(menuContainer, {
        label: "Hide selected columns",
        hint: hasColumnSelection ? undefined : "Select columns to hide",
        disabled: !hasColumnSelection,
        onClick: () => {
          hideSelectedDemoColumns(getGrid);
          refreshSnapshot();
          lastPollSignature = columnSnapshotSignature(snapshot);
          renderList();
          renderSummary();
          renderMenu();
        },
      }),
      mountPanelMenuItem(menuContainer, {
        label: "Auto-size visible columns",
        onClick: () => autoSizeVisibleDemoColumns(getGrid),
      }),
      mountPanelMenuItem(menuContainer, {
        label: "Fit columns to grid",
        onClick: () => fitDemoColumnsToGrid(getGrid),
      }),
      mountPanelMenuItem(menuContainer, {
        label: "Reset column widths",
        onClick: () => resetDemoColumnWidths(getGrid),
      }),
      mountPanelMenuItem(menuContainer, {
        label: "Clear all pinning",
        onClick: () => {
          clearAllDemoColumnPinning(getGrid);
          refreshSnapshot();
          lastPollSignature = columnSnapshotSignature(snapshot);
          renderList();
          renderSummary();
        },
      }),
    );
  }

  refreshSnapshot();
  lastPollSignature = columnSnapshotSignature(snapshot);
  renderList();
  renderSummary();
  renderMenu();

  mountPanelInfoFooter(
    root,
    "Pinning keeps columns visible while scrolling. Use Left / None / Right to control position.",
  );

  const timer = window.setInterval(() => {
    refreshSnapshot();
    const signature = columnSnapshotSignature(snapshot);
    if (signature === lastPollSignature) return;
    lastPollSignature = signature;
    renderList();
    renderSummary();
    renderMenu();
  }, 250);

  host.append(root);

  return () => {
    window.clearInterval(timer);
    for (const fn of listCleanups) fn();
    for (const fn of menuCleanups) fn();
    for (const fn of cleanups) fn();
    root.remove();
  };
}
