import type { ColumnMenuHeaderIcons, FilterModel } from "../../types";

const FILTERED_CLASS = "lfg-header-filtered";
const FILTER_ACTIVE_CLASS = "lfg-header-filter-active";

const SORT_ICON_KEYS: (keyof ColumnMenuHeaderIcons)[] = [
  "sortAsc",
  "sortDesc",
];

const FILTER_ICON_KEYS: (keyof ColumnMenuHeaderIcons)[] = [
  "filtered",
  "sortAscFiltered",
  "sortDescFiltered",
];

const CONTENT_VAR: Record<keyof ColumnMenuHeaderIcons, string> = {
  sortAsc: "--lfg-sort-asc-icon",
  sortDesc: "--lfg-sort-desc-icon",
  filtered: "--lfg-filter-active-icon",
  sortAscFiltered: "--lfg-sort-asc-filtered-icon",
  sortDescFiltered: "--lfg-sort-desc-filtered-icon",
};

/** Mask vars — set to `none` when a character `headerIcons` override is active. */
const MASK_VAR: Record<keyof ColumnMenuHeaderIcons, string> = {
  sortAsc: "--lfg-sort-asc-mask",
  sortDesc: "--lfg-sort-desc-mask",
  filtered: "--lfg-filter-trigger-mask",
  sortAscFiltered: "--lfg-sort-asc-filtered-mask",
  sortDescFiltered: "--lfg-sort-desc-filtered-mask",
};

const PAINT_VAR: Record<keyof ColumnMenuHeaderIcons, string> = {
  sortAsc: "--lfg-sort-asc-icon-paint",
  sortDesc: "--lfg-sort-desc-icon-paint",
  filtered: "--lfg-filter-trigger-icon-paint",
  sortAscFiltered: "--lfg-sort-asc-filtered-icon-paint",
  sortDescFiltered: "--lfg-sort-desc-filtered-icon-paint",
};

export interface FilterIndicatorControllerDeps {
  getFilterModel: () => FilterModel;
  getHeaderIcons?: () => ColumnMenuHeaderIcons | undefined;
  showMainMenuIndicator?: () => boolean;
  gridRoot: HTMLElement;
  getHeaderRowEl: () => HTMLDivElement | null;
  getPinnedHeaderRowEl?: () => HTMLDivElement | null;
  getPinnedRightHeaderRowEl?: () => HTMLDivElement | null;
}

export class FilterIndicatorController {
  private readonly deps: FilterIndicatorControllerDeps;
  private appliedIcons: Record<string, string | undefined> = {};

  constructor(deps: FilterIndicatorControllerDeps) {
    this.deps = deps;
  }

  syncFilterIndicatorState(): void {
    const filterModel = this.deps.getFilterModel();
    const showInMenu = this.deps.showMainMenuIndicator?.() ?? true;

    const icons = this.deps.getHeaderIcons?.();

    for (const key of [...SORT_ICON_KEYS, ...FILTER_ICON_KEYS]) {
      const value = icons?.[key];
      if (value === this.appliedIcons[key]) continue;
      this.appliedIcons[key] = value;
      if (value) {
        // Character override: show glyph, hide the default Lucide mask.
        this.deps.gridRoot.style.setProperty(CONTENT_VAR[key], `"${value}"`);
        this.deps.gridRoot.style.setProperty(MASK_VAR[key], "none");
        this.deps.gridRoot.style.setProperty(PAINT_VAR[key], "transparent");
      } else {
        this.deps.gridRoot.style.removeProperty(CONTENT_VAR[key]);
        this.deps.gridRoot.style.removeProperty(MASK_VAR[key]);
        this.deps.gridRoot.style.removeProperty(PAINT_VAR[key]);
      }
    }

    const headerRow = this.deps.getHeaderRowEl();
    if (headerRow) this.applyToRow(headerRow, filterModel, showInMenu);

    const pinnedRow = this.deps.getPinnedHeaderRowEl?.();
    if (pinnedRow) this.applyToRow(pinnedRow, filterModel, showInMenu);

    const pinnedRightRow = this.deps.getPinnedRightHeaderRowEl?.();
    if (pinnedRightRow) this.applyToRow(pinnedRightRow, filterModel, showInMenu);
  }

  private applyToRow(row: HTMLDivElement, filterModel: FilterModel, showInMenu: boolean): void {
    const cells = row.children;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i] as HTMLDivElement;
      if (cell.style.display === "none") continue;
      const colId = cell.getAttribute("data-col-id");
      if (!colId) continue;
      const isFiltered = colId in filterModel;
      cell.classList.toggle(FILTER_ACTIVE_CLASS, isFiltered);
      cell.classList.toggle(FILTERED_CLASS, isFiltered && showInMenu);
    }
  }
}
