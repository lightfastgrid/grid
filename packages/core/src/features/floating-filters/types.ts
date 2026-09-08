import type { ColumnFilterType, FloatingFilterSelectOption } from '../../types';

export type {
  FloatingFilterColumnOptions,
  FloatingFilterControl,
  FloatingFilterSelectOption,
  FloatingFiltersOptions,
} from '../../types';

export type ResolvedFloatingFilterControl =
  | "text"
  | "numberRange"
  | "dateRange"
  | "dateButton"
  | "booleanSelect"
  | "select";

export interface NormalizedFloatingFilterConfig {
  field: string;
  type: ColumnFilterType;
  control: ResolvedFloatingFilterControl;
  debounceMs: number;
  menuButton: boolean;
  disabled: boolean;
  placeholder: string | undefined;
  selectOptions: ReadonlyArray<FloatingFilterSelectOption> | undefined;
}
