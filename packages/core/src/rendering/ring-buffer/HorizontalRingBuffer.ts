/**
 * Horizontal column-slot recycling, symmetric to VerticalRingBuffer.
 *
 * Instead of rebinding every cell slot when startCol changes by a small
 * delta, the ring rotates and only the entering column slots are rebound.
 * Cells that remain visible keep their data-col-id, which means the
 * CSS-variable geometry system doesn't shift them — eliminating CLS on
 * horizontal scroll.
 *
 * If horizontal scroll recycling is broken, this file is the place to look.
 */

export interface HRingSyncParams {
  startCol: number;
  slotCount: number;
  /** true for scroll-driven syncs; false forces full reset. */
  isScrollDriven: boolean;
}

export interface HRingSyncResult {
  outcome: "skipped" | "partial" | "full";
  /** Virtual column slots that need rebinding. */
  enteringSlots: number[];
}

export class HorizontalRingBuffer {
  private offset = 0;
  private prevStartCol: number | null = null;

  /** Maps virtual column slot → physical cell index. */
  toPhysical(virtualSlot: number, slotCount: number): number {
    return ((virtualSlot + this.offset) % slotCount + slotCount) % slotCount;
  }

  sync(params: HRingSyncParams): HRingSyncResult {
    const { startCol, slotCount, isScrollDriven } = params;

    if (isScrollDriven) {
      return this.advance(startCol, slotCount);
    }

    this.resetState(startCol);
    return { outcome: "full", enteringSlots: allSlots(slotCount) };
  }

  invalidate(): void {
    this.offset = 0;
    this.prevStartCol = null;
  }

  // ── private ──────────────────────────────────────

  private advance(startCol: number, slotCount: number): HRingSyncResult {
    if (this.prevStartCol === null) {
      this.resetState(startCol);
      return { outcome: "full", enteringSlots: allSlots(slotCount) };
    }

    const delta = startCol - this.prevStartCol;

    if (delta === 0) {
      return { outcome: "skipped", enteringSlots: [] };
    }

    if (Math.abs(delta) < slotCount) {
      this.offset =
        ((this.offset + delta) % slotCount + slotCount) % slotCount;

      const entering: number[] = [];
      if (delta > 0) {
        for (let j = 0; j < delta; j++) entering.push(slotCount - delta + j);
      } else {
        const d = -delta;
        for (let j = 0; j < d; j++) entering.push(j);
      }

      this.prevStartCol = startCol;
      return { outcome: "partial", enteringSlots: entering };
    }

    this.resetState(startCol);
    return { outcome: "full", enteringSlots: allSlots(slotCount) };
  }

  private resetState(startCol: number): void {
    this.offset = 0;
    this.prevStartCol = startCol;
  }
}

function allSlots(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}
