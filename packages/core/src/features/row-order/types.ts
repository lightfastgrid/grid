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
  /**
   * Controller-mapped origin indexes. Not passed into `commitRowOrder`.
   * Managed public `fromIndex` / `fromIndices` / `toIndex` are recomputed
   * by GridState from the committed source rows.
   */
  fromIndex: number;
  fromIndices: number[];
  /**
   * Only this field drives the managed Grid commit.
   * Unmanaged: current displayed-subset coordinates, used with lazy getters.
   * Managed: source-row insertion mapped through DisplayRowReader.
   */
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
