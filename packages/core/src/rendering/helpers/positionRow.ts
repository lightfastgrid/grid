// ─── helpers/positionRow.ts ───

/**
 * Position a pool row at a specific data index.
 *
 * Uses translateY instead of `top` because:
 *   - transform is GPU-composited (no layout recalc)
 *   - changing `top` triggers reflow for every row
 *
 * Row always has `top: 0` in CSS. The transform offsets it.
 */
export function positionRow(
  poolRow: { element: HTMLDivElement; layoutTranslateY?: number },
  dataIndex: number,
  rowHeight: number,
  headerHeight = 0,
): void {
  const y = headerHeight + dataIndex * rowHeight;
  if (poolRow.layoutTranslateY === y) return;
  poolRow.layoutTranslateY = y;
  poolRow.element.style.transform = `translateY(${y}px)`;
}

/**
 * Position a pinned row element (left or right) relative to its pinned body
 * container. No header offset — only `dataIndex * rowHeight`.
 */
export function positionPinnedRow(
  poolRow: {
    pinnedElement?: HTMLDivElement; pinnedLayoutTranslateY?: number;
    rightPinnedElement?: HTMLDivElement; rightPinnedLayoutTranslateY?: number;
  },
  dataIndex: number,
  rowHeight: number,
  side: "left" | "right" = "left",
  bodyOffset = 0,
): void {
  const el = side === "left" ? poolRow.pinnedElement : poolRow.rightPinnedElement;
  if (!el) return;
  const y = bodyOffset + dataIndex * rowHeight;
  const cached = side === "left" ? poolRow.pinnedLayoutTranslateY : poolRow.rightPinnedLayoutTranslateY;
  if (cached === y) return;
  if (side === "left") poolRow.pinnedLayoutTranslateY = y;
  else poolRow.rightPinnedLayoutTranslateY = y;
  el.style.transform = `translateY(${y}px)`;
}