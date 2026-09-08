import type {
  LogicalColumnLayoutInput,
  LogicalColumnLayoutReadSnapshot,
} from "../../internal/columnLayoutReadSnapshot";
import type {
  ImmutableIdMembership,
  RowSelectionReadSnapshot,
} from "../../internal/readSnapshots";
import type {
  ColumnSelectionChangeSource,
  FocusChangeSource,
  FocusedCell,
  FocusMoveDirection,
  SelectionChange,
  SelectionChangeSource,
} from "../../types";
import type { DisplayRowReader } from "../rowViewAccess";

import type { GridRenderSnapshot } from "./renderSnapshot";

/** Context for content-based column autosize without DOM cell measurement. */
export interface AutoSizeContext {
  visibleRowStart: number;
  poolRowCount: number;
  /** Display-row reader for sampling visible rows in display order. */
  displayRows: DisplayRowReader;
}

/** DOM rendering contract for {@link Grid#render}. */
export interface GridRenderer {
  mount(container: HTMLElement): void;
  render(snapshot: GridRenderSnapshot): void;
  destroy(): void;
  /** Current viewport width in pixels. Returns 0 before mount. */
  getViewportWidth(): number;
  /** Current visible row window for content-based autosize. */
  getAutoSizeContext(): AutoSizeContext;
}

/** Implemented by renderers that support column selection by field id. */
export interface ColumnSelectionRendererCapability {
  getSelectedColumnIds(): string[];
  captureColumnSelectionSnapshot(): ImmutableIdMembership<string>;
  setSelectedColumnIds(
    ids: string[],
    opts?: { silent?: boolean; source?: ColumnSelectionChangeSource },
  ): boolean;
  clearColumnSelection(): boolean;
}

/** Implemented by renderers that support focused-cell APIs. */
export interface FocusRendererCapability {
  getFocusedCell(): FocusedCell | null;
  setFocusedCell(
    target: { rowId?: string; rowIndex?: number; field: string },
    source?: FocusChangeSource,
  ): void;
  clearFocusedCell(source?: FocusChangeSource): void;
  moveFocusedCell(
    direction: FocusMoveDirection,
    source?: FocusChangeSource,
  ): boolean;
}

/** Implemented by renderers that support cell editing. */
export interface EditingRendererCapability {
  getEditingCell(): { rowId: string; field: string } | null;
  startEdit(target: { rowId?: string; rowIndex?: number; field: string; charSeed?: string }): boolean;
  stopEdit(opts: { commit: boolean }): boolean;
}

/** Implemented by renderers that support ID-based row selection. */
export interface SelectionRendererCapability {
  getSelectedRowIds(): string[];
  captureRowSelectionSnapshot(universeRowCount: number): RowSelectionReadSnapshot;
  clearSelection(): SelectionChange | null;
  setSelectedRowIds(
    ids: string[],
    opts?: { silent?: boolean; source?: SelectionChangeSource },
  ): SelectionChange | null;
  isRowSelected(rowId: string): boolean;
  refreshHeaderSelectionState(): void;
}

/** Feature-neutral task-start capture of logical column order and internals. */
export interface ColumnLayoutRendererCapability {
  captureLogicalColumnLayoutSnapshot(
    input: LogicalColumnLayoutInput,
  ): LogicalColumnLayoutReadSnapshot;
}
