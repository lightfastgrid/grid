import type { ColumnOrderConfig, LightFastGridColumnOrderChangedEvent } from "../../types";
import type {
  ColumnOrderCapability,
  ColumnTransformCapability,
  DomGridFeature,
} from "../types";

import type { ColumnOrderStore } from "./ColumnOrderStore";

export interface ColumnOrderFeatureOptions {
  getColumnOrderConfig: () => ColumnOrderConfig;
  onColumnOrderChanged?: (e: LightFastGridColumnOrderChangedEvent) => void;
}

export interface ColumnOrderFeature
  extends DomGridFeature,
    ColumnTransformCapability,
    ColumnOrderCapability {
  readonly columnOrderStore: ColumnOrderStore;
}
