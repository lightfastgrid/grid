/**
 * Owns the full vertical row-recycling boundary.
 *
 * Everything about "which pool rows need rebinding after a scroll" lives here:
 *   - offset math (virtual slot → physical pool index)
 *   - skip / partial / full decision
 *   - iteration over affected slots
 *
 * Stability depends ONLY on vertical state (startIndex, dataLength).
 * Horizontal column-window changes are handled separately by VirtualWindowSync.
 *
 * The renderer provides a `bindSlot` callback for the DOM work.
 * If row recycling is broken, this file is the single place to look.
 */

export interface RingSyncParams {
  startIndex: number;
  poolSize: number;
  dataLength: number;
  /** true for scroll-driven syncs (may partial-update); false forces full rebind. */
  isScrollDriven: boolean;
  /** Called for each virtual slot that needs binding. */
  bindSlot: (virtualSlot: number) => void;
}

export type RingSyncOutcome = "skipped" | "partial" | "full";

export class VerticalRingBuffer {
  private offset = 0;
  private prevStartIndex: number | null = null;
  private prevDataLength = -1;

  /** Maps virtual visible slot → physical pool index. */
  toPhysical(virtualSlot: number, poolSize: number): number {
    return ((virtualSlot + this.offset) % poolSize + poolSize) % poolSize;
  }

  /**
   * Single entry point for the renderer.
   *
   * Decides skip / partial / full, iterates the right slots, and calls
   * `bindSlot` for each one. Returns what happened so the caller can
   * update its own bookkeeping (e.g. scroll dedup key).
   */
  sync(params: RingSyncParams): RingSyncOutcome {
    const { startIndex, poolSize, dataLength, isScrollDriven, bindSlot } = params;

    if (isScrollDriven) {
      return this.advanceAndBind(startIndex, poolSize, dataLength, bindSlot);
    }

    this.resetState(startIndex, dataLength);
    for (let v = 0; v < poolSize; v++) bindSlot(v);
    return "full";
  }

  /** Discard all state so the next `sync` returns `"full"`. */
  invalidate(): void {
    this.offset = 0;
    this.prevStartIndex = null;
    this.prevDataLength = -1;
  }

  // ── private ──────────────────────────────────────

  private advanceAndBind(
    startIndex: number,
    poolSize: number,
    dataLength: number,
    bindSlot: (v: number) => void,
  ): RingSyncOutcome {
    const delta =
      this.prevStartIndex === null
        ? poolSize
        : startIndex - this.prevStartIndex;

    const contextStable =
      this.prevStartIndex !== null &&
      dataLength === this.prevDataLength;

    if (contextStable && delta === 0) {
      return "skipped";
    }

    if (contextStable && Math.abs(delta) < poolSize) {
      this.offset =
        ((this.offset + delta) % poolSize + poolSize) % poolSize;

      if (delta > 0) {
        for (let j = 0; j < delta; j++) {
          bindSlot(poolSize - delta + j);
        }
      } else {
        const d = -delta;
        for (let j = 0; j < d; j++) {
          bindSlot(j);
        }
      }

      this.prevStartIndex = startIndex;
      return "partial";
    }

    this.resetState(startIndex, dataLength);
    for (let v = 0; v < poolSize; v++) bindSlot(v);
    return "full";
  }

  private resetState(startIndex: number, dataLength: number): void {
    this.offset = 0;
    this.prevStartIndex = startIndex;
    this.prevDataLength = dataLength;
  }
}
