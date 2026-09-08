import type {
  RowSelectionConfig,
  SelectionChange,
  SelectionChangeSource,
} from "../../types";
import type {
  DomGridFeature,
  SelectionCapability,
} from "../types";

export interface SelectionFeature
  extends DomGridFeature,
    SelectionCapability {}

export interface SelectionFeatureOptions {
  getConfig: () => RowSelectionConfig;
  onSelectionChanged?: (
    change: SelectionChange,
    source: SelectionChangeSource,
  ) => void;
}
