import { describe, expect, it } from 'vitest';

import type { NormalizedColumnFilterConfig } from '../../../types';
import { resolveFloatingFilterConfig } from '../resolveFloatingFilterConfig';

const TEXT_FILTER: NormalizedColumnFilterConfig = {
  type: 'text',
  defaultOperator: 'contains',
  caseSensitive: false,
  trimInput: true,
};

const NUMBER_FILTER: NormalizedColumnFilterConfig = {
  type: 'number',
  defaultOperator: 'equals',
  caseSensitive: false,
  trimInput: true,
};

const DATE_FILTER: NormalizedColumnFilterConfig = {
  type: 'date',
  defaultOperator: 'equals',
  caseSensitive: false,
  trimInput: false,
};

const BOOLEAN_FILTER: NormalizedColumnFilterConfig = {
  type: 'boolean',
  defaultOperator: 'equals',
  caseSensitive: false,
  trimInput: false,
};

describe('resolveFloatingFilterConfig', () => {
  it('global undefined disables', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: undefined,
        column: true,
        defaultColDef: undefined,
        filterConfig: TEXT_FILTER,
      }),
    ).toBeNull();
  });

  it('global false disables', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: false,
        column: true,
        defaultColDef: undefined,
        filterConfig: TEXT_FILTER,
      }),
    ).toBeNull();
  });

  it('global true enables filterable column', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result).toEqual({
      field: 'name',
      type: 'text',
      control: 'text',
      debounceMs: 250,
      menuButton: true,
      disabled: false,
      placeholder: undefined,
      selectOptions: undefined,
    });
  });

  it('object enabled false disables', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: { enabled: false },
        column: undefined,
        defaultColDef: undefined,
        filterConfig: TEXT_FILTER,
      }),
    ).toBeNull();
  });

  it('object without enabled field is enabled', () => {
    const result = resolveFloatingFilterConfig({
      field: 'age',
      global: { debounceMs: 100 },
      column: undefined,
      defaultColDef: undefined,
      filterConfig: NUMBER_FILTER,
    });
    expect(result).not.toBeNull();
    expect(result!.debounceMs).toBe(100);
  });

  it('invalid debounce falls back to 250', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: { debounceMs: NaN },
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.debounceMs).toBe(250);

    const neg = resolveFloatingFilterConfig({
      field: 'name',
      global: { debounceMs: -10 },
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(neg!.debounceMs).toBe(250);

    const inf = resolveFloatingFilterConfig({
      field: 'name',
      global: { debounceMs: Infinity },
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(inf!.debounceMs).toBe(250);
  });

  it('defaultColDef.floatingFilter false disables columns by default', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: true,
        column: undefined,
        defaultColDef: false,
        filterConfig: TEXT_FILTER,
      }),
    ).toBeNull();
  });

  it('column floatingFilter true overrides default false', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: true,
      defaultColDef: false,
      filterConfig: TEXT_FILTER,
    });
    expect(result).not.toBeNull();
    expect(result!.field).toBe('name');
  });

  it('column floatingFilter false disables that column', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: true,
        column: false,
        defaultColDef: true,
        filterConfig: TEXT_FILTER,
      }),
    ).toBeNull();
  });

  it('column floatingFilter { enabled: false } disables that column', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: true,
        column: { enabled: false },
        defaultColDef: true,
        filterConfig: TEXT_FILTER,
      }),
    ).toBeNull();
  });

  it('non-filterable column stays disabled even with floatingFilter true', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: true,
        column: true,
        defaultColDef: undefined,
        filterConfig: null,
      }),
    ).toBeNull();
  });

  it('missing filterConfig returns null', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: true,
        column: undefined,
        defaultColDef: undefined,
        filterConfig: null,
      }),
    ).toBeNull();
  });

  it('column debounceMs overrides global', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: { debounceMs: 500 },
      column: { debounceMs: 100 },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.debounceMs).toBe(100);
  });

  it('column menuButton overrides global', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: { menuButton: true },
      column: { menuButton: false },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.menuButton).toBe(false);
  });

  it('placeholder is preserved', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: { placeholder: 'Search...' },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.placeholder).toBe('Search...');
  });

  it('placeholder is undefined when not set', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.placeholder).toBeUndefined();
  });

  it('uses filter type from filterConfig', () => {
    const result = resolveFloatingFilterConfig({
      field: 'age',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: NUMBER_FILTER,
    });
    expect(result!.type).toBe('number');
  });

  it('invalid column debounceMs falls back to 250', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: { debounceMs: 500 },
      column: { debounceMs: NaN },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.debounceMs).toBe(250);
  });

  // ── Control resolution ──────────────────────────────────────────────

  it('auto control resolves to text for text filter', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.control).toBe('text');
  });

  it('auto control resolves to numberRange for number filter', () => {
    const result = resolveFloatingFilterConfig({
      field: 'age',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: NUMBER_FILTER,
    });
    expect(result!.control).toBe('numberRange');
  });

  it('auto control resolves to dateRange for date filter', () => {
    const result = resolveFloatingFilterConfig({
      field: 'dob',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: DATE_FILTER,
    });
    expect(result!.control).toBe('dateRange');
  });

  it('auto control resolves to booleanSelect for boolean filter', () => {
    const result = resolveFloatingFilterConfig({
      field: 'active',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: BOOLEAN_FILTER,
    });
    expect(result!.control).toBe('booleanSelect');
  });

  it('explicit control overrides auto', () => {
    const result = resolveFloatingFilterConfig({
      field: 'age',
      global: true,
      column: { control: 'text' },
      defaultColDef: undefined,
      filterConfig: NUMBER_FILTER,
    });
    expect(result!.control).toBe('text');
  });

  it('control "none" returns null', () => {
    expect(
      resolveFloatingFilterConfig({
        field: 'name',
        global: true,
        column: { control: 'none' },
        defaultColDef: undefined,
        filterConfig: TEXT_FILTER,
      }),
    ).toBeNull();
  });

  it('control "select" with floatingFilter.options provides selectOptions', () => {
    const result = resolveFloatingFilterConfig({
      field: 'status',
      global: true,
      column: { control: 'select', options: ['Active', 'Inactive'] },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.control).toBe('select');
    expect(result!.selectOptions).toEqual(['Active', 'Inactive']);
  });

  it('control "select" with editorSelectOptions falls back to editor options', () => {
    const result = resolveFloatingFilterConfig({
      field: 'status',
      global: true,
      column: { control: 'select' },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
      editorSelectOptions: [{ value: 'active', label: 'Active' }],
    });
    expect(result!.control).toBe('select');
    expect(result!.selectOptions).toEqual([{ value: 'active', label: 'Active' }]);
  });

  it('control "select" with no options has undefined selectOptions', () => {
    const result = resolveFloatingFilterConfig({
      field: 'status',
      global: true,
      column: { control: 'select' },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.control).toBe('select');
    expect(result!.selectOptions).toBeUndefined();
  });

  it('isInternal returns null', () => {
    expect(
      resolveFloatingFilterConfig({
        field: '__selection__',
        global: true,
        column: undefined,
        defaultColDef: undefined,
        filterConfig: TEXT_FILTER,
        isInternal: true,
      }),
    ).toBeNull();
  });

  it('disabled: true sets disabled in normalized config', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: { disabled: true },
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result).not.toBeNull();
    expect(result!.disabled).toBe(true);
  });

  it('disabled defaults to false when not set', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.disabled).toBe(false);
  });

  it('non-select control never gets selectOptions', () => {
    const result = resolveFloatingFilterConfig({
      field: 'name',
      global: true,
      column: undefined,
      defaultColDef: undefined,
      filterConfig: TEXT_FILTER,
    });
    expect(result!.selectOptions).toBeUndefined();
  });
});
