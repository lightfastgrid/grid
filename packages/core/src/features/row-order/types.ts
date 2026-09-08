import type {
  LightFastGridRowOrderChangedEvent,
  RowData,
  RowDragNormalizedConfig,
  RowOrderChangeSource,
} from "../../types";
import type {
  DomGridFeature,
  RowOrderCapability,
} from "../types";

import type { RowOrderStore } from "./RowOrderStore";

export interface RowOrderMoveRequest {
  rowId: string;
  rowIds: string[];
  fromIndex: number;
  fromIndices: number[];
  /** Original insertion slot from pointer position (before any adjustment). */
  insertionIndex: number;
  source: RowOrderChangeSource;
}

export interface RowOrderFeatureOptions {
  getRowDragConfig: () => RowDragNormalizedConfig;
  getRows: () => RowData[];
  resolveRowId: (row: RowData, index: number) => string;
  isReorderBlocked?: () => boolean;
  commitRowOrder?: (
    rowId: string,
    rowIds: string[],
    insertionIndex: number,
    source: RowOrderChangeSource,
  ) => LightFastGridRowOrderChangedEvent | null;
  onRowOrderChanged?: (e: LightFastGridRowOrderChangedEvent) => void;
}

export interface RowOrderFeature
  extends DomGridFeature,
    RowOrderCapability {
  readonly rowOrderStore: RowOrderStore;
}
