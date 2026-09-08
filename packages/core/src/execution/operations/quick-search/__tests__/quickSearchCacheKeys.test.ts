import { describe, expect, it } from 'vitest';

import {
  buildFullMatchKey,
  buildSourceResultKey,
  canStoreFullMatchEntry,
} from '../quickSearchCacheKeys';

const base = {
  generation: 3,
  searchableFieldsKey: 'sf|v|name,city',
  normalizerSignature: 'qs-norm-v1',
  configSignature: 'cfg-1',
  normalizedText: 'ALICE',
  searchableDataRevision: 0,
};

describe('quickSearchCacheKeys', () => {
  it('source-scoped key changes when sourceSignature changes', () => {
    const a = buildSourceResultKey({ ...base, sourceSignature: 'src-1' });
    const b = buildSourceResultKey({ ...base, sourceSignature: 'src-2' });
    expect(a).not.toBe(b);
  });

  it('full-match key does NOT include sourceSignature', () => {
    // Same inputs minus source — key must be identical regardless of source.
    const key = buildFullMatchKey(base);
    expect(key).toBe(buildFullMatchKey({ ...base }));
    expect(key).not.toContain('src-');
  });

  it('keys are deterministic for identical inputs', () => {
    const a = buildSourceResultKey({ ...base, sourceSignature: 'src-1' });
    const b = buildSourceResultKey({ ...base, sourceSignature: 'src-1' });
    expect(a).toBe(b);
  });

  it('every component participates in the source-scoped key', () => {
    const original = buildSourceResultKey({ ...base, sourceSignature: 'src-1' });
    const variants = [
      buildSourceResultKey({ ...base, sourceSignature: 'src-1', generation: 4 }),
      buildSourceResultKey({ ...base, sourceSignature: 'src-1', searchableFieldsKey: 'sf|v|name' }),
      buildSourceResultKey({ ...base, sourceSignature: 'src-1', normalizerSignature: 'v2' }),
      buildSourceResultKey({ ...base, sourceSignature: 'src-1', configSignature: 'cfg-2' }),
      buildSourceResultKey({ ...base, sourceSignature: 'src-1', normalizedText: 'BOB' }),
      buildSourceResultKey({
        ...base,
        sourceSignature: 'src-1',
        searchableDataRevision: 1,
      }),
    ];
    for (const v of variants) expect(v).not.toBe(original);
  });

  it('every component participates in the full-match key', () => {
    const original = buildFullMatchKey(base);
    const variants = [
      buildFullMatchKey({ ...base, generation: 4 }),
      buildFullMatchKey({ ...base, searchableFieldsKey: 'sf|v|name' }),
      buildFullMatchKey({ ...base, normalizerSignature: 'v2' }),
      buildFullMatchKey({ ...base, configSignature: 'cfg-2' }),
      buildFullMatchKey({ ...base, normalizedText: 'BOB' }),
      buildFullMatchKey({ ...base, searchableDataRevision: 1 }),
    ];
    for (const v of variants) expect(v).not.toBe(original);
  });

  it('same query/generation with different searchableDataRevision misses both caches', () => {
    const sourceA = buildSourceResultKey({ ...base, sourceSignature: 'src-1' });
    const sourceB = buildSourceResultKey({
      ...base,
      sourceSignature: 'src-1',
      searchableDataRevision: 2,
    });
    expect(sourceA).not.toBe(sourceB);

    const fullA = buildFullMatchKey(base);
    const fullB = buildFullMatchKey({ ...base, searchableDataRevision: 2 });
    expect(fullA).not.toBe(fullB);
  });

  it('pipe characters in signatures cannot alias different inputs', () => {
    // fieldsSignature legitimately contains "|" — the key encoding must
    // not let component boundaries shift.
    const a = buildFullMatchKey({ ...base, searchableFieldsKey: 'sf|v|a', configSignature: 'b' });
    const b = buildFullMatchKey({ ...base, searchableFieldsKey: 'sf|v', configSignature: 'a|b' });
    expect(a).not.toBe(b);
  });

  it('arbitrary user query text cannot alias component boundaries', () => {
    // Query text is user input and may contain quotes, control chars,
    // or JSON-looking fragments — none of it may shift key components.
    const hostile = '","X"]';
    const a = buildFullMatchKey({ ...base, configSignature: 'cfg', normalizedText: hostile });
    const b = buildFullMatchKey({ ...base, configSignature: `cfg${hostile}`, normalizedText: '' });
    expect(a).not.toBe(b);

    const control = 'AB';
    const c = buildSourceResultKey({ ...base, sourceSignature: 's', normalizedText: control });
    const d = buildSourceResultKey({ ...base, sourceSignature: `s${control}`, normalizedText: 'B' });
    expect(c).not.toBe(d);
  });

  // ── Full-match store precondition ────────────────────────────────────

  it('full-match entries may only be stored for full-dataset execution', () => {
    expect(canStoreFullMatchEntry(null)).toBe(true);
    expect(canStoreFullMatchEntry(new Uint32Array([0, 1, 2]))).toBe(false);
    expect(canStoreFullMatchEntry(new Uint32Array(0))).toBe(false);
  });
});
