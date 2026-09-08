import type {
  ColumnSelectionConfig,
  ColumnSelectionProp,
} from "../types";

/** Normalize public `columnSelection` prop to internal config. */
export function normalizeColumnSelection(
  value: ColumnSelectionProp,
): ColumnSelectionConfig {
  if (value === undefined || value === false) {
    return {
      enabled: false,
      mode: "single",
      enableHeaderClickSelection: true,
      clearOnOutsideClick: false,
    };
  }
  if (value === true) {
    return {
      enabled: true,
      mode: "single",
      enableHeaderClickSelection: true,
      clearOnOutsideClick: false,
    };
  }
  return {
    enabled: true,
    mode: value.mode ?? "single",
    enableHeaderClickSelection: value.enableHeaderClickSelection ?? true,
    clearOnOutsideClick: value.clearOnOutsideClick ?? false,
  };
}

export function columnSelectionConfigsEqual(
  a: ColumnSelectionConfig,
  b: ColumnSelectionConfig,
): boolean {
  return (
    a.enabled === b.enabled &&
    a.mode === b.mode &&
    a.enableHeaderClickSelection === b.enableHeaderClickSelection &&
    a.clearOnOutsideClick === b.clearOnOutsideClick
  );
}
