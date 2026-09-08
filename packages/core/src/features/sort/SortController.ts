import { isInternalColumn } from "../../internal/internalColumns";
import type {
  ColumnDef,
  ColumnSelectionConfig,
  SortChangeSource,
  SortModel,
} from "../../types";
import { isColumnMenuUiTarget } from "../column-menu/columnMenuDom";
import { isDedicatedFilterUiTarget } from "../filters/dedicatedFilterDom";
import { isHeaderActionUiTarget } from "../header-actions/headerActionDom";

const SORTABLE_CLASS = "lfg-header-sortable";
const SORTED_ASC_CLASS = "lfg-header-sorted-asc";
const SORTED_DESC_CLASS = "lfg-header-sorted-desc";
const SORT_PENDING_CLASS = "lfg-header-sort-pending";

export interface SortControllerDeps {
  getColumns: () => ColumnDef[];
  getColumnSelectionConfig: () => ColumnSelectionConfig;
  getSortModel: () => SortModel;
  isSortPending: () => boolean;
  toggleColumnSort: (field: string, opts: { multi: boolean; source: SortChangeSource }) => void;
  getHeaderRowEl: () => HTMLDivElement | null;
  getPinnedHeaderRowEl?: () => HTMLDivElement | null;
  getPinnedRightHeaderRowEl?: () => HTMLDivElement | null;
}

export class SortController {
  private root: HTMLElement | null = null;
  private readonly deps: SortControllerDeps;
  private columnsByField = new Map<string, ColumnDef>();

  constructor(deps: SortControllerDeps) {
    this.deps = deps;
  }

  attach(root: HTMLElement): void {
    this.root = root;
    root.addEventListener("click", this.onHeaderClick);
  }

  detach(): void {
    if (this.root) {
      this.root.removeEventListener("click", this.onHeaderClick);
      this.root = null;
    }
    this.columnsByField.clear();
  }

  syncSortState(): void {
    const columns = this.deps.getColumns();
    const colByField = new Map(columns.map((c) => [c.field, c]));
    this.columnsByField = colByField;
    const sortModel = this.deps.getSortModel();
    const sortByField = new Map(sortModel.map((s) => [s.field, s.sort]));
    const pending = this.deps.isSortPending();

    const headerRow = this.deps.getHeaderRowEl();
    if (headerRow) this.applySortToHeaderRow(headerRow, colByField, sortByField, pending);

    const pinnedHeaderRow = this.deps.getPinnedHeaderRowEl?.();
    if (pinnedHeaderRow) this.applySortToHeaderRow(pinnedHeaderRow, colByField, sortByField, pending);

    const pinnedRightHeaderRow = this.deps.getPinnedRightHeaderRowEl?.();
    if (pinnedRightHeaderRow) this.applySortToHeaderRow(pinnedRightHeaderRow, colByField, sortByField, pending);
  }

  toggleSortFromCommand(field: string, multi: boolean): boolean {
    if (this.root === null) return false;
    const column = this.columnsByField.get(field);
    if (
      column === undefined ||
      isInternalColumn(column) ||
      column.sortable === false
    ) {
      return false;
    }
    this.deps.toggleColumnSort(field, { multi, source: "ui" });
    return true;
  }

  private applySortToHeaderRow(
    headerRow: HTMLDivElement,
    colByField: Map<string, ColumnDef>,
    sortByField: Map<string, "asc" | "desc">,
    pending: boolean,
  ): void {
    const cells = headerRow.children;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as HTMLDivElement;
      if (cell.style.display === "none") continue;

      const colId = cell.getAttribute("data-col-id");
      if (!colId) continue;

      const col = colByField.get(colId);
      const sortDir = sortByField.get(colId);
      const isSortable = !!col &&
        !isInternalColumn(col) &&
        col.sortable !== false;

      cell.classList.toggle(SORTABLE_CLASS, isSortable);
      if (!isSortable) {
        cell.classList.remove(SORTED_ASC_CLASS, SORTED_DESC_CLASS, SORT_PENDING_CLASS);
        continue;
      }

      cell.classList.toggle(SORTED_ASC_CLASS, sortDir === "asc");
      cell.classList.toggle(SORTED_DESC_CLASS, sortDir === "desc");
      cell.classList.toggle(SORT_PENDING_CLASS, pending && sortDir !== undefined);
    }
  }

  private readonly onHeaderClick = (ev: MouseEvent): void => {
    if (ev.defaultPrevented) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;

    if (target.closest(".lfg-resize-handle")) return;
    if (target.closest(".lfg-column-drag-handle")) return;
    if (target.closest(".lfg-header-selection-checkbox")) return;
    if (target.closest(".lfg-row-selection-checkbox")) return;
    if (isColumnMenuUiTarget(target)) return;
    if (isDedicatedFilterUiTarget(target)) return;
    if (isHeaderActionUiTarget(target)) return;

    const headerCell = target.closest(".lfg-header-cell") as HTMLElement | null;
    if (!headerCell) return;

    const colId = headerCell.getAttribute("data-col-id");
    if (!colId) return;
    if (isInternalColumn({ field: colId })) return;

    const col = this.columnsByField.get(colId);
    const colSelectionCfg = this.deps.getColumnSelectionConfig();
    if (
      colSelectionCfg.enabled &&
      colSelectionCfg.enableHeaderClickSelection &&
      col &&
      !isInternalColumn(col) &&
      col.columnSelectable !== false
    ) {
      return;
    }

    if (!headerCell.classList.contains(SORTABLE_CLASS)) return;

    this.deps.toggleColumnSort(colId, {
      multi: ev.shiftKey,
      source: "ui",
    });
  };
}
