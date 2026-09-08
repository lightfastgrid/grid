function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function adjustedInsertionSlot(
  order: readonly string[],
  movingSet: Set<string>,
  toIndex: number,
): number {
  let removed = 0;
  for (let i = 0; i < toIndex && i < order.length; i++) {
    if (movingSet.has(order[i]!)) removed++;
  }
  return toIndex - removed;
}

export class RowOrderStore {
  private order: string[] = [];

  syncRowIds(ids: string[]): void {
    this.order = [...ids];
  }

  move(
    rowId: string,
    toIndex: number,
  ): {
    changed: boolean;
    order: string[];
    fromIndex: number;
    toIndex: number;
  } | null {
    const fromIndex = this.order.indexOf(rowId);
    if (fromIndex === -1) return null;

    const clamped = Math.max(0, Math.min(toIndex, this.order.length - 1));
    if (fromIndex === clamped) {
      return { changed: false, order: [...this.order], fromIndex, toIndex: clamped };
    }

    const next = [...this.order];
    next.splice(fromIndex, 1);
    next.splice(clamped, 0, rowId);
    this.order = next;
    return { changed: true, order: next, fromIndex, toIndex: clamped };
  }

  moveMany(
    rowIds: string[],
    toIndex: number,
  ): {
    changed: boolean;
    order: string[];
    movedRowIds: string[];
    fromIndices: number[];
    toIndex: number;
  } | null {
    if (this.order.length === 0) return null;

    const known = new Set(this.order);
    const deduped = [...new Set(rowIds)].filter((id) => known.has(id));
    if (deduped.length === 0) return null;

    const movingSet = new Set(deduped);
    const movingInOrder = this.order.filter((id) => movingSet.has(id));
    const fromIndices = movingInOrder.map((id) => this.order.indexOf(id));

    const adjusted = adjustedInsertionSlot(this.order, movingSet, toIndex);
    const withoutMoving = this.order.filter((id) => !movingSet.has(id));
    const clamped = Math.max(0, Math.min(adjusted, withoutMoving.length));
    const newOrder = [
      ...withoutMoving.slice(0, clamped),
      ...movingInOrder,
      ...withoutMoving.slice(clamped),
    ];

    if (arraysEqual(newOrder, this.order)) {
      return { changed: false, order: newOrder, movedRowIds: movingInOrder, fromIndices, toIndex: clamped };
    }

    this.order = newOrder;
    return { changed: true, order: newOrder, movedRowIds: movingInOrder, fromIndices, toIndex: clamped };
  }

  getOrder(): string[] {
    return [...this.order];
  }

  hasOrder(): boolean {
    return this.order.length > 0;
  }

  applyOrder<T>(
    rows: T[],
    resolveId: (row: T, index: number) => string,
  ): T[] {
    if (this.order.length === 0) return rows;
    const byId = new Map<string, T>();
    for (let i = 0; i < rows.length; i++) {
      byId.set(resolveId(rows[i]!, i), rows[i]!);
    }
    const out: T[] = [];
    const placed = new Set<string>();
    for (const id of this.order) {
      const row = byId.get(id);
      if (row !== undefined) {
        out.push(row);
        placed.add(id);
      }
    }
    for (let i = 0; i < rows.length; i++) {
      const id = resolveId(rows[i]!, i);
      if (!placed.has(id)) out.push(rows[i]!);
    }
    return out;
  }

  isCurrentOrder(order: readonly string[]): boolean {
    return arraysEqual(this.order, order);
  }

  clear(): void {
    this.order = [];
  }
}
