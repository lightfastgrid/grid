import {
  baseColumnDragWidth,
  clampColumnWidth,
  isColumnResizable,
} from "../../internal/columnSizing";
import type { ColumnWidthOverride } from "../../internal/layoutTypes";
import type { DisplayRowReader } from "../../rendering/rowViewAccess";
import type { ColumnDef } from "../../types";

import { measureColumnAutoFitWidth } from "./measureColumnAutoFit";

export interface ColumnResizeCallbacks {
  getColumns: () => ColumnDef[];
  getDisplayRows: () => DisplayRowReader;
  getVisibleRowStart: () => number;
  getPoolSize: () => number;
  requestSync: () => void;
  commitResize: (field: string, width: number) => void;
}

type ActiveDrag = {
  pointerId: number;
  field: string;
  col: ColumnDef;
  startW: number;
  onMove: (ev: PointerEvent) => void;
  onUp: (ev: PointerEvent) => void;
  onCancel: (ev: PointerEvent) => void;
};

export class ColumnResizeController {
  private liveField: string | null = null;
  private liveWidth: number | null = null;
  private dragRafId = 0;
  private latestClientX: number | null = null;
  private layoutKey: string | null = null;

  private root: HTMLElement | null = null;
  private activeDrag: ActiveDrag | null = null;
  private readonly cb: ColumnResizeCallbacks;
  private lastCommandColumns: readonly ColumnDef[] | null = null;
  private commandColumnsByField = new Map<string, ColumnDef>();
  private pendingCommandField: string | null = null;
  private pendingCommandWidth = 0;
  private commandCommitScheduled = false;

  constructor(callbacks: ColumnResizeCallbacks) {
    this.cb = callbacks;
  }

  /** Wire pointer + dblclick listeners on the grid root (capture phase). */
  attach(root: HTMLElement): void {
    this.root = root;
    root.addEventListener("pointerdown", this.onPointerDown, true);
    root.addEventListener("dblclick", this.onDblClick, true);
  }

  /** Remove listeners, cancel drag, drop document pointer capture without commit. */
  detach(): void {
    this.abortActiveDrag();
    if (this.root) {
      this.root.removeEventListener("pointerdown", this.onPointerDown, true);
      this.root.removeEventListener("dblclick", this.onDblClick, true);
      this.root = null;
    }
    this.liveField = null;
    this.liveWidth = null;
    this.latestClientX = null;
    this.layoutKey = null;
    this.lastCommandColumns = null;
    this.commandColumnsByField.clear();
    this.pendingCommandField = null;
    this.pendingCommandWidth = 0;
    this.commandCommitScheduled = false;
  }

  syncCommandColumns(columns: readonly ColumnDef[]): void {
    if (columns === this.lastCommandColumns) return;
    const next = new Map<string, ColumnDef>();
    for (const column of columns) next.set(column.field, column);
    this.lastCommandColumns = columns;
    this.commandColumnsByField = next;
  }

  resizeColumnFromCommand(field: string, deltaPx: number): boolean {
    const column = this.commandColumnsByField.get(field);
    if (
      column === undefined ||
      !isColumnResizable(column) ||
      !Number.isFinite(deltaPx)
    ) {
      return false;
    }
    const base = this.pendingCommandField === field
      ? this.pendingCommandWidth
      : baseColumnDragWidth(column);
    const width = clampColumnWidth(column, base + deltaPx);
    if (width === base) return false;
    this.pendingCommandField = field;
    this.pendingCommandWidth = width;
    if (!this.commandCommitScheduled) {
      this.commandCommitScheduled = true;
      queueMicrotask(this.flushCommandCommit);
    }
    return true;
  }

  private readonly flushCommandCommit = (): void => {
    this.commandCommitScheduled = false;
    const field = this.pendingCommandField;
    const width = this.pendingCommandWidth;
    this.pendingCommandField = null;
    this.pendingCommandWidth = 0;
    if (field !== null) this.cb.commitResize(field, width);
  };

  /** Current live-resize override (null when idle). */
  getLiveOverride(): ColumnWidthOverride | null {
    if (this.liveField !== null && this.liveWidth !== null) {
      return { field: this.liveField, width: this.liveWidth };
    }
    return null;
  }

  /** Layout-only optimization: true when row/col window hasn't changed since last resize frame. */
  isLayoutOnly(key: string): boolean {
    return this.layoutKey === key;
  }

  updateLayoutKey(key: string): void {
    this.layoutKey = key;
  }

  resetLayoutKey(): void {
    this.layoutKey = null;
  }

  private abortActiveDrag(): void {
    if (!this.activeDrag) return;
    const { onMove, onUp, onCancel } = this.activeDrag;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    if (this.dragRafId !== 0) {
      cancelAnimationFrame(this.dragRafId);
      this.dragRafId = 0;
    }
    this.latestClientX = null;
    this.liveField = null;
    this.liveWidth = null;
    this.layoutKey = null;
    this.activeDrag = null;
  }

  private endPointerDrag(ev: PointerEvent, commit: boolean): void {
    if (!this.activeDrag || ev.pointerId !== this.activeDrag.pointerId) {
      return;
    }
    const { field, col, startW, onMove, onUp, onCancel } = this.activeDrag;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    if (this.dragRafId !== 0) {
      cancelAnimationFrame(this.dragRafId);
      this.dragRafId = 0;
    }
    this.latestClientX = null;

    const finalW = clampColumnWidth(col, this.liveWidth ?? startW);
    this.liveField = null;
    this.liveWidth = null;
    this.layoutKey = null;
    this.activeDrag = null;

    if (commit) {
      this.cb.commitResize(field, finalW);
    }
  }

  // ── private handlers ──────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.liveField !== null || this.activeDrag) return;
    const t = e.target as HTMLElement | null;
    const handle = t?.closest(".lfg-resize-handle") as HTMLElement | null;
    if (!handle || handle.style.display === "none") return;
    const field = handle.getAttribute("data-col-id");
    if (!field) return;
    const col = this.cb.getColumns().find((c) => c.field === field);
    if (!col || !isColumnResizable(col)) return;

    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startW = baseColumnDragWidth(col);
    const pointerId = e.pointerId;
    const deltaSign: 1 | -1 = col.pinned === "right" ? -1 : 1;

    this.layoutKey = null;
    this.liveField = field;
    this.liveWidth = clampColumnWidth(col, startW);
    this.cb.requestSync();

    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      this.latestClientX = ev.clientX;
      if (this.dragRafId !== 0) return;
      this.dragRafId = requestAnimationFrame(() => {
        this.dragRafId = 0;
        const x = this.latestClientX ?? startX;
        const dx = x - startX;
        const next = clampColumnWidth(col, startW + deltaSign * dx);
        this.liveWidth = next;
        this.cb.requestSync();
      });
    };

    const onUp = (ev: PointerEvent): void => {
      this.endPointerDrag(ev, true);
    };

    const onCancel = (ev: PointerEvent): void => {
      this.endPointerDrag(ev, false);
    };

    this.activeDrag = {
      pointerId,
      field,
      col,
      startW,
      onMove,
      onUp,
      onCancel,
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  };

  private readonly onDblClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement | null;
    const handle = t?.closest(".lfg-resize-handle") as HTMLElement | null;
    if (!handle || handle.style.display === "none") return;
    const field = handle.getAttribute("data-col-id");
    if (!field) return;
    const col = this.cb.getColumns().find((c) => c.field === field);
    if (!col || !isColumnResizable(col)) return;

    e.preventDefault();
    e.stopPropagation();

    const w = measureColumnAutoFitWidth(
      col,
      field,
      this.cb.getVisibleRowStart(),
      this.cb.getPoolSize(),
      this.cb.getDisplayRows(),
    );
    this.cb.commitResize(field, w);
  };
}
