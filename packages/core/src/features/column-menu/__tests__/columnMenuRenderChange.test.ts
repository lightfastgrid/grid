import { describe, expect, it } from 'vitest';

import type { ColumnMenuOptions } from '../../../types';
import { columnMenuRenderChanged } from '../columnMenuRenderChange';

describe('columnMenuRenderChanged', () => {
  it('same reference returns false', () => {
    const opts: ColumnMenuOptions = { enabled: true };
    expect(columnMenuRenderChanged(opts, opts)).toBe(false);
  });

  it('enabled change returns true', () => {
    expect(
      columnMenuRenderChanged({ enabled: true }, { enabled: false }),
    ).toBe(true);
  });

  it('equivalent inline filter config returns false', () => {
    const a: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, placement: 'mainMenu', clear: true },
    };
    const b: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, placement: 'mainMenu', clear: true },
    };
    expect(columnMenuRenderChanged(a, b)).toBe(false);
  });

  it('filter placement change returns true', () => {
    const a: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, placement: 'mainMenu' },
    };
    const b: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, placement: 'dedicatedMenu' },
    };
    expect(columnMenuRenderChanged(a, b)).toBe(true);
  });

  it('equivalent selectionList object returns false', () => {
    const a: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, selectionList: { enabled: true, placement: 'mainMenu' } },
    };
    const b: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, selectionList: { enabled: true, placement: 'mainMenu' } },
    };
    expect(columnMenuRenderChanged(a, b)).toBe(false);
  });

  it('selectionList placement change returns true', () => {
    const a: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, selectionList: { enabled: true, placement: 'mainMenu' } },
    };
    const b: ColumnMenuOptions = {
      enabled: true,
      filter: { enabled: true, selectionList: { enabled: true, placement: 'dedicatedMenu' } },
    };
    expect(columnMenuRenderChanged(a, b)).toBe(true);
  });

  it('equivalent headerIcons returns false', () => {
    const icons = { sortAsc: '▲', sortDesc: '▼', filtered: '✓' };
    expect(
      columnMenuRenderChanged(
        { enabled: true, headerIcons: { ...icons } },
        { enabled: true, headerIcons: { ...icons } },
      ),
    ).toBe(false);
  });

  it('changed headerIcons returns true', () => {
    expect(
      columnMenuRenderChanged(
        { enabled: true, headerIcons: { sortAsc: '▲' } },
        { enabled: true, headerIcons: { sortAsc: '↑' } },
      ),
    ).toBe(true);
  });
});
