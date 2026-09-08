export {
  createGroupHeaderRowElement,
  createGroupHeaderSpanElement,
  detachGroupHeaderLanePool,
  emptyGroupHeaderLanePool,
  ensureGroupHeaderLaneRows,
  ensureGroupHeaderSpanPool,
} from './columnGroupHeaderDom';
export {
  type ColumnGroupHeaderFeature,
  columnGroupHeaderFeature,
  computeGroupHeaderAddonHeight,
} from './columnGroupHeaderFeature';
export { isColumnGroupHeadersEnabled } from './columnGroupHeadersConfig';
export {
  type ColumnGroupHeaderCenterWindow,
  type ColumnGroupHeaderLaneInput,
  type ColumnGroupHeaderLevelPlan,
  type ColumnGroupHeaderSpanPlan,
  GROUP_HEADER_ROW_CLASS,
  GROUP_HEADER_SPAN_CLASS,
  type GroupHeaderLanePool,
  type GroupHeaderLevelPool,
  type PlannedColumnGroupSpan,
} from './columnGroupHeaderTypes';
export { deriveColumnGroupHeaderSnapshot } from './deriveColumnGroupHeaderSnapshot';
export { deriveSegmentId } from './deriveGroupPathIds';
export { flattenColumnInput } from './flattenColumnInput';
export {
  expectedPrefixEdgeCount,
  planColumnGroupHeaderSpans,
} from './planColumnGroupHeaderSpans';
export { syncGroupHeaderRows } from './syncGroupHeaderRows';
