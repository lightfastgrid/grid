/**
 * Type-level proof that `LightFastGridHandle` exposes the row-pinning API
 * surface with the correct shapes. Runtime semantics are covered by the
 * core-package tests (`rowPinningApi.test.ts`); the React handle just
 * forwards each call to the underlying `Grid` instance.
 */
import type {
  LightFastGridHandle,
  RowPinChangeSource,
  RowPinStateEntry,
} from '@lightfastgrid/core';
import { createRef } from 'react';

const gridRef = createRef<LightFastGridHandle>();

// Pin / unpin individual rows.
gridRef.current?.pinRow('r1', 'top');
gridRef.current?.pinRow('r1', 'bottom', 'api' as RowPinChangeSource);

// Bulk variants.
gridRef.current?.pinRows(['r1', 'r2'], 'top');
gridRef.current?.unpinRows(['r1', 'r2']);

// Bulk replace.
const entries: RowPinStateEntry[] = [
  { rowId: 'r1', pinned: 'top' },
  { rowId: 'r2', pinned: false },
];
gridRef.current?.setRowPinState(entries);
gridRef.current?.setRowPinState(entries, 'ui');

// Read & clear.
const state: RowPinStateEntry[] = gridRef.current?.getRowPinState() ?? [];
void state;
gridRef.current?.clearRowPinning();
gridRef.current?.clearRowPinning('ui');

void gridRef;
