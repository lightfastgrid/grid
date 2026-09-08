import type {
  ColumnMenuFilterOptions,
  ColumnMenuHeaderIcons,
  ColumnMenuOptions,
} from '../../types';

export function columnMenuRenderChanged(
  prev: ColumnMenuOptions | undefined,
  next: ColumnMenuOptions | undefined,
): boolean {
  if (prev === next) return false;
  if (!prev || !next) return true;
  if (prev.enabled !== next.enabled) return true;
  if (prev.filterPlacement !== next.filterPlacement) return true;
  if (!columnMenuFilterEqual(prev.filter, next.filter)) return true;
  if (!headerIconsEqual(prev.headerIcons, next.headerIcons)) return true;
  return false;
}

function columnMenuFilterEqual(
  a: boolean | ColumnMenuFilterOptions | undefined,
  b: boolean | ColumnMenuFilterOptions | undefined,
): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'boolean') return a === b;
  const ao = a as ColumnMenuFilterOptions;
  const bo = b as ColumnMenuFilterOptions;
  if (ao.enabled !== bo.enabled) return false;
  if (ao.placement !== bo.placement) return false;
  if (ao.clear !== bo.clear) return false;
  if (ao.activeIcon !== bo.activeIcon) return false;
  const asl = ao.selectionList;
  const bsl = bo.selectionList;
  if (asl === bsl) return true;
  if (typeof asl !== typeof bsl) return false;
  if (typeof asl === 'boolean') return asl === bsl;
  const aslo = asl as { enabled?: boolean; placement?: string };
  const bslo = bsl as { enabled?: boolean; placement?: string };
  return aslo.enabled === bslo.enabled && aslo.placement === bslo.placement;
}

function headerIconsEqual(
  a: ColumnMenuHeaderIcons | undefined,
  b: ColumnMenuHeaderIcons | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.sortAsc === b.sortAsc &&
    a.sortDesc === b.sortDesc &&
    a.filtered === b.filtered &&
    a.sortAscFiltered === b.sortAscFiltered &&
    a.sortDescFiltered === b.sortDescFiltered
  );
}
