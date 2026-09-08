import { clampColumnWidth } from "../../internal/columnSizing";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import {
  DEFAULT_GRID_FONT_FAMILY,
  DEFAULT_GRID_FONT_SIZE,
} from "../../themes/gridTypography";
import type { ColumnDef, RowData } from "../../types";
import { resolveFieldValue } from "../../utils/resolveDotPath";

const HEADER_FONT = `600 ${DEFAULT_GRID_FONT_SIZE} ${DEFAULT_GRID_FONT_FAMILY}`;
const CELL_FONT = `400 ${DEFAULT_GRID_FONT_SIZE} ${DEFAULT_GRID_FONT_FAMILY}`;

let canvas: HTMLCanvasElement | null = null;

function measureWithFont(text: string, font: string): number {
  if (typeof document === "undefined") {
    return text.length * 8;
  }
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * 8;
  ctx.font = font;
  return Math.ceil(ctx.measureText(text).width);
}

/**
 * Row source for autosize measurement — either a DisplayRowReader (preferred)
 * or a plain RowData array (backward compat for tests / pre-RowView paths).
 */
interface RowSource {
  readonly rowCount: number;
  getRowData(index: number): RowData | undefined;
}

function toRowSource(source: DisplayRowReader | RowData[]): RowSource {
  if (Array.isArray(source)) {
    return {
      get rowCount() { return source.length; },
      getRowData(index: number) { return source[index]; },
    };
  }
  return source;
}

/**
 * Auto-fit width from header label + visible body rows for `field`
 * (widest visible cell). Adds horizontal padding for cell chrome.
 *
 * Accepts either a `DisplayRowReader` (display-order aware) or a plain
 * `RowData[]` for backward compatibility. Samples only visible rows in
 * the `[visibleRowStart, visibleRowStart + poolRowCount)` range.
 */
export function measureColumnAutoFitWidth(
  col: ColumnDef,
  field: string,
  visibleRowStart: number,
  poolRowCount: number,
  rows: DisplayRowReader | RowData[],
): number {
  const source = toRowSource(rows);
  const label = col.headerName ?? col.field;
  let maxPx = Math.max(
    measureWithFont(label, HEADER_FONT),
    measureWithFont(String(field), HEADER_FONT),
  );

  const end = Math.min(source.rowCount, visibleRowStart + poolRowCount);
  for (let r = visibleRowStart; r < end; r++) {
    const row = source.getRowData(r);
    if (!row) continue;
    const v = resolveFieldValue(row, field);
    const s = v === null || v === undefined ? "" : String(v);
    maxPx = Math.max(maxPx, measureWithFont(s, CELL_FONT));
  }

  const padded = maxPx + 28;
  return clampColumnWidth(col, padded);
}
