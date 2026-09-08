import {
  buildColumnPinningLayout,
  type ColumnPinningLayout,
} from "../../features/column-pinning/columnPinningLayout";
import type { HeaderLaneRefs } from "../../features/types";
import type { GridLayoutMetrics } from "../../layout/gridLayoutMetrics";
import type { ColumnDef, GridSkeleton, PooledCell, PooledRow } from "../../types";
import { CSS } from "../const/css-classes";
import { applyColumnWidthVars } from "../helpers/applyColumnWidthVars";
import { computeCenterSlotCount } from "../helpers/calculateColumnPoolSize";
import { computeRowPoolSize } from "../helpers/calculatePoolSize";
import { syncColumnGeometryStyle } from "../helpers/columnGeometryVars";
import {
  buildHeaderSlotRow,
  buildPool,
  buildRowTemplate,
} from "../helpers/dom";
import { calculateVerticalContentHeight } from "../helpers/verticalScrollGeometry";

export interface DomPoolManagerDeps {
  skeleton: GridSkeleton;
  getLayoutMetrics(): GridLayoutMetrics;
  suppressRowVirtualization(): boolean;
  suppressColumnVirtualization(): boolean;
  onPoolCleared?: () => void;
}

/**
 * Header row, pooled body rows, column slot count, scroll height, and
 * structural column geometry — no selection, resize, or window sync.
 */
export class DomPoolManager {
  pool: PooledRow[] = [];
  headerRowEl: HTMLDivElement | null = null;
  /** Pinned-left header leaf row (inside the pinned-left header stack). */
  pinnedHeaderRowEl: HTMLDivElement | null = null;
  /** Pinned-right header leaf row (inside the pinned-right header stack). */
  pinnedRightHeaderRowEl: HTMLDivElement | null = null;
  /** Structural stack wrapping pinned-left leaf + addon rows. */
  pinnedLeftHeaderStackEl: HTMLDivElement | null = null;
  /** Structural stack wrapping pinned-right leaf + addon rows. */
  pinnedRightHeaderStackEl: HTMLDivElement | null = null;
  /** Total physical column slot count (center only — pinned cells are separate). */
  columnSlotCount = 0;
  /** Current pinning layout; rebuilt on every structural column change. */
  pinningLayout: ColumnPinningLayout = { leftPinned: [], center: [], rightPinned: [], ordered: [] };
  /** Physical center-only slot count (horizontal ring size). */
  centerSlotCount = 0;

  constructor(private readonly deps: DomPoolManagerDeps) {}

  rebuild(columns: ColumnDef[], rowCount: number, topPinnedHeight = 0, bottomPinnedHeight = 0): void {
    const { skeleton } = this.deps;
    const { root, header, scrollContainer, viewport } = skeleton;

    // Remove existing pinned lanes before clearing refs — otherwise orphaned
    // header stacks remain in the scroll container (querySelector finds empties).
    this.removePinnedLane("left");
    this.removePinnedLane("right");

    header.innerHTML = "";
    this.headerRowEl = null;
    this.pinnedHeaderRowEl = null;
    this.pinnedRightHeaderRowEl = null;
    this.pinnedLeftHeaderStackEl = null;
    this.pinnedRightHeaderStackEl = null;
    this.pool = [];
    this.deps.onPoolCleared?.();

    scrollContainer.querySelectorAll(":scope > .lfg-row").forEach((r: Element) => r.remove());

    this.pinningLayout = buildColumnPinningLayout(columns);

    applyColumnWidthVars(root, columns, null, this.pinningLayout);
    syncColumnGeometryStyle(root, columns);

    const pinnedCount = this.pinningLayout.leftPinned.length;

    this.centerSlotCount = computeCenterSlotCount(
      viewport,
      this.pinningLayout,
      this.deps.suppressColumnVirtualization(),
    );

    // Center-only slot count (pinned cells are in a separate lane)
    this.columnSlotCount = this.centerSlotCount;

    // Build center header
    const headerRow = buildHeaderSlotRow(this.centerSlotCount);
    header.appendChild(headerRow);
    this.headerRowEl = headerRow;

    // Build center row pool
    const template = buildRowTemplate(this.centerSlotCount);
    const effectiveRowCount = rowCount;
    const poolSize = computeRowPoolSize(
      viewport,
      effectiveRowCount,
      this.deps.suppressRowVirtualization(),
      this.deps.getLayoutMetrics(),
    );
    this.pool = buildPool(template, poolSize, this.centerSlotCount, scrollContainer);

    // Build pinned-left lane if needed
    if (pinnedCount > 0) {
      this.buildPinnedLane(pinnedCount, poolSize);
    } else {
      this.removePinnedLane();
    }

    // Build pinned-right lane if needed
    const rightPinnedCount = this.pinningLayout.rightPinned.length;
    if (rightPinnedCount > 0) {
      this.buildPinnedLane(rightPinnedCount, poolSize, "right");
    } else {
      this.removePinnedLane("right");
    }

    this.updateScrollHeight(effectiveRowCount, topPinnedHeight, bottomPinnedHeight);
  }

  /**
   * Cached lane containers + leaf rows for header addon features.
   * Returns null before the first successful rebuild that created a center leaf row.
   */
  getHeaderLaneRefs(): HeaderLaneRefs | null {
    if (!this.headerRowEl) return null;
    const { skeleton } = this.deps;
    return {
      center: {
        container: skeleton.header,
        leafRow: this.headerRowEl,
      },
      left:
        this.pinnedLeftHeaderStackEl && this.pinnedHeaderRowEl
          ? {
              container: this.pinnedLeftHeaderStackEl,
              leafRow: this.pinnedHeaderRowEl,
            }
          : null,
      right:
        this.pinnedRightHeaderStackEl && this.pinnedRightHeaderRowEl
          ? {
              container: this.pinnedRightHeaderStackEl,
              leafRow: this.pinnedRightHeaderRowEl,
            }
          : null,
    };
  }

  private buildPinnedLane(pinnedCount: number, poolSize: number, side: "left" | "right" = "left"): void {
    const { skeleton } = this.deps;
    const css = pinnedLaneCss(side);

    getSkeletonLayer(skeleton, side)?.remove();
    this.removePinnedHeaderStack(side);

    const stack = document.createElement("div");
    stack.className =
      CSS.PINNED_HEADER_STACK +
      " " +
      (side === "left" ? CSS.PINNED_LEFT_HEADER_STACK : CSS.PINNED_RIGHT_HEADER_STACK);

    const pinnedHeaderRow = buildHeaderSlotRow(pinnedCount);
    pinnedHeaderRow.className = css.headerClass;
    stack.appendChild(pinnedHeaderRow);

    skeleton.scrollContainer.insertBefore(stack, skeleton.header);
    setSkeletonRefs(skeleton, side, { header: pinnedHeaderRow });
    if (side === "left") {
      this.pinnedLeftHeaderStackEl = stack;
      this.pinnedHeaderRowEl = pinnedHeaderRow;
    } else {
      this.pinnedRightHeaderStackEl = stack;
      this.pinnedRightHeaderRowEl = pinnedHeaderRow;
    }

    const layer = document.createElement("div");
    layer.className = css.layerClass;

    const pinnedBody = document.createElement("div");
    pinnedBody.className = css.bodyClass;
    layer.appendChild(pinnedBody);
    setSkeletonRefs(skeleton, side, { layer, body: pinnedBody });

    const pinnedTemplate = buildPinnedRowTemplate(pinnedCount, css.rowClass);

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < poolSize; i++) {
      const pinnedRowEl = pinnedTemplate.cloneNode(true) as HTMLDivElement;
      const pinnedCells: PooledCell[] = [];
      for (let c = 0; c < pinnedCount; c++) {
        pinnedCells.push({
          element: pinnedRowEl.children[c] as HTMLDivElement,
          value: "",
        });
      }
      setPinnedPoolRowRefs(this.pool[i]!, side, { element: pinnedRowEl, cells: pinnedCells });
      fragment.appendChild(pinnedRowEl);
    }
    pinnedBody.appendChild(fragment);

    skeleton.scrollContainer.insertBefore(layer, skeleton.header.nextSibling);
  }

  private removePinnedHeaderStack(side: "left" | "right"): void {
    const { skeleton } = this.deps;
    if (side === "left") {
      this.pinnedLeftHeaderStackEl?.remove();
      this.pinnedLeftHeaderStackEl = null;
      // Legacy: leaf may have been a direct scroll-container child before stacks.
      getSkeletonHeader(skeleton, side)?.remove();
      this.pinnedHeaderRowEl = null;
      setSkeletonRefs(skeleton, side, { header: undefined });
    } else {
      this.pinnedRightHeaderStackEl?.remove();
      this.pinnedRightHeaderStackEl = null;
      getSkeletonHeader(skeleton, side)?.remove();
      this.pinnedRightHeaderRowEl = null;
      setSkeletonRefs(skeleton, side, { header: undefined });
    }
  }

  private removePinnedLane(side: "left" | "right" = "left"): void {
    const { skeleton } = this.deps;
    getSkeletonLayer(skeleton, side)?.remove();
    this.removePinnedHeaderStack(side);
    setSkeletonRefs(skeleton, side, { layer: undefined, header: undefined, body: undefined });
    for (const row of this.pool) {
      clearPinnedPoolRowRefs(row, side);
    }
  }

  updateScrollHeight(rowCount: number, topPinnedHeight = 0, bottomPinnedHeight = 0, headerAddonHeight = 0): void {
    const { headerHeight, rowHeight } = this.deps.getLayoutMetrics();
    const totalHeight = calculateVerticalContentHeight({
      centerRowCount: rowCount,
      rowHeight,
      headerHeight,
      headerAddonHeight,
      topPinnedHeight,
      bottomPinnedHeight,
    });
    this.deps.skeleton.scrollContainer.style.height = `${totalHeight}px`;
  }

  /**
   * Commit pinned-column body extents after their recycled rows have moved.
   * Writing this before window sync can leave Chrome's scroll overflow at the
   * rows' previous deep transforms even after the main container shrinks.
   */
  syncPinnedBodyHeight(rowCount: number): void {
    const { rowHeight } = this.deps.getLayoutMetrics();
    const nextHeight = `${rowCount * rowHeight}px`;
    const { pinnedBodyContainer, pinnedRightBodyContainer } = this.deps.skeleton;
    if (pinnedBodyContainer && pinnedBodyContainer.style.height !== nextHeight) {
      pinnedBodyContainer.style.height = nextHeight;
    }
    if (
      pinnedRightBodyContainer &&
      pinnedRightBodyContainer.style.height !== nextHeight
    ) {
      pinnedRightBodyContainer.style.height = nextHeight;
    }
  }

  clear(): void {
    this.pool = [];
    this.headerRowEl = null;
    this.pinnedHeaderRowEl = null;
    this.pinnedRightHeaderRowEl = null;
    this.pinnedLeftHeaderStackEl = null;
    this.pinnedRightHeaderStackEl = null;
    this.pinningLayout = { leftPinned: [], center: [], rightPinned: [], ordered: [] };
    this.centerSlotCount = 0;
    this.columnSlotCount = 0;
    this.removePinnedLane("left");
    this.removePinnedLane("right");
    this.deps.onPoolCleared?.();
  }
}

// ── Typed pinned-lane helpers (no `as any`) ──

interface PinnedLaneCss {
  headerClass: string;
  layerClass: string;
  bodyClass: string;
  rowClass: string;
}

function pinnedLaneCss(side: "left" | "right"): PinnedLaneCss {
  if (side === "left") {
    return {
      headerClass: CSS.HEADER_ROW + " lfg-pinned-header-row",
      layerClass: "lfg-pinned-left-layer",
      bodyClass: "lfg-pinned-body",
      rowClass: "lfg-pinned-row",
    };
  }
  return {
    headerClass: CSS.HEADER_ROW + " lfg-pinned-right-header-row",
    layerClass: "lfg-pinned-right-layer",
    bodyClass: "lfg-pinned-right-body",
    rowClass: "lfg-pinned-right-row",
  };
}

function getSkeletonLayer(sk: GridSkeleton, side: "left" | "right"): HTMLDivElement | undefined {
  return side === "left" ? sk.pinnedLeftLayer : sk.pinnedRightLayer;
}

function getSkeletonHeader(sk: GridSkeleton, side: "left" | "right"): HTMLDivElement | undefined {
  return side === "left" ? sk.pinnedHeaderRow : sk.pinnedRightHeaderRow;
}

function setSkeletonRefs(
  sk: GridSkeleton,
  side: "left" | "right",
  refs: { layer?: HTMLDivElement; header?: HTMLDivElement; body?: HTMLDivElement },
): void {
  if (side === "left") {
    if ("layer" in refs) sk.pinnedLeftLayer = refs.layer;
    if ("header" in refs) sk.pinnedHeaderRow = refs.header;
    if ("body" in refs) sk.pinnedBodyContainer = refs.body;
  } else {
    if ("layer" in refs) sk.pinnedRightLayer = refs.layer;
    if ("header" in refs) sk.pinnedRightHeaderRow = refs.header;
    if ("body" in refs) sk.pinnedRightBodyContainer = refs.body;
  }
}

function setPinnedPoolRowRefs(
  row: PooledRow,
  side: "left" | "right",
  refs: { element: HTMLDivElement; cells: PooledCell[] },
): void {
  if (side === "left") {
    row.pinnedElement = refs.element;
    row.pinnedCells = refs.cells;
  } else {
    row.rightPinnedElement = refs.element;
    row.rightPinnedCells = refs.cells;
  }
}

function clearPinnedPoolRowRefs(row: PooledRow, side: "left" | "right"): void {
  if (side === "left") {
    row.pinnedElement = undefined;
    row.pinnedCells = undefined;
    row.pinnedLayoutTranslateY = undefined;
  } else {
    row.rightPinnedElement = undefined;
    row.rightPinnedCells = undefined;
    row.rightPinnedLayoutTranslateY = undefined;
  }
}

function buildPinnedRowTemplate(cellCount: number, rowClass: string): HTMLDivElement {
  const template = document.createElement("div");
  template.className = rowClass;
  for (let i = 0; i < cellCount; i++) {
    const cell = document.createElement("div");
    cell.className = CSS.CELL;
    template.appendChild(cell);
  }
  return template;
}
