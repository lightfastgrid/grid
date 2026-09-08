import type { RowData } from '../types';


/**
 * User callback that derives a stable id from a row object.
 *
 * Prefer the row-only form: `(row) => row.id`. The `index` parameter is kept
 * optional **for internal call signatures only** — never use it to build a row
 * id, because the row's index changes on sort, filter, reorder, and pin.
 * Ids must represent the row, not its current position.
 *
 * Return `null` / `undefined` to fall through to the internal object-identity
 * fallback (stable across sort/filter/reorder via a `WeakMap`).
 */
export type GetRowId = (row: RowData, index?: number) => unknown;

/**
 * Lazily assigns stable string ids per row **object identity** when the user
 * does not supply {@link GetRowId}, or when their callback returns nullish.
 * No upfront scan of the row array — ids are created only when a row reference
 * is resolved (render, pool bind, selection, etc.).
 *
 * Row index is intentionally NOT part of the identity model. We never derive
 * an id from `index` for object rows; the only `index:N` fallback is reserved
 * for primitive (non-object) rows that have no usable object identity.
 */
export class RowIdentityService {
  private nextAutoId = 0;

  private readonly objectIds = new WeakMap<object, string>();

  resolve(row: unknown, index: number, getRowId?: GetRowId): string {
    if (getRowId !== undefined) {
      // Pass index for back-compat with the legacy 2-arg signature, but new
      // user callbacks are expected to ignore it: `(row) => row.id`.
      const explicitId = getRowId(row as RowData, index);
      if (explicitId !== null && explicitId !== undefined) {
        return String(explicitId);
      }
      // Fall through to object-identity below — DO NOT use index as a row id
      // for object rows. Index changes on sort/filter/reorder/pin.
    }

    if (row !== null && typeof row === 'object') {
      let id = this.objectIds.get(row as object);
      if (id === undefined) {
        id = `auto:${this.nextAutoId++}`;
        this.objectIds.set(row as object, id);
      }
      return id;
    }

    // Only reachable for primitive (non-object) rows that have no object
    // identity to key off.
    return `index:${index}`;
  }

  transferIdentity(from: object, to: object): void {
    const id = this.objectIds.get(from);
    if (id !== undefined) {
      this.objectIds.set(to, id);
    }
  }
}
