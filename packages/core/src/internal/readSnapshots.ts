/**
 * Feature-neutral immutable read snapshots.
 *
 * Owners retain collection identity at capture and detach before a later
 * mutation. These views never expose the retained Set/Map for mutation and
 * require no iteration or copying at capture time.
 */

export interface ImmutableIdMembership<Id> {
  readonly size: number;
  has(id: Id): boolean;
}

export interface ImmutableKeyedMembership<Key, Value> {
  readonly size: number;
  get(id: Key): Value | undefined;
}

export interface RowSelectionReadSnapshot {
  readonly model: "explicit" | "allMinusExcluded";
  readonly universeRowCount: number;
  /** Exact O(1) proof that this captured selection cannot match any row. */
  readonly definitelyEmpty: boolean;
  has(id: string): boolean;
}

export function captureIdMembership<Id>(
  ids: ReadonlySet<Id>,
): ImmutableIdMembership<Id> {
  const size = ids.size;
  return {
    size,
    has: (id) => ids.has(id),
  };
}

export function captureKeyedMembership<Key, Value>(
  values: ReadonlyMap<Key, Value>,
): ImmutableKeyedMembership<Key, Value> {
  const size = values.size;
  return {
    size,
    get: (id) => values.get(id),
  };
}

export function captureExplicitRowSelection(
  ids: ReadonlySet<string>,
  universeRowCount: number,
): RowSelectionReadSnapshot {
  return {
    model: "explicit",
    universeRowCount,
    definitelyEmpty: ids.size === 0,
    has: (id) => ids.has(id),
  };
}

export function captureAllMinusExcludedRowSelection(
  excludedIds: ReadonlySet<string>,
  universeRowCount: number,
): RowSelectionReadSnapshot {
  return {
    model: "allMinusExcluded",
    universeRowCount,
    definitelyEmpty: universeRowCount === 0,
    has: (id) => !excludedIds.has(id),
  };
}

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

export function captureEmptyRowSelection(
  universeRowCount: number,
): RowSelectionReadSnapshot {
  return captureExplicitRowSelection(EMPTY_IDS, universeRowCount);
}

export const EMPTY_ID_MEMBERSHIP: ImmutableIdMembership<string> =
  captureIdMembership(EMPTY_IDS);

export const EMPTY_ROW_SELECTION_READ_SNAPSHOT: RowSelectionReadSnapshot =
  captureEmptyRowSelection(0);
