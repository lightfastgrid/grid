/**
 * Create / attach / detach group-header row elements.
 *
 * Owns only `.lfg-group-header-row` and `.lfg-group-header-span`.
 * Inserts rows before each lane's leaf row; never touches lane containers
 * or floating-filter DOM.
 */

import {
  COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
  COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE,
} from '../../internal/columnGroupHeaderDomMetadata';
import type { HeaderLaneRef } from '../types';

import {
  GROUP_HEADER_ROW_CLASS,
  GROUP_HEADER_SPAN_CLASS,
  type GroupHeaderLanePool,
  type GroupHeaderLevelPool,
} from './columnGroupHeaderTypes';

export function createGroupHeaderSpanElement(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = GROUP_HEADER_SPAN_CLASS;
  el.setAttribute(COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE, '');
  el.style.display = 'none';
  return el;
}

export function createGroupHeaderRowElement(level: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = GROUP_HEADER_ROW_CLASS;
  row.dataset.level = String(level);
  row.setAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE, String(level));
  return row;
}

/**
 * Ensure `lanePool.levels` has exactly `depth` rows, attached before `leafRow`
 * in top-to-bottom level order (0 … depth-1, then leaf).
 * Excess rows are removed from the DOM and dropped from the pool.
 */
export function ensureGroupHeaderLaneRows(
  lanePool: GroupHeaderLanePool,
  lane: HeaderLaneRef,
  depth: number,
): void {
  const { leafRow } = lane;
  const parent = leafRow.parentElement;
  if (!parent) return;

  while (lanePool.levels.length > depth) {
    const removed = lanePool.levels.pop();
    removed?.rowEl.remove();
  }

  for (let level = 0; level < depth; level++) {
    let entry = lanePool.levels[level];
    if (!entry) {
      const rowEl = createGroupHeaderRowElement(level);
      entry = { level, rowEl, spanPool: [] };
      lanePool.levels[level] = entry;
    } else if (entry.level !== level) {
      entry.level = level;
      entry.rowEl.dataset.level = String(level);
      entry.rowEl.setAttribute(
        COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
        String(level),
      );
    }
  }

  // Place each row immediately before the next level row (or the leaf).
  // When the next row is not yet in `parent`, fall back to `leafRow`.
  for (let level = 0; level < depth; level++) {
    const rowEl = lanePool.levels[level]!.rowEl;
    const nextLevelRow =
      level + 1 < depth ? lanePool.levels[level + 1]!.rowEl : null;
    const before =
      nextLevelRow && nextLevelRow.parentNode === parent
        ? nextLevelRow
        : leafRow;
    if (rowEl.nextSibling !== before || rowEl.parentNode !== parent) {
      parent.insertBefore(rowEl, before);
    }
  }
}

/** Remove all feature-owned group rows for a lane and clear the pool. */
export function detachGroupHeaderLanePool(lanePool: GroupHeaderLanePool): void {
  for (const entry of lanePool.levels) {
    entry.rowEl.remove();
  }
  lanePool.levels.length = 0;
}

export function emptyGroupHeaderLanePool(): GroupHeaderLanePool {
  return { levels: [] };
}

/** Ensure span pool has at least `needed` elements; append new ones to the row. */
export function ensureGroupHeaderSpanPool(
  levelPool: GroupHeaderLevelPool,
  needed: number,
): void {
  while (levelPool.spanPool.length < needed) {
    const span = createGroupHeaderSpanElement();
    levelPool.spanPool.push(span);
    levelPool.rowEl.appendChild(span);
  }
}
