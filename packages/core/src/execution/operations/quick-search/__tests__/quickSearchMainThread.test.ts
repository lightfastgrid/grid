import { describe, expect, it, vi } from 'vitest';

import { buildQuickSearchDependencyPlan } from '../../../../features/quick-search/quickSearchDependencyPlan';
import type { ColumnDef, QuickFilterOptions, RowData } from '../../../../types';
import { executeQuickSearchSync } from '../quickSearchMainThread';
import type { QuickSearchOperationInput } from '../types';

const rows = [{ name: 'Alice' }, { name: 'Bob' }];
const columns = [{ field: 'name' }];

function qsInput(partial: {
  rows: RowData[];
  columns: ColumnDef[];
  quickFilterText: string;
  quickFilter?: boolean | QuickFilterOptions;
  sourceIndexes?: Uint32Array;
  searchableFieldsSignature?: string;
  filterModel?: QuickSearchOperationInput['filterModel'];
  filteredOrderVersion?: number;
}): QuickSearchOperationInput {
  const plan = buildQuickSearchDependencyPlan(
    partial.columns,
    partial.quickFilter ?? true,
  );
  return {
    rows: partial.rows,
    columns: partial.columns,
    quickFilterText: partial.quickFilterText,
    quickFilter: partial.quickFilter,
    sourceIndexes: partial.sourceIndexes,
    filterModel: partial.filterModel ?? {},
    filteredOrderVersion: partial.filteredOrderVersion ?? 0,
    searchableFieldsSignature:
      partial.searchableFieldsSignature ?? plan.fieldsSignature,
    dependencyPlan: plan,
    sourceLayoutRevision: 0,
    searchableDataRevision: 0,
  };
}

describe('quickSearchMainThread query parsing', () => {
  it('passes pre-parsed query parts to fallback without re-running parser', () => {
    const parser = vi.fn((text: string) => text.split(' '));

    const input = qsInput({
      rows,
      columns,
      quickFilterText: 'alice',
      quickFilter: { parser },
      searchableFieldsSignature: 'sf|v|name',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    executeQuickSearchSync(input);

    expect(parser).toHaveBeenCalledTimes(1);
  });
});

describe('quickSearchMainThread projection field search', () => {
  it('formatted numeric value is searchable through projection field', () => {
    const input = qsInput({
      rows: [
        { amount: 1234567, amountText: '1234567 1,234,567' },
        { amount: 42, amountText: '42' },
        { amount: 9999, amountText: '9999 9,999' },
      ],
      columns: [
        { field: 'amount', quickFilterTextField: 'amountText' },
      ],
      quickFilterText: '234,567',
      searchableFieldsSignature: 'sf|v|amount:amountText',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([0]);
    }
  });

  it('raw numeric value is also searchable through projection field', () => {
    const input = qsInput({
      rows: [
        { amount: 1234567, amountText: '1234567 1,234,567' },
        { amount: 42, amountText: '42' },
      ],
      columns: [
        { field: 'amount', quickFilterTextField: 'amountText' },
      ],
      quickFilterText: '1234567',
      searchableFieldsSignature: 'sf|v|amount:amountText',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([0]);
    }
  });

  // quickFilterTextField is the worker-safe display-search projection.
  // valueFormatter/valueGetter/cellShell are display pipeline — they are
  // never invoked by the worker or the main-thread snapshot extraction.
  // Projection text should contain both raw and formatted terms when both
  // should be searchable (e.g. "true Yes", "80000 High").

  it('boolean formatted projection — "yes" matches true row', () => {
    const input = qsInput({
      rows: [
        { 'game.bought': true, boughtText: 'true Yes' },
        { 'game.bought': false, boughtText: 'false No' },
      ],
      columns: [
        { field: 'game.bought', quickFilterTextField: 'boughtText' },
      ],
      quickFilterText: 'yes',
      searchableFieldsSignature: 'sf|v|game.bought:boughtText',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([0]);
    }
  });

  it('boolean formatted projection — "no" matches false row', () => {
    const input = qsInput({
      rows: [
        { 'game.bought': true, boughtText: 'true Yes' },
        { 'game.bought': false, boughtText: 'false No' },
      ],
      columns: [
        { field: 'game.bought', quickFilterTextField: 'boughtText' },
      ],
      quickFilterText: 'no',
      searchableFieldsSignature: 'sf|v|game.bought:boughtText',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([1]);
    }
  });

  it('bucket/valueGetter-style projection — "high" matches projected rows', () => {
    const input = qsInput({
      rows: [
        { oct: 80000, octText: '80000 High' },
        { oct: 50000, octText: '50000 Medium' },
        { oct: 10000, octText: '10000 Low' },
        { oct: 90000, octText: '90000 High' },
      ],
      columns: [
        { field: 'oct', quickFilterTextField: 'octText' },
      ],
      quickFilterText: 'high',
      searchableFieldsSignature: 'sf|v|oct:octText',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([0, 3]);
    }
  });

  it('getQuickFilterText fallback still works for main-thread path', () => {
    const input = qsInput({
      rows: [
        { bought: true },
        { bought: false },
      ],
      columns: [
        {
          field: 'bought',
          getQuickFilterText: ({ value }: { value: unknown }) =>
            value === true ? 'Yes' : 'No',
        },
      ],
      quickFilterText: 'yes',
      searchableFieldsSignature: 'sf|v|bought:fn',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([0]);
    }
  });

  // ── Main-thread value-pipeline fallback (no projection) ─────────────
  // When no quickFilterTextField is configured, the main-thread fallback
  // runs valueGetter/valueFormatter so display values are searchable.

  it('valueGetter output is searchable through main-thread fallback', () => {
    const input = qsInput({
      rows: [
        { oct: 80000 },
        { oct: 50000 },
        { oct: 10000 },
      ],
      columns: [
        {
          field: 'oct',
          valueGetter: ({ row }: { row: Record<string, unknown> }) => {
            const v = Number(row.oct);
            return v < 33000 ? 'Low' : v < 66000 ? 'Medium' : 'High';
          },
        },
      ],
      quickFilterText: 'high',
      searchableFieldsSignature: 'sf|v|oct:fn',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([0]);
    }
  });

  it('valueFormatter output is searchable through main-thread fallback', () => {
    const input = qsInput({
      rows: [
        { amount: 1234567 },
        { amount: 42 },
      ],
      columns: [
        {
          field: 'amount',
          valueFormatter: ({ value }: { value: unknown }) =>
            value === null || value === undefined ? '' : `$${Number(value).toLocaleString()}`,
        },
      ],
      quickFilterText: '$1,234,567',
      searchableFieldsSignature: 'sf|v|amount:fn',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([0]);
    }
  });

  it('valueGetter + valueFormatter pipeline runs with correct rowIndex', () => {
    const valueGetter = vi.fn(({ row }: { row: Record<string, unknown> }) => row.bought);
    const valueFormatter = vi.fn(
      ({ value, rowIndex }: { value: unknown; rowIndex: number }) =>
        `${value === true ? 'Yes' : 'No'}@${rowIndex}`,
    );

    const input = qsInput({
      rows: [
        { bought: true },
        { bought: false },
        { bought: true },
      ],
      columns: [
        { field: 'bought', valueGetter, valueFormatter },
      ],
      quickFilterText: 'yes@2',
      searchableFieldsSignature: 'sf|v|bought:fn',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([2]);
    }

    expect(valueGetter).toHaveBeenCalledTimes(3);
    expect(valueFormatter).toHaveBeenCalledTimes(3);
    expect(valueFormatter).toHaveBeenCalledWith(
      expect.objectContaining({ value: true, rowIndex: 0 }),
    );
    expect(valueFormatter).toHaveBeenCalledWith(
      expect.objectContaining({ value: true, rowIndex: 2 }),
    );
  });

  it('value pipeline receives source rowIndex under filtered sourceIndexes', () => {
    const valueFormatter = vi.fn(
      ({ value, rowIndex }: { value: unknown; rowIndex: number }) =>
        `${value}@${rowIndex}`,
    );

    const input = qsInput({
      rows: [
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
        { name: 'Diana' },
      ],
      columns: [
        { field: 'name', valueFormatter },
      ],
      quickFilterText: 'charlie@2',
      sourceIndexes: Uint32Array.from([0, 2, 3]),
      searchableFieldsSignature: 'sf|v|name:fn',
      filterModel: {},
      filteredOrderVersion: 1,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([2]);
    }

    expect(valueFormatter).toHaveBeenCalledTimes(3);
    expect(valueFormatter).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'Alice', rowIndex: 0 }),
    );
    expect(valueFormatter).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'Charlie', rowIndex: 2 }),
    );
    expect(valueFormatter).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'Diana', rowIndex: 3 }),
    );
  });

  it('rating value is searchable through projection field', () => {
    const input = qsInput({
      rows: [
        { rating: 5, ratingText: '5' },
        { rating: 3, ratingText: '3' },
        { rating: 1, ratingText: '1' },
      ],
      columns: [
        { field: 'rating', quickFilterTextField: 'ratingText' },
      ],
      quickFilterText: '3',
      searchableFieldsSignature: 'sf|v|rating:ratingText',
      filterModel: {},
      filteredOrderVersion: 0,
    });

    const result = executeQuickSearchSync(input);
    expect(result.kind).toBe('indexes');
    if (result.kind === 'indexes') {
      expect(Array.from(result.indexes)).toEqual([1]);
    }
  });
});
