export type DemoColumnPin = "left" | "right" | false;

export type DemoColumnListItem = {
  field: string;
  label: string;
  visible: boolean;
  pinned: DemoColumnPin;
  pinnable: boolean;
};

export type DemoColumnListSnapshot = {
  columns: DemoColumnListItem[];
  hiddenCount: number;
  totalCount: number;
  selectedColumnIds: string[];
};

/** Prefer a readable label when only the field id is available. */
export function labelFromColumnField(field: string): string {
  if (!field) return field;
  const spaced = field
    .replace(/__/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) return field;
  return spaced.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Pure: build the Columns panel list from public handle snapshots.
 * `columns` supplies labels + pinnable; visibility/pin state supply live values.
 */
export function buildDemoColumnList(input: {
  columns: readonly {
    field: string;
    headerName?: string;
    visible?: boolean;
    pinned?: "left" | "right" | false;
    pinnable?: boolean;
    internal?: string;
  }[];
  visibilityState: readonly { field: string; visible: boolean }[];
  pinState: readonly { field: string; pinned: "left" | "right" | false }[];
  selectedColumnIds: readonly string[];
}): DemoColumnListSnapshot {
  const visibilityByField = new Map(
    input.visibilityState.map((entry) => [entry.field, entry.visible]),
  );
  const pinByField = new Map(
    input.pinState.map((entry) => [entry.field, entry.pinned]),
  );

  const columns: DemoColumnListItem[] = [];
  for (const column of input.columns) {
    if (column.internal) continue;
    const visible =
      visibilityByField.get(column.field) ?? column.visible !== false;
    const pinned = pinByField.get(column.field) ?? column.pinned ?? false;
    columns.push({
      field: column.field,
      label: column.headerName?.trim() || labelFromColumnField(column.field),
      visible,
      pinned,
      pinnable: column.pinnable !== false,
    });
  }

  const hiddenCount = columns.reduce(
    (count, column) => (column.visible ? count : count + 1),
    0,
  );

  return {
    columns,
    hiddenCount,
    totalCount: columns.length,
    selectedColumnIds: [...input.selectedColumnIds],
  };
}

/** Pure: local search filter for the Columns panel list. */
export function filterDemoColumns(
  columns: readonly DemoColumnListItem[],
  query: string,
): DemoColumnListItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...columns];
  return columns.filter(
    (column) =>
      column.label.toLowerCase().includes(normalized) ||
      column.field.toLowerCase().includes(normalized),
  );
}
