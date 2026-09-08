import type { RowAccess } from "../internal/rowAccess";
import type { DisplayRowReader } from "../rendering/rowViewAccess";
import type { RowData, SelectionSnapshot } from "../types";

/**
 * Resolve only `changedIds` to row objects in one pass (early exit when all found).
 */
export function resolveChangedRowsByIds(
  changedIds: string[],
  access: RowAccess,
): RowData[] {
  return resolveSelectionRows([], changedIds, access).changedRows;
}

/**
 * Resolve row objects for selection payloads with a single pass over data.
 * Stops scanning once every distinct id in the union is found (or EOF).
 */
export function resolveSelectionRows(
  selectedIds: string[],
  changedIds: string[],
  access: RowAccess,
): {
  selectedRows: RowData[];
  changedRows: RowData[];
} {
  const wantedIds = Array.from(new Set([...selectedIds, ...changedIds]));

  if (wantedIds.length === 0) {
    return { selectedRows: [], changedRows: [] };
  }

  const want = new Set(wantedIds);
  const rows = access.getRows();
  const byId = new Map<string, RowData>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const id = access.resolveRowId(row, i);

    if (!want.has(id) || byId.has(id)) continue;

    byId.set(id, row);

    if (byId.size === want.size) {
      break;
    }
  }

  return {
    selectedRows: selectedIds
      .map((id) => byId.get(id))
      .filter((row): row is RowData => row !== undefined),
    changedRows: changedIds
      .map((id) => byId.get(id))
      .filter((row): row is RowData => row !== undefined),
  };
}

/** All selected rows as strings of id — may scan all rows in `all` snapshot mode. */
export function resolveSelectedIdsFromModel(
  selection: SelectionSnapshot,
  access: RowAccess,
): string[] {
  return resolveSelectedIdsFromRows(
    selection,
    access.getRows(),
    access.resolveRowId,
  );
}

export function resolveSelectedIdsFromRows(
  selection: SelectionSnapshot,
  rows: RowData[],
  resolveRowId: (row: RowData, index: number) => string,
): string[] {
  if (selection.selectedCount === 0) return [];
  if (selection.type === "explicit") {
    return selection.ids ? [...selection.ids] : [];
  }
  const excluded = new Set(selection.excludedIds ?? []);
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const id = resolveRowId(rows[i]!, i);
    if (!excluded.has(id)) out.push(id);
  }
  return out;
}

/**
 * Like {@link resolveSelectedIdsFromRows} but reads display rows through
 * a `DisplayRowReader` instead of a materialized `RowData[]`.
 */
export function resolveSelectedIdsFromDisplayRows(
  selection: SelectionSnapshot,
  displayRows: DisplayRowReader,
  resolveRowId: (row: RowData, index: number) => string,
): string[] {
  if (selection.selectedCount === 0) return [];
  if (selection.type === "explicit") {
    return selection.ids ? [...selection.ids] : [];
  }
  const excluded = new Set(selection.excludedIds ?? []);
  const out: string[] = [];
  for (let i = 0; i < displayRows.rowCount; i++) {
    const row = displayRows.getRowData(i);
    if (row === undefined) continue;
    const id = resolveRowId(row, i);
    if (!excluded.has(id)) out.push(id);
  }
  return out;
}

/** One scan using live `isSelected` (matches renderer store at call time). */
export function resolveSelectedRowsLive(
  access: RowAccess,
  isSelected: (rowId: string) => boolean,
): RowData[] {
  const rows = access.getRows();
  const out: RowData[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (isSelected(access.resolveRowId(row, i))) out.push(row);
  }
  return out;
}

/** One scan over display rows using live `isSelected` (matches visible order). */
export function resolveSelectedRowsLiveFromDisplayRows(
  displayRows: DisplayRowReader,
  resolveRowId: (row: RowData, index: number) => string,
  isSelected: (rowId: string) => boolean,
): RowData[] {
  const out: RowData[] = [];
  for (let i = 0; i < displayRows.rowCount; i++) {
    const row = displayRows.getRowData(i);
    if (row === undefined) continue;
    if (isSelected(resolveRowId(row, i))) out.push(row);
  }
  return out;
}

export function resolveSelectedRowsFromModel(
  selection: SelectionSnapshot,
  access: RowAccess,
): RowData[] {
  return resolveSelectedRowsFromRows(
    selection,
    access.getRows(),
    access.resolveRowId,
  );
}

export function resolveSelectedRowsFromRows(
  selection: SelectionSnapshot,
  rows: RowData[],
  resolveRowId: (row: RowData, index: number) => string,
): RowData[] {
  if (selection.selectedCount === 0) return [];
  if (selection.type === "all") {
    const excluded = new Set(selection.excludedIds ?? []);
    const out: RowData[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!excluded.has(resolveRowId(row, i))) out.push(row);
    }
    return out;
  }
  const ids = selection.ids;
  if (!ids?.length) return [];
  const want = new Set(ids);
  const byId = new Map<string, RowData>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const id = resolveRowId(row, i);
    if (!want.has(id) || byId.has(id)) continue;
    byId.set(id, row);
    if (byId.size === want.size) break;
  }
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is RowData => row !== undefined);
}

export function resolveSelectedRowsFromDisplayRows(
  selection: SelectionSnapshot,
  displayRows: DisplayRowReader,
  resolveRowId: (row: RowData, index: number) => string,
): RowData[] {
  if (selection.selectedCount === 0) return [];
  if (selection.type === "all") {
    const excluded = new Set(selection.excludedIds ?? []);
    const out: RowData[] = [];
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      if (!excluded.has(resolveRowId(row, i))) out.push(row);
    }
    return out;
  }
  const ids = selection.ids;
  if (!ids?.length) return [];
  const want = new Set(ids);
  const byId = new Map<string, RowData>();
  for (let i = 0; i < displayRows.rowCount; i++) {
    const row = displayRows.getRowData(i);
    if (row === undefined) continue;
    const id = resolveRowId(row, i);
    if (!want.has(id) || byId.has(id)) continue;
    byId.set(id, row);
    if (byId.size === want.size) break;
  }
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is RowData => row !== undefined);
}

export function forEachSelectedRowFromModel(
  selection: SelectionSnapshot,
  access: RowAccess,
  callback: (row: RowData, index: number) => void,
): void {
  forEachSelectedRowFromRows(
    selection,
    access.getRows(),
    access.resolveRowId,
    callback,
  );
}

export function forEachSelectedRowFromRows(
  selection: SelectionSnapshot,
  rows: RowData[],
  resolveRowId: (row: RowData, index: number) => string,
  callback: (row: RowData, index: number) => void,
): void {
  if (selection.selectedCount === 0) return;
  if (selection.type === "all") {
    const excluded = new Set(selection.excludedIds ?? []);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (!excluded.has(resolveRowId(row, i))) callback(row, i);
    }
    return;
  }
  const ids = selection.ids;
  if (!ids?.length) return;
  const want = new Set(ids);
  const byId = new Map<string, { row: RowData; index: number }>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const id = resolveRowId(row, i);
    if (!want.has(id) || byId.has(id)) continue;
    byId.set(id, { row, index: i });
    if (byId.size === want.size) break;
  }
  for (const id of ids) {
    const hit = byId.get(id);
    if (hit) callback(hit.row, hit.index);
  }
}

export function forEachSelectedRowFromDisplayRows(
  selection: SelectionSnapshot,
  displayRows: DisplayRowReader,
  resolveRowId: (row: RowData, index: number) => string,
  callback: (row: RowData, index: number) => void,
): void {
  if (selection.selectedCount === 0) return;
  if (selection.type === "all") {
    const excluded = new Set(selection.excludedIds ?? []);
    for (let i = 0; i < displayRows.rowCount; i++) {
      const row = displayRows.getRowData(i);
      if (row === undefined) continue;
      if (!excluded.has(resolveRowId(row, i))) callback(row, i);
    }
    return;
  }
  const ids = selection.ids;
  if (!ids?.length) return;
  const want = new Set(ids);
  const byId = new Map<string, { row: RowData; index: number }>();
  for (let i = 0; i < displayRows.rowCount; i++) {
    const row = displayRows.getRowData(i);
    if (row === undefined) continue;
    const id = resolveRowId(row, i);
    if (!want.has(id) || byId.has(id)) continue;
    byId.set(id, { row, index: i });
    if (byId.size === want.size) break;
  }
  for (const id of ids) {
    const hit = byId.get(id);
    if (hit) callback(hit.row, hit.index);
  }
}
