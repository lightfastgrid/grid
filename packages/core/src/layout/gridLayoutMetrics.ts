import type { GridThemeDensity } from "../themes/types";

export interface GridLayoutMetrics {
  readonly rowHeight: number;
  readonly headerHeight: number;
}

export const DEFAULT_GRID_LAYOUT_METRICS: GridLayoutMetrics = {
  rowHeight: 40,
  headerHeight: 40,
};

const COMPACT_METRICS: GridLayoutMetrics = {
  rowHeight: 32,
  headerHeight: 36,
};
const COMFORTABLE_METRICS: GridLayoutMetrics = {
  rowHeight: 48,
  headerHeight: 44,
};

const DENSITY_MAP: Record<GridThemeDensity, GridLayoutMetrics> = {
  compact: COMPACT_METRICS,
  standard: DEFAULT_GRID_LAYOUT_METRICS,
  comfortable: COMFORTABLE_METRICS,
};

export function resolveDensityMetrics(
  density: GridThemeDensity | undefined,
): GridLayoutMetrics {
  if (density === undefined) return DEFAULT_GRID_LAYOUT_METRICS;
  return DENSITY_MAP[density];
}

export interface GridCellPadding {
  readonly x: string;
  readonly y: string;
}

const STANDARD_CELL_PADDING: GridCellPadding = { x: "12px", y: "8px" };

const DENSITY_CELL_PADDING_MAP: Record<GridThemeDensity, GridCellPadding> = {
  compact: { x: "10px", y: "6px" },
  standard: STANDARD_CELL_PADDING,
  comfortable: { x: "14px", y: "10px" },
};

export function resolveDensityCellPadding(
  density: GridThemeDensity | undefined,
): GridCellPadding {
  if (density === undefined) return STANDARD_CELL_PADDING;
  return DENSITY_CELL_PADDING_MAP[density];
}
