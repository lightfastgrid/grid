import type { PooledRow } from "../../internal/poolTypes";
import type { RowSelectionReadSnapshot } from "../../internal/readSnapshots";
import { ROW_CONTROLS_COLUMN_FIELD } from "../../internal/rowControlColumns";
import { SELECTION_COLUMN_FIELD } from "../../internal/selectionColumn";
import { selectionPointerModifiers } from "../../internal/selectionModifiers";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type {
  ColumnDef,
  RowData,
  RowSelectionConfig,
  SelectionChange,
  SelectionChangeSource,
} from "../../types";
import { resolveSelectedIdsFromDisplayRows } from "../../utils/rowSelection";
import { rowSelectionConfigsEqual } from "../../utils/rowSelectionConfig";
import { isCellShellActionTarget, isCellShellOverlayTarget } from "../cell-shells/cellShellActionDom";
import { isRowActionUiTarget } from "../row-actions/rowActionDom";

import { SelectionStore } from "./SelectionStore";

interface RowSelectionControllerOptions {
  getPool: () => PooledRow[];
  getConfig: () => RowSelectionConfig;
  getColumns: () => ColumnDef[];
  /** Display-row reader backed by RowView — preferred for display-index lookups. */
  getDisplayRows: () => DisplayRowReader;
  /**
   * Reader over ALL rows after sorting, ignoring pagination — the
   * selection universe. Falls back to {@link getDisplayRows} when not
   * provided (they are identical without pagination).
   */
  getFullDisplayRows?: () => DisplayRowReader;
  getDataRevision: () => number;
  resolveRowId: (row: RowData, index: number) => string;
  getHeaderRowEl: () => HTMLDivElement | null;
  getPinnedHeaderRowEl?: () => HTMLDivElement | null;
  onSelectionChanged?: (
    change: SelectionChange,
    source: SelectionChangeSource,
  ) => void;
}

export class RowSelectionController {
  private static readonly MAX_INCREMENTAL_PATCH = 256;

  private root: HTMLElement | null = null;
  private readonly store = new SelectionStore();
  private lastConfig: RowSelectionConfig | null = null;
  private lastDataRevision: number | null = null;
  private needsHeaderAggregateRefresh = true;
  private postSelectionReconcileScheduled = false;
  private pendingKeyboardCommand = 0;
  private pendingKeyboardRowIndex = -1;
  private pendingKeyboardNextRowIndex = -1;
  private pendingKeyboardSource: SelectionChangeSource = "keyboard";
  private keyboardCommandScheduled = false;
  /** Range anchor for Shift + row body clicks (display order). */
  private anchorRowId: string | null = null;
  private anchorRowIndex: number | null = null;
  /** Range extent bounds (display indices). Expand-only on repeated shift-clicks. */
  private extentLo: number | null = null;
  private extentHi: number | null = null;

  constructor(private readonly options: RowSelectionControllerOptions) {}

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.root.addEventListener("click", this.onClick);
  }

  detach(): void {
    if (this.root) {
      this.root.removeEventListener("click", this.onClick);
      this.root = null;
    }
    this.lastConfig = null;
    this.lastDataRevision = null;
    this.needsHeaderAggregateRefresh = true;
    this.postSelectionReconcileScheduled = false;
    this.pendingKeyboardCommand = 0;
    this.pendingKeyboardRowIndex = -1;
    this.pendingKeyboardNextRowIndex = -1;
    this.keyboardCommandScheduled = false;
    this.resetAnchorSilent();
  }

  syncMode(): void {
    const cfg = this.options.getConfig();
    const dataRev = this.options.getDataRevision();

    if (this.lastConfig && this.lastConfig.mode !== cfg.mode) {
      this.resetAnchorSilent();
    }

    this.syncStoreModeFromConfig();

    const configChanged =
      !this.lastConfig || !rowSelectionConfigsEqual(this.lastConfig, cfg);
    const dataChanged =
      this.lastDataRevision !== null && dataRev !== this.lastDataRevision;

    if (configChanged || dataChanged) {
      this.needsHeaderAggregateRefresh = true;
    }

    this.lastConfig = cfg;
    this.lastDataRevision = dataRev;

    this.ensureAnchorValid();

    for (const row of this.options.getPool()) {
      if (row.rowId) this.applyRowState(row, row.rowId);
    }

    this.refreshHeaderIfDirty();
  }

  isSelected(rowId: string): boolean {
    return this.store.isSelected(rowId);
  }

  /**
   * The selection universe: all rows after sorting, ignoring
   * pagination. Store `totalRows` arguments use this count so
   * selectedCount/events reflect the full row model, not the page.
   */
  private getUniverseRows(): DisplayRowReader {
    return this.options.getFullDisplayRows?.() ?? this.options.getDisplayRows();
  }

  private getUniverseRowCount(): number {
    return this.getUniverseRows().rowCount;
  }

  /**
   * Re-apply header checkbox checked/indeterminate from SelectionStore after the
   * header row cells were re-created (e.g. horizontal column virtualization).
   * O(1): updates at most one checkbox; does not touch body rows.
   */
  refreshHeaderSelectionState(): void {
    this.refreshHeaderCheckboxAggregate();
  }

  getSelectedCount(totalRows: number): number {
    return this.store.getSelectedCount(totalRows);
  }

  /** O(1) immutable capture over the full selection universe. */
  captureSelectionSnapshot(universeRowCount: number): RowSelectionReadSnapshot {
    return this.store.captureReadSnapshot(universeRowCount);
  }

  getSelectedIds(): string[] {
    // Resolve against the full universe so the `all` model enumerates
    // every selected row, not just the current pagination page.
    const universeRows = this.getUniverseRows();
    return resolveSelectedIdsFromDisplayRows(
      this.store.snapshot(universeRows.rowCount),
      universeRows,
      this.options.resolveRowId,
    );
  }

  /**
   * Replace the entire selection with the given row ids.
   * Respects the current mode (none → no-op, single → first id only).
   * Resets the range anchor, patches pool visuals, and emits unless silent.
   */
  setSelectedIds(
    ids: string[],
    opts?: { silent?: boolean; source?: SelectionChangeSource },
  ): SelectionChange | null {
    this.syncStoreModeFromConfig();
    const n = this.getUniverseRowCount();
    const change = this.store.replaceWithIds(ids, n);
    if (!change) return null;
    this.resetAnchorSilent();
    this.patchAfterChange(change);
    if (!opts?.silent) {
      this.emit(change, opts?.source ?? "api");
    }
    this.needsHeaderAggregateRefresh = true;
    this.refreshHeaderIfDirty();
    return change;
  }

  clear(opts?: { silent?: boolean; source?: SelectionChangeSource }): SelectionChange | null {
    const n = this.getUniverseRowCount();
    const change = this.store.clear(n);
    if (!change) return null;
    this.resetAnchorSilent();
    this.patchAfterChange(change);
    if (!opts?.silent) {
      this.emit(change, opts?.source ?? "api");
    }
    this.needsHeaderAggregateRefresh = true;
    this.refreshHeaderIfDirty();
    return change;
  }

  toggleRowSelectionAtDisplayIndex(
    rowIndex: number,
    source: SelectionChangeSource = "keyboard",
  ): boolean {
    const config = this.options.getConfig();
    if (config.mode === "none") return false;
    const displayRows = this.options.getDisplayRows();
    if (rowIndex < 0 || rowIndex >= displayRows.rowCount) return false;
    if (displayRows.getRowData(rowIndex) === undefined) return false;
    this.pendingKeyboardCommand = 1;
    this.pendingKeyboardRowIndex = rowIndex;
    this.pendingKeyboardSource = source;
    this.scheduleKeyboardCommand();
    return true;
  }

  toggleAllRowSelection(
    source: SelectionChangeSource = "keyboard",
  ): boolean {
    const config = this.options.getConfig();
    if (config.mode !== "multiple") return false;
    this.pendingKeyboardCommand = 2;
    this.pendingKeyboardRowIndex = -1;
    this.pendingKeyboardSource = source;
    this.scheduleKeyboardCommand();
    return true;
  }

  selectRowAtDisplayIndex(
    rowIndex: number,
    source: SelectionChangeSource = "keyboard",
  ): boolean {
    const config = this.options.getConfig();
    if (config.mode === "none") return false;
    const displayRows = this.options.getDisplayRows();
    if (rowIndex < 0 || rowIndex >= displayRows.rowCount) return false;
    if (displayRows.getRowData(rowIndex) === undefined) return false;
    this.pendingKeyboardCommand = 3;
    this.pendingKeyboardRowIndex = rowIndex;
    this.pendingKeyboardNextRowIndex = -1;
    this.pendingKeyboardSource = source;
    this.scheduleKeyboardCommand();
    return true;
  }

  extendRowSelectionStep(
    previousRowIndex: number,
    nextRowIndex: number,
    source: SelectionChangeSource = "keyboard",
  ): boolean {
    if (this.options.getConfig().mode !== "multiple") return false;
    const displayRows = this.options.getDisplayRows();
    if (
      previousRowIndex < 0 ||
      previousRowIndex >= displayRows.rowCount ||
      nextRowIndex < 0 ||
      nextRowIndex >= displayRows.rowCount ||
      displayRows.getRowData(previousRowIndex) === undefined ||
      displayRows.getRowData(nextRowIndex) === undefined
    ) {
      return false;
    }
    this.pendingKeyboardCommand = 4;
    this.pendingKeyboardRowIndex = previousRowIndex;
    this.pendingKeyboardNextRowIndex = nextRowIndex;
    this.pendingKeyboardSource = source;
    this.scheduleKeyboardCommand();
    return true;
  }

  applyRowState(row: PooledRow, rowId: string): void {
    const selected = this.store.isSelected(rowId);
    row.element.classList.toggle("lfg-row-selected", selected);
    const cb = row.element.querySelector(
      ".lfg-row-selection-checkbox",
    ) as HTMLInputElement | null;
    if (cb) cb.checked = selected;

    if (row.pinnedElement) {
      row.pinnedElement.classList.toggle("lfg-row-selected", selected);
      const pinnedCb = row.pinnedElement.querySelector(
        ".lfg-row-selection-checkbox",
      ) as HTMLInputElement | null;
      if (pinnedCb) pinnedCb.checked = selected;
    }

    if (row.rightPinnedElement) {
      row.rightPinnedElement.classList.toggle("lfg-row-selected", selected);
    }
  }

  private firstSelectedRowIdInAllModel(): string | undefined {
    const displayRows = this.getUniverseRows();
    const ex = this.store.getExcludedIds();
    const resolve = this.options.resolveRowId;
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      const id = resolve(row, i);
      if (!ex.has(id)) return id;
    }
    return undefined;
  }

  private syncStoreModeFromConfig(): void {
    const cfg = this.options.getConfig();
    const n = this.getUniverseRowCount();

    if (cfg.mode === "single" && this.store.isAllRowsModel()) {
      const rowId = this.firstSelectedRowIdInAllModel();
      const fold = this.store.foldAllToExplicit(rowId, n);
      this.patchAfterChange(fold);
      this.emit(fold, "api");
    }

    const modeChange = this.store.setMode(cfg.mode, n);
    if (modeChange) {
      this.patchAfterChange(modeChange);
      this.emit(modeChange, "api");
    }
  }

  private schedulePostNativeCheckboxReconcile(): void {
    if (this.postSelectionReconcileScheduled) return;
    this.postSelectionReconcileScheduled = true;
    queueMicrotask(this.flushPostSelectionReconcile);
  }

  private readonly flushPostSelectionReconcile = (): void => {
    this.postSelectionReconcileScheduled = false;
    if (this.root === null) return;
    this.applyPoolRowSelectionVisuals();
    this.refreshHeaderCheckboxAggregate();
  };

  private scheduleKeyboardCommand(): void {
    if (this.keyboardCommandScheduled) return;
    this.keyboardCommandScheduled = true;
    queueMicrotask(this.flushKeyboardCommand);
  }

  private readonly flushKeyboardCommand = (): void => {
    this.keyboardCommandScheduled = false;
    const command = this.pendingKeyboardCommand;
    const rowIndex = this.pendingKeyboardRowIndex;
    const nextRowIndex = this.pendingKeyboardNextRowIndex;
    const source = this.pendingKeyboardSource;
    this.pendingKeyboardCommand = 0;
    this.pendingKeyboardRowIndex = -1;
    this.pendingKeyboardNextRowIndex = -1;
    if (this.root === null || command === 0) return;

    let change: SelectionChange | null = null;
    if (command === 1 || command === 3) {
      const config = this.options.getConfig();
      const displayRows = this.options.getDisplayRows();
      if (
        config.mode === "none" ||
        rowIndex < 0 ||
        rowIndex >= displayRows.rowCount
      ) {
        return;
      }
      const row = displayRows.getRowData(rowIndex);
      if (row === undefined) return;
      const rowId = this.options.resolveRowId(row, rowIndex);
      change = command === 1
        ? this.store.toggle(rowId, this.getUniverseRowCount())
        : this.store.selectOnly(rowId, this.getUniverseRowCount());
      if (change === null) return;
      this.anchorRowId = rowId;
      this.anchorRowIndex = rowIndex;
      this.extentLo = null;
      this.extentHi = null;
    } else if (command === 2) {
      this.syncStoreModeFromConfig();
      if (this.options.getConfig().mode !== "multiple") return;
      const totalRows = this.getUniverseRowCount();
      change = this.toggleScopedSelection(totalRows);
      if (change === null) return;
      this.resetAnchorSilent();
    } else {
      if (this.options.getConfig().mode !== "multiple") return;
      const displayRows = this.options.getDisplayRows();
      const previousRow = displayRows.getRowData(rowIndex);
      const nextRow = displayRows.getRowData(nextRowIndex);
      if (previousRow === undefined || nextRow === undefined) return;
      const previousId = this.options.resolveRowId(previousRow, rowIndex);
      const nextId = this.options.resolveRowId(nextRow, nextRowIndex);
      change = this.store.addRangeToSelection(
        [previousId, nextId],
        this.getUniverseRowCount(),
      );
      if (change === null) return;
      if (this.anchorRowId === null) {
        this.anchorRowId = previousId;
        this.anchorRowIndex = rowIndex;
      }
      this.extentLo = this.extentLo === null
        ? Math.min(rowIndex, nextRowIndex)
        : Math.min(this.extentLo, rowIndex, nextRowIndex);
      this.extentHi = this.extentHi === null
        ? Math.max(rowIndex, nextRowIndex)
        : Math.max(this.extentHi, rowIndex, nextRowIndex);
    }

    this.emit(change, source);
    this.needsHeaderAggregateRefresh = true;
    this.schedulePostNativeCheckboxReconcile();
  };

  private resetAnchorSilent(): void {
    this.anchorRowId = null;
    this.anchorRowIndex = null;
    this.extentLo = null;
    this.extentHi = null;
  }

  private ensureAnchorValid(): void {
    const displayRows = this.options.getDisplayRows();
    if (this.anchorRowIndex === null) {
      this.anchorRowId = null;
      return;
    }
    if (this.anchorRowIndex < 0 || this.anchorRowIndex >= displayRows.rowCount) {
      this.resetAnchorSilent();
      return;
    }
    const row = displayRows.getRowData(this.anchorRowIndex);
    if (row === undefined) {
      this.resetAnchorSilent();
      return;
    }
    const id = this.options.resolveRowId(row, this.anchorRowIndex);
    if (id !== this.anchorRowId) {
      this.resetAnchorSilent();
    }
  }

  private resolveClickedRowIndex(
    rowEl: HTMLElement,
    rowId: string,
  ): number {
    const attr = rowEl.getAttribute("data-row-index");
    if (attr !== null) {
      const i = parseInt(attr, 10);
      if (!Number.isNaN(i)) {
        const displayRows = this.options.getDisplayRows();
        const row = displayRows.getRowData(i);
        if (
          row !== undefined &&
          this.options.resolveRowId(row, i) === rowId
        ) {
          return i;
        }
      }
    }
    return this.findRowIndexById(rowId);
  }

  private findRowIndexById(rowId: string): number {
    const displayRows = this.options.getDisplayRows();
    const resolve = this.options.resolveRowId;
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row !== undefined && resolve(row, i) === rowId) return i;
    }
    return -1;
  }

  private rowIdsInInclusiveRange(lo: number, hi: number): string[] {
    const displayRows = this.options.getDisplayRows();
    const resolve = this.options.resolveRowId;
    const out: string[] = [];
    for (let i = lo; i <= hi; i++) {
      const row = displayRows.getRowData(i);
      if (row !== undefined) {
        out.push(resolve(row, i));
      }
    }
    return out;
  }

  private readonly applyPlainMultipleRowBodyClick = (
    rowId: string,
    rowIndex: number,
    totalRows: number,
  ): SelectionChange | null => {
    if (this.store.isSelected(rowId)) {
      const ch = this.store.toggle(rowId, totalRows);
      this.resetAnchorSilent();
      return ch;
    }
    const ch = this.store.replaceSelectionWithSingleId(rowId, totalRows);
    if (ch) {
      this.anchorRowId = rowId;
      this.anchorRowIndex = rowIndex;
    }
    return ch;
  }

  private readonly applyPlainCheckboxClick = (
    rowId: string,
    rowIndex: number,
    totalRows: number,
  ): SelectionChange | null => {
    const change = this.store.toggle(rowId, totalRows);
    if (!change) return null;
    if (this.store.isSelected(rowId)) {
      this.anchorRowId = rowId;
      this.anchorRowIndex = rowIndex;
      this.extentLo = null;
      this.extentHi = null;
    } else if (this.anchorRowId === rowId) {
      this.resetAnchorSilent();
    }
    return change;
  }

  /**
   * Shared multiple-mode modifier logic for both checkbox and body-click
   * paths. Handles Shift range, Ctrl/Meta additive, Ctrl+Shift additive
   * range, and delegates plain / no-anchor cases to the caller-provided
   * `applyPlain` callback (checkbox toggle vs. body-click replace).
   */
  private applyMultipleModeModifiers(
    mods: { range: boolean; additive: boolean },
    rowId: string,
    idx: number,
    totalRows: number,
    applyPlain: (rowId: string, idx: number, totalRows: number) => SelectionChange | null,
  ): SelectionChange | null {
    if (mods.range && mods.additive) {
      if (this.anchorRowIndex === null) {
        return this.toggleAndSetAnchor(rowId, idx, totalRows);
      }
      return this.applyRangeFromAnchor(idx, totalRows, true);
    }

    if (mods.range) {
      if (this.anchorRowIndex === null) {
        return applyPlain(rowId, idx, totalRows);
      }
      return this.applyRangeFromAnchor(idx, totalRows, false);
    }

    if (mods.additive) {
      return this.toggleAndSetAnchor(rowId, idx, totalRows);
    }

    const change = applyPlain(rowId, idx, totalRows);
    this.extentLo = null;
    this.extentHi = null;
    return change;
  }

  private toggleAndSetAnchor(
    rowId: string,
    idx: number,
    totalRows: number,
  ): SelectionChange | null {
    const change = this.store.toggle(rowId, totalRows);
    if (change) {
      this.anchorRowId = rowId;
      this.anchorRowIndex = idx;
      this.extentLo = null;
      this.extentHi = null;
    }
    return change;
  }

  private applyRangeFromAnchor(
    idx: number,
    totalRows: number,
    additive: boolean,
  ): SelectionChange | null {
    const lo = Math.min(this.anchorRowIndex!, idx);
    const hi = Math.max(this.anchorRowIndex!, idx);
    const newLo = this.extentLo !== null ? Math.min(this.extentLo, lo) : lo;
    const newHi = this.extentHi !== null ? Math.max(this.extentHi, hi) : hi;
    this.extentLo = newLo;
    this.extentHi = newHi;
    const rangeIds = this.rowIdsInInclusiveRange(newLo, newHi);
    return additive
      ? this.store.addRangeToSelection(rangeIds, totalRows)
      : this.store.replaceSelectionWithRangeIds(rangeIds, totalRows);
  }

  /**
   * Click routing for row selection (single delegated listener on the grid root):
   *
   * 1. Header checkbox → toggle all (early return).
   * 2. Row action UI (trigger / dropdown) → ignore (early return).
   * 3. Row checkbox (.lfg-row-selection-checkbox) → checkbox selection path,
   *    independent of enableRowClickSelection. Supports plain toggle and
   *    Shift-range selection in multiple mode (early return).
   * 4. Body cell click → gated by `enableRowClickSelection` AND the clicked
   *    column's `suppressRowClickSelection`. Works for center, pinned-left,
   *    and pinned-right rows uniformly.
   *
   * The selection column itself defaults `suppressRowClickSelection: true`,
   * so clicking its cell area (outside the checkbox input) does not trigger
   * body-click row selection — the checkbox input path (step 3) owns it.
   */
  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!this.root || !target) return;

    const cfg = this.options.getConfig();
    // Universe count: only ever passed to the store as `totalRows` for
    // counts/fold thresholds. Display-index logic below uses the
    // (possibly paginated) display reader directly.
    const n = this.getUniverseRowCount();

    // ── Step 1: header checkbox ──
    if (target.closest(".lfg-header-selection-checkbox")) {
      if (cfg.headerCheckbox && cfg.mode === "multiple" && cfg.checkboxes) {
        this.syncStoreModeFromConfig();
        this.toggleHeaderSelection(n);
        this.schedulePostNativeCheckboxReconcile();
      }
      return;
    }

    // ── Step 2: row action UI (trigger button, dropdown panel) ──
    if (isRowActionUiTarget(target)) return;

    // Cell-shell action elements (button/iconButton/link with actionKey) emit
    // their own delegated action and must never toggle row selection.
    if (isCellShellActionTarget(target)) return;
    if (isCellShellOverlayTarget(target)) return;

    const rowEl = target.closest(".lfg-row, .lfg-pinned-row, .lfg-pinned-right-row") as HTMLElement | null;
    if (!rowEl || !this.root.contains(rowEl)) return;

    const rowId = rowEl.getAttribute("data-row-id");
    if (!rowId) return;

    // ── Step 3: row checkbox (works when checkboxes are enabled,
    //    independent of enableRowClickSelection) ──
    if (target.closest(".lfg-row-selection-checkbox")) {
      if (!cfg.checkboxes || cfg.mode === "none") return;
      this.syncStoreModeFromConfig();

      if (cfg.mode === "multiple") {
        this.ensureAnchorValid();
        const idx = this.resolveClickedRowIndex(rowEl, rowId);
        if (idx < 0) return;

        const mods = selectionPointerModifiers(event);
        const change = this.applyMultipleModeModifiers(
          mods, rowId, idx, n, this.applyPlainCheckboxClick,
        );
        if (!change) { this.schedulePostNativeCheckboxReconcile(); return; }
        this.patchAfterChange(change);
        this.emit(change, "click");
      } else {
        const change = this.store.toggle(rowId, n);
        if (!change) return;
        this.patchAfterChange(change);
        this.emit(change, "click");
      }
      this.schedulePostNativeCheckboxReconcile();
      return;
    }

    // ── Step 4: body cell click selection ──
    if (!cfg.enableRowClickSelection || cfg.mode === "none") return;

    // Per-column opt-out: columns with suppressRowClickSelection (e.g. the
    // internal selection column, action columns) skip body-click selection.
    const cellEl = target.closest(".lfg-cell") as HTMLElement | null;
    if (cellEl) {
      const colId = cellEl.getAttribute("data-col-id");
      if (colId) {
        const col = this.options.getColumns().find((c) => c.field === colId);
        if (col?.suppressRowClickSelection) return;
      }
    }

    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }

    this.syncStoreModeFromConfig();
    this.ensureAnchorValid();

    const idx = this.resolveClickedRowIndex(rowEl, rowId);
    if (idx < 0) return;

    if (cfg.mode === "single") {
      const change = this.store.singleModeBodyClick(rowId, n);
      if (!change) return;
      if (this.store.getSelectedCount(n) === 0) {
        this.resetAnchorSilent();
      } else {
        this.anchorRowId = rowId;
        this.anchorRowIndex = idx;
      }
      this.patchAfterChange(change);
      this.emit(change, "click");
      this.needsHeaderAggregateRefresh = true;
      this.refreshHeaderIfDirty();
      return;
    }

    const mods = selectionPointerModifiers(event);
    const change = this.applyMultipleModeModifiers(
      mods, rowId, idx, n, this.applyPlainMultipleRowBodyClick,
    );

    if (!change) return;
    this.patchAfterChange(change);
    this.emit(change, "click");
    this.needsHeaderAggregateRefresh = true;
    this.refreshHeaderIfDirty();
  };

  private toggleHeaderSelection(totalRows: number): void {
    const change = this.toggleScopedSelection(totalRows);
    if (change) this.finishHeaderToggle(change);
  }

  /**
   * Shared select/clear for the configured `selectAllScope`. Used by the
   * header checkbox (`source: "click"`) and Ctrl/Cmd+A (`source:
   * "keyboard"`). `"all"`, and `"page"` when the displayed rows are the
   * whole universe, keep the O(1) bulk model. `"page"` with pagination
   * slicing operates only on displayed IDs and preserves other pages.
   */
  private toggleScopedSelection(totalRows: number): SelectionChange | null {
    if (totalRows === 0) return null;

    if (
      this.options.getConfig().selectAllScope === "all" ||
      this.displayedRowsAreUniverse(totalRows)
    ) {
      const allSelected = this.store.isAllSelected(totalRows);
      return allSelected
        ? this.store.clear(totalRows)
        : this.store.selectAll(totalRows);
    }

    const { pageRowIds, allPageSelected } = this.collectPageSelectionState();
    if (pageRowIds.length === 0) return null;
    return allPageSelected
      ? this.store.deselectIds(pageRowIds, totalRows)
      : this.store.selectIds(pageRowIds, totalRows);
  }

  /** True when the display reader covers the entire selection universe. */
  private displayedRowsAreUniverse(universeRowCount: number): boolean {
    return this.options.getDisplayRows().rowCount === universeRowCount;
  }

  private finishHeaderToggle(change: SelectionChange): void {
    this.resetAnchorSilent();
    this.patchAfterChange(change);
    this.emit(change, "click");
    this.needsHeaderAggregateRefresh = true;
    this.refreshHeaderIfDirty();
  }

  /**
   * One scan over the current display rows (the page): collect their
   * ids and whether every one of them is already selected.
   */
  private collectPageSelectionState(): {
    pageRowIds: string[];
    allPageSelected: boolean;
  } {
    const displayRows = this.options.getDisplayRows();
    const resolve = this.options.resolveRowId;
    const pageRowIds: string[] = [];
    let allPageSelected = true;
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      const id = resolve(row, i);
      pageRowIds.push(id);
      if (!this.store.isSelected(id)) allPageSelected = false;
    }
    if (pageRowIds.length === 0) allPageSelected = false;
    return { pageRowIds, allPageSelected };
  }

  private getHeaderSelectionCheckbox(): HTMLInputElement | null {
    // Selection column may be in the pinned header row or the center header row.
    for (const getRow of [this.options.getPinnedHeaderRowEl, this.options.getHeaderRowEl]) {
      const row = getRow?.();
      if (!row) continue;
      const cell = row.querySelector(
        `.lfg-header-cell[data-col-id="${SELECTION_COLUMN_FIELD}"], .lfg-header-cell[data-col-id="${ROW_CONTROLS_COLUMN_FIELD}"]`,
      );
      if (!cell) continue;
      const input = cell.querySelector(
        ".lfg-header-selection-checkbox",
      ) as HTMLInputElement | null;
      if (input) return input;
    }
    return null;
  }

  private refreshHeaderCheckboxAggregate(): void {
    const input = this.getHeaderSelectionCheckbox();
    if (!input) return;

    const universeRowCount = this.getUniverseRowCount();
    if (
      this.options.getConfig().selectAllScope === "all" ||
      this.displayedRowsAreUniverse(universeRowCount)
    ) {
      // O(1) store aggregates — also used for page scope when the page
      // is the whole universe (mirrors the toggle fast path).
      if (universeRowCount === 0) {
        input.checked = false;
        input.indeterminate = false;
        return;
      }
      input.checked = this.store.isAllSelected(universeRowCount);
      input.indeterminate = this.store.isPartiallySelected(universeRowCount);
      return;
    }

    // Scope "page": the header reflects the current display rows only.
    // Fast path: nothing selected anywhere → unchecked, no scan.
    if (this.store.getSelectedCount(universeRowCount) === 0) {
      input.checked = false;
      input.indeterminate = false;
      return;
    }
    const displayRows = this.options.getDisplayRows();
    const resolve = this.options.resolveRowId;
    let pageRows = 0;
    let selectedOnPage = 0;
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      pageRows++;
      if (this.store.isSelected(resolve(row, i))) selectedOnPage++;
    }
    input.checked = pageRows > 0 && selectedOnPage === pageRows;
    input.indeterminate = selectedOnPage > 0 && selectedOnPage < pageRows;
  }

  private refreshHeaderIfDirty(): void {
    if (!this.needsHeaderAggregateRefresh) return;
    this.refreshHeaderCheckboxAggregate();
    this.needsHeaderAggregateRefresh = false;
  }

  private applyPoolRowSelectionVisuals(): void {
    for (const row of this.options.getPool()) {
      if (row.rowId) this.applyRowState(row, row.rowId);
    }
  }

  private patchAfterChange(change: SelectionChange): void {
    const n = change.changedIds.length;
    if (n > 0 && n <= RowSelectionController.MAX_INCREMENTAL_PATCH) {
      const changed = new Set(change.changedIds);
      for (const row of this.options.getPool()) {
        if (!row.rowId || !changed.has(row.rowId)) continue;
        this.applyRowState(row, row.rowId);
      }
      return;
    }

    if (
      change.kind === "selectAll" ||
      change.kind === "clear" ||
      change.kind === "single" ||
      change.kind === "api" ||
      (change.kind === "mode" && change.changedIds.length === 0) ||
      n > RowSelectionController.MAX_INCREMENTAL_PATCH ||
      (change.kind === "toggle" && n === 0)
    ) {
      this.applyPoolRowSelectionVisuals();
    }
  }

  private emit(
    change: SelectionChange,
    source: SelectionChangeSource,
  ): void {
    this.options.onSelectionChanged?.(change, source);
  }
}
