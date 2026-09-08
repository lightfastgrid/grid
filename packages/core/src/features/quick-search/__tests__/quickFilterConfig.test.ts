import { describe, expect, it } from 'vitest';

import {
  getIncludeHiddenColumns,
  getQuickFilterCacheMode,
  getQuickFilterPrewarmMode,
  isQuickFilterActive,
  isQuickFilterEnabled,
  shouldQuickFilterPrewarm,
} from '../quickFilterConfig';

describe('isQuickFilterEnabled', () => {
  it('undefined → enabled', () => {
    expect(isQuickFilterEnabled(undefined)).toBe(true);
  });

  it('true → enabled', () => {
    expect(isQuickFilterEnabled(true)).toBe(true);
  });

  it('false → disabled', () => {
    expect(isQuickFilterEnabled(false)).toBe(false);
  });

  it('{ enabled: false } → disabled', () => {
    expect(isQuickFilterEnabled({ enabled: false })).toBe(false);
  });

  it('{ enabled: true } → enabled', () => {
    expect(isQuickFilterEnabled({ enabled: true })).toBe(true);
  });

  it('{} (no enabled key) → enabled', () => {
    expect(isQuickFilterEnabled({})).toBe(true);
  });

  it('{ includeHiddenColumns: true } → enabled', () => {
    expect(isQuickFilterEnabled({ includeHiddenColumns: true })).toBe(true);
  });
});

describe('isQuickFilterActive', () => {
  it('disabled with text → not active', () => {
    expect(isQuickFilterActive('hello', false)).toBe(false);
    expect(isQuickFilterActive('hello', { enabled: false })).toBe(false);
  });

  it('enabled with text → active', () => {
    expect(isQuickFilterActive('hello', true)).toBe(true);
    expect(isQuickFilterActive('hello', undefined)).toBe(true);
  });

  it('enabled with empty/whitespace text → not active', () => {
    expect(isQuickFilterActive('', undefined)).toBe(false);
    expect(isQuickFilterActive('   ', undefined)).toBe(false);
  });
});

describe('getIncludeHiddenColumns', () => {
  it('returns false for non-object configs', () => {
    expect(getIncludeHiddenColumns(undefined)).toBe(false);
    expect(getIncludeHiddenColumns(true)).toBe(false);
    expect(getIncludeHiddenColumns(false)).toBe(false);
  });

  it('returns the value from the options object', () => {
    expect(getIncludeHiddenColumns({ includeHiddenColumns: true })).toBe(true);
    expect(getIncludeHiddenColumns({ includeHiddenColumns: false })).toBe(false);
    expect(getIncludeHiddenColumns({})).toBe(false);
  });
});

describe('getQuickFilterCacheMode', () => {
  it('defaults to auto for non-object configs', () => {
    expect(getQuickFilterCacheMode(undefined)).toBe('auto');
    expect(getQuickFilterCacheMode(true)).toBe('auto');
    expect(getQuickFilterCacheMode(false)).toBe('auto');
  });

  it('returns the configured cache mode from options objects', () => {
    expect(getQuickFilterCacheMode({ cache: 'auto' })).toBe('auto');
    expect(getQuickFilterCacheMode({ cache: true })).toBe(true);
    expect(getQuickFilterCacheMode({ cache: false })).toBe(false);
    expect(getQuickFilterCacheMode({})).toBe('auto');
  });
});

describe('getQuickFilterPrewarmMode', () => {
  it('defaults to auto for non-object configs and omitted prewarm', () => {
    expect(getQuickFilterPrewarmMode(undefined)).toBe('auto');
    expect(getQuickFilterPrewarmMode(true)).toBe('auto');
    expect(getQuickFilterPrewarmMode(false)).toBe('auto');
    expect(getQuickFilterPrewarmMode({})).toBe('auto');
  });

  it('returns explicit prewarm settings from options objects', () => {
    expect(getQuickFilterPrewarmMode({ prewarm: false })).toBe(false);
    expect(getQuickFilterPrewarmMode({ prewarm: true })).toBe(true);
    expect(getQuickFilterPrewarmMode({ prewarm: 'auto' })).toBe('auto');
  });
});

describe('shouldQuickFilterPrewarm', () => {
  it('auto mode requires threshold, enabled quick filter, and worker eligibility', () => {
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: undefined,
        rowCount: 600,
        threshold: 500,
        workerEligible: true,
      }),
    ).toBe(true);
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: undefined,
        rowCount: 100,
        threshold: 500,
        workerEligible: true,
      }),
    ).toBe(false);
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: false,
        rowCount: 600,
        threshold: 500,
        workerEligible: true,
      }),
    ).toBe(false);
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: undefined,
        rowCount: 600,
        threshold: 500,
        workerEligible: false,
      }),
    ).toBe(false);
  });

  it('true mode skips threshold but still requires enabled quick filter and worker eligibility', () => {
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: { prewarm: true },
        rowCount: 10,
        threshold: 500,
        workerEligible: true,
      }),
    ).toBe(true);
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: { prewarm: true, enabled: false },
        rowCount: 600,
        threshold: 500,
        workerEligible: true,
      }),
    ).toBe(false);
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: { prewarm: true },
        rowCount: 600,
        threshold: 500,
        workerEligible: false,
      }),
    ).toBe(false);
  });

  it('false mode never prewarms', () => {
    expect(
      shouldQuickFilterPrewarm({
        quickFilter: { prewarm: false },
        rowCount: 600,
        threshold: 500,
        workerEligible: true,
      }),
    ).toBe(false);
  });
});
