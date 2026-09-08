import { isColumnFilterEligible } from "../../features/filters/filterColumnEligibility";
import { isColumnResizable } from "../../internal/columnSizing";
import { isInternalColumn } from "../../internal/internalColumns";
import {
  isCombinedRowControlsColumn,
  ROW_CONTROLS_DRAG_SLOT_CLASS,
  ROW_CONTROLS_HEADER_CLASS,
  ROW_CONTROLS_SELECTION_SLOT_CLASS,
} from "../../internal/rowControlColumns";
import {
  isRowDragColumn,
  ROW_DRAG_HEADER_CLASS,
} from "../../internal/rowDragColumn";
import { isSelectionColumn } from "../../internal/selectionColumn";
import type {
  ColumnDef,
  RowSelectionConfig,
} from "../../types";
import type {
  HeaderControlDescriptor,
  ResolveHeaderControls,
} from "../headerControlTypes";

const HEADER_CONTROLS_CLASS = "lfg-header-controls";
const UTILITY_COLUMN_ATTR = "data-lfg-utility-column";

function syncUtilityColumnMarker(el: HTMLDivElement, col: ColumnDef): void {
  if (!isColumnFilterEligible(col)) {
    el.setAttribute(UTILITY_COLUMN_ATTR, "");
  } else {
    el.removeAttribute(UTILITY_COLUMN_ATTR);
  }
}

interface HeaderCellChrome {
  label: HTMLElement;
  handle: HTMLElement;
  dragHandle: HTMLElement | null;
  controls: HTMLElement | null;
  selectionCheckbox: HTMLInputElement | null;
  legacyCleaned: boolean;
}

const chromeKey = Symbol("headerChrome");

interface HeaderCellWithChrome extends HTMLDivElement {
  [chromeKey]?: HeaderCellChrome;
}

function getChrome(cell: HTMLDivElement): HeaderCellChrome {
  const c = (cell as HeaderCellWithChrome)[chromeKey];
  if (c) return c;

  let label = cell.querySelector<HTMLElement>(".lfg-header-label");
  let handle = cell.querySelector<HTMLElement>(".lfg-resize-handle");
  if (!label) {
    label = document.createElement("span");
    label.className = "lfg-header-label";
    cell.appendChild(label);
  }
  if (!handle) {
    handle = document.createElement("div");
    handle.className = "lfg-resize-handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-hidden", "true");
    cell.appendChild(handle);
  }
  const chrome: HeaderCellChrome = {
    label,
    handle,
    dragHandle: cell.querySelector<HTMLElement>(".lfg-column-drag-handle"),
    controls: cell.querySelector<HTMLElement>(`.${HEADER_CONTROLS_CLASS}`),
    selectionCheckbox: cell.querySelector<HTMLInputElement>(".lfg-header-selection-checkbox"),
    legacyCleaned: false,
  };
  (cell as HeaderCellWithChrome)[chromeKey] = chrome;
  return chrome;
}

function removeHeaderSelectionCheckbox(
  el: HTMLDivElement,
  chrome: HeaderCellChrome,
): void {
  if (chrome.selectionCheckbox) {
    chrome.selectionCheckbox.remove();
    chrome.selectionCheckbox = null;
  }
  const leftover = el.querySelector<HTMLInputElement>(
    ".lfg-header-selection-checkbox",
  );
  if (leftover) leftover.remove();
}


function syncDragHandle(cell: HTMLDivElement, chrome: HeaderCellChrome, col: ColumnDef): void {
  const wantHandle = col.reorderable !== false;
  if (wantHandle) {
    if (!chrome.dragHandle) {
      chrome.dragHandle = document.createElement("div");
      chrome.dragHandle.className = "lfg-column-drag-handle";
      chrome.dragHandle.setAttribute("aria-hidden", "true");
      cell.appendChild(chrome.dragHandle);
    }
    chrome.dragHandle.setAttribute("data-col-id", col.field);
    chrome.dragHandle.style.display = "";
  } else if (chrome.dragHandle) {
    // Remove (don't just hide) so recycled slots and hover CSS cannot revive it.
    chrome.dragHandle.remove();
    chrome.dragHandle = null;
  }
}

function createControlButton(
  col: ColumnDef,
  desc: HeaderControlDescriptor,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = desc.className;
  btn.tabIndex = -1;
  btn.setAttribute("data-col-id", col.field);
  btn.setAttribute("aria-label", desc.ariaLabel);
  if (desc.ariaHaspopup) btn.setAttribute("aria-haspopup", desc.ariaHaspopup);
  if (desc.ariaExpanded) btn.setAttribute("aria-expanded", desc.ariaExpanded);
  if (desc.textContent) btn.textContent = desc.textContent;
  if (desc.disabled) {
    btn.disabled = true;
    btn.setAttribute("aria-disabled", "true");
  }
  if (desc.dataset) {
    for (const [key, value] of Object.entries(desc.dataset)) {
      btn.setAttribute(`data-${key}`, value);
    }
  }
  return btn;
}

function syncHeaderControls(
  cell: HTMLDivElement,
  chrome: HeaderCellChrome,
  col: ColumnDef,
  resolveControls?: ResolveHeaderControls,
): void {
  if (!chrome.legacyCleaned) {
    chrome.legacyCleaned = true;
    for (const el of Array.from(cell.querySelectorAll("button.lfg-column-menu-trigger"))) {
      if (!el.closest(`.${HEADER_CONTROLS_CLASS}`)) el.remove();
    }
    for (const el of Array.from(cell.querySelectorAll(".lfg-header-actions"))) {
      el.remove();
    }
  }

  const descriptors = resolveControls?.(col) ?? [];

  if (!chrome.controls) {
    chrome.controls = document.createElement("div");
    chrome.controls.className = HEADER_CONTROLS_CLASS;
    cell.appendChild(chrome.controls);
  }

  chrome.controls.replaceChildren();

  let hasActions = false;
  let hasMenu = false;

  for (const desc of descriptors) {
    chrome.controls.appendChild(createControlButton(col, desc));
    if (desc.layoutRole === "action") hasActions = true;
    if (desc.layoutRole === "menu") hasMenu = true;
  }

  if (descriptors.length === 0) {
    chrome.controls.remove();
    chrome.controls = null;
    cell.classList.remove(
      "lfg-header-has-controls",
      "lfg-header-has-actions",
      "lfg-header-has-menu",
    );
    cell.style.removeProperty("--lfg-header-control-count");
    return;
  }

  cell.classList.add("lfg-header-has-controls");
  cell.classList.toggle("lfg-header-has-actions", hasActions);
  cell.classList.toggle("lfg-header-has-menu", hasMenu);
  cell.style.setProperty("--lfg-header-control-count", String(descriptors.length));
}

/** Bind one physical header cell to a column. */
function bindHeaderCell(
  el: HTMLDivElement,
  col: ColumnDef,
  opts?: { suppressDragHandle?: boolean; resolveHeaderControls?: ResolveHeaderControls },
): void {
  el.style.display = "";
  el.setAttribute("data-col-id", col.field);
  syncUtilityColumnMarker(el, col);
  el.classList.remove(ROW_DRAG_HEADER_CLASS);
  clearRowControlsHeaderSlots(el);

  const chrome = getChrome(el);
  removeHeaderSelectionCheckbox(el, chrome);
  chrome.label.style.display = "";
  chrome.label.textContent = col.headerName ?? col.field;
  chrome.handle.setAttribute("data-col-id", col.field);
  chrome.handle.style.display = isColumnResizable(col) ? "" : "none";

  if (opts?.suppressDragHandle) {
    if (chrome.dragHandle) {
      chrome.dragHandle.remove();
      chrome.dragHandle = null;
    }
  } else {
    syncDragHandle(el, chrome, col);
  }
  syncHeaderControls(el, chrome, col, opts?.resolveHeaderControls);
}

function applyHeaderColumnSelectedClass(
  el: HTMLDivElement,
  col: ColumnDef,
  isColumnSelected?: (field: string) => boolean,
): void {
  if (isInternalColumn(col)) {
    el.classList.remove("lfg-column-selected");
    return;
  }
  el.classList.toggle(
    "lfg-column-selected",
    isColumnSelected?.(col.field) ?? false,
  );
}

function bindSelectionHeaderCell(
  el: HTMLDivElement,
  col: ColumnDef,
  rowSelection: RowSelectionConfig,
): void {
  el.style.display = "";
  el.setAttribute("data-col-id", col.field);
  syncUtilityColumnMarker(el, col);
  el.classList.remove(ROW_DRAG_HEADER_CLASS);
  clearRowControlsHeaderSlots(el);

  const chrome = getChrome(el);
  chrome.label.textContent = "";
  chrome.label.style.display = "none";
  chrome.handle.style.display = "none";
  chrome.handle.removeAttribute("data-col-id");

  if (chrome.dragHandle) {
    chrome.dragHandle.remove();
    chrome.dragHandle = null;
  }
  if (chrome.controls) {
    chrome.controls.remove();
    chrome.controls = null;
  }
  el.classList.remove(
    "lfg-header-has-controls",
    "lfg-header-has-actions",
    "lfg-header-has-menu",
  );
  el.style.removeProperty("--lfg-header-control-count");

  const wantCheckbox =
    rowSelection.headerCheckbox &&
    rowSelection.mode === "multiple" &&
    rowSelection.checkboxes;

  let input = chrome.selectionCheckbox;
  if (wantCheckbox) {
    if (!input) {
      input = document.createElement("input");
      input.type = "checkbox";
      input.className = "lfg-header-selection-checkbox";
      input.setAttribute("aria-label", "Select all rows");
      input.tabIndex = -1;
      el.appendChild(input);
    }
    input.tabIndex = -1;
  } else if (input) {
    input.remove();
    input = null;
  }
  chrome.selectionCheckbox = input;

  el.classList.remove("lfg-column-selected");
}

function bindRowDragHeaderCell(el: HTMLDivElement, col: ColumnDef): void {
  el.style.display = "";
  el.setAttribute("data-col-id", col.field);
  syncUtilityColumnMarker(el, col);
  el.classList.add(ROW_DRAG_HEADER_CLASS);
  clearRowControlsHeaderSlots(el);

  const chrome = getChrome(el);
  chrome.label.textContent = "";
  chrome.label.style.display = "none";
  chrome.handle.style.display = "none";
  chrome.handle.removeAttribute("data-col-id");

  if (chrome.dragHandle) {
    chrome.dragHandle.remove();
    chrome.dragHandle = null;
  }
  if (chrome.controls) {
    chrome.controls.remove();
    chrome.controls = null;
  }
  removeHeaderSelectionCheckbox(el, chrome);
  el.classList.remove(
    "lfg-header-has-controls",
    "lfg-header-has-actions",
    "lfg-header-has-menu",
    "lfg-column-selected",
  );
  el.style.removeProperty("--lfg-header-control-count");
}

function clearRowControlsHeaderSlots(el: HTMLDivElement): void {
  if (el.classList.contains(ROW_CONTROLS_HEADER_CLASS)) {
    el.classList.remove(ROW_CONTROLS_HEADER_CLASS);
  }
  const dragSlot = el.querySelector(`.${ROW_CONTROLS_DRAG_SLOT_CLASS}`);
  if (dragSlot) dragSlot.remove();
  const selectionSlot = el.querySelector(`.${ROW_CONTROLS_SELECTION_SLOT_CLASS}`);
  if (selectionSlot) selectionSlot.remove();
}

function bindRowControlsHeaderCell(
  el: HTMLDivElement,
  col: ColumnDef,
  rowSelection: RowSelectionConfig,
): void {
  el.style.display = "";
  el.setAttribute("data-col-id", col.field);
  syncUtilityColumnMarker(el, col);
  el.classList.remove(ROW_DRAG_HEADER_CLASS);
  el.classList.add(ROW_CONTROLS_HEADER_CLASS);

  const chrome = getChrome(el);
  chrome.label.textContent = "";
  chrome.label.style.display = "none";
  chrome.handle.style.display = "none";
  chrome.handle.removeAttribute("data-col-id");

  if (chrome.dragHandle) {
    chrome.dragHandle.remove();
    chrome.dragHandle = null;
  }
  if (chrome.controls) {
    chrome.controls.remove();
    chrome.controls = null;
  }
  el.classList.remove(
    "lfg-header-has-controls",
    "lfg-header-has-actions",
    "lfg-header-has-menu",
    "lfg-column-selected",
  );
  el.style.removeProperty("--lfg-header-control-count");

  let dragSlot = el.querySelector(
    `:scope > .${ROW_CONTROLS_DRAG_SLOT_CLASS}`,
  ) as HTMLDivElement | null;
  let selSlot = el.querySelector(
    `:scope > .${ROW_CONTROLS_SELECTION_SLOT_CLASS}`,
  ) as HTMLDivElement | null;
  if (!dragSlot || !selSlot) {
    if (chrome.selectionCheckbox) {
      chrome.selectionCheckbox.remove();
      chrome.selectionCheckbox = null;
    }
    if (dragSlot) dragSlot.remove();
    if (selSlot) selSlot.remove();
    dragSlot = el.ownerDocument.createElement("div");
    dragSlot.className = ROW_CONTROLS_DRAG_SLOT_CLASS;
    dragSlot.setAttribute("aria-hidden", "true");
    selSlot = el.ownerDocument.createElement("div");
    selSlot.className = ROW_CONTROLS_SELECTION_SLOT_CLASS;
    el.appendChild(dragSlot);
    el.appendChild(selSlot);
  }

  const wantCheckbox =
    rowSelection.headerCheckbox &&
    rowSelection.mode === "multiple" &&
    rowSelection.checkboxes;

  let input = selSlot.querySelector(
    ".lfg-header-selection-checkbox",
  ) as HTMLInputElement | null;
  if (wantCheckbox) {
    if (!input) {
      input = el.ownerDocument.createElement("input");
      input.type = "checkbox";
      input.className = "lfg-header-selection-checkbox";
      input.setAttribute("aria-label", "Select all rows");
      input.tabIndex = -1;
      selSlot.appendChild(input);
    }
    input.tabIndex = -1;
  } else if (input) {
    input.remove();
    input = null;
  }
  chrome.selectionCheckbox = input;
}

function bindHeaderCellResolved(
  el: HTMLDivElement,
  col: ColumnDef,
  rowSelection: RowSelectionConfig,
  isColumnSelected?: (field: string) => boolean,
  opts?: { suppressDragHandle?: boolean; resolveHeaderControls?: ResolveHeaderControls },
): void {
  if (isCombinedRowControlsColumn(col)) {
    bindRowControlsHeaderCell(el, col, rowSelection);
  } else if (isSelectionColumn(col)) {
    bindSelectionHeaderCell(el, col, rowSelection);
  } else if (isRowDragColumn(col)) {
    bindRowDragHeaderCell(el, col);
  } else {
    bindHeaderCell(el, col, opts);
    applyHeaderColumnSelectedClass(el, col, isColumnSelected);
  }
}

/**
 * Bind pinned header cells (left or right) in fixed physical slots.
 */
export function syncPinnedHeaderSlots(
  headerRow: HTMLDivElement,
  pinnedColumns: ColumnDef[],
  rowSelection: RowSelectionConfig,
  isColumnSelected?: (field: string) => boolean,
  side: "left" | "right" = "left",
  resolveHeaderControls?: ResolveHeaderControls,
): void {
  for (let p = 0; p < pinnedColumns.length; p++) {
    const el = headerRow.children[p] as HTMLDivElement | undefined;
    if (!el) continue;
    const col = pinnedColumns[p]!;
    bindHeaderCellResolved(el, col, rowSelection, isColumnSelected, {
      suppressDragHandle: true,
      resolveHeaderControls,
    });
    el.setAttribute("data-pinned", side);
  }
}

/**
 * Full header sync: updates ALL column slots using the horizontal ring mapping.
 */
export function syncHeaderRowSlots(
  headerRow: HTMLDivElement,
  columns: ColumnDef[],
  startIndex: number,
  columnSlotCount: number,
  toPhysicalCol: (virtualSlot: number) => number,
  rowSelection: RowSelectionConfig,
  isColumnSelected?: (field: string) => boolean,
  resolveHeaderControls?: ResolveHeaderControls,
): void {
  for (let v = 0; v < columnSlotCount; v++) {
    const p = toPhysicalCol(v);
    const el = headerRow.children[p] as HTMLDivElement | undefined;
    if (!el) continue;

    const colIndex = startIndex + v;
    if (colIndex >= columns.length) {
      el.style.display = "none";
      continue;
    }

    const col = columns[colIndex];
    if (!col) {
      el.style.display = "none";
      continue;
    }

    bindHeaderCellResolved(el, col, rowSelection, isColumnSelected, { resolveHeaderControls });
  }
}

/**
 * Partial header sync: updates only the entering column slots after a
 * horizontal ring rotation.
 */
export function syncHeaderRowSlotsPartial(
  headerRow: HTMLDivElement,
  columns: ColumnDef[],
  startCol: number,
  enteringSlots: number[],
  toPhysicalCol: (virtualSlot: number) => number,
  rowSelection: RowSelectionConfig,
  isColumnSelected?: (field: string) => boolean,
  resolveHeaderControls?: ResolveHeaderControls,
): void {
  for (const v of enteringSlots) {
    const p = toPhysicalCol(v);
    const el = headerRow.children[p] as HTMLDivElement | undefined;
    if (!el) continue;

    const colIndex = startCol + v;
    if (colIndex >= columns.length) {
      el.style.display = "none";
      continue;
    }

    const col = columns[colIndex];
    if (!col) {
      el.style.display = "none";
      continue;
    }

    bindHeaderCellResolved(el, col, rowSelection, isColumnSelected, { resolveHeaderControls });
  }
}
