import { describe, expect, it, vi } from 'vitest';

import type { ColumnDef } from '../../../types';
import { isQuickFilterEnabled } from '../quickFilterConfig';
import {
  resolveSearchableFields,
  resolveSearchableFieldsFromConfig,
} from '../searchableFieldResolver';

function col(partial: Partial<ColumnDef> & { field: string }): ColumnDef {
  return { ...partial };
}

describe('resolveSearchableFields', () => {
  // ── 1. searchable: false exclusion ───────────────────────────────────

  it('excludes searchable: false columns', () => {
    const resolution = resolveSearchableFields([
      col({ field: 'name' }),
      col({ field: 'actions', searchable: false }),
      col({ field: 'city' }),
    ]);
    expect(resolution.descriptors.map((d) => d.field)).toEqual(['name', 'city']);
  });

  it('excludes internal selection columns', () => {
    const resolution = resolveSearchableFields([
      col({ field: '__selection__', internal: 'selection' }),
      col({ field: 'name' }),
    ]);
    expect(resolution.descriptors.map((d) => d.field)).toEqual(['name']);
  });

  it('excludes internal row-drag columns', () => {
    const resolution = resolveSearchableFields([
      col({ field: '__lfg_row_drag__', internal: 'row-drag' }),
      col({ field: 'name' }),
    ]);
    expect(resolution.descriptors.map((d) => d.field)).toEqual(['name']);
  });

  it('excludes internal combined row-controls columns', () => {
    const resolution = resolveSearchableFields([
      col({ field: '__lfg_row_controls__', internal: 'row-controls' }),
      col({ field: 'name' }),
    ]);
    expect(resolution.descriptors.map((d) => d.field)).toEqual(['name']);
  });

  // ── 2. hidden column include/exclude ─────────────────────────────────

  it('excludes hidden columns by default', () => {
    const resolution = resolveSearchableFields([
      col({ field: 'name' }),
      col({ field: 'secret', visible: false }),
    ]);
    expect(resolution.descriptors.map((d) => d.field)).toEqual(['name']);
  });

  it('includes hidden columns when includeHiddenColumns is true', () => {
    const resolution = resolveSearchableFields(
      [col({ field: 'name' }), col({ field: 'secret', visible: false })],
      { includeHiddenColumns: true },
    );
    expect(resolution.descriptors.map((d) => d.field)).toEqual(['name', 'secret']);
  });

  it('resolveSearchableFieldsFromConfig reads includeHiddenColumns from quickFilter options', () => {
    const columns = [
      col({ field: 'name' }),
      col({ field: 'secret', visible: false }),
    ];
    const withHidden = resolveSearchableFieldsFromConfig(columns, {
      includeHiddenColumns: true,
    });
    const withoutHidden = resolveSearchableFieldsFromConfig(columns, true);
    expect(withHidden.descriptors).toHaveLength(2);
    expect(withoutHidden.descriptors).toHaveLength(1);
  });

  // ── 3. quickFilterTextField projection precedence ────────────────────

  it('quickFilterTextField provides the worker-safe projection field', () => {
    const resolution = resolveSearchableFields([
      col({
        field: 'bankBalance',
        quickFilterTextField: 'bankBalanceSearch',
        valueFormatter: () => 'formatted',
      }),
    ]);
    const d = resolution.descriptors[0]!;
    expect(d.projectionField).toBe('bankBalanceSearch');
    expect(d.workerEligible).toBe(true);
    expect(resolution.allWorkerEligible).toBe(true);
    expect(resolution.fields[0]).toEqual({
      field: 'bankBalance',
      projectionField: 'bankBalanceSearch',
    });
  });

  // ── 4. getQuickFilterText marks worker-ineligible, never runs ────────

  it('getQuickFilterText marks the column worker-ineligible without running it', () => {
    const extractor = vi.fn(() => 'custom');
    const resolution = resolveSearchableFields([
      col({ field: 'name', getQuickFilterText: extractor }),
      col({ field: 'city' }),
    ]);
    expect(resolution.descriptors[0]!.workerEligible).toBe(false);
    expect(resolution.descriptors[1]!.workerEligible).toBe(true);
    expect(resolution.allWorkerEligible).toBe(false);
    expect(extractor).not.toHaveBeenCalled();
  });

  it('quickFilterTextField keeps the column worker-eligible even with getQuickFilterText', () => {
    const extractor = vi.fn(() => 'custom');
    const resolution = resolveSearchableFields([
      col({
        field: 'balance',
        getQuickFilterText: extractor,
        quickFilterTextField: 'balanceSearch',
      }),
    ]);
    const d = resolution.descriptors[0]!;
    expect(d.projectionField).toBe('balanceSearch');
    expect(d.workerEligible).toBe(true);
    expect(resolution.allWorkerEligible).toBe(true);
    expect(extractor).not.toHaveBeenCalled();
  });

  // ── Signature stability ──────────────────────────────────────────────

  it('signature is stable for identical inputs', () => {
    const columns = [
      col({ field: 'name' }),
      col({ field: 'balance', quickFilterTextField: 'balanceSearch' }),
    ];
    const a = resolveSearchableFields(columns);
    const b = resolveSearchableFields(columns);
    expect(a.signature).toBe(b.signature);
  });

  it('signature changes with field set, projection, and hidden-include', () => {
    const base = resolveSearchableFields([col({ field: 'name' })]);
    const moreFields = resolveSearchableFields([
      col({ field: 'name' }),
      col({ field: 'city' }),
    ]);
    const projected = resolveSearchableFields([
      col({ field: 'name', quickFilterTextField: 'nameSearch' }),
    ]);
    const hiddenIncluded = resolveSearchableFields([col({ field: 'name' })], {
      includeHiddenColumns: true,
    });
    expect(moreFields.signature).not.toBe(base.signature);
    expect(projected.signature).not.toBe(base.signature);
    expect(hiddenIncluded.signature).not.toBe(base.signature);
  });

  // valueFormatter/valueGetter are display pipeline, not worker query
  // pipeline. quickFilterTextField is the worker-safe display-search
  // projection. Columns with these display functions + projection remain
  // worker-eligible; the worker reads the projection field only.

  it('valueGetter column with quickFilterTextField is worker-eligible', () => {
    const resolution = resolveSearchableFields([
      col({
        field: 'oct',
        quickFilterTextField: 'octText',
        valueGetter: () => 'High',
      }),
    ]);
    expect(resolution.descriptors[0]!.workerEligible).toBe(true);
    expect(resolution.descriptors[0]!.projectionField).toBe('octText');
    expect(resolution.allWorkerEligible).toBe(true);
  });

  it('valueFormatter column with quickFilterTextField is worker-eligible', () => {
    const resolution = resolveSearchableFields([
      col({
        field: 'game.bought',
        quickFilterTextField: 'boughtText',
        valueFormatter: () => 'Yes',
      }),
    ]);
    expect(resolution.descriptors[0]!.workerEligible).toBe(true);
    expect(resolution.descriptors[0]!.projectionField).toBe('boughtText');
  });

  it('valueFormatter column with quickFilterTextField pointing to the same field is worker-eligible', () => {
    const resolution = resolveSearchableFields([
      col({
        field: 'name',
        quickFilterTextField: 'name',
        valueFormatter: ({ value }) =>
          value === null || value === undefined || value === '' ? '' : `${value}`,
      }),
      col({
        field: 'game.name',
        quickFilterTextField: 'game.name',
        valueFormatter: ({ value }) =>
          value === null || value === undefined ? '' : `${value}`,
      }),
    ]);
    expect(resolution.allWorkerEligible).toBe(true);
    expect(resolution.descriptors.every((d) => d.workerEligible)).toBe(true);
    expect(resolution.descriptors[0]!.projectionField).toBe('name');
    expect(resolution.descriptors[1]!.projectionField).toBe('game.name');
  });

  it('valueGetter column without projection is worker-ineligible', () => {
    const resolution = resolveSearchableFields([
      col({ field: 'oct', valueGetter: () => 'High' }),
    ]);
    expect(resolution.descriptors[0]!.workerEligible).toBe(false);
    expect(resolution.descriptors[0]!.projectionField).toBeUndefined();
    expect(resolution.allWorkerEligible).toBe(false);
  });

  it('valueFormatter column without projection is worker-ineligible', () => {
    const resolution = resolveSearchableFields([
      col({ field: 'amount', valueFormatter: () => '$100' }),
    ]);
    expect(resolution.descriptors[0]!.workerEligible).toBe(false);
    expect(resolution.allWorkerEligible).toBe(false);
  });

  it('allWorkerEligible is false for an empty descriptor list', () => {
    const resolution = resolveSearchableFields([
      col({ field: 'a', searchable: false }),
    ]);
    expect(resolution.descriptors).toHaveLength(0);
    expect(resolution.allWorkerEligible).toBe(false);
  });

  // ── Disabled quick filter ─────────────────────────────────────────

  it('resolveSearchableFieldsFromConfig returns empty for quickFilter: false', () => {
    const resolution = resolveSearchableFieldsFromConfig(
      [col({ field: 'name' }), col({ field: 'city' })],
      false,
    );
    expect(resolution.descriptors).toHaveLength(0);
    expect(resolution.signature).toBe('sf|disabled');
    expect(isQuickFilterEnabled(false)).toBe(false);
  });

  it('resolveSearchableFieldsFromConfig returns empty for { enabled: false }', () => {
    const resolution = resolveSearchableFieldsFromConfig(
      [col({ field: 'name' })],
      { enabled: false },
    );
    expect(resolution.descriptors).toHaveLength(0);
    expect(resolution.signature).toBe('sf|disabled');
  });

  it('resolveSearchableFieldsFromConfig works normally for { enabled: true }', () => {
    const resolution = resolveSearchableFieldsFromConfig(
      [col({ field: 'name' })],
      { enabled: true },
    );
    expect(resolution.descriptors).toHaveLength(1);
    expect(resolution.descriptors[0]!.field).toBe('name');
  });
});
