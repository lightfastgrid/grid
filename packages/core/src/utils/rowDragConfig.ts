import type { RowDragNormalizedConfig, RowDragProp } from "../types";

const DEFAULT_MAX_MULTI_ROW_DRAG_COUNT = 1000;
const DEFAULT_MAX_MULTI_ROW_DRAG_RATIO = 0.5;

function sanitizeCount(v: number | undefined): number {
  if (v === undefined) return DEFAULT_MAX_MULTI_ROW_DRAG_COUNT;
  if (!Number.isFinite(v) || v < 1) return DEFAULT_MAX_MULTI_ROW_DRAG_COUNT;
  return Math.floor(v);
}

function sanitizeRatio(v: number | undefined): number {
  if (v === undefined) return DEFAULT_MAX_MULTI_ROW_DRAG_RATIO;
  if (!Number.isFinite(v) || v <= 0 || v > 1) return DEFAULT_MAX_MULTI_ROW_DRAG_RATIO;
  return v;
}

const DISABLED: RowDragNormalizedConfig = {
  enabled: false,
  managed: false,
  maxMultiRowDragCount: DEFAULT_MAX_MULTI_ROW_DRAG_COUNT,
  maxMultiRowDragRatio: DEFAULT_MAX_MULTI_ROW_DRAG_RATIO,
};

const ENABLED: RowDragNormalizedConfig = {
  enabled: true,
  managed: true,
  maxMultiRowDragCount: DEFAULT_MAX_MULTI_ROW_DRAG_COUNT,
  maxMultiRowDragRatio: DEFAULT_MAX_MULTI_ROW_DRAG_RATIO,
};

/** Normalize public `rowDrag` prop to internal config. */
export function normalizeRowDrag(
  value: RowDragProp | undefined,
): RowDragNormalizedConfig {
  if (!value) return DISABLED;
  if (value === true) return ENABLED;
  return {
    enabled: value.enabled ?? true,
    managed: value.managed ?? true,
    maxMultiRowDragCount: sanitizeCount(value.maxMultiRowDragCount),
    maxMultiRowDragRatio: sanitizeRatio(value.maxMultiRowDragRatio),
  };
}

export function rowDragConfigsEqual(
  a: RowDragNormalizedConfig,
  b: RowDragNormalizedConfig,
): boolean {
  return a.enabled === b.enabled && a.managed === b.managed
    && a.maxMultiRowDragCount === b.maxMultiRowDragCount
    && a.maxMultiRowDragRatio === b.maxMultiRowDragRatio;
}
