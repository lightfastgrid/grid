import type { GetCellValue } from "../../../features/filters/filterValueAccess";
import type { NormalizedColumnFilterConfig } from "../../../features/filters/types";
import type { FilterModel, RowData } from "../../../types";

export interface FilterOperationInput {
  rows: RowData[];
  filterModel: FilterModel;
  columnsByField: ReadonlyMap<string, NormalizedColumnFilterConfig>;
  getCellValue?: GetCellValue;
  sourceIndexes?: readonly number[] | Uint32Array;
}
