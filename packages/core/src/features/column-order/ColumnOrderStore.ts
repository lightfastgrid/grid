import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnDef } from "../../types";

function clampInsertionSlot(slot: number, orderLength: number): number {
  return Math.max(0, Math.min(slot, orderLength));
}

/**
 * Deduplicate `fields`, drop internal/unknown ids; order of first-seen kept.
 */
function uniqueKnownUserFields(
  fields: readonly string[],
  knownUserFields: readonly string[],
): string[] {
  const allowed = new Set(knownUserFields);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (isInternalColumn({ field: f })) continue;
    if (!allowed.has(f)) continue;
    out.push(f);
  }
  return out;
}

/** Subset of `order` in store order, only fields that appear in `requestedFields`. */
function orderedMovingBlock(
  order: readonly string[],
  requestedFields: readonly string[],
): string[] {
  const wanted = new Set(requestedFields);
  return order.filter((f) => wanted.has(f));
}

function indicesOf(
  order: readonly string[],
  fields: readonly string[],
): number[] {
  return fields.map((f) => order.indexOf(f));
}

/**
 * The pointer gives a slot in the original order. After removing moving fields,
 * slots after those fields shift left.
 */
function adjustedInsertionSlot(
  insertionSlot: number,
  fromIndices: readonly number[],
  remainingLength: number,
): number {
  const removedBeforeInsertion = fromIndices.filter(
    (i) => i < insertionSlot,
  ).length;
  const adjusted = insertionSlot - removedBeforeInsertion;
  return Math.max(0, Math.min(adjusted, remainingLength));
}

function removeFields(
  order: readonly string[],
  fieldsToRemove: readonly string[],
): string[] {
  const drop = new Set(fieldsToRemove);
  return order.filter((f) => !drop.has(f));
}

function insertBlock(
  remaining: readonly string[],
  block: readonly string[],
  index: number,
): string[] {
  const next = [...remaining];
  next.splice(index, 0, ...block);
  return next;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface ReconcileOptions {
  preserveMissing?: boolean;
}

/**
 * Pure runtime order of user columns (by `field`).
 * Internal columns (e.g. row selection checkbox) are never stored or reordered.
 */
export class ColumnOrderStore {
  private fieldOrder: string[] = [];

  /** Drop unknown fields, append new user fields in incoming column order. */
  syncColumns(columns: readonly ColumnDef[], opts?: ReconcileOptions): void {
    this.reconcile(columns, opts);
  }

  /** Current user field order for these columns (same rules as {@link syncColumns}). */
  getOrder(columns: readonly ColumnDef[]): string[] {
    return [...this.reconcile(columns)];
  }

  /**
   * Returns a new array: internal columns first (original relative order), then user
   * columns in store order. User defs keep their object identity from `columns`.
   */
  applyOrder(columns: readonly ColumnDef[], opts?: ReconcileOptions): ColumnDef[] {
    this.reconcile(columns, opts);
    const internal = columns.filter((c) => isInternalColumn(c));
    const userByField = new Map<string, ColumnDef>();
    for (const c of columns) {
      if (!isInternalColumn(c)) userByField.set(c.field, c);
    }
    const orderedUser: ColumnDef[] = [];
    for (const f of this.fieldOrder) {
      const c = userByField.get(f);
      if (c) orderedUser.push(c);
    }
    return [...internal, ...orderedUser];
  }

  /**
   * Move a user column by insertion slot `toIndex` in the original user order
   * (0..n where n = column count: insert before column `toIndex`, or after all when `toIndex === n`).
   * `toIndex` in the result is the moved column's final index in the new order.
   */
  move(
    field: string,
    toIndex: number,
    columns: readonly ColumnDef[],
  ): {
    changed: boolean;
    movedColumnId: string;
    fromIndex: number;
    toIndex: number;
    order: string[];
  } | null {
    const target = columns.find((c) => c.field === field);
    if (!target || isInternalColumn(target)) return null;

    const m = this.moveMany([field], toIndex, columns);
    if (!m) return null;
    return {
      changed: m.changed,
      movedColumnId: field,
      fromIndex: m.fromIndices[0] ?? -1,
      toIndex: m.toIndex,
      order: m.order,
    };
  }

  /**
   * Move a set of user columns as one block. `toIndex` is an insertion slot in the
   * original user order: 0..n (before column k, or n = after the last column). Returns
   * `toIndex` as the block's start index in the resulting order.
   */
  moveMany(
    fields: readonly string[],
    toIndex: number,
    columns: readonly ColumnDef[],
  ): {
    changed: boolean;
    movedColumnIds: string[];
    fromIndices: number[];
    toIndex: number;
    order: string[];
  } | null {
    this.reconcile(columns);

    const order = [...this.fieldOrder];
    const requested = uniqueKnownUserFields(fields, this.userFieldsInOrder(columns));
    if (requested.length === 0) return null;

    const movingBlock = orderedMovingBlock(order, requested);
    if (movingBlock.length === 0) return null;

    const fromIndices = indicesOf(order, movingBlock);
    const insertionSlot = clampInsertionSlot(toIndex, order.length);
    const remaining = removeFields(order, movingBlock);
    const insertAt = adjustedInsertionSlot(
      insertionSlot,
      fromIndices,
      remaining.length,
    );
    const next = insertBlock(remaining, movingBlock, insertAt);
    const finalStart = next.indexOf(movingBlock[0]!);
    const changed = !arraysEqual(order, next);

    if (!changed) {
      return {
        changed: false,
        movedColumnIds: [...movingBlock],
        fromIndices,
        toIndex: finalStart,
        order: [...order],
      };
    }

    this.fieldOrder = next;
    return {
      changed: true,
      movedColumnIds: [...movingBlock],
      fromIndices,
      toIndex: finalStart,
      order: [...next],
    };
  }

  clear(): void {
    this.fieldOrder = [];
  }

  private userFieldsInOrder(columns: readonly ColumnDef[]): string[] {
    const out: string[] = [];
    for (const c of columns) {
      if (!isInternalColumn(c)) out.push(c.field);
    }
    return out;
  }

  private reconcile(
    columns: readonly ColumnDef[],
    opts?: ReconcileOptions,
  ): string[] {
    const incoming = this.userFieldsInOrder(columns);
    const incomingSet = new Set(incoming);
    const next: string[] = [];
    const seen = new Set<string>();

    for (const f of this.fieldOrder) {
      if ((opts?.preserveMissing || incomingSet.has(f)) && !seen.has(f)) {
        next.push(f);
        seen.add(f);
      }
    }
    for (const f of incoming) {
      if (!seen.has(f)) {
        next.push(f);
        seen.add(f);
      }
    }

    this.fieldOrder = next;
    return next;
  }
}
