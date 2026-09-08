/**
 * Type-level proof that the React grid handle exposes the row-data
 * transaction API surface with the correct shapes. Runtime semantics
 * are covered by the core-package tests
 * (`rowDataTransactions.test.ts`); the React handle just forwards each
 * call to the underlying `Grid` instance.
 */
import type {
  LightFastGridHandle,
  RowData,
  RowDataTransaction,
  RowDataTransactionResult,
} from '@lightfastgrid/core';
import { createRef } from 'react';

const gridRef = createRef<LightFastGridHandle>();

const rows: RowData[] = gridRef.current?.getRows() ?? [];
void rows;

// Synchronous transaction.
const transaction: RowDataTransaction = {
  add: [{ id: 'r1' }],
  update: [{ id: 'r2', name: 'updated' }],
  remove: [{ id: 'r3' }],
  removeIds: ['r4'],
  addIndex: 0,
};
const anchoredBefore: RowDataTransaction = {
  add: [{ id: 'r10' }],
  addBeforeId: 'r2',
};
const anchoredAfter: RowDataTransaction = {
  add: [{ id: 'r11' }],
  addAfterId: 'r3',
};
void anchoredBefore;
void anchoredAfter;
const result: RowDataTransactionResult | undefined =
  gridRef.current?.applyTransaction(transaction);
void result?.added;
void result?.skipped[0]?.reason;

// Async queue + manual flush.
gridRef.current?.applyTransactionAsync({ add: [{ id: 'r5' }] });
gridRef.current?.applyTransactionAsync(
  { removeIds: ['r5'] },
  (r: RowDataTransactionResult) => void r.removeCount,
);
const flushed: RowDataTransactionResult[] =
  gridRef.current?.flushAsyncTransactions() ?? [];
void flushed;

// Immutable replacement.
const immutable: RowDataTransactionResult | undefined =
  gridRef.current?.setRowsImmutable([{ id: 'r1' }]);
void immutable;

// ── Props surface ─────────────────────────────────────────────────────
//
// There is no React runtime test harness in this repo, so behavioral
// coverage for the prop wiring lives in two places:
//  - `useGridInstance` routes `rows` prop changes through
//    `grid.setRowsImmutable` when `immutableRows` is true, and syncs
//    `asyncTransactionWaitMillis` via `grid.setAsyncTransactionWaitMillis`
//    — a single code path with no adapter-side logic.
//  - The core integration tests
//    (`packages/core/src/__tests__/rowDataTransactions.test.ts`) cover
//    `setRowsImmutable` diff semantics, the no-getRowId fallback, and
//    wait-millis updates affecting future flushes.
// This file type-proves the prop contract.
import type { ReactLightFastGridProps } from '../types';

const props: ReactLightFastGridProps = {
  rows: [{ id: 'r1' }],
  columns: [{ field: 'id' }],
  getRowId: (row) => row.id,
  immutableRows: true,
  asyncTransactionWaitMillis: 100,
  onRowDataUpdated: (e) => {
    void e.source; // "transaction" | "asyncTransaction" | "immutableRows"
    void e.addCount;
    void e.rowCount;
  },
  onAsyncTransactionsFlushed: (e) => {
    void e.results[0]?.skippedCount;
  },
};
void props;

void gridRef;
