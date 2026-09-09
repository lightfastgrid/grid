import { bindCellShell, cellShellDependsOnlyOnOwnField, clearCellShell, normalizeCellShell } from "../../features/cell-shells";
import {
  ACTION_CELL_CLASS,
  ACTION_TRIGGER_CLASS,
  isActionColumn,
  syncRowActionTriggerPopupSemantics,
} from "../../features/row-actions/rowActionDom";
import {
  isCombinedRowControlsColumn,
  isInternalColumn,
  isSelectionColumn,
  isSelectionHostColumn,
} from "../../internal/internalColumns";
import {
  ROW_CONTROLS_CELL_CLASS,
  ROW_CONTROLS_DRAG_SLOT_CLASS,
  ROW_CONTROLS_SELECTION_SLOT_CLASS,
} from "../../internal/rowControlColumns";
import {
  isRowDragColumn,
  ROW_DRAG_CELL_CLASS,
  ROW_DRAG_HANDLE_CLASS,
} from "../../internal/rowDragColumn";
import type { CellRendererRegistry, ColumnDef, RowData } from "../../types";
import { CSS } from "../const/css-classes";
import {
  clearCellChangeFlash,
  syncCellChangeFlash,
} from "./cellChangeFlash";
import type { PooledCell, PooledRow } from "../types/types";

import { formatCellValue, getCellRawValue } from "./cellValue";

function setPlainCellDisplay(cellEl: HTMLElement, display: string): void {
  let valueEl = cellEl.querySelector(
    `.${CSS.CELL_VALUE}`,
  ) as HTMLElement | null;
  if (!valueEl) {
    valueEl = cellEl.ownerDocument.createElement("span");
    valueEl.className = CSS.CELL_VALUE;
    cellEl.textContent = "";
    cellEl.appendChild(valueEl);
  }
  if (valueEl.textContent !== display) {
    valueEl.textContent = display;
  }
}

/**
 * Whether a column's field is touched by the changed-field set for a row.
 *
 * Matching rules (mirror `dirtyFieldUtils.didAnyDirtyFieldTouch`):
 * - Direct: changed "name" matches field "name".
 * - Dot-path prefix: changed "user" matches field "user.name".
 */
function isFieldChanged(field: string, changedFieldSet: ReadonlySet<string>): boolean {
  if (changedFieldSet.has(field)) return true;
  if (field.includes(".")) {
    const prefix = field.split(".")[0]!;
    if (changedFieldSet.has(prefix)) return true;
  }
  return false;
}

function resolveUpdateFields(
  changedFields: ReadonlySet<string> | undefined,
  flashFields: ReadonlySet<string> | undefined,
): ReadonlySet<string> | undefined {
  if (!changedFields) return flashFields;
  if (!flashFields || flashFields === changedFields) return changedFields;
  const merged = new Set(changedFields);
  for (const field of flashFields) merged.add(field);
  return merged;
}

/**
 * Whether the column output is guaranteed to depend only on its own
 * plain field value.  Columns with `valueGetter`, `valueFormatter`,
 * `getCellClass`, or `cellClassRules` may read arbitrary row fields,
 * so they must always refresh for changed rows. A `cellShell` whose
 * text / image / tone / parts reference another field is likewise
 * field-dependent and must not be skipped when that other field changes.
 */
function isPlainFieldColumn(col: ColumnDef): boolean {
  if (col.valueGetter || col.valueFormatter || col.getCellClass || col.cellClassRules) {
    return false;
  }
  if (col.cellShell !== undefined) {
    const shell = normalizeCellShell(col.cellShell);
    if (shell !== undefined && !cellShellDependsOnlyOnOwnField(shell, col.field)) {
      return false;
    }
  }
  return true;
}

export interface ColumnWindow {
  startIndex: number;
  slotCount: number;
  /** Maps virtual column slot → physical cell index (horizontal ring). */
  toPhysicalCol: (virtualSlot: number) => number;
}

/**
 * Resolve the managed class names for a body row. Closure-built by the
 * renderer (it captures the user's `rowClass / getRowClass / rowClassRules`
 * inputs and the live `Grid` reference) so this helper stays Grid-free.
 *
 * Returning `[]` is equivalent to "no managed classes" — the diff helper
 * removes any previously applied managed class.
 */
export type ResolveRowClassesFn = (
  row: RowData,
  rowIndex: number,
  rowId: string,
) => string[];

/**
 * Resolve the managed class names for a single body cell.
 *
 * Closure-built by the renderer (it captures per-column
 * `cellClass / getCellClass / cellClassRules` plus the live `Grid` reference)
 * so this helper stays Grid-free. `value` is the RAW resolved value (before
 * `valueFormatter`) — `populateRow` extracts it once from the value pipeline
 * and forwards it here, so the resolver does not pay an extra
 * `valueGetter` / `valueFormatter` cost.
 *
 * Returning `[]` is equivalent to "no managed classes" — the diff helper
 * removes any previously applied managed class.
 */
export type ResolveCellClassesFn = (
  row: RowData,
  rowIndex: number,
  rowId: string,
  column: ColumnDef,
  value: unknown,
) => string[];

export interface PopulateRowOptions {
  /**
   * Skip text/value updates when the cell is already bound to the same field.
   * Use during live column resize when row + column window are unchanged.
   */
  layoutOnly?: boolean;
  /** Grid / RowStore revision; paired with `rowId` for row-level skip. */
  dataRevision?: number;
  /** Horizontal ring version; bumps only on full horizontal resets. */
  columnVersion?: number;
  /**
   * When present (update-only transaction with stable visual order), maps
   * rowId → changed field names. Rows not in the map are skipped entirely;
   * cells for unchanged plain-field columns within changed rows are skipped.
   * valueGetter columns always refresh for changed rows (conservative).
   */
  changedRows?: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Transaction cell-change flash metadata for this bind. Distinct from
   * {@link changedRows}: flash can still apply on the settled full render
   * after sort/filter/Quick Search invalidates the dirty-patch change set,
   * including when that render rebinds a targeted row onto a new slot.
   */
  flashRows?: ReadonlyMap<string, ReadonlySet<string>>;
  getRowId?: (row: RowData, dataIndex: number) => string;
  isRowSelected?: (rowId: string) => boolean;
  /** When column selection is enabled, toggles `.lfg-column-selected` on body cells. */
  isColumnSelected?: (field: string) => boolean;
  /**
   * Row-styling resolver. When provided, its returned class names are added
   * to the row element (and pinned-left / pinned-right row elements) as
   * "managed" classes, tracked on the {@link PooledRow} so recycling can
   * remove only what was added without touching core classes.
   */
  resolveRowClasses?: ResolveRowClassesFn;
  /**
   * Version that bumps when row-styling inputs (rowClass / getRowClass /
   * rowClassRules — or anything that affects what {@link resolveRowClasses}
   * returns) change. Paired with `rowId` / `rowVersion` for skip-rebind.
   */
  rowClassVersion?: number;
  /**
   * Cell-styling resolver. When provided, its returned class names are added
   * to the body cell element as "managed" classes, tracked on the
   * {@link PooledCell} so recycling can remove only what was added without
   * touching core / column-selected / action / selection chrome.
   *
   * v1 scope:
   * - Applied to normal data cells only (selection / action / internal
   *   columns are excluded; any previously applied managed cell classes
   *   are drained on recycle to those column kinds).
   * - Renderer wiring forwards this through every body-cell lane:
   *     - center body cells (`populateRow` / `rebindCells`)
   *     - pinned-left / pinned-right body cells (`syncPinnedRowCells`)
   *     - row-pinned top / bottom **center** lane cells
   *     - row-pinned top / bottom **left** and **right** sub-lane cells
   *       (via `rowPinLaneDom` forwarding `bindOptions.resolveCellClasses`)
   */
  resolveCellClasses?: ResolveCellClassesFn;
  /**
   * Version that bumps when any column's cell-styling inputs change. Paired
   * with `rowId` / `rowVersion` / `columnVersion` for per-cell skip-rebind in
   * a future styling-only fast path.
   */
  cellClassVersion?: number;
  /** Row-action renderer modes used only while binding action triggers. */
  cellRenderers?: CellRendererRegistry;
}

/**
 * Diff `current` (already on the element) against `next` and apply only the
 * delta. Core classes — anything NOT in `current` — are never touched, so
 * `lfg-row-selected`, row-drag indicators, etc. stay put.
 */
function applyManagedClassesToEl(
  el: HTMLDivElement,
  current: string[] | undefined,
  next: string[],
): void {
  if (current) {
    for (let i = 0; i < current.length; i++) {
      const c = current[i]!;
      if (next.indexOf(c) === -1) el.classList.remove(c);
    }
  }
  for (let i = 0; i < next.length; i++) {
    const c = next[i]!;
    if (!current || current.indexOf(c) === -1) el.classList.add(c);
  }
}

/**
 * Apply `next` managed class names to the center row element AND any pinned
 * row elements held by the same {@link PooledRow}, then cache the result on
 * the pool row so the next pass can diff against it.
 *
 * Exported for the renderer's styling-only render path
 * ({@link applyRowStylingOnly}) which needs to refresh classes without going
 * through `populateRow`'s cell-rebind path.
 */
export function applyManagedRowClasses(poolRow: PooledRow, next: string[]): void {
  const current = poolRow.managedRowClasses;
  applyManagedClassesToEl(poolRow.element, current, next);
  if (poolRow.pinnedElement) {
    applyManagedClassesToEl(poolRow.pinnedElement, current, next);
  }
  if (poolRow.rightPinnedElement) {
    applyManagedClassesToEl(poolRow.rightPinnedElement, current, next);
  }
  // Store a defensive copy — callers must not mutate the cached array.
  poolRow.managedRowClasses = next.length === 0 ? undefined : next.slice();
}

function applyBodyColumnSelectedClass(
  el: HTMLDivElement,
  col: ColumnDef,
  isColumnSelected?: (field: string) => boolean,
): void {
  if (isInternalColumn(col)) {
    el.classList.remove("lfg-column-selected");
    return;
  }
  if (isColumnSelected === undefined) {
    if (el.classList.contains("lfg-column-selected")) {
      el.classList.remove("lfg-column-selected");
    }
    return;
  }
  el.classList.toggle("lfg-column-selected", isColumnSelected(col.field));
}

function applyRowSelectionRoot(
  poolRow: PooledRow,
  isSelected: boolean,
): void {
  poolRow.element.classList.toggle("lfg-row-selected", isSelected);
  const rowCb = poolRow.element.querySelector(
    ".lfg-row-selection-checkbox",
  ) as HTMLInputElement | null;
  if (rowCb) rowCb.checked = isSelected;
}

/**
 * Row selection visuals + selection-column checkbox, always from the current model.
 * Runs before populateRow's skip check so virtualization recycle cannot leave stale UI.
 */
export function syncRowSelectionDom(
  poolRow: PooledRow,
  row: RowData,
  columns: ColumnDef[],
  rowIndex: number,
  window: ColumnWindow,
  options?: Pick<
    PopulateRowOptions,
    "layoutOnly" | "getRowId" | "isRowSelected" | "isColumnSelected"
  >,
): void {
  const layoutOnly = options?.layoutOnly ?? false;
  const newRowId = options?.getRowId
    ? options.getRowId(row, rowIndex)
    : String(rowIndex);
  const isSelected = options?.isRowSelected?.(newRowId) ?? false;

  applyRowSelectionRoot(poolRow, isSelected);

  const { startIndex, slotCount, toPhysicalCol } = window;
  for (let v = 0; v < slotCount; v++) {
    const colIndex = startIndex + v;
    if (colIndex >= columns.length) continue;
    const col = columns[colIndex];
    if (!col || !isSelectionHostColumn(col)) continue;
    const p = toPhysicalCol(v);
    const cell = poolRow.cells[p];
    if (!cell) continue;
    const prevField = cell.element.getAttribute("data-col-id");
    if (isCombinedRowControlsColumn(col)) {
      bindRowControlsBodyCell(
        cell,
        col,
        isSelected,
        layoutOnly,
        prevField,
        options?.isColumnSelected,
      );
    } else {
      bindSelectionBodyCell(
        cell,
        col,
        isSelected,
        layoutOnly,
        prevField,
        options?.isColumnSelected,
      );
    }
    break;
  }
}

function bindSelectionBodyCell(
  cell: PooledRow["cells"][number],
  col: ColumnDef,
  isSelected: boolean,
  layoutOnly: boolean,
  prevField: string | null,
  isColumnSelected?: (field: string) => boolean,
): void {
  cell.element.style.display = "";
  cell.element.setAttribute("data-col-id", col.field);
  clearRowControlsCellChrome(cell.element);
  clearRowDragCellChrome(cell.element);

  const hadShell = cell.shellKind !== undefined;
  if (hadShell) clearCellShell(cell);

  if (layoutOnly && !hadShell && prevField === col.field) {
    const input = cell.element.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement | null;
    if (input) input.checked = isSelected;
    applyBodyColumnSelectedClass(cell.element, col, isColumnSelected);
    return;
  }

  if (prevField !== col.field || hadShell) {
    cell.value = "";
    cell.element.textContent = "";
  }

  let input = cell.element.querySelector(
    ".lfg-row-selection-checkbox",
  ) as HTMLInputElement | null;
  if (!input) {
    input = document.createElement("input");
    input.type = "checkbox";
    input.tabIndex = -1;
    input.className = "lfg-row-selection-checkbox";
    input.setAttribute("aria-label", "Select row");
    cell.element.appendChild(input);
  }
  if (input.tabIndex !== -1) input.tabIndex = -1;
  input.checked = isSelected;
  cell.value = "";
  applyBodyColumnSelectedClass(cell.element, col, isColumnSelected);
}

function resolveTriggerClassName(col: ColumnDef): string {
  const custom = col.actionTrigger?.className;
  return custom ? `${ACTION_TRIGGER_CLASS} ${custom}` : ACTION_TRIGGER_CLASS;
}

function applyTriggerAttributes(
  btn: HTMLButtonElement,
  col: ColumnDef,
  rowId: string,
  rowIndex: number,
  cellRenderers: CellRendererRegistry | undefined,
): void {
  const actionsKey = col.actionsKey ?? "";
  const bindingChanged =
    btn.getAttribute("data-row-id") !== rowId ||
    btn.getAttribute("data-col-id") !== col.field ||
    btn.getAttribute("data-actions-key") !== actionsKey;
  const configuredAriaLabel = col.actionTrigger?.ariaLabel?.trim() ?? "";
  const ariaLabel =
    configuredAriaLabel.length > 0 ? configuredAriaLabel : "Row actions";
  if (btn.tabIndex !== -1) btn.tabIndex = -1;
  btn.className = resolveTriggerClassName(col);
  if (btn.getAttribute("aria-label") !== ariaLabel) {
    btn.setAttribute("aria-label", ariaLabel);
  }
  btn.setAttribute("data-row-id", rowId);
  btn.setAttribute("data-row-index", String(rowIndex));
  btn.setAttribute("data-col-id", col.field);
  btn.setAttribute("data-actions-key", actionsKey);
  btn.textContent = col.actionTrigger?.icon ?? "⋯";
  syncRowActionTriggerPopupSemantics(
    btn,
    actionsKey,
    cellRenderers,
    bindingChanged,
  );
}

function bindActionBodyCell(
  cell: PooledRow["cells"][number],
  col: ColumnDef,
  rowId: string,
  rowIndex: number,
  prevField: string | null,
  isColumnSelected?: (field: string) => boolean,
  cellRenderers?: CellRendererRegistry,
): void {
  cell.element.style.display = "";
  cell.element.setAttribute("data-col-id", col.field);
  clearRowControlsCellChrome(cell.element);
  clearRowDragCellChrome(cell.element);

  const hadShell = cell.shellKind !== undefined;
  if (hadShell) clearCellShell(cell);

  // Field unchanged and no stale shell → try to reuse existing trigger
  if (!hadShell && prevField === col.field) {
    const trigger = cell.element.querySelector(`.${ACTION_TRIGGER_CLASS}`) as HTMLButtonElement | null;
    if (trigger) {
      applyTriggerAttributes(trigger, col, rowId, rowIndex, cellRenderers);
      applyBodyColumnSelectedClass(cell.element, col, isColumnSelected);
      return;
    }
    // Trigger missing (e.g. first pinned render) → fall through to create it
  }

  // Field changed, shell cleared, or trigger missing → full rebuild
  cell.value = "";
  cell.element.textContent = "";

  if (!cell.element.classList.contains(ACTION_CELL_CLASS)) {
    cell.element.classList.add(ACTION_CELL_CLASS);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  applyTriggerAttributes(btn, col, rowId, rowIndex, cellRenderers);
  cell.element.appendChild(btn);

  applyBodyColumnSelectedClass(cell.element, col, isColumnSelected);
}

/**
 * Strip action-cell chrome when recycling from an action column to a normal column.
 */
function clearActionCellIfNeeded(el: HTMLDivElement): void {
  if (el.classList.contains(ACTION_CELL_CLASS)) {
    el.classList.remove(ACTION_CELL_CLASS);
    const trigger = el.querySelector(`.${ACTION_TRIGGER_CLASS}`);
    if (trigger) trigger.remove();
  }
}

function clearRowControlsCellChrome(el: HTMLDivElement): void {
  if (el.classList.contains(ROW_CONTROLS_CELL_CLASS)) {
    el.classList.remove(ROW_CONTROLS_CELL_CLASS);
  }
  const dragSlot = el.querySelector(`.${ROW_CONTROLS_DRAG_SLOT_CLASS}`);
  if (dragSlot) dragSlot.remove();
  const selectionSlot = el.querySelector(`.${ROW_CONTROLS_SELECTION_SLOT_CLASS}`);
  if (selectionSlot) selectionSlot.remove();
}

function clearRowDragCellChrome(el: HTMLDivElement): void {
  if (el.classList.contains(ROW_DRAG_CELL_CLASS)) {
    el.classList.remove(ROW_DRAG_CELL_CLASS);
  }
  const direct = el.querySelector(`:scope > .${ROW_DRAG_HANDLE_CLASS}`);
  if (direct) direct.remove();
}

function createRowDragHandle(doc: Document): HTMLDivElement {
  const handle = doc.createElement("div");
  handle.className = ROW_DRAG_HANDLE_CLASS;
  handle.setAttribute("aria-hidden", "true");
  handle.setAttribute("touch-action", "none");
  return handle;
}

function bindRowControlsBodyCell(
  cell: PooledRow["cells"][number],
  col: ColumnDef,
  isSelected: boolean,
  layoutOnly: boolean,
  prevField: string | null,
  isColumnSelected?: (field: string) => boolean,
): void {
  const el = cell.element;
  el.style.display = "";
  el.setAttribute("data-col-id", col.field);

  if (cell.shellKind !== undefined) clearCellShell(cell);
  clearActionCellIfNeeded(el);
  clearRowDragCellChrome(el);

  if (!el.classList.contains(ROW_CONTROLS_CELL_CLASS)) {
    el.classList.add(ROW_CONTROLS_CELL_CLASS);
  }
  el.classList.remove("lfg-column-selected");

  let dragSlot = el.querySelector(
    `:scope > .${ROW_CONTROLS_DRAG_SLOT_CLASS}`,
  ) as HTMLDivElement | null;
  let selSlot = el.querySelector(
    `:scope > .${ROW_CONTROLS_SELECTION_SLOT_CLASS}`,
  ) as HTMLDivElement | null;

  if (layoutOnly && prevField === col.field && dragSlot && selSlot) {
    const input = selSlot.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement | null;
    if (input) input.checked = isSelected;
    applyBodyColumnSelectedClass(el, col, isColumnSelected);
    return;
  }

  if (!dragSlot || !selSlot) {
    el.textContent = "";
    dragSlot = el.ownerDocument.createElement("div");
    dragSlot.className = ROW_CONTROLS_DRAG_SLOT_CLASS;
    dragSlot.appendChild(createRowDragHandle(el.ownerDocument));
    selSlot = el.ownerDocument.createElement("div");
    selSlot.className = ROW_CONTROLS_SELECTION_SLOT_CLASS;
    const input = el.ownerDocument.createElement("input");
    input.type = "checkbox";
    input.tabIndex = -1;
    input.className = "lfg-row-selection-checkbox";
    input.setAttribute("aria-label", "Select row");
    selSlot.appendChild(input);
    el.appendChild(dragSlot);
    el.appendChild(selSlot);
  } else {
    if (!dragSlot.querySelector(`.${ROW_DRAG_HANDLE_CLASS}`)) {
      dragSlot.appendChild(createRowDragHandle(el.ownerDocument));
    }
    if (!selSlot.querySelector(".lfg-row-selection-checkbox")) {
      const input = el.ownerDocument.createElement("input");
      input.type = "checkbox";
      input.tabIndex = -1;
      input.className = "lfg-row-selection-checkbox";
      input.setAttribute("aria-label", "Select row");
      selSlot.appendChild(input);
    }
  }

  const input = selSlot.querySelector(
    ".lfg-row-selection-checkbox",
  ) as HTMLInputElement | null;
  if (input) {
    if (input.tabIndex !== -1) input.tabIndex = -1;
    input.checked = isSelected;
  }
  cell.value = "";
  applyBodyColumnSelectedClass(el, col, isColumnSelected);
}

function bindRowDragBodyCell(
  cell: PooledRow["cells"][number],
  col: ColumnDef,
): void {
  cell.element.style.display = "";
  cell.element.setAttribute("data-col-id", col.field);

  if (cell.shellKind !== undefined) clearCellShell(cell);
  clearActionCellIfNeeded(cell.element);
  clearRowControlsCellChrome(cell.element);

  const checkbox = cell.element.querySelector(".lfg-row-selection-checkbox");
  if (checkbox) checkbox.remove();

  if (!cell.element.classList.contains(ROW_DRAG_CELL_CLASS)) {
    cell.element.classList.add(ROW_DRAG_CELL_CLASS);
  }
  cell.element.classList.remove("lfg-column-selected");

  const existing = cell.element.querySelector(
    `:scope > .${ROW_DRAG_HANDLE_CLASS}`,
  ) as HTMLDivElement | null;
  if (existing && cell.element.childElementCount === 1) {
    cell.value = "";
    return;
  }

  cell.value = "";
  cell.element.textContent = "";
  cell.element.appendChild(createRowDragHandle(cell.element.ownerDocument));
}

function enteringSlotsTouchSelectionColumn(
  enteringSlots: readonly number[],
  startCol: number,
  columns: ColumnDef[],
): boolean {
  for (const v of enteringSlots) {
    const colIndex = startCol + v;
    if (colIndex < 0 || colIndex >= columns.length) continue;
    const col = columns[colIndex];
    if (col && isSelectionHostColumn(col)) return true;
  }
  return false;
}

/**
 * Cell-styling eligibility (v1).
 *
 * Cell styling applies ONLY to normal user data columns. Selection columns,
 * action columns, row-drag columns, and any column marked `internal` are
 * excluded.
 *
 * Centralizing the check guarantees the cell loop's "drain managed classes
 * on recycle to ineligible column" path and the styling-only fast pass use
 * the same definition of "eligible".
 */
function isCellStylingEligibleColumn(col: ColumnDef): boolean {
  if (isSelectionColumn(col)) return false;
  if (isActionColumn(col)) return false;
  if (col.internal !== undefined) return false;
  return true;
}

/**
 * Apply `next` managed class names to a single body cell element, then cache
 * the result on the {@link PooledCell} so subsequent passes can diff against
 * it. Core / selection / action / column-selected classes are never in
 * `current`, so they are never touched.
 *
 * Exported for use by the renderer's future cell-styling fast path; today
 * only `populateRow` calls it internally.
 */
export function applyManagedCellClasses(cell: PooledCell, next: string[]): void {
  const current = cell.managedCellClasses;
  if (current) {
    for (let i = 0; i < current.length; i++) {
      const c = current[i]!;
      if (next.indexOf(c) === -1) cell.element.classList.remove(c);
    }
  }
  for (let i = 0; i < next.length; i++) {
    const c = next[i]!;
    if (!current || current.indexOf(c) === -1) cell.element.classList.add(c);
  }
  // Defensive copy — callers must not mutate the cached array.
  cell.managedCellClasses = next.length === 0 ? undefined : next.slice();
}

/**
 * Refresh ONLY the managed row classes on a single pool row, without touching
 * cells, columnVersion, rowVersion, or selection visuals.
 *
 * Used by the renderer's styling-only fast path
 * ({@link DomGridRenderer.applyRowStylingOnlyUpdate}) to flush a new
 * `rowClassVersion` through visible body + lane pool rows when nothing else
 * changed. Selection and column-selection visuals continue to flow through
 * their own dedicated DOM walks; they do not gate this helper.
 *
 * Contract:
 * - Idempotent on `lastRowClassVersion === rowClassVersion`.
 * - Caller is responsible for confirming the pool row is currently bound
 *   (`rowIndex >= 0` and `rowId !== null`).
 * - When `resolver` is `undefined` but the row has managed classes from a
 *   prior bind, drains them via the diff helper.
 */
export function applyRowStylingOnly(
  poolRow: PooledRow,
  row: RowData,
  resolver: ResolveRowClassesFn | undefined,
  rowClassVersion: number,
): void {
  if (poolRow.lastRowClassVersion === rowClassVersion) return;
  if (resolver !== undefined) {
    // `rowId` is guaranteed non-null by the caller's bound-row check.
    const next = resolver(row, poolRow.rowIndex, poolRow.rowId as string);
    applyManagedRowClasses(poolRow, next);
  } else if (poolRow.managedRowClasses !== undefined) {
    applyManagedRowClasses(poolRow, []);
  }
  poolRow.lastRowClassVersion = rowClassVersion;
}

function clearShellAndResetCellValue(cell: PooledCell): void {
  clearCellShell(cell);
  cell.value = "";
  cell.element.textContent = "";
}

/**
 * Bind a single normal data cell's value/shell content.
 *
 * Handles all mode transitions: plain text ↔ shell, shell kind changes,
 * field recycle cleanup, and action-cell chrome removal. Selection / action /
 * internal column paths are NOT handled here — callers gate on
 * `isCellStylingEligibleColumn` before reaching this helper.
 *
 * `prevField` is the previous `data-col-id` on the cell element; pass `null`
 * for first mount. The caller must have already set `data-col-id` and
 * `cell.element.style.display` before calling.
 */
function bindDataCellValue(
  cell: PooledCell,
  col: ColumnDef,
  row: RowData,
  rowId: string,
  rowIndex: number,
  prevField: string | null,
  raw: unknown,
  display: string,
): void {
  const hadActionChrome = cell.element.classList.contains(ACTION_CELL_CLASS);
  const hadDragChrome = cell.element.classList.contains(ROW_DRAG_CELL_CLASS);
  const hadControlsChrome = cell.element.classList.contains(ROW_CONTROLS_CELL_CLASS);
  if (prevField !== col.field) {
    if (cell.shellKind !== undefined) clearCellShell(cell);
    if (hadActionChrome) clearActionCellIfNeeded(cell.element);
    if (hadDragChrome) clearRowDragCellChrome(cell.element);
    if (hadControlsChrome) clearRowControlsCellChrome(cell.element);
    cell.value = "";
    cell.element.textContent = "";
  } else if (hadActionChrome || hadDragChrome || hadControlsChrome) {
    if (hadActionChrome) clearActionCellIfNeeded(cell.element);
    if (hadDragChrome) clearRowDragCellChrome(cell.element);
    if (hadControlsChrome) clearRowControlsCellChrome(cell.element);
    cell.value = "";
    cell.element.textContent = "";
  }

  const shellConfig = normalizeCellShell(col.cellShell);
  if (shellConfig !== undefined) {
    if (cell.shellKind === undefined) cell.element.textContent = "";
    cell.value = display;
    bindCellShell(cell, {
      row, rowId, rowIndex, column: col,
      field: col.field, value: raw, formattedValue: display,
    }, shellConfig);
  } else {
    if (cell.shellKind !== undefined) {
      clearCellShell(cell);
      cell.value = display;
      setPlainCellDisplay(cell.element, display);
    } else if (cell.value !== display) {
      cell.value = display;
      setPlainCellDisplay(cell.element, display);
    }
  }
}

/**
 * Binds a data row into a pooled DOM row for the current column window.
 * Uses `toPhysicalCol` from the horizontal ring buffer to map virtual
 * column slots to physical cell indices.
 */
export function populateRow(
  poolRow: PooledRow,
  row: RowData,
  columns: ColumnDef[],
  rowIndex: number,
  window: ColumnWindow,
  options?: PopulateRowOptions,
): void {
  const layoutOnly = options?.layoutOnly ?? false;
  const newRowId = options?.getRowId
    ? options.getRowId(row, rowIndex)
    : String(rowIndex);
  const dataRevision = options?.dataRevision ?? 0;
  const colVer = options?.columnVersion ?? 0;
  const wasBoundToRow =
    poolRow.rowId === newRowId && poolRow.rowIndex === rowIndex;

  syncRowSelectionDom(poolRow, row, columns, rowIndex, window, options);

  // ── Phase 3: render-change-set fast path ───────────────────────────
  // When change metadata is available (update-only transaction, stable
  // visual order), skip rows whose rowId is not in the changed set.
  // This avoids row styling, cell value extraction, and cell class work
  // for unchanged rows while the vertical ring still reports "full".
  const changedRows = options?.changedRows;
  const flashRows = options?.flashRows;
  if (
    changedRows !== undefined &&
    !layoutOnly &&
    poolRow.rowId === newRowId &&
    poolRow.rowIndex === rowIndex &&
    poolRow.lastColumnVersion === colVer
  ) {
    if (!changedRows.has(newRowId) && !flashRows?.has(newRowId)) {
      return;
    }
  }

  // Row-styling application. Runs BEFORE the cell-rebind skip so a pure
  // styling-version bump (e.g. user toggled a `rowClassRules` predicate input)
  // refreshes managed classes without re-binding cells. Skipped entirely when
  // none of (`rowId`, `rowVersion`, `rowClassVersion`) changed since last bind.
  if (!layoutOnly) {
    if (options?.resolveRowClasses !== undefined) {
      const rowClassVersion = options.rowClassVersion ?? 0;
      const stylingStillFresh =
        poolRow.rowId === newRowId &&
        poolRow.rowVersion === dataRevision &&
        poolRow.lastRowClassVersion === rowClassVersion;
      if (!stylingStillFresh) {
        const next = options.resolveRowClasses(row, rowIndex, newRowId);
        applyManagedRowClasses(poolRow, next);
        poolRow.lastRowClassVersion = rowClassVersion;
      }
    } else if (poolRow.managedRowClasses !== undefined) {
      // Row styling was previously active for this pool slot but the caller
      // is no longer supplying a resolver — drain the managed classes via the
      // diff helper so we touch only what we added (core / selection / drag
      // classes are untouched), and reset the styling skip-rebind cache.
      applyManagedRowClasses(poolRow, []);
      poolRow.lastRowClassVersion = undefined;
    }
  }

  const cellClassResolver = options?.resolveCellClasses;
  const cellClassVersion = options?.cellClassVersion ?? 0;
  const cellClassResolverActive = cellClassResolver !== undefined;

  const outerSkippable =
    !layoutOnly &&
    poolRow.rowIndex === rowIndex &&
    poolRow.rowId === newRowId &&
    poolRow.rowVersion === dataRevision &&
    poolRow.lastColumnVersion === colVer;

  // Cell-styling-only fast pass.
  //
  // When the outer skip WOULD fire (row + columns unchanged) but
  // cell-styling state is stale, the visible cells must still re-run cell
  // class application. Staleness is two-fold:
  //
  //   - **Version bump**: caller advanced `cellClassVersion` while the
  //     resolver remained active → recompute classes from the resolver.
  //   - **Presence transition**: resolver was active and is now gone (drain),
  //     OR resolver is now supplied for the first time / after being dropped
  //     (apply). Crucially, the default `cellClassVersion` is 0 on both
  //     sides of a presence flip, so a presence-only check is required —
  //     a version-only check would miss the transition.
  //
  // The fast pass updates managed cell classes ONLY: text content, value
  // cache, and `lastColumnVersion` are untouched.
  const wasResolverActive = poolRow.lastCellClassResolverActive === true;
  const presenceChanged = cellClassResolverActive !== wasResolverActive;
  const versionStale =
    cellClassResolverActive && poolRow.lastCellClassVersion !== cellClassVersion;

  if (outerSkippable && (presenceChanged || versionStale)) {
    const { startIndex: sIdx, slotCount: sCnt, toPhysicalCol: toPhys } = window;
    for (let v = 0; v < sCnt; v++) {
      const p = toPhys(v);
      const cell = poolRow.cells[p];
      if (!cell) continue;
      const colIndex = sIdx + v;
      if (colIndex >= columns.length) continue;
      const col = columns[colIndex];
      if (!col) continue;
      if (!isCellStylingEligibleColumn(col)) {
        // Ineligible — drain any prior managed classes from a recycled bind.
        if (cell.managedCellClasses !== undefined) {
          applyManagedCellClasses(cell, []);
        }
        cell.lastCellClassVersion = cellClassVersion;
        continue;
      }
      if (cellClassResolverActive) {
        const raw = getCellRawValue(row, rowIndex, col);
        const nextClasses = cellClassResolver(row, rowIndex, newRowId, col, raw);
        applyManagedCellClasses(cell, nextClasses);
        cell.lastCellClassVersion = cellClassVersion;
      } else {
        // Resolver was dropped — drain any classes it had applied.
        if (cell.managedCellClasses !== undefined) {
          applyManagedCellClasses(cell, []);
        }
        cell.lastCellClassVersion = undefined;
      }
    }
    poolRow.lastCellClassVersion = cellClassResolverActive ? cellClassVersion : undefined;
    poolRow.lastCellClassResolverActive = cellClassResolverActive;
    return;
  }

  if (outerSkippable) {
    return;
  }

  poolRow.rowIndex = rowIndex;

  const { startIndex, slotCount, toPhysicalCol } = window;
  const changedFields = changedRows?.get(newRowId);
  const flashFields = flashRows?.get(newRowId);
  const updateFields = resolveUpdateFields(changedFields, flashFields);

  // TODO(perf): This loop is O(visibleColumns) per changed row. For wide
  // grids (100+ visible columns) updating a single field, a per-row
  // field→cell binding map would allow O(changedFields) patching instead.
  for (let v = 0; v < slotCount; v++) {
    const p = toPhysicalCol(v);
    const cell = poolRow.cells[p];
    if (!cell) continue;

    const colIndex = startIndex + v;
    if (colIndex >= columns.length) {
      if (cell.shellKind !== undefined) clearShellAndResetCellValue(cell);
      clearCellChangeFlash(cell);
      cell.element.style.display = "none";
      continue;
    }

    const col = columns[colIndex];
    if (!col) {
      if (cell.shellKind !== undefined) clearShellAndResetCellValue(cell);
      clearCellChangeFlash(cell);
      cell.element.style.display = "none";
      continue;
    }

    const prevField = cell.element.getAttribute("data-col-id");

    // For ineligible columns (selection / action / internal / synthetic),
    // drain any prior managed cell classes left over from a styled binding
    // on this physical cell slot, then take the column-specific path.
    // Action cells clear shell inside bindActionBodyCell. Selection cells
    // in populateRow are bound by syncRowSelectionDom (which calls
    // bindSelectionBodyCell) — the center body loop only `continue`s past
    // them, so we must clear shell bookkeeping here before skipping.
    if (!isCellStylingEligibleColumn(col)) {
      if (cell.managedCellClasses !== undefined) {
        applyManagedCellClasses(cell, []);
      }
      cell.lastCellClassVersion = cellClassVersion;
      clearCellChangeFlash(cell);

      if (isCombinedRowControlsColumn(col)) {
        bindRowControlsBodyCell(
          cell,
          col,
          options?.isRowSelected?.(newRowId) ?? false,
          false,
          prevField,
          options?.isColumnSelected,
        );
        continue;
      }
      if (isSelectionColumn(col)) {
        if (cell.shellKind !== undefined) clearShellAndResetCellValue(cell);
        continue;
      }
      if (isRowDragColumn(col)) {
        bindRowDragBodyCell(cell, col);
        continue;
      }
      if (isActionColumn(col)) {
        bindActionBodyCell(
          cell,
          col,
          newRowId,
          rowIndex,
          prevField,
          options?.isColumnSelected,
          options?.cellRenderers,
        );
        continue;
      }
      // Other internal kinds: leave the cell hidden (selection and row-drag
      // are handled above; this branch reserves the shape for future synthetic
      // columns without falling into the normal-cell pipeline below).
      if (cell.shellKind !== undefined) clearShellAndResetCellValue(cell);
      cell.element.style.display = "none";
      continue;
    }

    cell.element.style.display = "";

    // Field-level skip: for update-only transactions, skip cells whose
    // output is guaranteed unchanged. Only plain-field columns (no
    // valueGetter/valueFormatter/getCellClass/cellClassRules) qualify,
    // and the field must not have changed (with dot-path prefix matching).
    if (
      updateFields !== undefined &&
      prevField === col.field &&
      isPlainFieldColumn(col) &&
      !isFieldChanged(col.field, updateFields)
    ) {
      continue;
    }

    if (layoutOnly && prevField === col.field) {
      applyBodyColumnSelectedClass(cell.element, col, options?.isColumnSelected);
      // `layoutOnly` is the live column-resize path — column refs unchanged,
      // row unchanged. Skip the cell-class resolver entirely; existing
      // managed classes remain valid.
      continue;
    }

    cell.element.setAttribute("data-col-id", col.field);

    // Split the value pipeline so the cell-class resolver receives the RAW
    // value without paying for an extra `valueGetter` / `valueFormatter`
    // pass. Same number of pipeline calls as before.
    const raw = getCellRawValue(row, rowIndex, col);
    const next = formatCellValue(raw, row, rowIndex, col);
    const prevDisplay = cell.value;

    bindDataCellValue(cell, col, row, newRowId, rowIndex, prevField, raw, next);
    if (!layoutOnly) {
      syncCellChangeFlash(cell, {
        column: col,
        wasBoundToSameCell: wasBoundToRow && prevField === col.field,
        flashFields,
        prevDisplay,
        nextDisplay: next,
      });
    }
    applyBodyColumnSelectedClass(cell.element, col, options?.isColumnSelected);

    // Cell-styling: apply managed classes for normal data cells only. v1
    // intentionally excludes selection / action / internal columns (handled
    // above with a drain pass). When the column has no styling inputs, the
    // closure returns `[]` and the diff helper drops any prior managed
    // classes from a recycled binding.
    if (cellClassResolver !== undefined) {
      const nextClasses = cellClassResolver(row, rowIndex, newRowId, col, raw);
      applyManagedCellClasses(cell, nextClasses);
      cell.lastCellClassVersion = cellClassVersion;
    } else if (cell.managedCellClasses !== undefined) {
      // Resolver was active in a previous bind but is no longer supplied —
      // drain stale managed classes so they don't linger on this cell.
      applyManagedCellClasses(cell, []);
      cell.lastCellClassVersion = undefined;
    }
  }

  if (!layoutOnly) {
    poolRow.rowId = newRowId;
    poolRow.rowVersion = dataRevision;
    poolRow.lastColumnVersion = colVer;
    // Record cell-styling sync — the cell loop above either ran the resolver
    // for each eligible cell (and set per-cell version) or drained classes.
    // We store the resolver-active flag alongside the version so a future
    // resolver-presence flip (with the same default version) can be
    // detected — without it, "drop then re-add at version 0" would skip.
    poolRow.lastCellClassVersion = cellClassResolverActive
      ? cellClassVersion
      : undefined;
    poolRow.lastCellClassResolverActive = cellClassResolverActive;
    poolRow.element.setAttribute("data-row-id", newRowId);
    poolRow.element.setAttribute("data-row-index", String(rowIndex));
  }
}

/**
 * Bind pinned cells (left or right) in the separate pinned lane.
 * Runs once per vertical entering row; horizontal scroll never touches these.
 *
 * Cell-styling (v1) is applied to normal data cells in the pinned columns
 * using the same eligibility helper as the center body. Selection / action /
 * internal columns are excluded and any stale managed cell classes from a
 * prior styled binding are drained on recycle. The styling path makes one
 * value-pipeline pass per cell (raw → format) so `valueGetter` /
 * `valueFormatter` are not duplicated.
 */
export function syncPinnedRowCells(
  poolRow: PooledRow,
  row: RowData,
  pinnedColumns: ColumnDef[],
  rowIndex: number,
  getRowId?: (row: RowData, dataIndex: number) => string,
  isRowSelected?: (rowId: string) => boolean,
  isColumnSelected?: (field: string) => boolean,
  side: "left" | "right" = "left",
  resolveCellClasses?: ResolveCellClassesFn,
  cellClassVersion?: number,
  changedFields?: ReadonlySet<string>,
  cellRenderers?: CellRendererRegistry,
  flashFields?: ReadonlySet<string>,
): void {
  const pinnedCells = side === "left" ? poolRow.pinnedCells : poolRow.rightPinnedCells;
  if (!pinnedCells) return;

  const rowId = getRowId ? getRowId(row, rowIndex) : String(rowIndex);
  const selected = isRowSelected?.(rowId) ?? false;
  const cellVer = cellClassVersion ?? 0;
  const wasBoundToRow = poolRow.rowId === rowId && poolRow.rowIndex === rowIndex;
  const updateFields = resolveUpdateFields(changedFields, flashFields);

  if (side === "left") applyRowSelectionRoot(poolRow, selected);

  const el = side === "left" ? poolRow.pinnedElement : poolRow.rightPinnedElement;
  if (el) {
    el.setAttribute("data-row-id", rowId);
    el.setAttribute("data-row-index", String(rowIndex));
    el.classList.toggle("lfg-row-selected", selected);
  }

  for (let p = 0; p < pinnedColumns.length; p++) {
    const col = pinnedColumns[p]!;
    const cell = pinnedCells[p];
    if (!cell) continue;

    cell.element.style.display = "";
    const prevField = cell.element.getAttribute("data-col-id");

    // Recycle into an ineligible pinned column (selection / action / internal):
    // drain any managed cell classes left over from a styled binding on this
    // physical pinned slot. We still fall through to the column-kind-specific
    // chrome below (selection checkbox, action trigger) or — for right-pinned
    // selection columns historically — the normal data-cell path that stamps
    // `data-col-id` and runs the value pipeline.
    const eligible = isCellStylingEligibleColumn(col);
    if (!eligible) {
      clearCellChangeFlash(cell);
      if (cell.managedCellClasses !== undefined) {
        applyManagedCellClasses(cell, []);
        cell.lastCellClassVersion = undefined;
      }
    }

    if (isCombinedRowControlsColumn(col)) {
      bindRowControlsBodyCell(
        cell,
        col,
        selected,
        false,
        prevField,
        isColumnSelected,
      );
      cell.element.setAttribute("data-pinned", side);
      continue;
    }

    if (isRowDragColumn(col)) {
      bindRowDragBodyCell(cell, col);
      cell.element.setAttribute("data-pinned", side);
      continue;
    }

    if (isSelectionColumn(col)) {
      bindSelectionBodyCell(
        cell, col, selected, false,
        prevField,
        isColumnSelected,
      );
      cell.element.setAttribute("data-pinned", side);
      continue;
    }

    if (isActionColumn(col)) {
      bindActionBodyCell(
        cell,
        col,
        rowId,
        rowIndex,
        prevField,
        isColumnSelected,
        cellRenderers,
      );
      cell.element.setAttribute("data-pinned", side);
      continue;
    }

    // Field-level skip for pinned cells (same rules as center).
    if (
      updateFields !== undefined &&
      prevField === col.field &&
      isPlainFieldColumn(col) &&
      !isFieldChanged(col.field, updateFields)
    ) {
      continue;
    }

    cell.element.setAttribute("data-col-id", col.field);
    cell.element.setAttribute("data-pinned", side);

    const raw = getCellRawValue(row, rowIndex, col);
    const next = formatCellValue(raw, row, rowIndex, col);
    const prevDisplay = cell.value;

    bindDataCellValue(cell, col, row, rowId, rowIndex, prevField, raw, next);
    syncCellChangeFlash(cell, {
      column: col,
      wasBoundToSameCell: wasBoundToRow && prevField === col.field,
      flashFields,
      prevDisplay,
      nextDisplay: next,
    });
    applyBodyColumnSelectedClass(cell.element, col, isColumnSelected);

    if (eligible) {
      if (resolveCellClasses !== undefined) {
        const nextClasses = resolveCellClasses(row, rowIndex, rowId, col, raw);
        applyManagedCellClasses(cell, nextClasses);
        cell.lastCellClassVersion = cellVer;
      } else if (cell.managedCellClasses !== undefined) {
        applyManagedCellClasses(cell, []);
        cell.lastCellClassVersion = undefined;
      }
    }
  }
}

/**
 * Rebind only specific column slots in a row after a horizontal ring
 * rotation. Bypasses the row-level skip check because only the
 * recycled column slots need updating.
 */
export function rebindCells(
  poolRow: PooledRow,
  row: RowData,
  columns: ColumnDef[],
  rowIndex: number,
  startCol: number,
  enteringSlots: number[],
  toPhysicalCol: (virtualSlot: number) => number,
  getRowId?: (row: RowData, dataIndex: number) => string,
  isRowSelected?: (rowId: string) => boolean,
  isColumnSelected?: (field: string) => boolean,
  resolveCellClasses?: ResolveCellClassesFn,
  cellClassVersion?: number,
  cellRenderers?: CellRendererRegistry,
): void {
  const rowId = getRowId ? getRowId(row, rowIndex) : String(rowIndex);
  const selected = isRowSelected?.(rowId) ?? false;
  const cellVer = cellClassVersion ?? 0;

  if (enteringSlotsTouchSelectionColumn(enteringSlots, startCol, columns)) {
    applyRowSelectionRoot(poolRow, selected);
  }

  for (const v of enteringSlots) {
    const p = toPhysicalCol(v);
    const cell = poolRow.cells[p];
    if (!cell) continue;

    const colIndex = startCol + v;
    if (colIndex >= columns.length) {
      if (cell.shellKind !== undefined) clearShellAndResetCellValue(cell);
      clearCellChangeFlash(cell);
      cell.element.style.display = "none";
      continue;
    }

    const col = columns[colIndex];
    if (!col) {
      if (cell.shellKind !== undefined) clearShellAndResetCellValue(cell);
      clearCellChangeFlash(cell);
      cell.element.style.display = "none";
      continue;
    }

    // Recycle into an ineligible column (selection / action / internal):
    // drain any managed cell classes left over from a prior styled binding
    // on this physical slot, then take the column-specific path.
    // Shell bookkeeping is cleared inside bindSelectionBodyCell /
    // bindActionBodyCell, or below for other internal kinds.
    clearCellChangeFlash(cell);
    if (!isCellStylingEligibleColumn(col)) {
      if (cell.managedCellClasses !== undefined) {
        applyManagedCellClasses(cell, []);
        cell.lastCellClassVersion = undefined;
      }
      if (isCombinedRowControlsColumn(col)) {
        bindRowControlsBodyCell(
          cell,
          col,
          selected,
          false,
          cell.element.getAttribute("data-col-id"),
          isColumnSelected,
        );
        continue;
      }
      if (isSelectionColumn(col)) {
        bindSelectionBodyCell(
          cell,
          col,
          selected,
          false,
          cell.element.getAttribute("data-col-id"),
          isColumnSelected,
        );
        continue;
      }
      if (isRowDragColumn(col)) {
        bindRowDragBodyCell(cell, col);
        continue;
      }
      if (isActionColumn(col)) {
        bindActionBodyCell(
          cell,
          col,
          rowId,
          rowIndex,
          cell.element.getAttribute("data-col-id"),
          isColumnSelected,
          cellRenderers,
        );
        continue;
      }
      // Other internal kinds: hide (selection and row-drag handled above).
      if (cell.shellKind !== undefined) clearShellAndResetCellValue(cell);
      cell.element.style.display = "none";
      continue;
    }

    cell.element.style.display = "";

    const prevField = cell.element.getAttribute("data-col-id");

    const raw = getCellRawValue(row, rowIndex, col);
    const next = formatCellValue(raw, row, rowIndex, col);

    cell.element.setAttribute("data-col-id", col.field);
    bindDataCellValue(cell, col, row, rowId, rowIndex, prevField, raw, next);
    applyBodyColumnSelectedClass(cell.element, col, isColumnSelected);

    if (resolveCellClasses !== undefined) {
      const nextClasses = resolveCellClasses(row, rowIndex, rowId, col, raw);
      applyManagedCellClasses(cell, nextClasses);
      cell.lastCellClassVersion = cellVer;
    } else if (cell.managedCellClasses !== undefined) {
      applyManagedCellClasses(cell, []);
      cell.lastCellClassVersion = undefined;
    }
  }
}
