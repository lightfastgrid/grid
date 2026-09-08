import { describe, expect, it } from 'vitest';

import { parseQueryParts, rowTextMatchesParts } from '../quickSearchMatcher';

describe('quickSearchMatcher', () => {
  it('splits on whitespace and drops empty parts', () => {
    expect(parseQueryParts('ALICE PAKISTAN')).toEqual(['ALICE', 'PAKISTAN']);
    expect(parseQueryParts('  ALICE   PAKISTAN  ')).toEqual(['ALICE', 'PAKISTAN']);
    expect(parseQueryParts('ALICE\tPAKISTAN\nX')).toEqual(['ALICE', 'PAKISTAN', 'X']);
    expect(parseQueryParts('')).toEqual([]);
    expect(parseQueryParts('   ')).toEqual([]);
  });

  it('applies AND semantics across parts', () => {
    expect(rowTextMatchesParts('ALICE LAHORE', ['ALICE', 'LAHORE'])).toBe(true);
    expect(rowTextMatchesParts('ALICE LAHORE', ['ALICE', 'LONDON'])).toBe(false);
    expect(rowTextMatchesParts('ALICE LAHORE', ['LAH'])).toBe(true);
    expect(rowTextMatchesParts('ALICE LAHORE', [])).toBe(true);
  });

  it('matches substrings inside number/boolean-looking normalized text', () => {
    expect(rowTextMatchesParts('2397 2,397 TRUE', ['239'])).toBe(true);
    expect(rowTextMatchesParts('2397 2,397 TRUE', ['2,39'])).toBe(true);
    expect(rowTextMatchesParts('2397 2,397 TRUE', ['TRU'])).toBe(true);
    expect(rowTextMatchesParts('2397 2,397 TRUE', ['FALSE'])).toBe(false);
  });

  it('parts can match across different fields of aggregated row text', () => {
    // Snapshot row text joins field values with a space: name + city.
    const rowText = 'ALICE LAHORE';
    expect(rowTextMatchesParts(rowText, ['ALICE', 'LAHORE'])).toBe(true);
    // A part may even span the field boundary via the join space —
    // acceptable for substring semantics over aggregated text.
    expect(rowTextMatchesParts(rowText, ['CE LA'])).toBe(true);
  });
});
