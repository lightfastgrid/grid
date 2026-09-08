import { isBooleanCellValue } from "../../internal/booleanCellValue";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type { ColumnDef, RowData } from "../../types";
import { CELL_SHELL_CHECKBOX_INPUT_SELECTOR } from "../cell-shells/cellShellActionDom";

import {
  type BooleanCellTarget,
  type BooleanCommitOperationDeps,
  commitBooleanCell,
} from "./booleanCommitOperation";
import { prepareCommit } from "./commitPreparation";
import {
  addEditingClass,
  clearInvalid,
  ensureEditorHost,
  mountEditor,
  removeEditingClass,
  unmountEditor,
} from "./editingDom";
import { findCellFromEvent, isEditableKeyboardTarget, isPrintableKey } from "./editingEventHelpers";
import { EditingStore } from "./EditingStore";
import type { EditCommitChange } from "./editingTypes";
import type { EditorInstance } from "./EditorPool";
import { EditorPool } from "./EditorPool";
import { EditorValidationSemantics } from "./editorValidationSemantics";
import { resolveCellEditEligibility } from "./eligibility";
import { getEditableFieldValue } from "./fieldPath";
import { resolveCheckboxActivation } from "./resolveCheckboxActivation";
import { resolveEditor } from "./resolveEditor";

// ── Public types ───────────────────────────────────────────────────

export type { EditCommitChange } from "./editingTypes";

export interface EditTarget {
  rowId?: string;
  rowIndex?: number;
  field: string;
  charSeed?: string;
}

export interface EditingEvent {
  rowId: string;
  rowIndex: number;
  field: string;
}

export interface EditCommittedEvent extends EditingEvent {
  changed: boolean;
}

export interface EditingDeps {
  getColumns(): readonly ColumnDef[];
  getDisplayRows(): DisplayRowReader;
  resolveRowId(row: RowData, index: number): string;
  getFocusedCell(): { rowIndex: number; field: string } | null;
  setFocusedCell(target: { rowIndex: number; field: string }, source: string): void;
  findCellElement(rowId: string, field: string): HTMLElement | null;
  commitEdit(change: EditCommitChange): void;
  onEditStarted?(event: EditingEvent): void;
  onEditCommitted?(event: EditCommittedEvent): void;
  onEditCanceled?(event: EditingEvent): void;
  /** Production composite-grid entry is owned by the accessibility coordinator. */
  keyboardNavigation?: boolean;
}

// ── Controller ─────────────────────────────────────────────────────

export class EditingController {
  readonly store = new EditingStore();
  private readonly pool = new EditorPool();
  private readonly validation = new EditorValidationSemantics();
  private readonly deps: EditingDeps;
  private root: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private currentCell: HTMLElement | null = null;
  private currentHost: HTMLElement | null = null;
  private currentEditor: EditorInstance | null = null;
  private readonly columnsByField = new Map<string, ColumnDef>();
  private lastColumns: readonly ColumnDef[] | null = null;
  private readonly booleanCommitDeps: BooleanCommitOperationDeps;

  // Changed commits keep the editor host mounted until the next rAF so
  // stale cell text is never exposed between commit and render patch.
  // The grid schedules its dirty-patch render on rAF; the deferred
  // teardown rAF queues after it, so final paint shows the patched value.
  private pendingTeardownId: number | null = null;
  private pendingTeardownCell: HTMLElement | null = null;
  private pendingTeardownHost: HTMLElement | null = null;

  private starting = false;
  private dateBlurTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onDblClick = (e: MouseEvent) => this.handleDblClick(e);
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
  private readonly onBlur = (e: FocusEvent) => this.handleBlur(e);
  private readonly onChange = (e: Event) => this.handleChange(e);
  private readonly onClick = (e: MouseEvent) => this.handleClick(e);
  private readonly onScroll = () => this.handleScroll();

  constructor(deps: EditingDeps) {
    this.deps = deps;
    this.booleanCommitDeps = {
      getColumns: deps.getColumns,
      getColumnByField: (field) => this.columnsByField.get(field),
      getDisplayRows: deps.getDisplayRows,
      resolveRowId: deps.resolveRowId,
      commitEdit: deps.commitEdit,
    };
  }

  attach(root: HTMLElement, viewport: HTMLElement): void {
    this.syncColumnIndex();
    this.root = root;
    this.viewport = viewport;
    root.addEventListener("dblclick", this.onDblClick);
    root.addEventListener("keydown", this.onKeyDown);
    root.addEventListener("click", this.onClick);
    root.addEventListener("focusout", this.onBlur);
    root.addEventListener("change", this.onChange);
    viewport.addEventListener("scroll", this.onScroll);
  }

  detach(): void {
    if (this.root) {
      this.root.removeEventListener("dblclick", this.onDblClick);
      this.root.removeEventListener("keydown", this.onKeyDown);
      this.root.removeEventListener("click", this.onClick);
      this.root.removeEventListener("focusout", this.onBlur);
      this.root.removeEventListener("change", this.onChange);
      this.root = null;
    }
    if (this.viewport) {
      this.viewport.removeEventListener("scroll", this.onScroll);
      this.viewport = null;
    }
  }

  destroy(): void {
    this.clearDateBlurTimer();
    this.flushDeferredCommitTeardown();
    this.stopEdit({ commit: false });
    this.detach();
    this.validation.destroy();
    this.pool.destroy();
  }

  getEditingCell(): { rowId: string; field: string } | null {
    const active = this.store.get();
    if (!active) return null;
    return { rowId: active.rowId, field: active.field };
  }

  isEditing(): boolean {
    return this.store.get() !== null;
  }

  toggleBooleanCell(target: BooleanCellTarget): boolean {
    this.syncColumnIndex();
    return commitBooleanCell(this.booleanCommitDeps, target);
  }

  toggleBooleanCellAtDisplayIndex(rowIndex: number, field: string): boolean {
    if (!this.hasCurrentColumnIndex()) return false;
    return commitBooleanCell(this.booleanCommitDeps, { rowIndex, field });
  }

  getBooleanCellKeyboardMode(
    target: BooleanCellTarget,
  ): "toggle" | "edit" | null {
    const rowIndex = target.rowIndex;
    if (
      rowIndex === undefined ||
      !Number.isSafeInteger(rowIndex) ||
      rowIndex < 0
    ) {
      return null;
    }
    const resolved = this.resolveBooleanCell(rowIndex, target.field);
    if (resolved === null || resolved.editorConfig.kind !== "checkbox") {
      return null;
    }
    if (
      target.rowId !== undefined &&
      this.deps.resolveRowId(resolved.row, rowIndex) !== target.rowId
    ) {
      return null;
    }
    return resolveCheckboxActivation(
      resolved.editorConfig.activation,
      resolved.column,
    );
  }

  getBooleanCellKeyboardModeAtDisplayIndex(
    rowIndex: number,
    field: string,
  ): "toggle" | "edit" | null {
    if (!this.hasCurrentColumnIndex()) return null;
    return this.getBooleanCellKeyboardMode({ rowIndex, field });
  }

  // ── Start ──────────────────────────────────────────────────────

  startEdit(target: EditTarget): boolean {
    this.syncColumnIndex();
    this.starting = true;
    try {
      return this.startEditInner(target);
    } finally {
      this.starting = false;
    }
  }

  startEditAtDisplayIndex(
    rowIndex: number,
    field: string,
    cellElement: HTMLElement,
    charSeed?: string,
  ): boolean {
    if (!this.hasCurrentColumnIndex() || !cellElement.isConnected) return false;
    this.starting = true;
    try {
      return this.startEditInner(
        { rowIndex, field, charSeed },
        cellElement,
      );
    } finally {
      this.starting = false;
    }
  }

  private startEditInner(
    target: EditTarget,
    retainedCellElement?: HTMLElement,
  ): boolean {
    this.flushDeferredCommitTeardown();
    const reader = this.deps.getDisplayRows();

    let row: RowData | undefined;
    let rowIndex: number;
    let sourceIndex: number;

    if (target.rowId !== undefined) {
      rowIndex = -1;
      for (let i = 0; i < reader.rowCount; i++) {
        const r = reader.getRowData(i);
        if (r && this.deps.resolveRowId(r, i) === target.rowId) {
          rowIndex = i;
          row = r;
          break;
        }
      }
      if (rowIndex === -1) return false;
      sourceIndex = reader.getSourceIndex(rowIndex);
    } else if (target.rowIndex !== undefined) {
      rowIndex = target.rowIndex;
      row = reader.getRowData(rowIndex);
      sourceIndex = reader.getSourceIndex(rowIndex);
    } else {
      return false;
    }

    if (!row || sourceIndex < 0) return false;

    const column = this.columnsByField.get(target.field);
    if (!column) return false;

    const fieldResult = getEditableFieldValue(row, target.field);
    const rawValue = fieldResult.ok ? fieldResult.value : undefined;

    const eligibility = resolveCellEditEligibility({
      row,
      rowIndex,
      column,
      field: target.field,
      value: rawValue,
    });
    if (!eligibility.editable) return false;

    const editorConfig = resolveEditor(column, rawValue);
    if (
      editorConfig.kind === "checkbox" &&
      resolveCheckboxActivation(editorConfig.activation, column) === "toggle"
    ) {
      return false;
    }
    const rowId = target.rowId ?? this.deps.resolveRowId(row, rowIndex);

    if (this.store.get()) {
      const closed = this.stopEdit({ commit: true });
      if (!closed) return false;
    }

    const cellEl = retainedCellElement ??
      this.deps.findCellElement(rowId, target.field);
    if (!cellEl) return false;

    const editor = this.pool.get(editorConfig);
    this.validation.clear(null, editor.element);
    const host = ensureEditorHost(cellEl);
    mountEditor(host, editor.element);
    addEditingClass(cellEl);

    const seedValue = target.charSeed !== undefined ? target.charSeed : rawValue;
    editor.setValue(seedValue);

    this.store.start({
      rowId,
      rowIndex,
      field: target.field,
      sourceIndex,
      originalValue: rawValue,
      editorConfig,
    });

    this.currentCell = cellEl;
    this.currentHost = host;
    this.currentEditor = editor;

    editor.focus();
    this.deps.onEditStarted?.({ rowId, rowIndex, field: target.field });
    return true;
  }

  // ── Stop ───────────────────────────────────────────────────────

  stopEdit({ commit }: { commit: boolean }): boolean {
    return this.stopEditInner(commit, true);
  }

  stopEditFromCommand(commit: boolean): boolean {
    return this.stopEditInner(commit, false);
  }

  private stopEditInner(commit: boolean, allowRowScan: boolean): boolean {
    this.clearDateBlurTimer();
    const active = this.store.get();
    if (!active) return true;
    this.flushDeferredCommitTeardown();

    if (!commit) {
      this.teardownEditor();
      const event = { rowId: active.rowId, rowIndex: active.rowIndex, field: active.field };
      this.store.clear();
      this.deps.onEditCanceled?.(event);
      return true;
    }

    const resolved = this.resolveActiveRow(
      active.rowId,
      active.rowIndex,
      allowRowScan,
    );
    if (!resolved) {
      if (!allowRowScan) return false;
      this.teardownEditor();
      const event = { rowId: active.rowId, rowIndex: active.rowIndex, field: active.field };
      this.store.clear();
      this.deps.onEditCanceled?.(event);
      return true;
    }

    const rawEditorValue = this.currentEditor
      ? String(this.currentEditor.getValue())
      : "";
    const result = prepareCommit(
      resolved.row,
      active.field,
      active.editorConfig,
      rawEditorValue,
    );

    if (!result.ok) {
      if (this.currentCell && this.currentHost && this.currentEditor) {
        this.validation.expose({
          cell: this.currentCell,
          host: this.currentHost,
          editor: this.currentEditor.element,
          message: result.reason,
        });
        this.currentEditor.focus();
      }
      return false;
    }

    this.validation.clear(
      this.currentCell,
      this.currentEditor?.element ?? null,
    );

    if (!result.changed) {
      this.teardownEditor();
      const event = { rowId: active.rowId, rowIndex: resolved.rowIndex, field: active.field, changed: false };
      this.store.clear();
      this.deps.onEditCommitted?.(event);
      return true;
    }

    const newFieldResult = getEditableFieldValue(result.row, active.field);
    this.deps.commitEdit({
      rowId: active.rowId,
      rowIndex: resolved.rowIndex,
      sourceIndex: resolved.sourceIndex,
      field: active.field,
      updatedRow: result.row,
      oldValue: active.originalValue,
      newValue: newFieldResult.ok ? newFieldResult.value : undefined,
      topLevelField: result.topLevelField,
    });

    this.store.clear();
    this.scheduleDeferredCommitTeardown();
    const event = { rowId: active.rowId, rowIndex: resolved.rowIndex, field: active.field, changed: true };
    this.deps.onEditCommitted?.(event);
    return true;
  }

  // ── Sync after render ──────────────────────────────────────────

  syncAfterRender(): void {
    this.syncColumnIndex();
    const active = this.store.get();
    if (!active) return;

    const cellEl = this.deps.findCellElement(active.rowId, active.field);
    if (!cellEl) {
      this.stopEdit({ commit: true });
      return;
    }

    if (cellEl !== this.currentCell && this.currentEditor) {
      const previousCell = this.currentCell;
      const host = ensureEditorHost(cellEl);
      mountEditor(host, this.currentEditor.element);
      addEditingClass(cellEl);
      if (previousCell) {
        removeEditingClass(previousCell);
        this.validation.move(previousCell, cellEl, host);
      }
      this.currentCell = cellEl;
      this.currentHost = host;
    }
  }

  // ── Delegated event handlers ───────────────────────────────────

  private handleDblClick(e: MouseEvent): void {
    const cell = findCellFromEvent(e);
    if (!cell) return;
    const resolved = this.resolveBooleanCell(cell.rowIndex, cell.field);
    if (
      resolved !== null &&
      resolved.editorConfig.kind === "checkbox" &&
      resolveCheckboxActivation(resolved.editorConfig.activation, resolved.column) ===
        "toggle"
    ) {
      return;
    }
    const started = this.startEdit({ rowIndex: cell.rowIndex, field: cell.field });
    if (started) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target;
    const inputConstructor =
      this.root?.ownerDocument.defaultView?.HTMLInputElement;
    if (
      inputConstructor === undefined ||
      !(target instanceof inputConstructor) ||
      !target.matches(CELL_SHELL_CHECKBOX_INPUT_SELECTOR)
    ) {
      return;
    }

    const cell = findCellFromEvent(e);
    if (!cell) return;
    const input = target;
    const resolved = this.resolveBooleanCell(cell.rowIndex, cell.field);
    if (
      resolved === null ||
      resolved.editorConfig.kind !== "checkbox" ||
      !isBooleanCellValue(resolved.value)
    ) {
      input.checked = resolved?.value === true;
      return;
    }

    const activation = resolveCheckboxActivation(
      resolved.editorConfig.activation,
      resolved.column,
    );
    if (
      activation !== "toggle" ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey
    ) {
      input.checked = resolved.value === true;
      return;
    }

    try {
      const committed = commitBooleanCell(
        this.booleanCommitDeps,
        { rowIndex: cell.rowIndex, field: cell.field },
        input.checked,
      );
      if (!committed) input.checked = resolved.value === true;
    } catch (error) {
      input.checked = resolved.value === true;
      throw error;
    }
  }

  private resolveBooleanCell(
    rowIndex: number,
    field: string,
  ): {
    row: RowData;
    column: ColumnDef;
    value: unknown;
    editorConfig: ReturnType<typeof resolveEditor>;
  } | null {
    const row = this.deps.getDisplayRows().getRowData(rowIndex);
    if (row === undefined) return null;
    const column = this.columnsByField.get(field);
    if (column === undefined) return null;
    const fieldResult = getEditableFieldValue(row, field);
    const value = fieldResult.ok ? fieldResult.value : undefined;
    return { row, column, value, editorConfig: resolveEditor(column, value) };
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    const active = this.store.get();
    if (active) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stopEdit({ commit: true });
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.stopEdit({ commit: false });
        return;
      }
      return;
    }

    if (this.deps.keyboardNavigation === false) return;

    if (isEditableKeyboardTarget(e, this.currentHost)) return;

    const focused = this.deps.getFocusedCell();
    if (!focused) return;

    if (e.key === "Enter" || e.key === "F2") {
      const started = this.startEdit({ rowIndex: focused.rowIndex, field: focused.field });
      if (started) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (isPrintableKey(e)) {
      const started = this.startEdit({
        rowIndex: focused.rowIndex,
        field: focused.field,
        charSeed: e.key,
      });
      if (started) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  }

  private handleBlur(e: FocusEvent): void {
    if (!this.store.get() || this.starting) return;
    const relatedTarget = e.relatedTarget as Node | null;
    if (relatedTarget && this.currentHost?.contains(relatedTarget)) return;

    // Native date picker popup causes focusout with null relatedTarget.
    // Defer the commit so the picker can operate; if focus returns to
    // the editor element the commit is cancelled.
    if (this.currentEditor?.kind === "date" && !relatedTarget) {
      this.scheduleDateBlurCommit();
      return;
    }

    this.stopEdit({ commit: true });
  }

  private scheduleDateBlurCommit(): void {
    this.clearDateBlurTimer();
    this.dateBlurTimer = setTimeout(() => {
      this.dateBlurTimer = null;
      if (!this.store.get()) return;
      if (this.currentHost?.contains(document.activeElement)) return;
      this.stopEdit({ commit: true });
    }, 150);
  }

  private clearDateBlurTimer(): void {
    if (this.dateBlurTimer !== null) {
      clearTimeout(this.dateBlurTimer);
      this.dateBlurTimer = null;
    }
  }

  private handleChange(e: Event): void {
    if (!this.store.get() || this.starting) return;
    if (!this.currentEditor || !this.currentHost) return;
    if (!this.currentHost.contains(e.target as Node)) return;
    if (this.currentEditor.kind === "select" || this.currentEditor.kind === "checkbox") {
      this.stopEdit({ commit: true });
    }
  }

  private syncColumnIndex(): void {
    const columns = this.deps.getColumns();
    if (columns === this.lastColumns) return;
    this.columnsByField.clear();
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i]!;
      if (!this.columnsByField.has(column.field)) {
        this.columnsByField.set(column.field, column);
      }
    }
    this.lastColumns = columns;
  }

  private hasCurrentColumnIndex(): boolean {
    return this.lastColumns !== null && this.deps.getColumns() === this.lastColumns;
  }

  private handleScroll(): void {
    if (this.store.get()) {
      this.stopEdit({ commit: true });
    }
  }

  // ── Editor lifecycle ───────────────────────────────────────────

  private resolveActiveRow(
    rowId: string,
    preferredRowIndex: number,
    allowScan: boolean,
  ): { row: RowData; rowIndex: number; sourceIndex: number } | null {
    const reader = this.deps.getDisplayRows();
    if (
      preferredRowIndex >= 0 &&
      preferredRowIndex < reader.rowCount
    ) {
      const preferred = reader.getRowData(preferredRowIndex);
      if (
        preferred !== undefined &&
        this.deps.resolveRowId(preferred, preferredRowIndex) === rowId
      ) {
        return {
          row: preferred,
          rowIndex: preferredRowIndex,
          sourceIndex: reader.getSourceIndex(preferredRowIndex),
        };
      }
    }
    if (!allowScan) return null;
    for (let i = 0; i < reader.rowCount; i++) {
      const r = reader.getRowData(i);
      if (r && this.deps.resolveRowId(r, i) === rowId) {
        return { row: r, rowIndex: i, sourceIndex: reader.getSourceIndex(i) };
      }
    }
    return null;
  }

  private scheduleDeferredCommitTeardown(): void {
    this.pendingTeardownCell = this.currentCell;
    this.pendingTeardownHost = this.currentHost;
    this.currentCell = null;
    this.currentHost = null;
    this.currentEditor = null;

    const doTeardown = () => {
      this.pendingTeardownId = null;
      if (this.pendingTeardownHost) unmountEditor(this.pendingTeardownHost);
      if (this.pendingTeardownCell) {
        removeEditingClass(this.pendingTeardownCell);
        clearInvalid(this.pendingTeardownCell);
      }
      this.pendingTeardownCell = null;
      this.pendingTeardownHost = null;
    };

    if (typeof requestAnimationFrame === "function") {
      this.pendingTeardownId = requestAnimationFrame(doTeardown);
    } else {
      doTeardown();
    }
  }

  private flushDeferredCommitTeardown(): void {
    if (this.pendingTeardownId !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.pendingTeardownId);
      }
      this.pendingTeardownId = null;
      if (this.pendingTeardownHost) unmountEditor(this.pendingTeardownHost);
      if (this.pendingTeardownCell) {
        removeEditingClass(this.pendingTeardownCell);
        clearInvalid(this.pendingTeardownCell);
      }
      this.pendingTeardownCell = null;
      this.pendingTeardownHost = null;
    }
  }

  private teardownEditor(): void {
    this.validation.clear(
      this.currentCell,
      this.currentEditor?.element ?? null,
    );
    if (this.currentHost) {
      unmountEditor(this.currentHost);
    }
    if (this.currentCell) {
      removeEditingClass(this.currentCell);
    }
    this.currentCell = null;
    this.currentHost = null;
    this.currentEditor = null;
  }

}
