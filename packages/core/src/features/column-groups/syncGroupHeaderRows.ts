/**
 * Sync planned group-header spans onto pooled DOM for one lane.
 *
 * Updates text, left/width, and visibility. Hides unused pooled spans.
 * Applies `containerOffsetX` at DOM bind so planner geometry stays lane-local.
 * No querySelector / layout reads.
 */

import {
  COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
  COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
  COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
} from '../../internal/columnGroupHeaderDomMetadata';
import type { ColumnDef } from '../../types';

import { ensureGroupHeaderSpanPool } from './columnGroupHeaderDom';
import type { ColumnGroupHeaderSpanPlan } from './columnGroupHeaderTypes';
import {
  GROUP_HEADER_GAP_SPAN_CLASS,
  type GroupHeaderLanePool,
} from './columnGroupHeaderTypes';

function setGroupMetadata(
  element: HTMLElement,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    if (element.hasAttribute(name)) {
      element.removeAttribute(name);
    }
    return;
  }
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function hideUnusedGroupSpanElements(
  spanPool: readonly HTMLDivElement[],
  usedCount: number,
): void {
  for (let i = usedCount; i < spanPool.length; i++) {
    const el = spanPool[i];
    if (!el) continue;
    el.style.display = 'none';
    el.textContent = '';
    el.removeAttribute('data-group-id');
    el.classList.remove(GROUP_HEADER_GAP_SPAN_CLASS);
    el.removeAttribute('aria-hidden');
    setGroupMetadata(el, COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE, undefined);
    setGroupMetadata(el, COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE, undefined);
    setGroupMetadata(el, COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE, undefined);
  }
}

/**
 * Apply a span plan to an already-sized lane pool (rows must match `plan.depth`).
 *
 * @param containerOffsetX - maps lane-local `span.left` into the group row's
 *   DOM container coordinate space (0 for pinned stacks; left-pinned width for center).
 */
export function syncGroupHeaderRows(
  lanePool: GroupHeaderLanePool,
  plan: ColumnGroupHeaderSpanPlan,
  columns: readonly ColumnDef[],
  containerOffsetX = 0,
): void {
  const depth = plan.depth;
  for (let level = 0; level < depth; level++) {
    const levelPool = lanePool.levels[level];
    const levelPlan = plan.levels[level];
    if (!levelPool || !levelPlan) continue;

    const spans = levelPlan.spans;
    ensureGroupHeaderSpanPool(levelPool, spans.length);

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      const el = levelPool.spanPool[i]!;
      el.style.display = '';
      el.style.left = `${span.left + containerOffsetX}px`;
      el.style.width = `${span.width}px`;
      el.textContent = span.headerName;
      el.dataset.groupId = span.key;
      const isGap = span.key.startsWith('gap:');
      el.classList.toggle(GROUP_HEADER_GAP_SPAN_CLASS, isGap);
      if (isGap) {
        el.setAttribute('aria-hidden', 'true');
      } else {
        el.removeAttribute('aria-hidden');
      }
      const startField = columns[span.startLeafIndex]?.field;
      const endField = columns[span.endLeafIndex]?.field;
      if (startField === undefined || endField === undefined) {
        setGroupMetadata(
          el,
          COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
          undefined,
        );
        setGroupMetadata(
          el,
          COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
          undefined,
        );
        setGroupMetadata(
          el,
          COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
          undefined,
        );
      } else {
        setGroupMetadata(
          el,
          COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
          startField,
        );
        setGroupMetadata(
          el,
          COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
          endField,
        );
        setGroupMetadata(
          el,
          COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
          String(span.endLeafIndex - span.startLeafIndex + 1),
        );
      }
    }

    hideUnusedGroupSpanElements(levelPool.spanPool, spans.length);
  }
}
