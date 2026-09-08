import {
  captureAllMinusExcludedRowSelection,
  captureExplicitRowSelection,
  type RowSelectionReadSnapshot,
} from "../../internal/readSnapshots";
import type {
  RowSelectionMode,
  SelectionChange,
  SelectionChangeKind,
  SelectionSnapshot,
} from "../../types";

type StoreModel =
  | { type: "explicit"; ids: Set<string> }
  | { type: "all"; excludedIds: Set<string> };

function symmetricDiffSets(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const id of a) if (!b.has(id)) out.push(id);
  for (const id of b) if (!a.has(id)) out.push(id);
  return out;
}

export class SelectionStore {
  private mode: RowSelectionMode;
  private model: StoreModel;
  private modelCollectionShared = false;

  constructor(mode: RowSelectionMode = "none") {
    this.mode = mode;
    this.model = { type: "explicit", ids: new Set() };
  }

  /**
   * Fold `all` selection into an explicit set (used when switching to single mode).
   * Does not emit by itself; caller patches pool and dispatches.
   */
  foldAllToExplicit(rowId: string | undefined, totalRows: number): SelectionChange {
    this.replaceModel({
      type: "explicit",
      ids: rowId === undefined ? new Set() : new Set([rowId]),
    });
    return this.makeChange("mode", [], totalRows);
  }

  /**
   * When mode already matches, returns `null` (no emit, no patch).
   */
  setMode(mode: RowSelectionMode, totalRows: number): SelectionChange | null {
    if (this.mode === mode) return null;

    const before = this.signature(totalRows);
    this.mode = mode;

    if (mode === "none") {
      this.replaceModel({ type: "explicit", ids: new Set() });
      const after = this.signature(totalRows);
      if (before === after) return null;
      return this.makeChange("mode", [], totalRows);
    }

    if (mode === "single" && this.model.type === "explicit" && this.model.ids.size > 1) {
      const ids = Array.from(this.model.ids);
      const first = ids[0]!;
      const rest = ids.slice(1);
      this.detachModelCollection();
      this.model.ids.clear();
      this.model.ids.add(first);
      const after = this.signature(totalRows);
      if (before === after) return null;
      const changedIds = rest.length <= 256 ? rest : [];
      return this.makeChange("mode", changedIds, totalRows);
    }

    const after = this.signature(totalRows);
    if (before === after) return null;
    return this.makeChange("mode", [], totalRows);
  }

  /**
   * Single-mode row body click: deselects if row is already selected,
   * otherwise selects only that row.
   */
  singleModeBodyClick(rowId: string, totalRows: number): SelectionChange | null {
    if (this.mode !== "single") return null;
    if (this.isSelected(rowId)) {
      return this.clear(totalRows);
    }
    return this.selectOnly(rowId, totalRows);
  }

  /**
   * Multiple mode: replace selection with exactly one row id (no full-row id scan).
   * From `all` model, folds to explicit `{ rowId }` with bulk-style `single` change.
   */
  replaceSelectionWithSingleId(
    rowId: string,
    totalRows: number,
  ): SelectionChange | null {
    if (this.mode !== "multiple") return null;
    if (this.model.type === "all") {
      this.replaceModel({ type: "explicit", ids: new Set([rowId]) });
      return this.makeChange("single", [], totalRows);
    }
    const prev = new Set(this.model.ids);
    const next = new Set([rowId]);
    return this.commitMultipleSelectionFromPrev(prev, next, totalRows);
  }

  /**
   * Multiple mode: replace selection with these row ids (inclusive range from data).
   * When current model is `all`, folds to an explicit set without enumerating every row id.
   */
  replaceSelectionWithRangeIds(
    rangeIds: readonly string[],
    totalRows: number,
  ): SelectionChange | null {
    if (this.mode !== "multiple") return null;
    const next = new Set(rangeIds);
    if (this.model.type === "all") {
      if (
        next.size === totalRows &&
        totalRows > 0 &&
        this.model.excludedIds.size === 0
      ) {
        return null;
      }
      if (next.size === totalRows && totalRows > 0) {
        this.replaceModel({ type: "all", excludedIds: new Set() });
        return this.makeChange("toggle", [], totalRows);
      }
      this.replaceModel({ type: "explicit", ids: next });
      return this.makeChange("toggle", [], totalRows);
    }
    const prev = new Set(this.model.ids);
    return this.commitMultipleSelectionFromPrev(prev, next, totalRows);
  }

  /**
   * Multiple mode: add inclusive range ids to selection.
   * For `all` model, only removes matching ids from `excludedIds`.
   */
  addRangeToSelection(
    rangeIds: readonly string[],
    totalRows: number,
  ): SelectionChange | null {
    if (this.mode !== "multiple") return null;
    if (this.model.type === "explicit") {
      const prev = new Set(this.model.ids);
      const next = new Set(prev);
      for (const id of rangeIds) next.add(id);
      return this.commitMultipleSelectionFromPrev(prev, next, totalRows);
    }
    const changed: string[] = [];
    for (const id of rangeIds) {
      if (this.model.excludedIds.has(id)) {
        this.detachModelCollection();
        this.model.excludedIds.delete(id);
        changed.push(id);
      }
    }
    if (changed.length === 0) return null;
    const changedIds = changed.length <= 256 ? changed : [];
    return this.makeChange("toggle", changedIds, totalRows);
  }

  toggle(rowId: string, totalRows: number): SelectionChange | null {
    if (this.mode === "none") return null;

    if (this.mode === "single") {
      return this.selectOnly(rowId, totalRows);
    }

    if (this.model.type === "explicit") {
      this.detachModelCollection();
      if (this.model.ids.has(rowId)) this.model.ids.delete(rowId);
      else this.model.ids.add(rowId);
      return this.makeChange("toggle", [rowId], totalRows);
    }

    this.detachModelCollection();
    if (this.model.excludedIds.has(rowId)) this.model.excludedIds.delete(rowId);
    else this.model.excludedIds.add(rowId);
    return this.makeChange("toggle", [rowId], totalRows);
  }

  selectOnly(rowId: string, totalRows: number): SelectionChange | null {
    if (this.mode === "none") return null;

    if (this.model.type === "all") {
      this.replaceModel({ type: "explicit", ids: new Set([rowId]) });
      return this.makeChange("single", [], totalRows);
    }

    const prevExplicit = Array.from(this.model.ids);

    this.replaceModel({ type: "explicit", ids: new Set([rowId]) });
    const changedIds = Array.from(new Set([...prevExplicit, rowId]));
    return this.makeChange("single", changedIds, totalRows);
  }

  selectAll(totalRows: number): SelectionChange | null {
    if (this.mode !== "multiple") return null;
    this.replaceModel({ type: "all", excludedIds: new Set() });
    return this.makeChange("selectAll", [], totalRows);
  }

  /**
   * Additively select `ids` (page-scope header select-all). Keeps the
   * current model kind — never folds into the `all` model — so a
   * page-level select cannot silently claim the whole row universe.
   * When already in the `all` model (e.g. after a scope change), the
   * ids are removed from `excludedIds` instead.
   */
  selectIds(ids: readonly string[], totalRows: number): SelectionChange | null {
    if (this.mode !== "multiple") return null;
    const changed: string[] = [];
    if (this.model.type === "all") {
      for (const id of ids) {
        if (this.model.excludedIds.has(id)) {
          this.detachModelCollection();
          this.model.excludedIds.delete(id);
          changed.push(id);
        }
      }
    } else {
      for (const id of ids) {
        if (!this.model.ids.has(id)) {
          this.detachModelCollection();
          this.model.ids.add(id);
          changed.push(id);
        }
      }
    }
    if (changed.length === 0) return null;
    return this.makeChange(
      "selectAll",
      changed.length <= 256 ? changed : [],
      totalRows,
    );
  }

  /**
   * Deselect `ids` (page-scope header clear). Keeps the current model
   * kind; in the `all` model the ids are added to `excludedIds`.
   */
  deselectIds(
    ids: readonly string[],
    totalRows: number,
  ): SelectionChange | null {
    if (this.mode === "none") return null;
    const changed: string[] = [];
    if (this.model.type === "all") {
      for (const id of ids) {
        if (!this.model.excludedIds.has(id)) {
          this.detachModelCollection();
          this.model.excludedIds.add(id);
          changed.push(id);
        }
      }
    } else {
      for (const id of ids) {
        if (this.model.ids.has(id)) {
          this.detachModelCollection();
          this.model.ids.delete(id);
          changed.push(id);
        }
      }
    }
    if (changed.length === 0) return null;
    return this.makeChange(
      "clear",
      changed.length <= 256 ? changed : [],
      totalRows,
    );
  }

  /**
   * Replace the entire selection with the given ids.
   * Respects current mode: `none` → no-op, `single` → keeps only first id.
   * Returns `null` when the resulting selection is identical to the current one.
   */
  replaceWithIds(ids: string[], totalRows: number): SelectionChange | null {
    if (this.mode === "none") return null;

    // Single mode: keep at most one id.
    const effective = this.mode === "single" ? ids.slice(0, 1) : ids;
    const next = new Set(effective);

    if (this.model.type === "all") {
      // Folding from `all` model — can't compute incremental diff cheaply.
      if (next.size === totalRows && totalRows > 0) {
        // Already all-selected with no exclusions → no-op.
        if (this.model.excludedIds.size === 0) return null;
        this.replaceModel({ type: "all", excludedIds: new Set() });
        return this.makeChange("api", [], totalRows);
      }
      this.replaceModel({ type: "explicit", ids: next });
      return this.makeChange("api", [], totalRows);
    }

    // Explicit model → use symmetric diff for incremental patching.
    const prev = new Set(this.model.ids);
    const changedIds = symmetricDiffSets(prev, next);
    if (changedIds.length === 0) return null;

    if (next.size === totalRows && totalRows > 0) {
      this.replaceModel({ type: "all", excludedIds: new Set() });
    } else {
      this.replaceModel({ type: "explicit", ids: next });
    }

    return this.makeChange(
      "api",
      changedIds.length <= 256 ? changedIds : [],
      totalRows,
    );
  }

  /**
   * Imperative clear — `kind: "clear"` for consumer `changeKind`.
   */
  clear(totalRows: number): SelectionChange | null {
    if (this.mode === "none" || this.getSelectedCount(totalRows) === 0) {
      return null;
    }
    this.replaceModel({ type: "explicit", ids: new Set() });
    return this.makeChange("clear", [], totalRows);
  }

  isSelected(rowId: string): boolean {
    if (this.mode === "none") return false;
    if (this.model.type === "explicit") return this.model.ids.has(rowId);
    return !this.model.excludedIds.has(rowId);
  }

  isAllRowsModel(): boolean {
    return this.mode !== "none" && this.model.type === "all";
  }

  getExcludedIds(): ReadonlySet<string> {
    return this.model.type === "all"
      ? this.model.excludedIds
      : new Set<string>();
  }

  getSelectedCount(totalRows: number): number {
    if (this.mode === "none") return 0;
    if (this.model.type === "explicit") return this.model.ids.size;
    return Math.max(0, totalRows - this.model.excludedIds.size);
  }

  /** O(1) immutable membership capture; later mutations detach first. */
  captureReadSnapshot(totalRows: number): RowSelectionReadSnapshot {
    this.modelCollectionShared = true;
    if (this.mode !== "none" && this.model.type === "all") {
      return captureAllMinusExcludedRowSelection(
        this.model.excludedIds,
        totalRows,
      );
    }
    const ids = this.model.type === "explicit" ? this.model.ids : new Set<string>();
    return captureExplicitRowSelection(ids, totalRows);
  }

  isAllSelected(totalRows: number): boolean {
    if (totalRows === 0 || this.mode === "none") return false;
    if (this.model.type === "all") return this.model.excludedIds.size === 0;
    return this.model.ids.size === totalRows;
  }

  isPartiallySelected(totalRows: number): boolean {
    const c = this.getSelectedCount(totalRows);
    return c > 0 && !this.isAllSelected(totalRows);
  }

  snapshot(totalRows: number): SelectionSnapshot {
    const selectedCount = this.getSelectedCount(totalRows);
    if (this.mode === "none" || selectedCount === 0) {
      return { type: "explicit", ids: [], selectedCount: 0 };
    }
    if (this.model.type === "explicit") {
      return {
        type: "explicit",
        ids: Array.from(this.model.ids),
        selectedCount,
      };
    }
    return {
      type: "all",
      excludedIds: Array.from(this.model.excludedIds),
      selectedCount,
    };
  }

  private commitMultipleSelectionFromPrev(
    prev: Set<string>,
    next: Set<string>,
    totalRows: number,
  ): SelectionChange | null {
    const changedIds = symmetricDiffSets(prev, next);
    if (changedIds.length === 0) return null;

    if (next.size === totalRows && totalRows > 0) {
      this.replaceModel({ type: "all", excludedIds: new Set() });
    } else {
      this.replaceModel({ type: "explicit", ids: next });
    }
    return this.makeChange("toggle", changedIds, totalRows);
  }

  private signature(totalRows: number): string {
    const c = this.getSelectedCount(totalRows);
    if (this.model.type === "explicit") {
      const keys = Array.from(this.model.ids).sort().join("|");
      return `e:${c}:${keys}`;
    }
    const ex = Array.from(this.model.excludedIds).sort().join("|");
    return `a:${c}:${ex}`;
  }

  private makeChange(
    kind: SelectionChangeKind,
    changedIds: string[],
    totalRows: number,
  ): SelectionChange {
    return {
      kind,
      changedIds,
      selection: this.snapshot(totalRows),
    };
  }

  private replaceModel(model: StoreModel): void {
    this.model = model;
    this.modelCollectionShared = false;
  }

  private detachModelCollection(): void {
    if (!this.modelCollectionShared) return;
    this.model =
      this.model.type === "explicit"
        ? { type: "explicit", ids: new Set(this.model.ids) }
        : { type: "all", excludedIds: new Set(this.model.excludedIds) };
    this.modelCollectionShared = false;
  }
}
