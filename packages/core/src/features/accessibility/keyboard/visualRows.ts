import type { VisualRowLayout } from "../../../internal/layoutTypes";

export function keyboardVisualRowCount(layout: VisualRowLayout): number {
  return (
    layout.topDisplayIndexes.length +
    layout.centerRowCount +
    layout.bottomDisplayIndexes.length
  );
}

/** Visual index to display index in O(1), with no pinned-array scan. */
export function keyboardDisplayIndexAtVisual(
  layout: VisualRowLayout,
  visualIndex: number,
): number {
  const topCount = layout.topDisplayIndexes.length;
  if (visualIndex < topCount) return layout.topDisplayIndexes[visualIndex]!;

  const centerIndex = visualIndex - topCount;
  if (centerIndex < layout.centerRowCount) {
    return layout.centerToDisplayIndex === null
      ? centerIndex
      : layout.centerToDisplayIndex(centerIndex);
  }

  return layout.bottomDisplayIndexes[centerIndex - layout.centerRowCount]!;
}

/**
 * Display index to visual index for low-frequency focus synchronization.
 * This may inspect the bounded pinned-row arrays and must not run on keydown.
 */
export function keyboardVisualIndexOfDisplay(
  layout: VisualRowLayout,
  displayIndex: number,
): number {
  const topCount = layout.topDisplayIndexes.length;
  const topIndex = layout.topDisplayIndexes.indexOf(displayIndex);
  if (topIndex >= 0) return topIndex;

  const bottomIndex = layout.bottomDisplayIndexes.indexOf(displayIndex);
  if (bottomIndex >= 0) {
    return topCount + layout.centerRowCount + bottomIndex;
  }

  let pinnedBefore = 0;
  for (const pinned of layout.topDisplayIndexes) {
    if (pinned < displayIndex) pinnedBefore++;
  }
  for (const pinned of layout.bottomDisplayIndexes) {
    if (pinned < displayIndex) pinnedBefore++;
  }
  return topCount + displayIndex - pinnedBefore;
}
