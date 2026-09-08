import { isInternalColumn } from "../../internal/internalColumns";
import {
  captureIdMembership,
  type ImmutableIdMembership,
} from "../../internal/readSnapshots";
import { selectionPointerModifiers } from "../../internal/selectionModifiers";
import type {
  ColumnSelectionChangeSource,
  ColumnSelectionConfig,
  LightFastGridColumnSelectionChangedEvent,
} from "../../types";
import { isColumnMenuUiTarget } from "../column-menu/columnMenuDom";
import { isDedicatedFilterUiTarget } from "../filters/dedicatedFilterDom";
import { isHeaderActionUiTarget } from "../header-actions/headerActionDom";

function symmetricDiffFields(prev: Set<string>, next: Set<string>): string[] {
  const out: string[] = [];
  for (const id of prev) {
    if (!next.has(id)) out.push(id);
  }
  for (const id of next) {
    if (!prev.has(id)) out.push(id);
  }
  return out;
}

export interface ColumnSelectionControllerOptions {
  getConfig: () => ColumnSelectionConfig;
  getHeaderRowEl: () => HTMLDivElement | null;
  getPinnedHeaderRowEl?: () => HTMLDivElement | null;
  getPinnedRightHeaderRowEl?: () => HTMLDivElement | null;
  /** Selectable column field ids in rendered order (excludes internal checkbox column, invisible cols). */
  getSelectableColumnIds: () => string[];
  onChanged?: (e: LightFastGridColumnSelectionChangedEvent) => void;
  /** Apply `.lfg-column-selected` to visible header/body/floating-filter cells (no window sync). */
  syncColumnSelectionClasses?: () => void;
}

/**
 * Owns selected column field ids; header clicks and imperative clear API.
 */
export class ColumnSelectionController {
  private root: HTMLElement | null = null;
  private selected = new Set<string>();
  private selectableFields = new Set<string>();
  private selectedShared = false;
  /** Last header-driven range anchor; drives shift-range selection. */
  private anchorField: string | null = null;
  /** Range extent bounds (indices into selectable order). Expand-only on repeated shift-clicks. */
  private extentLo: number | null = null;
  private extentHi: number | null = null;
  private outsideClickListenerAttached = false;
  private pendingCommandField: string | null = null;
  private pendingCommandSource: ColumnSelectionChangeSource = "keyboard";
  private commandScheduled = false;

  constructor(private readonly options: ColumnSelectionControllerOptions) {}

  attach(root: HTMLElement): void {
    this.detach();
    this.root = root;
    this.syncSelectableFields();
    this.root.addEventListener("click", this.onClick);
    this.syncInteractionListeners();
  }

  detach(): void {
    this.teardownDocumentListeners();
    if (this.root) {
      this.root.removeEventListener("click", this.onClick);
      this.root = null;
    }
    this.replaceSelected(new Set());
    this.selectableFields.clear();
    this.pendingCommandField = null;
    this.commandScheduled = false;
    this.anchorField = null;
    this.extentLo = null;
    this.extentHi = null;
  }

  /**
   * Document listener for `clearOnOutsideClick` only (`Escape` is handled by the input feature).
   */
  syncInteractionListeners(): void {
    if (!this.root) {
      this.teardownOutsideClickListener();
      return;
    }
    const cfg = this.options.getConfig();
    const wantOutside = cfg.enabled && cfg.clearOnOutsideClick;

    if (wantOutside && !this.outsideClickListenerAttached) {
      document.addEventListener("click", this.onDocumentClick, true);
      this.outsideClickListenerAttached = true;
    } else if (!wantOutside && this.outsideClickListenerAttached) {
      document.removeEventListener("click", this.onDocumentClick, true);
      this.outsideClickListenerAttached = false;
    }
  }

  private teardownOutsideClickListener(): void {
    if (this.outsideClickListenerAttached) {
      document.removeEventListener("click", this.onDocumentClick, true);
      this.outsideClickListenerAttached = false;
    }
  }

  private teardownDocumentListeners(): void {
    this.teardownOutsideClickListener();
  }

  private readonly onDocumentClick = (event: MouseEvent): void => {
    const cfg = this.options.getConfig();
    if (!cfg.enabled || !cfg.clearOnOutsideClick || !this.root) return;
    const t = event.target;
    if (t instanceof Node && this.root.contains(t)) return;
    if (this.selected.size === 0) return;
    const prev = new Set(this.selected);
    this.replaceSelected(new Set());
    this.anchorField = null;
    this.extentLo = null;
    this.extentHi = null;
    const changed = symmetricDiffFields(prev, this.selected);
    if (changed.length > 0) {
      this.emit(changed, "click");
    }
    this.options.syncColumnSelectionClasses?.();
  };

  isColumnSelected(field: string): boolean {
    return this.selected.has(field);
  }

  toggleColumnSelection(
    field: string,
    source: ColumnSelectionChangeSource = "keyboard",
  ): boolean {
    const config = this.options.getConfig();
    if (
      this.root === null ||
      !config.enabled ||
      !this.selectableFields.has(field)
    ) {
      return false;
    }
    this.pendingCommandField = field;
    this.pendingCommandSource = source;
    if (!this.commandScheduled) {
      this.commandScheduled = true;
      queueMicrotask(this.flushColumnSelectionCommand);
    }
    return true;
  }

  getSelectedColumnIds(): string[] {
    return Array.from(this.selected);
  }

  captureColumnSelectionSnapshot(): ImmutableIdMembership<string> {
    this.selectedShared = true;
    return captureIdMembership(this.selected);
  }

  setSelectedColumnIds(
    ids: string[],
    opts?: { silent?: boolean; source?: ColumnSelectionChangeSource },
  ): boolean {
    const cfg = this.options.getConfig();
    const prev = new Set(this.selected);
    const nextIds: string[] = [];
    if (cfg.enabled && ids.length > 0) {
      const selectable = new Set(this.options.getSelectableColumnIds());
      const seen = new Set<string>();
      for (const id of ids) {
        if (!selectable.has(id) || seen.has(id)) continue;
        nextIds.push(id);
        seen.add(id);
        if (cfg.mode === "single") break;
      }
    }

    const next = new Set(nextIds);
    const changed = symmetricDiffFields(prev, next);
    if (changed.length === 0) return false;

    this.replaceSelected(next);
    this.anchorField = nextIds[0] ?? null;
    this.extentLo = null;
    this.extentHi = null;

    if (!opts?.silent) {
      this.emit(changed, opts?.source ?? "api");
    }
    this.options.syncColumnSelectionClasses?.();
    return true;
  }

  /** Returns true if selection or anchor was cleared. */
  clear(opts?: { silent?: boolean; source?: ColumnSelectionChangeSource }): boolean {
    const prev = new Set(this.selected);
    const hadAnchor = this.anchorField !== null;
    if (prev.size === 0 && !hadAnchor) return false;
    this.replaceSelected(new Set());
    this.anchorField = null;
    this.extentLo = null;
    this.extentHi = null;
    const changed = symmetricDiffFields(prev, this.selected);
    if (!opts?.silent && changed.length > 0) {
      this.emit(changed, opts?.source ?? "api");
    }
    this.options.syncColumnSelectionClasses?.();
    return true;
  }

  /**
   * When feature is disabled via config, clear without event and refresh DOM.
   */
  syncDisabledFromConfig(): void {
    const cfg = this.options.getConfig();
    if (cfg.enabled) {
      this.syncInteractionListeners();
      return;
    }
    if (this.selected.size === 0 && this.anchorField === null) {
      this.syncInteractionListeners();
      return;
    }
    this.replaceSelected(new Set());
    this.anchorField = null;
    this.extentLo = null;
    this.extentHi = null;
    this.options.syncColumnSelectionClasses?.();
    this.syncInteractionListeners();
  }

  /**
   * Drop selection/anchor entries that are no longer selectable (silent, no event).
   */
  pruneToSelectableColumnsSilent(): void {
    const cfg = this.options.getConfig();
    const ids = this.options.getSelectableColumnIds();
    this.selectableFields = new Set(ids);
    if (!cfg.enabled) return;
    const allowed = this.selectableFields;
    const removed = [...this.selected].filter((id) => !allowed.has(id));
    const changed = removed.length > 0;
    if (changed) {
      this.detachSelected();
      for (const id of removed) this.selected.delete(id);
    }
    if (this.anchorField !== null && !allowed.has(this.anchorField)) {
      this.anchorField = null;
      this.extentLo = null;
      this.extentHi = null;
    }
    if (changed) {
      this.options.syncColumnSelectionClasses?.();
    }
  }

  private emit(
    changedColumnIds: string[],
    source: LightFastGridColumnSelectionChangedEvent["source"],
  ): void {
    this.options.onChanged?.({
      selectedColumnIds: this.getSelectedColumnIds(),
      changedColumnIds,
      source,
    });
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const cfg = this.options.getConfig();
    if (!cfg.enabled || !cfg.enableHeaderClickSelection) return;

    const target = event.target as HTMLElement | null;
    if (!this.root || !target) return;

    if (target.closest(".lfg-resize-handle")) return;
    if (isColumnMenuUiTarget(target)) return;
    if (isDedicatedFilterUiTarget(target)) return;
    if (isHeaderActionUiTarget(target)) return;

    const cell = target.closest(".lfg-header-cell") as HTMLDivElement | null;
    if (!cell) return;

    const headerRow = this.options.getHeaderRowEl();
    const pinnedHeaderRow = this.options.getPinnedHeaderRowEl?.();
    const pinnedRightHeaderRow = this.options.getPinnedRightHeaderRowEl?.();
    const inCenter = headerRow?.contains(cell) ?? false;
    const inPinned = pinnedHeaderRow?.contains(cell) ?? false;
    const inRightPinned = pinnedRightHeaderRow?.contains(cell) ?? false;
    if (!inCenter && !inPinned && !inRightPinned) return;

    const field = cell.getAttribute("data-col-id");
    if (!field || isInternalColumn({ field })) return;

    const selectableIds = this.options.getSelectableColumnIds();
    if (!selectableIds.includes(field)) return;

    event.preventDefault();

    const prev = new Set(this.selected);
    const { additive, range } = selectionPointerModifiers(event);

    this.detachSelected();

    if (cfg.mode === "single") {
      if (this.selected.has(field)) {
        this.selected.delete(field);
        this.anchorField = null;
      } else {
        this.selected.clear();
        this.selected.add(field);
        this.anchorField = field;
      }
      this.extentLo = null;
      this.extentHi = null;
    } else if (range) {
      if (this.anchorField === null) {
        if (additive) {
          if (this.selected.has(field)) this.selected.delete(field);
          else this.selected.add(field);
        } else {
          this.selected.clear();
          this.selected.add(field);
        }
        this.anchorField = field;
        this.extentLo = null;
        this.extentHi = null;
      } else {
        const groupIds = selectableIds;
        const anchorIdx = groupIds.indexOf(this.anchorField);
        const targetIdx = groupIds.indexOf(field);
        if (anchorIdx < 0 || targetIdx < 0) {
          this.anchorField = field;
          this.extentLo = null;
          this.extentHi = null;
          return;
        }
        const lo = Math.min(anchorIdx, targetIdx);
        const hi = Math.max(anchorIdx, targetIdx);
        const newLo = this.extentLo !== null ? Math.min(this.extentLo, lo) : lo;
        const newHi = this.extentHi !== null ? Math.max(this.extentHi, hi) : hi;
        this.extentLo = newLo;
        this.extentHi = newHi;
        const span = groupIds.slice(newLo, newHi + 1);
        if (additive) {
          for (const id of span) this.selected.add(id);
        } else {
          this.selected.clear();
          for (const id of span) this.selected.add(id);
        }
      }
    } else if (additive) {
      if (this.selected.has(field)) this.selected.delete(field);
      else this.selected.add(field);
      this.anchorField = field;
      this.extentLo = null;
      this.extentHi = null;
    } else {
      if (this.selected.has(field)) {
        this.selected.delete(field);
      } else {
        this.selected.clear();
        this.selected.add(field);
      }
      this.anchorField = field;
      this.extentLo = null;
      this.extentHi = null;
    }

    const changed = symmetricDiffFields(prev, this.selected);
    if (changed.length === 0) return;

    this.emit(changed, "click");
    this.options.syncColumnSelectionClasses?.();
  };

  private replaceSelected(selected: Set<string>): void {
    this.selected = selected;
    this.selectedShared = false;
  }

  private detachSelected(): void {
    if (!this.selectedShared) return;
    this.selected = new Set(this.selected);
    this.selectedShared = false;
  }

  private syncSelectableFields(): void {
    this.selectableFields = new Set(this.options.getSelectableColumnIds());
  }

  private readonly flushColumnSelectionCommand = (): void => {
    this.commandScheduled = false;
    const field = this.pendingCommandField;
    this.pendingCommandField = null;
    if (
      this.root === null ||
      field === null ||
      !this.options.getConfig().enabled ||
      !this.selectableFields.has(field)
    ) {
      return;
    }

    const previous = new Set(this.selected);
    this.detachSelected();
    if (this.options.getConfig().mode === "single") {
      if (this.selected.has(field)) {
        this.selected.clear();
        this.anchorField = null;
      } else {
        this.selected.clear();
        this.selected.add(field);
        this.anchorField = field;
      }
    } else if (this.selected.has(field)) {
      this.selected.delete(field);
      if (this.anchorField === field) this.anchorField = null;
    } else {
      this.selected.add(field);
      this.anchorField = field;
    }
    this.extentLo = null;
    this.extentHi = null;
    const changed = symmetricDiffFields(previous, this.selected);
    if (changed.length === 0) return;
    this.emit(changed, this.pendingCommandSource);
    this.options.syncColumnSelectionClasses?.();
  };
}
