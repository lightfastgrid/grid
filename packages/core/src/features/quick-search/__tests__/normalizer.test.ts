import { describe, expect, it } from 'vitest';

import {
  createNormalizer,
  defaultNormalizer,
  getNormalizerSignature,
} from '../normalizer';

describe('QuickSearchNormalizer', () => {
  // ── 1. Uses String.prototype.toUpperCase ────────────────────────────

  it('normalizeValue uses toUpperCase, not toLocaleUpperCase', () => {
    const n = defaultNormalizer;
    expect(n.normalizeValue('hello')).toBe('HELLO');
    expect(n.normalizeValue('Hello World')).toBe('HELLO WORLD');
    expect(n.normalizeValue('café')).toBe('CAFÉ');
  });

  it('normalizeQuery uses toUpperCase, not toLocaleUpperCase', () => {
    const n = defaultNormalizer;
    expect(n.normalizeQuery('alice pakistan')).toBe('ALICE PAKISTAN');
  });

  // ── 2. Does not use locale-specific toLocaleUpperCase ───────────────

  it('produces same result as explicit toUpperCase', () => {
    const inputs = ['straße', 'istanbul', 'café', 'naïve', 'abc123'];
    const n = defaultNormalizer;
    for (const input of inputs) {
      expect(n.normalizeQuery(input)).toBe(input.toUpperCase());
    }
  });

  // ── 3. normalizerSignature is stable ────────────────────────────────

  it('signature is stable across calls', () => {
    const sig1 = defaultNormalizer.signature;
    const sig2 = defaultNormalizer.signature;
    expect(sig1).toBe(sig2);
    expect(typeof sig1).toBe('string');
    expect(sig1.length).toBeGreaterThan(0);
  });

  it('signature is stable across separate normalizer instances', () => {
    const a = createNormalizer();
    const b = createNormalizer();
    expect(a.signature).toBe(b.signature);
  });

  it('getNormalizerSignature returns the same value', () => {
    expect(getNormalizerSignature(defaultNormalizer)).toBe(
      defaultNormalizer.signature,
    );
  });

  it('custom version produces a different signature', () => {
    const custom = createNormalizer({ version: 'custom-v2' });
    expect(custom.signature).toBe('custom-v2');
    expect(custom.signature).not.toBe(defaultNormalizer.signature);
  });

  // ── 4. Query normalization happens once through the helper ──────────

  it('normalizeQuery is a single-call normalization', () => {
    const n = defaultNormalizer;
    const raw = '  Alice Pakistan  ';
    const result = n.normalizeQuery(raw);
    expect(result).toBe('  ALICE PAKISTAN  ');
    expect(n.normalizeQuery(result)).toBe(result);
  });

  // ── Value coercion ──────────────────────────────────────────────────

  it('normalizes null and undefined to empty string', () => {
    const n = defaultNormalizer;
    expect(n.normalizeValue(null)).toBe('');
    expect(n.normalizeValue(undefined)).toBe('');
  });

  it('normalizes numbers and booleans', () => {
    const n = defaultNormalizer;
    expect(n.normalizeValue(2397)).toBe('2397');
    expect(n.normalizeValue(true)).toBe('TRUE');
    expect(n.normalizeValue(false)).toBe('FALSE');
  });

  it('normalizes objects via String()', () => {
    const n = defaultNormalizer;
    expect(n.normalizeValue({ toString: () => 'custom' })).toBe('CUSTOM');
  });
});
