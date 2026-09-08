import type { ColumnDef, ColumnGroupHeadersSnapshot } from "../../../types";

export type KeyboardColumnPin = "left" | "center" | "right";

export interface KeyboardColumnTarget {
  readonly field: string;
  readonly ordinal: number;
  readonly pin: KeyboardColumnPin;
  readonly column: ColumnDef;
}

export interface KeyboardGroupTargetSpan {
  readonly level: number;
  readonly groupId: string;
  readonly headerName: string;
  readonly startColumnOrdinal: number;
  readonly endColumnOrdinal: number;
}

export interface KeyboardGroupTargetRow {
  readonly level: number;
  readonly spans: readonly KeyboardGroupTargetSpan[];
}

export interface KeyboardNavigationPlan {
  readonly columns: readonly KeyboardColumnTarget[];
  readonly columnOrdinalByField: ReadonlyMap<string, number>;
  readonly firstDataColumnOrdinal: number;
  readonly lastDataColumnOrdinal: number;
  readonly previousDataColumnOrdinal: readonly number[];
  readonly nextDataColumnOrdinal: readonly number[];
  readonly groupRows: readonly KeyboardGroupTargetRow[];
  readonly hasFloatingFilterRow: boolean;
  readonly topologyRevision: number;
}

export interface KeyboardTopologyPlannerInput {
  readonly columns: readonly ColumnDef[];
  readonly columnGroupHeaders?: ColumnGroupHeadersSnapshot | null;
  readonly hasFloatingFilterRow: boolean;
  readonly topologyRevision: number;
}
