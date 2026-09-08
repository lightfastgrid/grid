import type { FloatingPlacement, FloatingPositionResult } from "./types";

export interface PositionInput {
  anchorEl: HTMLElement;
  hostEl: HTMLElement;
  placement: FloatingPlacement;
  matchAnchorWidth: boolean;
  clampToViewport: boolean;
  /** Extra gap (px) between anchor and host on the placement side. */
  offset?: number;
}

type Side = "top" | "bottom" | "left" | "right";
type Alignment = "start" | "center" | "end";

interface Boundary {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

function parsePlacement(p: FloatingPlacement): { side: Side; align: Alignment } | null {
  if (p === "cell") return null;
  const [side, align] = p.split("-") as [Side, Alignment];
  return { side, align };
}

function buildPlacement(side: Side, align: Alignment): FloatingPlacement {
  return `${side}-${align}` as FloatingPlacement;
}

function intersectBoundary(a: DOMRect, b: Boundary): Boundary {
  const top = Math.max(a.top, b.top);
  const left = Math.max(a.left, b.left);
  const bottom = Math.min(a.bottom, b.bottom);
  const right = Math.min(a.right, b.right);
  return {
    top,
    left,
    bottom: Math.max(bottom, top),
    right: Math.max(right, left),
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

export class FloatingPositioner {
  constructor(private readonly gridRoot: HTMLElement) {}

  position(input: PositionInput): FloatingPositionResult {
    const { anchorEl, hostEl, matchAnchorWidth, clampToViewport } = input;
    const offset = Math.max(0, input.offset ?? 0);
    let placement = input.placement;

    const anchor = anchorEl.getBoundingClientRect();
    const root = this.gridRoot.getBoundingClientRect();

    if (matchAnchorWidth) {
      hostEl.style.width = `${Math.round(anchor.width)}px`;
    }

    const host = hostEl.getBoundingClientRect();

    let x: number;
    let y: number;

    if (placement === "cell") {
      x = anchor.left - root.left;
      y = anchor.top - root.top;
      if (matchAnchorWidth) {
        hostEl.style.height = `${Math.round(anchor.height)}px`;
      }
    } else {
      const parsed = parsePlacement(placement)!;
      let { side } = parsed;
      const { align } = parsed;

      if (clampToViewport) {
        const boundary = this.visibleBoundary(root);
        side = this.maybeFlip(side, anchor, host, boundary, offset);
        placement = buildPlacement(side, align);
      }

      x = this.computeX(side, align, anchor, root, host, offset);
      y = this.computeY(side, align, anchor, root, host, offset);
    }

    if (clampToViewport && placement !== "cell") {
      const vb = this.visibleBoundary(root);
      const maxX = vb.right - root.left - host.width;
      const minX = vb.left - root.left;
      x = Math.max(minX, Math.min(x, maxX));
      const maxY = vb.bottom - root.top - host.height;
      const minY = vb.top - root.top;
      y = Math.max(minY, Math.min(y, maxY));
    }

    x = Math.round(x);
    y = Math.round(y);

    hostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    return { x, y, placement };
  }

  private visibleBoundary(root: DOMRect): Boundary {
    const viewport: Boundary = {
      top: 0,
      left: 0,
      bottom: window.innerHeight,
      right: window.innerWidth,
      width: window.innerWidth,
      height: window.innerHeight,
    };
    return intersectBoundary(root, viewport);
  }

  private maybeFlip(
    side: Side,
    anchor: DOMRect,
    host: DOMRect,
    boundary: Boundary,
    offset: number,
  ): Side {
    const gap = host.height + offset;
    const gapW = host.width + offset;
    if (side === "bottom" && anchor.bottom + gap > boundary.bottom) {
      if (anchor.top - gap >= boundary.top) return "top";
    } else if (side === "top" && anchor.top - gap < boundary.top) {
      if (anchor.bottom + gap <= boundary.bottom) return "bottom";
    } else if (side === "right" && anchor.right + gapW > boundary.right) {
      if (anchor.left - gapW >= boundary.left) return "left";
    } else if (side === "left" && anchor.left - gapW < boundary.left) {
      if (anchor.right + gapW <= boundary.right) return "right";
    }
    return side;
  }

  private computeX(
    side: Side, align: Alignment,
    anchor: DOMRect, root: DOMRect, host: DOMRect,
    offset: number,
  ): number {
    if (side === "left") return anchor.left - root.left - host.width - offset;
    if (side === "right") return anchor.right - root.left + offset;

    // top or bottom: align along X
    if (align === "start") return anchor.left - root.left;
    if (align === "end") return anchor.right - root.left - host.width;
    return anchor.left - root.left + (anchor.width - host.width) / 2;
  }

  private computeY(
    side: Side, align: Alignment,
    anchor: DOMRect, root: DOMRect, host: DOMRect,
    offset: number,
  ): number {
    if (side === "top") return anchor.top - root.top - host.height - offset;
    if (side === "bottom") return anchor.bottom - root.top + offset;

    // left or right: align along Y
    if (align === "start") return anchor.top - root.top;
    if (align === "end") return anchor.bottom - root.top - host.height;
    return anchor.top - root.top + (anchor.height - host.height) / 2;
  }
}
