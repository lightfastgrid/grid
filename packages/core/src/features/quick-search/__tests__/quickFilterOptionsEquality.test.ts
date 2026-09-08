import { describe, expect, it } from 'vitest';

import {
  quickFilterConfigKey,
  quickFilterDependencyOptionsEqual,
  quickFilterOptionsEqual,
} from '../quickFilterOptionsEquality';

describe('quickFilterOptionsEquality', () => {
  it('quickFilterOptionsEqual compares option fields by value', () => {
    expect(
      quickFilterOptionsEqual(
        { includeHiddenColumns: true, enabled: true },
        { includeHiddenColumns: true, enabled: true },
      ),
    ).toBe(true);
    expect(
      quickFilterOptionsEqual(
        { includeHiddenColumns: true },
        { includeHiddenColumns: false },
      ),
    ).toBe(false);
  });

  it('quickFilterOptionsEqual treats distinct object references with same values as equal', () => {
    expect(
      quickFilterOptionsEqual(
        { includeHiddenColumns: true },
        { includeHiddenColumns: true },
      ),
    ).toBe(true);
  });

  it('quickFilterOptionsEqual detects prewarm changes', () => {
    expect(
      quickFilterOptionsEqual({ prewarm: 'auto' }, { prewarm: 'auto' }),
    ).toBe(true);
    expect(
      quickFilterOptionsEqual({ prewarm: true }, { prewarm: false }),
    ).toBe(false);
    expect(
      quickFilterOptionsEqual({}, { prewarm: false }),
    ).toBe(false);
  });

  it('quickFilterOptionsEqual still detects cache and prewarm runtime changes', () => {
    expect(quickFilterOptionsEqual(true, { cache: false })).toBe(false);
    expect(quickFilterOptionsEqual(undefined, { prewarm: true })).toBe(false);
    expect(
      quickFilterOptionsEqual({ cache: 'auto' }, { cache: false }),
    ).toBe(false);
  });

  it('quickFilterOptionsEqual compares parser and matcher by reference', () => {
    const parserA = (text: string) => text.split(' ');
    const parserB = (text: string) => text.split(' ');
    const matcher = () => true;

    expect(
      quickFilterOptionsEqual({ parser: parserA }, { parser: parserA }),
    ).toBe(true);
    expect(
      quickFilterOptionsEqual({ parser: parserA }, { parser: parserB }),
    ).toBe(false);
    expect(
      quickFilterOptionsEqual({ matcher }, { matcher }),
    ).toBe(true);
    expect(
      quickFilterOptionsEqual({ matcher: () => true }, { matcher: () => true }),
    ).toBe(false);
  });

  it('quickFilterDependencyOptionsEqual normalizes enabled representations', () => {
    expect(quickFilterDependencyOptionsEqual(undefined, true)).toBe(true);
    expect(quickFilterDependencyOptionsEqual(undefined, {})).toBe(true);
    expect(quickFilterDependencyOptionsEqual(undefined, { enabled: true })).toBe(true);
    expect(quickFilterDependencyOptionsEqual(true, {})).toBe(true);
    expect(quickFilterDependencyOptionsEqual(true, { enabled: true })).toBe(true);
    expect(quickFilterDependencyOptionsEqual({}, { enabled: true })).toBe(true);
  });

  it('quickFilterDependencyOptionsEqual normalizes includeHiddenColumns defaults', () => {
    expect(
      quickFilterDependencyOptionsEqual(undefined, { includeHiddenColumns: false }),
    ).toBe(true);
    expect(
      quickFilterDependencyOptionsEqual({}, { includeHiddenColumns: false }),
    ).toBe(true);
    expect(
      quickFilterDependencyOptionsEqual(
        { includeHiddenColumns: true },
        { includeHiddenColumns: false },
      ),
    ).toBe(false);
  });

  it('quickFilterDependencyOptionsEqual treats disabled representations as equal', () => {
    expect(quickFilterDependencyOptionsEqual(false, { enabled: false })).toBe(true);
    const parser = (text: string) => text.split(',');
    expect(
      quickFilterDependencyOptionsEqual(
        false,
        { enabled: false, parser },
      ),
    ).toBe(true);
    expect(
      quickFilterDependencyOptionsEqual(
        { enabled: false, parser },
        { enabled: false, matcher: () => true },
      ),
    ).toBe(true);
  });

  it('quickFilterDependencyOptionsEqual ignores cache and prewarm', () => {
    expect(
      quickFilterDependencyOptionsEqual(true, { cache: false }),
    ).toBe(true);
    expect(
      quickFilterDependencyOptionsEqual(undefined, { prewarm: true }),
    ).toBe(true);
    expect(
      quickFilterDependencyOptionsEqual(
        { cache: 'auto', prewarm: true },
        { cache: false, prewarm: false },
      ),
    ).toBe(true);
  });

  it('quickFilterDependencyOptionsEqual compares parser/matcher by reference when enabled', () => {
    const parserA = (text: string) => text.split(' ');
    const parserB = (text: string) => text.split(' ');
    const matcher = () => true;

    expect(
      quickFilterDependencyOptionsEqual({ parser: parserA }, { parser: parserA }),
    ).toBe(true);
    expect(
      quickFilterDependencyOptionsEqual({ parser: parserA }, { parser: parserB }),
    ).toBe(false);
    expect(
      quickFilterDependencyOptionsEqual({ matcher }, { matcher }),
    ).toBe(true);
    expect(
      quickFilterDependencyOptionsEqual(
        { matcher: () => true },
        { matcher: () => true },
      ),
    ).toBe(false);
  });

  it('quickFilterConfigKey is stable for equivalent inline configs', () => {
    expect(
      quickFilterConfigKey({ includeHiddenColumns: true }),
    ).toBe(quickFilterConfigKey({ includeHiddenColumns: true }));
  });
});
