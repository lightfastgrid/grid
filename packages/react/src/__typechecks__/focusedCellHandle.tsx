/**
 * Type-level proof that the React grid handle exposes the focused-cell
 * API surface with the correct shapes. Runtime semantics are covered by
 * the core-package tests (`focusedCell.test.ts`); the React handle just
 * forwards each call to the underlying `Grid` instance.
 */
import type {
  FocusedCell,
  FocusMoveDirection,
  LightFastGridHandle,
} from '@lightfastgrid/core';
import { createRef } from 'react';

import type { ReactLightFastGridProps } from '../types';

const gridRef = createRef<LightFastGridHandle>();

// Read.
const cell: FocusedCell | null = gridRef.current?.getFocusedCell() ?? null;
void cell?.rowId;
void cell?.field;
void cell?.rowIndex;
void cell?.sourceIndex;

// Focus by rowId or display rowIndex.
gridRef.current?.setFocusedCell({ rowId: 'r1', field: 'name' });
gridRef.current?.setFocusedCell({ rowIndex: 0, field: 'name' }, 'api');

// Clear.
gridRef.current?.clearFocusedCell();
gridRef.current?.clearFocusedCell('keyboard');

// Move in every public direction.
const directions: FocusMoveDirection[] = [
  'up', 'down', 'left', 'right', 'home', 'end', 'pageUp', 'pageDown',
];
for (const direction of directions) {
  gridRef.current?.moveFocusedCell(direction);
}

// Event prop contract.
const props: ReactLightFastGridProps = {
  rows: [{ id: 'r1' }],
  columns: [{ field: 'id' }],
  getRowId: (row) => row.id,
  onFocusedCellChanged: (e) => {
    void e.focusedCell?.rowId;
    void e.previousCell?.field;
    void e.source; // "click" | "keyboard" | "api"
  },
};
void props;

void gridRef;
