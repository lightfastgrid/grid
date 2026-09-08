import { describe, expect, it } from 'vitest';

import type { LazyNarrowingPrevious } from '../quickSearchLazyNarrowing';
import { canNarrowFromPrevious } from '../quickSearchLazyNarrowing';

function previous(overrides?: Partial<LazyNarrowingPrevious>): LazyNarrowingPrevious {
  return {
    generation: 1,
    searchableFieldsKey: 'sf|v|name,city',
    normalizerSignature: 'qs-norm-v1',
    sourceSignature: 'src-1',
    configSignature: 'cfg-1',
    normalizedText: 'ALI',
    searchableDataRevision: 0,
    indexes: new Uint32Array([1, 4, 9]),
    ...overrides,
  };
}

function next(text: string, overrides?: Partial<Omit<LazyNarrowingPrevious, 'indexes'>>) {
  const p = previous();
  return {
    generation: p.generation,
    searchableFieldsKey: p.searchableFieldsKey,
    normalizerSignature: p.normalizerSignature,
    sourceSignature: p.sourceSignature,
    configSignature: p.configSignature,
    searchableDataRevision: p.searchableDataRevision,
    normalizedText: text,
    ...overrides,
  };
}

describe('canNarrowFromPrevious', () => {
  // ── Safe forward refinements ─────────────────────────────────────────

  it('allows monotonic forward typing', () => {
    expect(canNarrowFromPrevious(previous({ normalizedText: 'A' }), next('AB'))).toBe(true);
    expect(canNarrowFromPrevious(previous({ normalizedText: 'ALI' }), next('ALIC'))).toBe(true);
    expect(canNarrowFromPrevious(previous({ normalizedText: 'ALICE' }), next('ALICE P'))).toBe(true);
    expect(canNarrowFromPrevious(previous({ normalizedText: '239' }), next('2397'))).toBe(true);
  });

  // ── Unsafe query changes ─────────────────────────────────────────────

  it('rejects backspace, replacement, and reordering', () => {
    expect(canNarrowFromPrevious(previous({ normalizedText: 'AB' }), next('A'))).toBe(false);
    expect(canNarrowFromPrevious(previous({ normalizedText: 'ALICE' }), next('ALI'))).toBe(false);
    expect(canNarrowFromPrevious(previous({ normalizedText: 'ALICE' }), next('BOB'))).toBe(false);
    expect(
      canNarrowFromPrevious(previous({ normalizedText: 'ALICE BOB' }), next('BOB ALICE')),
    ).toBe(false);
  });

  it('rejects identical text (exact repeats belong to the result cache)', () => {
    expect(canNarrowFromPrevious(previous({ normalizedText: 'ALI' }), next('ALI'))).toBe(false);
  });

  it('rejects empty previous text', () => {
    expect(canNarrowFromPrevious(previous({ normalizedText: '' }), next('A'))).toBe(false);
  });

  it('rejects missing previous result', () => {
    expect(canNarrowFromPrevious(null, next('ALIC'))).toBe(false);
  });

  // ── Context invalidation ─────────────────────────────────────────────

  it('rejects generation change', () => {
    expect(canNarrowFromPrevious(previous(), next('ALIC', { generation: 2 }))).toBe(false);
  });

  it('rejects searchable fields change', () => {
    expect(
      canNarrowFromPrevious(previous(), next('ALIC', { searchableFieldsKey: 'sf|v|name' })),
    ).toBe(false);
  });

  it('rejects source signature change (filters changed)', () => {
    expect(canNarrowFromPrevious(previous(), next('ALIC', { sourceSignature: 'src-2' }))).toBe(false);
  });

  it('rejects config signature change (parser/matcher semantics)', () => {
    expect(canNarrowFromPrevious(previous(), next('ALIC', { configSignature: 'cfg-2' }))).toBe(false);
  });

  it('rejects normalizer signature change', () => {
    expect(
      canNarrowFromPrevious(previous(), next('ALIC', { normalizerSignature: 'v2' })),
    ).toBe(false);
  });

  it('rejects searchableDataRevision change', () => {
    expect(
      canNarrowFromPrevious(previous(), next('ALIC', { searchableDataRevision: 1 })),
    ).toBe(false);
  });
});
