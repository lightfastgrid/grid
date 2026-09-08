import type {
  ColumnDef,
  ColumnGroupHeadersSnapshot,
  ColumnGroupPathMeta,
  ColumnGroupPathSegment,
} from "../../../types";

import type {
  KeyboardColumnPin,
  KeyboardColumnTarget,
  KeyboardGroupTargetRow,
  KeyboardGroupTargetSpan,
  KeyboardNavigationPlan,
  KeyboardTopologyPlannerInput,
} from "./navigationPlan";

function pinLane(column: ColumnDef): KeyboardColumnPin {
  if (column.pinned === "left") return "left";
  if (column.pinned === "right") return "right";
  return "center";
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid keyboard topology revision: ${String(value)}`);
  }
}

function orderVisibleColumns(columns: readonly ColumnDef[]): ColumnDef[] {
  const left: ColumnDef[] = [];
  const center: ColumnDef[] = [];
  const right: ColumnDef[] = [];
  for (const column of columns) {
    if (column.visible === false) continue;
    const lane = pinLane(column);
    if (lane === "left") left.push(column);
    else if (lane === "right") right.push(column);
    else center.push(column);
  }
  return left.concat(center, right);
}

function buildColumnTargets(ordered: readonly ColumnDef[]): {
  columns: KeyboardColumnTarget[];
  ordinalByField: Map<string, number>;
} {
  const columns: KeyboardColumnTarget[] = [];
  const ordinalByField = new Map<string, number>();
  for (let ordinal = 0; ordinal < ordered.length; ordinal++) {
    const column = ordered[ordinal]!;
    if (ordinalByField.has(column.field)) {
      throw new Error(`Duplicate visible keyboard field: ${column.field}`);
    }
    ordinalByField.set(column.field, ordinal);
    columns.push(Object.freeze({
      field: column.field,
      ordinal,
      pin: pinLane(column),
      column,
    }));
  }
  return { columns, ordinalByField };
}

function buildDataColumnLinks(columns: readonly KeyboardColumnTarget[]): {
  first: number;
  last: number;
  previous: number[];
  next: number[];
} {
  const previous = new Array<number>(columns.length);
  const next = new Array<number>(columns.length);
  let first = -1;
  let last = -1;
  let dataOrdinal = -1;
  for (let ordinal = 0; ordinal < columns.length; ordinal++) {
    previous[ordinal] = dataOrdinal;
    if (columns[ordinal]!.column.internal === undefined) {
      if (first < 0) first = ordinal;
      last = ordinal;
      dataOrdinal = ordinal;
    }
  }
  dataOrdinal = -1;
  for (let ordinal = columns.length - 1; ordinal >= 0; ordinal--) {
    next[ordinal] = dataOrdinal;
    if (columns[ordinal]!.column.internal === undefined) dataOrdinal = ordinal;
  }
  return { first, last, previous, next };
}

function pathAt(
  byField: Readonly<Record<string, ColumnGroupPathMeta>>,
  field: string,
): readonly ColumnGroupPathSegment[] | undefined {
  return byField[field]?.path;
}

function segmentAt(
  path: readonly ColumnGroupPathSegment[] | undefined,
  level: number,
): ColumnGroupPathSegment | undefined {
  return path === undefined ? undefined : path[level];
}

function effectiveDepth(
  columns: readonly KeyboardColumnTarget[],
  snapshot: ColumnGroupHeadersSnapshot,
): number {
  if (!Number.isSafeInteger(snapshot.depth) || snapshot.depth < 0) {
    throw new Error(`Invalid keyboard group depth: ${String(snapshot.depth)}`);
  }
  let visibleDepth = 0;
  for (const target of columns) {
    const length = pathAt(snapshot.byField, target.field)?.length ?? 0;
    if (length > visibleDepth) visibleDepth = length;
  }
  return Math.min(snapshot.depth, visibleDepth);
}

function buildGroupRow(
  level: number,
  columns: readonly KeyboardColumnTarget[],
  byField: Readonly<Record<string, ColumnGroupPathMeta>>,
): KeyboardGroupTargetRow {
  const spans: KeyboardGroupTargetSpan[] = [];
  let openId: string | null = null;
  let openPin: KeyboardColumnPin | null = null;
  let openHeaderName = "";
  let openStart = -1;

  const flush = (end: number): void => {
    if (openId === null) return;
    spans.push(Object.freeze({
      level,
      groupId: openId,
      headerName: openHeaderName,
      startColumnOrdinal: openStart,
      endColumnOrdinal: end,
    }));
    openId = null;
    openPin = null;
    openHeaderName = "";
    openStart = -1;
  };

  for (let ordinal = 0; ordinal < columns.length; ordinal++) {
    const column = columns[ordinal]!;
    const segment = segmentAt(pathAt(byField, column.field), level);
    const id = segment?.id ?? null;
    if (id !== null && id === openId && column.pin === openPin) continue;
    flush(ordinal - 1);
    if (id === null) continue;
    openId = id;
    openPin = column.pin;
    openHeaderName = segment!.headerName;
    openStart = ordinal;
  }
  flush(columns.length - 1);
  return Object.freeze({ level, spans: Object.freeze(spans) });
}

function buildGroupRows(
  columns: readonly KeyboardColumnTarget[],
  snapshot: ColumnGroupHeadersSnapshot | null | undefined,
): KeyboardGroupTargetRow[] {
  if (snapshot === null || snapshot === undefined || columns.length === 0) {
    return [];
  }
  const depth = effectiveDepth(columns, snapshot);
  const rows: KeyboardGroupTargetRow[] = [];
  for (let level = 0; level < depth; level++) {
    rows.push(buildGroupRow(level, columns, snapshot.byField));
  }
  return rows;
}

/** Structural-only O(V * H + G) immutable plan construction. */
export function planKeyboardNavigationTopology(
  input: KeyboardTopologyPlannerInput,
): KeyboardNavigationPlan {
  assertRevision(input.topologyRevision);
  const ordered = orderVisibleColumns(input.columns);
  const { columns, ordinalByField } = buildColumnTargets(ordered);
  const links = buildDataColumnLinks(columns);
  const groupRows = buildGroupRows(columns, input.columnGroupHeaders);
  return Object.freeze({
    columns: Object.freeze(columns),
    columnOrdinalByField: ordinalByField,
    firstDataColumnOrdinal: links.first,
    lastDataColumnOrdinal: links.last,
    previousDataColumnOrdinal: Object.freeze(links.previous),
    nextDataColumnOrdinal: Object.freeze(links.next),
    groupRows: Object.freeze(groupRows),
    hasFloatingFilterRow: input.hasFloatingFilterRow,
    topologyRevision: input.topologyRevision,
  });
}
