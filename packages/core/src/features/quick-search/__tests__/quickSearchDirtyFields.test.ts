import { describe, expect, it } from 'vitest';

import type { RowStoreDirtyMetadata } from '../../../row-model/store/RowStore.types';
import {
  buildQuickSearchDirtyFieldWatchSet,
  doDirtyFieldsTouchQuickSearch,
} from '../quickSearchDirtyFields';
import type { SearchableFieldDescriptor } from '../searchableFieldResolver';

function desc(
  field: string,
  projectionField?: string,
): SearchableFieldDescriptor {
  return { field, projectionField, workerEligible: true };
}

function dirty(fieldsByRow: Record<string, string[]>): RowStoreDirtyMetadata {
  const dirtyFieldsByRowId = new Map<string, ReadonlySet<string>>();
  for (const [rowId, fields] of Object.entries(fieldsByRow)) {
    dirtyFieldsByRowId.set(rowId, new Set(fields));
  }
  return {
    structural: false,
    updatedRowIds: new Set(Object.keys(fieldsByRow)),
    dirtyFieldsByRowId,
    updatedSourceIndexes: new Set(),
    dirtyFieldsBySourceIndex: new Map(),
  };
}

describe('quickSearchDirtyFields', () => {
  it('buildQuickSearchDirtyFieldWatchSet includes field and projection paths', () => {
    expect(
      [...buildQuickSearchDirtyFieldWatchSet([
        desc('balance', 'balanceSearch'),
        desc('name'),
      ])].sort(),
    ).toEqual(['balance', 'balanceSearch', 'name']);
  });

  it('doDirtyFieldsTouchQuickSearch matches searchable field updates', () => {
    const descriptors = [desc('name')];
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['name'] }))).toBe(true);
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['age'] }))).toBe(false);
  });

  it('doDirtyFieldsTouchQuickSearch matches projection field updates', () => {
    const descriptors = [desc('balance', 'balanceSearch')];
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['balanceSearch'] }))).toBe(
      true,
    );
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['balance'] }))).toBe(true);
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['notes'] }))).toBe(false);
  });

  it('doDirtyFieldsTouchQuickSearch treats dot-path prefix as searchable', () => {
    const descriptors = [desc('user.name')];
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['user'] }))).toBe(true);
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['user.name'] }))).toBe(true);
    expect(doDirtyFieldsTouchQuickSearch(descriptors, dirty({ r1: ['age'] }))).toBe(false);
  });

  it('doDirtyFieldsTouchQuickSearch returns true for structural changes', () => {
    const descriptors = [desc('name')];
    const structural: RowStoreDirtyMetadata = {
      structural: true,
      updatedRowIds: new Set(['r1']),
      dirtyFieldsByRowId: new Map(),
      updatedSourceIndexes: new Set(),
      dirtyFieldsBySourceIndex: new Map(),
    };
    expect(doDirtyFieldsTouchQuickSearch(descriptors, structural)).toBe(true);
  });
});
