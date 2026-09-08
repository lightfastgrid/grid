import { describe, expect, it } from 'vitest';

import type { RowData } from '../../types';
import {
  type GetRowId,
  RowIdentityService,
} from '../RowIdentityService';

describe('RowIdentityService', () => {
  it('assigns the same auto id for the same object reference', () => {
    const svc = new RowIdentityService();
    const row = { a: 1 } as RowData;
    expect(svc.resolve(row, 0)).toBe(svc.resolve(row, 99));
  });

  it('assigns distinct auto ids for distinct object references', () => {
    const svc = new RowIdentityService();
    const r0 = { id: 0 } as RowData;
    const r1 = { id: 0 } as RowData;
    expect(svc.resolve(r0, 0)).not.toBe(svc.resolve(r1, 1));
  });

  it('uses user getRowId when provided (and stringifies)', () => {
    const svc = new RowIdentityService();
    const user: GetRowId = (row) => (row as RowData & { k: string }).k;
    expect(svc.resolve({ k: 'explicit' } as RowData, 0, user)).toBe('explicit');
  });

  it('user getRowId beats object identity', () => {
    const svc = new RowIdentityService();
    const row = { x: 1 } as RowData;
    const user: GetRowId = () => 'fixed';
    expect(svc.resolve(row, 0, user)).toBe('fixed');
    expect(svc.resolve(row, 9, user)).toBe('fixed');
  });

  it('falls back to lazy object identity when user getRowId returns nullish', () => {
    const svc = new RowIdentityService();
    const row = { missingId: true } as RowData;
    const missing: GetRowId = () => undefined;
    expect(svc.resolve(row, 0, missing)).toBe('auto:0');
    expect(svc.resolve(row, 20, missing)).toBe('auto:0');
  });

  it('falls back to index key for primitive rows', () => {
    const svc = new RowIdentityService();
    expect(svc.resolve(42, 3)).toBe('index:3');
    expect(svc.resolve('x', 0)).toBe('index:0');
    expect(svc.resolve(null, 1)).toBe('index:1');
  });

  it('does not touch all rows in a large dataset (lazy resolution)', () => {
    const svc = new RowIdentityService();
    const rows: RowData[] = Array.from({ length: 50_000 }, (_, i) => ({ i }) as RowData);
    const picked = rows[12_345]!;
    expect(svc.resolve(picked, 12_345)).toMatch(/^auto:0$/);
    expect(svc.resolve(rows[48_000]!, 48_000)).toBe('auto:1');
  });

  it('does not mutate row objects when assigning auto ids', () => {
    const svc = new RowIdentityService();
    const row = Object.freeze({ z: 3 } as RowData);
    svc.resolve(row, 0);
    expect(Object.keys(row)).toEqual(['z']);
    expect((row as Record<string, unknown>).__id).toBeUndefined();
  });

  // ── Row-based identity contract ────────────────────────────────────────
  // Prompt: getRowId should be row-based, not index-based.

  it('row-only getRowId(row) form returns the row id', () => {
    const svc = new RowIdentityService();
    const row = { id: 'r-42' } as RowData;
    // Note the single-argument form — index is intentionally ignored.
    const user: GetRowId = (r) => (r as { id: string }).id;
    expect(svc.resolve(row, 0, user)).toBe('r-42');
    // The same row at a different index still maps to the same id —
    // index never participates.
    expect(svc.resolve(row, 99, user)).toBe('r-42');
  });

  it('user getRowId returning undefined falls back to object identity (NOT index)', () => {
    const svc = new RowIdentityService();
    const row = { someField: 'no-id' } as RowData;
    const user: GetRowId = () => undefined;
    const first = svc.resolve(row, 0, user);
    // Object-identity ids are `auto:N`; the index-based `index:N` fallback
    // is reserved for non-object rows only.
    expect(first).toMatch(/^auto:\d+$/);
    expect(first).not.toMatch(/^index:/);
  });

  it('object-identity fallback stays stable after a row reorder', () => {
    const svc = new RowIdentityService();
    // Two rows, neither has an explicit id field. Same callback returns
    // undefined for both, so both fall through to object identity.
    const a = { value: 'a' } as RowData;
    const b = { value: 'b' } as RowData;
    const user: GetRowId = () => undefined;

    const idA0 = svc.resolve(a, 0, user);
    const idB1 = svc.resolve(b, 1, user);

    // Simulate a reorder — swap the indices we resolve at.
    const idA1 = svc.resolve(a, 1, user);
    const idB0 = svc.resolve(b, 0, user);

    expect(idA0).toBe(idA1); // A keeps its id even at a new index
    expect(idB0).toBe(idB1); // B keeps its id even at a new index
    expect(idA0).not.toBe(idB0); // distinct rows still distinct
  });

  it('mixed dataset: some rows return undefined and fall back to stable object-identity', () => {
    const svc = new RowIdentityService();
    // Mix of rows: some have ids, some don't. Simulates a row-drag scenario
    // where the user callback occasionally returns undefined.
    const explicit = { id: 'expl-1' } as RowData;
    const missing1 = { name: 'no-id-1' } as RowData;
    const missing2 = { name: 'no-id-2' } as RowData;
    const user: GetRowId = (r) => (r as { id?: string }).id;

    const idExplicit0 = svc.resolve(explicit, 0, user);
    const idMissing1At1 = svc.resolve(missing1, 1, user);
    const idMissing2At2 = svc.resolve(missing2, 2, user);

    expect(idExplicit0).toBe('expl-1');
    expect(idMissing1At1).toMatch(/^auto:\d+$/);
    expect(idMissing2At2).toMatch(/^auto:\d+$/);
    expect(idMissing1At1).not.toBe(idMissing2At2);

    // After a "drag" (reorder) — explicit-id row at index 5, missing rows
    // at indices 0 and 9. Ids must NOT change.
    expect(svc.resolve(explicit, 5, user)).toBe(idExplicit0);
    expect(svc.resolve(missing1, 9, user)).toBe(idMissing1At1);
    expect(svc.resolve(missing2, 0, user)).toBe(idMissing2At2);
  });
});
