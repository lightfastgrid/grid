import type { ColumnOrderConfig, ColumnOrderProp } from "../types";

/** Normalize public `columnOrder` prop to internal config. */
export function normalizeColumnOrder(
  value: ColumnOrderProp | undefined,
): ColumnOrderConfig {
  if (value === undefined || value === false) {
    return { enabled: false };
  }
  if (value === true) {
    return { enabled: true };
  }
  return {
    enabled: value.enabled ?? true,
  };
}

export function columnOrderConfigsEqual(
  a: ColumnOrderConfig,
  b: ColumnOrderConfig,
): boolean {
  return a.enabled === b.enabled;
}
