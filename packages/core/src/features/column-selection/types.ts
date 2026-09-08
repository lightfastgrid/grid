import type {
  ColumnSelectionConfig,
  LightFastGridColumnSelectionChangedEvent,
} from "../../types";

export interface ColumnSelectionFeatureOptions {
  getColumnSelectionConfig: () => ColumnSelectionConfig;
  onColumnSelectionChanged?: (
    e: LightFastGridColumnSelectionChangedEvent,
  ) => void;
}
