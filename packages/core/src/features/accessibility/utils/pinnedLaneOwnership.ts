import type { PooledCell, PooledRow } from "../../../internal/poolTypes";
import type { DomGridFeatureContext } from "../../types";

import {
  applyPinnedLaneOwnership,
  clearPinnedLaneOwnership,
} from "./pinnedLaneOwnershipDom";

export interface BodyCellOwnershipState {
  readonly id: string;
  readonly active: boolean;
  readonly rowId: string | null;
  readonly ariaColIndex: number;
}

export type ReadBodyCellOwnershipState = (
  cell: PooledCell,
) => BodyCellOwnershipState | null;

interface RetainedRowOwnershipState {
  initialized: boolean;
  ownerElement: HTMLElement | null;
  readonly ownedCells: PooledCell[];
  ownedCellCount: number;
}

function createRetainedRowOwnershipState(): RetainedRowOwnershipState {
  return {
    initialized: false,
    ownerElement: null,
    ownedCells: [],
    ownedCellCount: 0,
  };
}

function isVisible(element: HTMLElement | null): boolean {
  return element !== null && element.style.display !== "none";
}

/**
 * Pool-bounded `aria-owns` reconciler for rows split across pinned lanes.
 *
 * Structural sync is the only path that creates row state or grows retained
 * arrays. Positional sync reuses one center hRing order and candidate scratch
 * across every physical row.
 */
export class PinnedLaneOwnershipReconciler {
  private states = new WeakMap<PooledRow, RetainedRowOwnershipState>();
  private readonly centerPhysicalOrder: number[] = [];
  private centerPhysicalOrderCount = 0;
  private readonly candidateCells: PooledCell[] = [];
  private candidateCellCount = 0;
  private readonly candidateIds: string[] = [];
  private allowCreate = false;
  private complete = true;
  private readCell: ReadBodyCellOwnershipState | null = null;

  private readonly findPinnedCenterOrder = (
    center: PooledRow,
  ): void => {
    if (this.centerPhysicalOrderCount === 0) {
      this.tryBuildCenterPhysicalOrder(center.cells);
    }
  };

  private readonly syncPinnedLogicalRow = (
    center: PooledRow,
    left: PooledRow | null,
    right: PooledRow | null,
  ): void => {
    this.syncLogicalRow(center, left, right);
  };

  private readonly clearPinnedLogicalRow = (
    center: PooledRow,
  ): void => {
    clearPinnedLaneOwnership(center.element);
  };

  syncStructure(
    ctx: DomGridFeatureContext,
    readCell: ReadBodyCellOwnershipState,
  ): void {
    this.sync(ctx, readCell, true);
  }

  /** Returns false when retained physical capacity needs structural warm-up. */
  syncPosition(
    ctx: DomGridFeatureContext,
    readCell: ReadBodyCellOwnershipState,
  ): boolean {
    this.sync(ctx, readCell, false);
    return this.complete;
  }

  clear(ctx: DomGridFeatureContext): void {
    for (const poolRow of ctx.getPool()) {
      clearPinnedLaneOwnership(poolRow.element);
    }
    ctx.forEachRowPinnedLogicalPoolRow?.(this.clearPinnedLogicalRow);
    this.states = new WeakMap<PooledRow, RetainedRowOwnershipState>();
    this.centerPhysicalOrderCount = 0;
    this.candidateCellCount = 0;
  }

  private sync(
    ctx: DomGridFeatureContext,
    readCell: ReadBodyCellOwnershipState,
    allowCreate: boolean,
  ): void {
    this.readCell = readCell;
    this.allowCreate = allowCreate;
    this.complete = true;
    this.centerPhysicalOrderCount = 0;
    try {
      this.prepareCenterPhysicalOrder(ctx);
      for (const poolRow of ctx.getPool()) {
        this.syncLogicalRow(poolRow, null, null);
      }
      ctx.forEachRowPinnedLogicalPoolRow?.(this.syncPinnedLogicalRow);
    } finally {
      this.readCell = null;
      this.allowCreate = false;
      this.candidateCellCount = 0;
    }
  }

  private prepareCenterPhysicalOrder(ctx: DomGridFeatureContext): void {
    for (const poolRow of ctx.getPool()) {
      if (this.tryBuildCenterPhysicalOrder(poolRow.cells)) return;
    }
    ctx.forEachRowPinnedLogicalPoolRow?.(this.findPinnedCenterOrder);
  }

  private tryBuildCenterPhysicalOrder(
    cells: readonly PooledCell[],
  ): boolean {
    const readCell = this.readCell;
    if (readCell === null) return false;

    let minimum = Number.MAX_SAFE_INTEGER;
    let maximum = -1;
    let count = 0;
    for (let physical = 0; physical < cells.length; physical += 1) {
      const state = readCell(cells[physical]!);
      if (state === null || !state.active) continue;
      minimum = Math.min(minimum, state.ariaColIndex);
      maximum = Math.max(maximum, state.ariaColIndex);
      count += 1;
    }
    if (count === 0) return false;
    if (
      minimum < 1 ||
      maximum < minimum ||
      maximum - minimum + 1 !== count
    ) {
      this.complete = false;
      return false;
    }
    if (!this.ensureNumberCapacity(this.centerPhysicalOrder, count)) {
      return false;
    }
    for (let index = 0; index < count; index += 1) {
      this.centerPhysicalOrder[index] = -1;
    }
    for (let physical = 0; physical < cells.length; physical += 1) {
      const state = readCell(cells[physical]!);
      if (state === null || !state.active) continue;
      const logicalOffset = state.ariaColIndex - minimum;
      if (
        logicalOffset < 0 ||
        logicalOffset >= count ||
        this.centerPhysicalOrder[logicalOffset] !== -1
      ) {
        this.complete = false;
        this.centerPhysicalOrderCount = 0;
        return false;
      }
      this.centerPhysicalOrder[logicalOffset] = physical;
    }
    for (let index = 0; index < count; index += 1) {
      const physical = this.centerPhysicalOrder[index];
      if (physical === undefined || physical < 0) {
        this.complete = false;
        this.centerPhysicalOrderCount = 0;
        return false;
      }
    }
    this.centerPhysicalOrderCount = count;
    return true;
  }

  private syncLogicalRow(
    center: PooledRow,
    left: PooledRow | null,
    right: PooledRow | null,
  ): void {
    let state = this.states.get(center);
    if (state === undefined) {
      if (!this.allowCreate) {
        this.complete = false;
        return;
      }
      state = createRetainedRowOwnershipState();
      this.states.set(center, state);
    }

    const owner = center.element;
    if (state.ownerElement !== owner && state.ownerElement !== null) {
      clearPinnedLaneOwnership(state.ownerElement);
    }

    const active =
      center.rowId !== null &&
      center.rowIndex >= 0 &&
      isVisible(owner);
    if (!active) {
      this.publishCandidate(state, owner, 0);
      return;
    }

    const leftCells = left?.cells ?? center.pinnedCells;
    const rightCells = right?.cells ?? center.rightPinnedCells;
    const leftElement = left?.element ?? center.pinnedElement ?? null;
    const rightElement =
      right?.element ?? center.rightPinnedElement ?? null;
    const leftSplit =
      leftCells !== undefined &&
      leftCells.length > 0 &&
      isVisible(leftElement);
    const rightSplit =
      rightCells !== undefined &&
      rightCells.length > 0 &&
      isVisible(rightElement);
    if (!leftSplit && !rightSplit) {
      this.publishCandidate(state, owner, 0);
      return;
    }

    this.candidateCellCount = 0;
    let previousAriaColIndex = 0;
    const beforeLeft = this.candidateCellCount;
    if (
      leftSplit &&
      !this.appendNaturalLane(
        leftCells!,
        center.rowId!,
        previousAriaColIndex,
      )
    ) {
      this.failClosed(state, owner);
      return;
    }
    if (leftSplit && this.candidateCellCount === beforeLeft) {
      this.failClosed(state, owner);
      return;
    }
    previousAriaColIndex = this.lastCandidateAriaColIndex();

    if (
      !this.appendCenterLane(
        center.cells,
        center.rowId!,
        previousAriaColIndex,
      )
    ) {
      this.failClosed(state, owner);
      return;
    }
    previousAriaColIndex = this.lastCandidateAriaColIndex();

    const beforeRight = this.candidateCellCount;
    if (
      rightSplit &&
      !this.appendNaturalLane(
        rightCells!,
        center.rowId!,
        previousAriaColIndex,
      )
    ) {
      this.failClosed(state, owner);
      return;
    }
    if (rightSplit && this.candidateCellCount === beforeRight) {
      this.failClosed(state, owner);
      return;
    }

    if (this.candidateCellCount === 0) {
      this.failClosed(state, owner);
      return;
    }
    this.publishCandidate(state, owner, this.candidateCellCount);
  }

  private appendNaturalLane(
    cells: readonly PooledCell[],
    rowId: string,
    previousAriaColIndex: number,
  ): boolean {
    const readCell = this.readCell;
    if (readCell === null) return false;
    let previous = previousAriaColIndex;
    for (const cell of cells) {
      const state = readCell(cell);
      if (state === null || !state.active) continue;
      if (
        state.rowId !== rowId ||
        state.ariaColIndex <= previous ||
        !this.appendCandidateCell(cell)
      ) {
        return false;
      }
      previous = state.ariaColIndex;
    }
    return true;
  }

  private appendCenterLane(
    cells: readonly PooledCell[],
    rowId: string,
    previousAriaColIndex: number,
  ): boolean {
    const readCell = this.readCell;
    if (readCell === null) return false;
    let previous = previousAriaColIndex;
    let activeCount = 0;
    for (const cell of cells) {
      if (readCell(cell)?.active) activeCount += 1;
    }
    if (activeCount !== this.centerPhysicalOrderCount) return false;

    for (
      let logical = 0;
      logical < this.centerPhysicalOrderCount;
      logical += 1
    ) {
      const physical = this.centerPhysicalOrder[logical]!;
      const cell = cells[physical];
      if (cell === undefined) return false;
      const state = readCell(cell);
      if (
        state === null ||
        !state.active ||
        state.rowId !== rowId ||
        state.ariaColIndex <= previous ||
        !this.appendCandidateCell(cell)
      ) {
        return false;
      }
      previous = state.ariaColIndex;
    }
    return true;
  }

  private appendCandidateCell(cell: PooledCell): boolean {
    if (
      this.candidateCellCount >= this.candidateCells.length &&
      !this.allowCreate
    ) {
      this.complete = false;
      return false;
    }
    this.candidateCells[this.candidateCellCount] = cell;
    this.candidateCellCount += 1;
    return true;
  }

  private lastCandidateAriaColIndex(): number {
    if (this.candidateCellCount === 0 || this.readCell === null) return 0;
    return (
      this.readCell(this.candidateCells[this.candidateCellCount - 1]!)
        ?.ariaColIndex ?? 0
    );
  }

  private failClosed(
    state: RetainedRowOwnershipState,
    owner: HTMLElement,
  ): void {
    this.complete = false;
    this.publishCandidate(state, owner, 0);
  }

  private publishCandidate(
    state: RetainedRowOwnershipState,
    owner: HTMLElement,
    count: number,
  ): void {
    let changed =
      !state.initialized ||
      state.ownerElement !== owner ||
      state.ownedCellCount !== count;
    if (!changed) {
      for (let index = 0; index < count; index += 1) {
        if (state.ownedCells[index] !== this.candidateCells[index]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    if (!this.ensureCellCapacity(state.ownedCells, count)) {
      this.complete = false;
      return;
    }

    if (count > 0) {
      if (!this.ensureStringCapacity(this.candidateIds, count)) {
        this.complete = false;
        return;
      }
      const readCell = this.readCell;
      if (readCell === null) {
        this.complete = false;
        return;
      }
      for (let index = 0; index < count; index += 1) {
        const cell = this.candidateCells[index]!;
        const cellState = readCell(cell);
        if (cellState === null || !cellState.active) {
          this.complete = false;
          return;
        }
        state.ownedCells[index] = cell;
        this.candidateIds[index] = cellState.id;
      }
      const retainedLength = this.candidateIds.length;
      this.candidateIds.length = count;
      try {
        applyPinnedLaneOwnership(owner, this.candidateIds.join(" "));
      } finally {
        this.candidateIds.length = retainedLength;
      }
    } else {
      clearPinnedLaneOwnership(owner);
    }
    state.ownedCells.length = count;
    state.initialized = true;
    state.ownerElement = owner;
    state.ownedCellCount = count;
  }

  private ensureNumberCapacity(target: number[], count: number): boolean {
    if (target.length >= count) return true;
    if (!this.allowCreate) {
      this.complete = false;
      return false;
    }
    while (target.length < count) target.push(-1);
    return true;
  }

  private ensureCellCapacity(target: PooledCell[], count: number): boolean {
    if (target.length >= count) return true;
    if (!this.allowCreate) {
      this.complete = false;
      return false;
    }
    while (target.length < count) target.push(this.candidateCells[target.length]!);
    return true;
  }

  private ensureStringCapacity(target: string[], count: number): boolean {
    if (target.length >= count) return true;
    if (!this.allowCreate) {
      this.complete = false;
      return false;
    }
    while (target.length < count) target.push("");
    return true;
  }
}
