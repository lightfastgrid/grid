import type {
  ColumnDef,
  ColumnSelectionConfig,
  SortChangeSource,
  SortModel,
} from "../../types";
import type { DomGridFeature, SortCapability } from "../types";

export interface SortFeatureOptions {
  getColumns: () => ColumnDef[];
  getColumnSelectionConfig: () => ColumnSelectionConfig;
  getSortModel: () => SortModel;
  isSortPending: () => boolean;
  toggleColumnSort: (field: string, opts: { multi: boolean; source: SortChangeSource }) => void;
}

export interface SortFeature extends DomGridFeature, SortCapability {
  name: "sort";
}
