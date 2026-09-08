/**
 * Feature-neutral DOM metadata shared by the column-group owner and structural
 * consumers. These attributes describe existing group topology; they do not
 * carry accessibility state.
 */
export const COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE =
  "data-lfg-group-level";
export const COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE =
  "data-lfg-group-header";
export const COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE =
  "data-lfg-group-start-field";
export const COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE =
  "data-lfg-group-end-field";
export const COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE =
  "data-lfg-group-leaf-count";

export const COLUMN_GROUP_HEADER_ROW_SELECTOR =
  `[${COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE}]`;
export const COLUMN_GROUP_HEADER_SPAN_SELECTOR =
  `[${COLUMN_GROUP_HEADER_SPAN_ATTRIBUTE}]`;
