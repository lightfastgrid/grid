import type { LightFastGridDefaultColDef } from '../types';

export function defaultColDefsEqual(
  a: LightFastGridDefaultColDef | undefined,
  b: LightFastGridDefaultColDef | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.visible === b.visible &&
    a.editable === b.editable &&
    a.sortable === b.sortable &&
    a.filterable === b.filterable &&
    a.filter === b.filter &&
    a.floatingFilter === b.floatingFilter &&
    a.resizable === b.resizable &&
    a.reorderable === b.reorderable &&
    a.pinnable === b.pinnable &&
    a.tooltip === b.tooltip &&
    a.suppressSizeToFit === b.suppressSizeToFit &&
    a.valueGetter === b.valueGetter &&
    a.valueFormatter === b.valueFormatter &&
    a.sortComparator === b.sortComparator &&
    a.getCellAriaLabel === b.getCellAriaLabel &&
    a.cellAriaDescribedBy === b.cellAriaDescribedBy &&
    a.getCellAriaDescribedBy === b.getCellAriaDescribedBy &&
    a.getCellClass === b.getCellClass &&
    a.tooltipValueGetter === b.tooltipValueGetter &&
    a.editor === b.editor &&
    a.headerControls === b.headerControls &&
    a.cellShell === b.cellShell &&
    a.cellClassRules === b.cellClassRules &&
    a.cellChangeFlash === b.cellChangeFlash &&
    cellClassEqual(a.cellClass, b.cellClass)
  );
}

function cellClassEqual(
  a: string | string[] | undefined,
  b: string | string[] | undefined,
): boolean {
  if (a === b) return true;
  if (typeof a === 'string' || typeof b === 'string') return false;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
