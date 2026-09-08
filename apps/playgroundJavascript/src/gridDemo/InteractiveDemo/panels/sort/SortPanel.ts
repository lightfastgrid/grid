import type { SortDirection, SortModel } from "@lightfastgrid/core";

import type { InteractiveDemoPanelProps } from "../../runtime/types.ts";
import { el } from "../../shell/dom.ts";
import { preservePanelFocus } from "../../shell/preservePanelFocus.ts";
import { bindFocusStealGuard } from "../../shell/ToolbarIcons.ts";
import {
  mountPanelDivider,
  mountPanelHeader,
  mountPanelInfoFooter,
  mountPanelMenuItem,
} from "../../shell/ui/panelPrimitives.ts";

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

/**
 * Sort panel — sort model only (architecture §5.4).
 * Vanilla DOM port of React SortPanel.tsx with drag-reorder.
 */
export function mountSortPanel(
  host: HTMLElement,
  props: InteractiveDemoPanelProps,
): () => void {
  const { getGrid, onClose } = props;
  const root = el("div", "interactive-demo-panel-stack");
  const cleanups: (() => void)[] = [];

  let rows: DemoSortRow[] = [];
  let dragFrom: number | null = null;
  let lastPollSignature = "";

  function sortRowsSignature(next: readonly DemoSortRow[]): string {
    return JSON.stringify(
      next.map((row) => ({ field: row.field, sort: row.sort, label: row.label })),
    );
  }

  const headerHandle = mountPanelHeader(root, {
    title: "Sort by (0)",
    onClose,
  });
  cleanups.push(headerHandle.destroy);
  const titleEl = headerHandle.root.querySelector(
    ".interactive-demo-panel-heading-title",
  );

  const placeholderStack = el(
    "div",
    "interactive-demo-panel-placeholder-stack",
  );
  const placeholderText = el(
    "p",
    "interactive-demo-panel-placeholder",
    "No active sorts. Use + Add sort, or apply the Status → Balance example. Header Shift+click also appends multi-sort.",
  );
  const exampleBtn = el("button", "interactive-demo-sort-add", "Apply Status → Balance");
  exampleBtn.type = "button";
  const unguardExample = bindFocusStealGuard(exampleBtn);
  cleanups.push(unguardExample);
  const onExample = () => {
    applyDemoMultiSortExample(getGrid);
    refresh();
    render();
  };
  exampleBtn.addEventListener("click", onExample);
  cleanups.push(() => exampleBtn.removeEventListener("click", onExample));
  placeholderStack.append(placeholderText, exampleBtn);
  root.append(placeholderStack);

  const sortListContainer = el("div", "interactive-demo-sort-list");
  root.append(sortListContainer);

  const addBtn = el("button", "interactive-demo-sort-add");
  addBtn.type = "button";
  const addPlus = el("span", undefined, "+");
  addPlus.setAttribute("aria-hidden", "true");
  addBtn.append(addPlus, document.createTextNode(" Add sort"));
  const unguardAdd = bindFocusStealGuard(addBtn);
  cleanups.push(unguardAdd);
  const onAdd = () => {
    const liveModel = currentModel();
    const used = new Set(liveModel.map((e) => e.field));
    const next = suggestNextSortColumn(getGrid, used);
    if (!next) return;
    write(withAddedSort(liveModel, next.field, "asc"));
  };
  addBtn.addEventListener("click", onAdd);
  cleanups.push(() => addBtn.removeEventListener("click", onAdd));
  root.append(addBtn);

  mountPanelDivider(root);

  const menuContainer = el("div", "interactive-demo-panel-menu");
  root.append(menuContainer);

  const clearCleanup = mountPanelMenuItem(menuContainer, {
    label: "Clear sorting",
    disabled: true,
    onClick: () => {
      clearDemoSort(getGrid);
      refresh();
      lastPollSignature = sortRowsSignature(rows);
      render();
    },
  });
  cleanups.push(clearCleanup);
  const clearBtn = menuContainer.querySelector<HTMLButtonElement>(
    ".interactive-demo-panel-menu-item",
  );

  mountPanelInfoFooter(
    root,
    "Priority is top to bottom. Secondary sorts only change order when higher-priority values are equal (e.g. Status, then Balance). Badge count should match the rows above.",
  );

  function refresh() {
    rows = readDemoSortRows(getGrid);
  }

  function currentModel(): SortModel {
    return getGrid()?.getSortModel().map((e) => ({ ...e })) ?? [];
  }

  function write(model: SortModel) {
    writeDemoSortModel(getGrid, model);
    refresh();
    lastPollSignature = sortRowsSignature(rows);
    render();
  }

  let listCleanups: (() => void)[] = [];

  function render() {
    preservePanelFocus(root, () => {
      for (const fn of listCleanups) fn();
      listCleanups = [];

      const sortable = listSortableColumns(getGrid);
      const modelFields = new Set(currentModel().map((e) => e.field));
      const canAdd = suggestNextSortColumn(getGrid, modelFields) !== null;

      if (titleEl) {
        titleEl.textContent = `Sort by (${rows.length})`;
      }

      placeholderStack.style.display = rows.length === 0 ? "" : "none";
      sortListContainer.style.display = rows.length === 0 ? "none" : "";
      sortListContainer.replaceChildren();

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]!;
        const rowCleanups: (() => void)[] = [];

        const rowEl = el("div", "interactive-demo-sort-row");
        if (dragFrom === index) rowEl.classList.add("is-dragging");

        const dragBtn = el("button", "interactive-demo-sort-drag");
        dragBtn.type = "button";
        dragBtn.draggable = true;
        dragBtn.setAttribute(
          "aria-label",
          `Reorder ${row.label} sort priority`,
        );
        dragBtn.title = "Drag to change priority";
        dragBtn.textContent = "⠿";
        const onDragStart = (event: DragEvent) => {
          dragFrom = index;
          event.dataTransfer!.effectAllowed = "move";
          event.dataTransfer!.setData("text/plain", String(index));
        };
        const onDragEnd = () => {
          dragFrom = null;
        };
        dragBtn.addEventListener("dragstart", onDragStart);
        dragBtn.addEventListener("dragend", onDragEnd);
        rowCleanups.push(
          () => dragBtn.removeEventListener("dragstart", onDragStart),
          () => dragBtn.removeEventListener("dragend", onDragEnd),
        );
        rowEl.append(dragBtn);

        const indexBadge = el("span", "interactive-demo-sort-index");
        indexBadge.setAttribute("aria-hidden", "true");
        indexBadge.textContent = String(index + 1);
        rowEl.append(indexBadge);

        const fieldSelect = el("select", "interactive-demo-sort-select");
        fieldSelect.setAttribute("aria-label", `Sort column ${index + 1}`);

        const fieldOptionsFor = () => {
          if (sortable.some((c) => c.field === row.field)) return sortable;
          return [
            { field: row.field, label: row.label },
            ...sortable,
          ];
        };

        for (const col of fieldOptionsFor()) {
          const opt = el("option", undefined, col.label);
          opt.value = col.field;
          if (col.field === row.field) opt.selected = true;
          if (col.field !== row.field && modelFields.has(col.field))
            opt.disabled = true;
          fieldSelect.append(opt);
        }
        const unguardFieldSel = bindFocusStealGuard(fieldSelect);
        rowCleanups.push(unguardFieldSel);
        const onFieldChange = () =>
          write(withSortFieldAt(currentModel(), index, fieldSelect.value));
        fieldSelect.addEventListener("change", onFieldChange);
        rowCleanups.push(() =>
          fieldSelect.removeEventListener("change", onFieldChange),
        );
        rowEl.append(fieldSelect);

        const dirSelect = el(
          "select",
          "interactive-demo-sort-select interactive-demo-sort-dir",
        );
        dirSelect.setAttribute("aria-label", `${row.label} direction`);
        for (const [val, lab] of [
          ["asc", "Asc"],
          ["desc", "Desc"],
        ] as const) {
          const opt = el("option", undefined, lab);
          opt.value = val;
          if (val === row.sort) opt.selected = true;
          dirSelect.append(opt);
        }
        const unguardDirSel = bindFocusStealGuard(dirSelect);
        rowCleanups.push(unguardDirSel);
        const onDirChange = () =>
          write(
            withSortDirectionAt(
              currentModel(),
              index,
              dirSelect.value as SortDirection,
            ),
          );
        dirSelect.addEventListener("change", onDirChange);
        rowCleanups.push(() =>
          dirSelect.removeEventListener("change", onDirChange),
        );
        rowEl.append(dirSelect);

        const removeBtn = el("button", "interactive-demo-sort-remove", "×");
        removeBtn.type = "button";
        removeBtn.setAttribute("aria-label", `Remove ${row.label} sort`);
        const unguardRemoveBtn = bindFocusStealGuard(removeBtn);
        rowCleanups.push(unguardRemoveBtn);
        const onRemove = () => write(withoutSortAt(currentModel(), index));
        removeBtn.addEventListener("click", onRemove);
        rowCleanups.push(() =>
          removeBtn.removeEventListener("click", onRemove),
        );
        rowEl.append(removeBtn);

        const onDragOver = (event: DragEvent) => {
          if (dragFrom === null || dragFrom === index) return;
          event.preventDefault();
          event.dataTransfer!.dropEffect = "move";
        };
        const onDrop = (event: DragEvent) => {
          event.preventDefault();
          if (dragFrom === null || dragFrom === index) return;
          write(moveSortModelEntry(currentModel(), dragFrom, index));
          dragFrom = null;
        };
        rowEl.addEventListener("dragover", onDragOver);
        rowEl.addEventListener("drop", onDrop);
        rowCleanups.push(
          () => rowEl.removeEventListener("dragover", onDragOver),
          () => rowEl.removeEventListener("drop", onDrop),
        );

        sortListContainer.append(rowEl);
        listCleanups.push(() => {
          for (const fn of rowCleanups) fn();
          rowEl.remove();
        });
      }

      addBtn.disabled = !canAdd;
      if (clearBtn) clearBtn.disabled = rows.length === 0;
    });
  }

  refresh();
  lastPollSignature = sortRowsSignature(rows);
  render();

  const timer = window.setInterval(() => {
    refresh();
    const signature = sortRowsSignature(rows);
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
