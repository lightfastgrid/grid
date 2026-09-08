import { describe, expect, it } from 'vitest';

import type { LightFastGridDefaultColDef } from '../../types';
import { defaultColDefsEqual } from '../defaultColDefEquality';

describe('defaultColDefsEqual', () => {
  it('same reference returns true', () => {
    const def: LightFastGridDefaultColDef = { sortable: true };
    expect(defaultColDefsEqual(def, def)).toBe(true);
  });

  it('equivalent scalar config returns true', () => {
    expect(
      defaultColDefsEqual(
        { sortable: true, resizable: true, editable: false },
        { sortable: true, resizable: true, editable: false },
      ),
    ).toBe(true);
  });

  it('changed scalar config returns false', () => {
    expect(
      defaultColDefsEqual(
        { sortable: true, resizable: true },
        { sortable: true, resizable: false },
      ),
    ).toBe(false);
  });

  it('equivalent cellClass arrays returns true', () => {
    expect(
      defaultColDefsEqual(
        { cellClass: ['a', 'b'] },
        { cellClass: ['a', 'b'] },
      ),
    ).toBe(true);
  });

  it('different cellClass arrays returns false', () => {
    expect(
      defaultColDefsEqual(
        { cellClass: ['a', 'b'] },
        { cellClass: ['a', 'c'] },
      ),
    ).toBe(false);
  });

  it('different function refs returns false', () => {
    const fn1 = () => 'a';
    const fn2 = () => 'a';
    expect(
      defaultColDefsEqual(
        { valueGetter: fn1 },
        { valueGetter: fn2 },
      ),
    ).toBe(false);
  });

  it('same function refs returns true', () => {
    const fn = () => 'a';
    expect(
      defaultColDefsEqual(
        { valueGetter: fn },
        { valueGetter: fn },
      ),
    ).toBe(true);
  });

  it('observes body-cell accessibility default changes', () => {
    const label = () => 'label';
    const description = () => 'description';
    const baseline: LightFastGridDefaultColDef = {
      getCellAriaLabel: label,
      cellAriaDescribedBy: 'help',
      getCellAriaDescribedBy: description,
    };

    expect(defaultColDefsEqual(baseline, { ...baseline })).toBe(true);
    expect(
      defaultColDefsEqual(baseline, {
        ...baseline,
        getCellAriaLabel: () => 'label',
      }),
    ).toBe(false);
    expect(
      defaultColDefsEqual(baseline, {
        ...baseline,
        cellAriaDescribedBy: 'other-help',
      }),
    ).toBe(false);
    expect(
      defaultColDefsEqual(baseline, {
        ...baseline,
        getCellAriaDescribedBy: () => 'description',
      }),
    ).toBe(false);
  });

  it('object refs like editor/headerControls/cellShell compare by reference', () => {
    const editor = { type: 'select' as const, options: ['a', 'b'] };
    expect(
      defaultColDefsEqual({ editor }, { editor }),
    ).toBe(true);

    expect(
      defaultColDefsEqual(
        { editor: { type: 'select' as const, options: ['a'] } },
        { editor: { type: 'select' as const, options: ['a'] } },
      ),
    ).toBe(false);
  });
});
