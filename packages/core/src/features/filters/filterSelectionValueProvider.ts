import type { ColumnDef, FilterModel, RowData } from "../../types";

import { compileFilterModel } from "./compileFilterPredicate";
import { createFilterDisplayValueAccessor } from "./filterDisplayValueAccess";
import type { GetSelectionValuesArgs } from "./filterMenuForm";
import type { FilterSelectionValueResult } from "./filterSelectionValues";
import { collectFilterSelectionValues } from "./filterSelectionValues";
import { defaultGetCellValue } from "./filterValueAccess";
import type { NormalizedColumnFilterConfig } from "./types";

export interface FilterSelectionValueProviderDeps {
  getRows: () => RowData[];
  getColumns: () => readonly ColumnDef[];
  getFilterConfig: (field: string) => NormalizedColumnFilterConfig | null;
  getFilterModel?: () => FilterModel;
  getColumnFilterConfigs?: () => ReadonlyMap<string, NormalizedColumnFilterConfig>;
}

const EMPTY_RESULT: FilterSelectionValueResult = {
  values: [],
  totalDistinct: 0,
  scannedRowCount: 0,
  truncated: false,
};

function buildEffectiveFilterModel(
  filterModel: FilterModel,
  excludeField: string,
): FilterModel | null {
  const keys = Object.keys(filterModel);
  if (keys.length === 0) return null;
  if (keys.length === 1 && keys[0] === excludeField) return null;

  let result: FilterModel | undefined;
  for (const key of keys) {
    if (key === excludeField) continue;
    if (!result) result = {};
    result[key] = filterModel[key]!;
  }
  return result ?? null;
}

function computeCandidateIndexes(
  rows: readonly RowData[],
  effectiveModel: FilterModel,
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>,
  getCellValue = defaultGetCellValue,
): number[] {
  const predicate = compileFilterModel({
    filterModel: effectiveModel,
    columnsByField,
    getCellValue,
  });
  if (!predicate) return [];

  const indexes: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i]!, i)) indexes.push(i);
  }
  return indexes;
}

export function createFilterSelectionValueProvider(
  deps: FilterSelectionValueProviderDeps,
): (args: GetSelectionValuesArgs) => FilterSelectionValueResult {
  let cachedRows: RowData[] | null = null;
  let cachedConfig: NormalizedColumnFilterConfig | null = null;
  let cachedField: string | null = null;
  let cachedSearchText: string | undefined = undefined;
  let cachedMaxValues: number | undefined = undefined;
  let cachedFilterModel: FilterModel | null = null;
  let cachedColumns: readonly ColumnDef[] | null = null;
  let cachedResult: FilterSelectionValueResult | null = null;

  return (args: GetSelectionValuesArgs): FilterSelectionValueResult => {
    const config = deps.getFilterConfig(args.field);
    if (!config) return EMPTY_RESULT;

    const rows = deps.getRows();
    const columns = deps.getColumns();
    const filterModel = deps.getFilterModel?.() ?? null;
    const columnsByField = deps.getColumnFilterConfigs?.();

    if (
      cachedResult !== null &&
      rows === cachedRows &&
      columns === cachedColumns &&
      config === cachedConfig &&
      args.field === cachedField &&
      args.searchText === cachedSearchText &&
      args.maxValues === cachedMaxValues &&
      filterModel === cachedFilterModel
    ) {
      return cachedResult;
    }

    let sourceIndexes: number[] | undefined;
    const accessorFields = filterModel
      ? [args.field, ...Object.keys(filterModel)]
      : [args.field];
    const getCellValue = columnsByField
      ? createFilterDisplayValueAccessor({
          columns,
          columnsByField,
          fields: accessorFields,
        })
      : undefined;
    const effectiveGetCellValue = getCellValue ?? defaultGetCellValue;

    if (filterModel) {
      const effectiveModel = buildEffectiveFilterModel(filterModel, args.field);
      if (effectiveModel) {
        if (columnsByField) {
          sourceIndexes = computeCandidateIndexes(
            rows,
            effectiveModel,
            columnsByField,
            effectiveGetCellValue,
          );
        }
      }
    }

    cachedRows = rows;
    cachedColumns = columns;
    cachedConfig = config;
    cachedField = args.field;
    cachedSearchText = args.searchText;
    cachedMaxValues = args.maxValues;
    cachedFilterModel = filterModel;
    cachedResult = collectFilterSelectionValues({
      rows,
      field: args.field,
      config,
      getCellValue: effectiveGetCellValue,
      searchText: args.searchText,
      maxValues: args.maxValues,
      sourceIndexes,
    });

    return cachedResult;
  };
}
