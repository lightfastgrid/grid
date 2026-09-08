import type {
  ColumnFilterType,
  FloatingFilterSelectOption,
  NormalizedColumnFilterConfig,
} from '../../types';

import type {
  FloatingFilterColumnOptions,
  FloatingFilterControl,
  FloatingFiltersOptions,
  NormalizedFloatingFilterConfig,
  ResolvedFloatingFilterControl,
} from './types';

const DEFAULT_DEBOUNCE_MS = 250;

export interface ResolveFloatingFilterArgs {
  field: string;
  global: boolean | FloatingFiltersOptions | undefined;
  column: boolean | FloatingFilterColumnOptions | undefined;
  defaultColDef: boolean | FloatingFilterColumnOptions | undefined;
  filterConfig: NormalizedColumnFilterConfig | null;
  isInternal?: boolean;
  editorSelectOptions?: ReadonlyArray<FloatingFilterSelectOption>;
}

export function resolveFloatingFilterConfig(
  args: ResolveFloatingFilterArgs,
): NormalizedFloatingFilterConfig | null {
  if (!isGlobalEnabled(args.global)) return null;
  if (!args.filterConfig) return null;
  if (args.isInternal) return null;

  const colOpt = args.column !== undefined ? args.column : args.defaultColDef;

  if (colOpt === false) return null;
  if (typeof colOpt === 'object' && colOpt.enabled === false) return null;

  const globalObj = typeof args.global === 'object' ? args.global : undefined;
  const colObj = typeof colOpt === 'object' ? colOpt : undefined;

  const requestedControl = colObj?.control ?? "auto";
  if (requestedControl === "none") return null;

  const control = resolveControl(requestedControl, args.filterConfig.type);

  const selectOptions = control === "select"
    ? resolveSelectOptions(colObj?.options, args.editorSelectOptions)
    : undefined;

  return {
    field: args.field,
    type: args.filterConfig.type,
    control,
    debounceMs: resolveDebounce(colObj?.debounceMs, globalObj?.debounceMs),
    menuButton: colObj?.menuButton ?? globalObj?.menuButton ?? true,
    disabled: colObj?.disabled === true,
    placeholder: colObj?.placeholder,
    selectOptions,
  };
}

function resolveControl(
  requested: Exclude<FloatingFilterControl, "none">,
  filterType: ColumnFilterType,
): ResolvedFloatingFilterControl {
  if (requested !== "auto") return requested;
  switch (filterType) {
    case "number": return "numberRange";
    case "date": return "dateRange";
    case "boolean": return "booleanSelect";
    default: return "text";
  }
}

function resolveSelectOptions(
  colOptions: ReadonlyArray<FloatingFilterSelectOption> | undefined,
  editorOptions: ReadonlyArray<FloatingFilterSelectOption> | undefined,
): ReadonlyArray<FloatingFilterSelectOption> | undefined {
  if (colOptions && colOptions.length > 0) return colOptions;
  if (editorOptions && editorOptions.length > 0) return editorOptions;
  return undefined;
}

function isGlobalEnabled(
  global: boolean | FloatingFiltersOptions | undefined,
): boolean {
  if (global === undefined || global === false) return false;
  if (global === true) return true;
  return global.enabled !== false;
}

function resolveDebounce(
  column: number | undefined,
  global: number | undefined,
): number {
  if (column !== undefined) return isValidDebounce(column) ? column : DEFAULT_DEBOUNCE_MS;
  if (global !== undefined) return isValidDebounce(global) ? global : DEFAULT_DEBOUNCE_MS;
  return DEFAULT_DEBOUNCE_MS;
}

function isValidDebounce(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
