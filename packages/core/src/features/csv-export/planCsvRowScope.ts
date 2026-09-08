/**
 * CSV Export V1 - pure row scope planner (Stage 1).
 *
 * Resolves a `CsvRowScope` into an ordered stream of SOURCE INDEXES. No
 * `RowData` object is ever copied; the planner reads only `getSourceIndex`
 * (never `getRow`) plus the O(1) rowId resolver and pin membership view.
 *
 * The planner exposes a bounded, cursor-driven `step` contract so Stage 3 can
 * drive it cooperatively. `step(out, maxWorkUnits)` budgets INSPECTED WORK, not
 * emitted rows: inspecting one display index, building one row-id lookup entry,
 * checking one requested id for duplicates, and emitting one buffered pinned
 * index each cost one unit. A sparse selection with one match at row 99,999
 * therefore never inspects 100k rows in `step(out, 1)`.
 *
 * Construction is O(1): nothing iterates rows, ids, or pin state. Explicit-id
 * dedup and lookup build run inside `step`. This module schedules nothing.
 *
 * Source of truth: CSV_EXPORT_V1_ARCHITECTURE.md, Sections 9, 15, 17, 20, 26.
 */

import type { RowView } from "../../row-model/rowOrder";

import {
  CsvExportDuplicateRowError,
  CsvExportUnknownRowError,
} from "./csvExportErrors";
import type { CsvExportSnapshot } from "./csvExportSnapshot";
import type { CsvRowScope } from "./csvExportTypes";

/**
 * Bounded, cursor-driven source-index stream. `step` appends source indexes to
 * `out`, consuming at most `maxWorkUnits` units of inspected work, and returns
 * `true` when the plan is exhausted. The plan owns its cursor; call `step`
 * repeatedly until it returns `true`.
 */
export interface CsvRowPlan {
  /**
   * Output row count when derivable in O(1) (source order, explicit ids, empty
   * result, or a lossless display reorder). `undefined` when computing it would
   * require a scan (filtered selection, or a pin lane omitted).
   */
  readonly knownRowCount: number | undefined;
  /** Consume up to `maxWorkUnits` work units; append emitted source indexes. */
  step(out: number[], maxWorkUnits: number): boolean;
}

/** Predicate over a row id; `undefined` means "every row passes". */
type RowIdFilter = ((rowId: string) => boolean) | undefined;

/**
 * Normalize an internal budget so every active call makes deterministic
 * progress: zero, negative, NaN, and infinity collapse to the minimum of 1;
 * fractional positives floor to an integer. Never stalls, never unbounded.
 */
function normalizeBudget(maxWorkUnits: number): number {
  const floored = Math.floor(maxWorkUnits);
  if (!Number.isFinite(floored) || floored < 1) return 1;
  return floored;
}

const EMPTY_ROW_PLAN: CsvRowPlan = {
  knownRowCount: 0,
  step(): boolean {
    return true;
  },
};

class AllRowsPlan implements CsvRowPlan {
  readonly knownRowCount: number;
  private cursor = 0;

  constructor(private readonly total: number) {
    this.knownRowCount = total;
  }

  step(out: number[], maxWorkUnits: number): boolean {
    let budget = normalizeBudget(maxWorkUnits);
    while (this.cursor < this.total && budget > 0) {
      out.push(this.cursor++);
      budget--;
    }
    return this.cursor >= this.total;
  }
}

type DisplayPhase = "collect-top" | "emit-top" | "scan-center" | "emit-bottom";

class DisplayRowsPlan implements CsvRowPlan {
  readonly knownRowCount: number | undefined;
  private readonly phases: readonly DisplayPhase[];
  private readonly hasPins: boolean;
  private readonly collectBottom: boolean;
  private readonly topBuffer: number[] = [];
  private readonly bottomBuffer: number[] = [];
  private phaseIndex = 0;
  private cursor = 0;

  constructor(
    private readonly view: RowView,
    private readonly snapshot: CsvExportSnapshot,
    includeTop: boolean,
    includeBottom: boolean,
    private readonly filter: RowIdFilter,
  ) {
    // O(1): only reads the pin snapshot size, never iterates it.
    this.hasPins = snapshot.rowPinState.size > 0;
    this.collectBottom = this.hasPins && includeBottom;

    const phases: DisplayPhase[] = [];
    if (!this.hasPins) {
      phases.push("scan-center");
    } else {
      if (includeTop) {
        phases.push("collect-top", "emit-top");
      }
      phases.push("scan-center");
      if (includeBottom) phases.push("emit-bottom");
    }
    this.phases = phases;

    // Lossless reorder (all rows emitted, just repartitioned) only with no
    // filter and no omitted lane; otherwise the count needs a scan.
    const allEmitted =
      filter === undefined && (!this.hasPins || (includeTop && includeBottom));
    this.knownRowCount = allEmitted ? view.rowCount : undefined;
  }

  step(out: number[], maxWorkUnits: number): boolean {
    let budget = normalizeBudget(maxWorkUnits);
    const rowCount = this.view.rowCount;

    while (budget > 0 && this.phaseIndex < this.phases.length) {
      const phase = this.phases[this.phaseIndex]!;

      if (phase === "emit-top" || phase === "emit-bottom") {
        const buffer = phase === "emit-top" ? this.topBuffer : this.bottomBuffer;
        while (this.cursor < buffer.length && budget > 0) {
          out.push(buffer[this.cursor++]!);
          budget--; // emitting one buffered pinned index
        }
        if (this.cursor >= buffer.length) {
          this.phaseIndex++;
          this.cursor = 0;
        } else {
          break;
        }
        continue;
      }

      // Scan phase: "collect-top" or "scan-center".
      while (this.cursor < rowCount && budget > 0) {
        const i = this.cursor++;
        budget--; // inspecting one display/source index
        const sourceIndex = this.view.getSourceIndex(i);
        if (sourceIndex < 0) continue;
        const rowId = this.snapshot.rowIds.getRowIdBySourceIndex(sourceIndex);
        if (this.filter !== undefined && !this.filter(rowId)) continue;
        const pin = this.hasPins ? this.snapshot.rowPinState.get(rowId) : undefined;

        if (phase === "collect-top") {
          if (pin === "top") this.topBuffer.push(sourceIndex);
          continue;
        }
        // scan-center
        if (pin === "top") continue; // omitted, or already buffered in collect-top
        if (pin === "bottom") {
          if (this.collectBottom) this.bottomBuffer.push(sourceIndex);
          continue;
        }
        out.push(sourceIndex); // unpinned center
      }
      if (this.cursor >= rowCount) {
        this.phaseIndex++;
        this.cursor = 0;
      } else {
        break;
      }
    }
    return this.phaseIndex >= this.phases.length;
  }
}

type IdsPhase = "dedup" | "build" | "emit";

class IdsRowsPlan implements CsvRowPlan {
  readonly knownRowCount: number;
  private readonly phases: readonly IdsPhase[] = ["dedup", "build", "emit"];
  /** Deduplicated requested ids (built in the `dedup` phase). */
  private readonly seen = new Set<string>();
  /** Only requested ids that resolved. Retained memory is O(requested ids). */
  private resolvedById: Map<string, number> | null = null;
  private phaseIndex = 0;
  private cursor = 0;

  constructor(
    private readonly snapshot: CsvExportSnapshot,
    private readonly ids: readonly string[],
  ) {
    // O(1): no id iteration, no row-id resolution at construction.
    this.knownRowCount = ids.length;
  }

  step(out: number[], maxWorkUnits: number): boolean {
    let budget = normalizeBudget(maxWorkUnits);

    while (budget > 0 && this.phaseIndex < this.phases.length) {
      const phase = this.phases[this.phaseIndex]!;

      if (phase === "dedup") {
        while (this.cursor < this.ids.length && budget > 0) {
          const id = this.ids[this.cursor++]!;
          budget--; // checking one requested id for duplicates
          if (this.seen.has(id)) throw new CsvExportDuplicateRowError(id);
          this.seen.add(id);
        }
        if (this.cursor >= this.ids.length) {
          this.phaseIndex++;
          this.cursor = 0;
        } else {
          break;
        }
        continue;
      }

      if (phase === "build") {
        if (this.resolvedById === null) this.resolvedById = new Map<string, number>();
        const total = this.snapshot.sourceRows.length;
        // Retain only requested matches; stop early once every requested
        // unique id has resolved. Lookup memory stays O(requested ids).
        while (
          this.cursor < total &&
          this.resolvedById.size < this.seen.size &&
          budget > 0
        ) {
          const rowId = this.snapshot.rowIds.getRowIdBySourceIndex(this.cursor);
          if (this.seen.has(rowId) && !this.resolvedById.has(rowId)) {
            this.resolvedById.set(rowId, this.cursor); // first match wins
          }
          this.cursor++;
          budget--; // scanning one source row for id resolution
        }
        if (this.cursor >= total || this.resolvedById.size >= this.seen.size) {
          this.phaseIndex++;
          this.cursor = 0;
        } else {
          break;
        }
        continue;
      }

      // emit
      const resolved = this.resolvedById ?? new Map<string, number>();
      while (this.cursor < this.ids.length && budget > 0) {
        const id = this.ids[this.cursor++]!;
        budget--; // resolving/emitting one requested id
        const sourceIndex = resolved.get(id);
        if (sourceIndex === undefined) throw new CsvExportUnknownRowError(id);
        out.push(sourceIndex);
      }
      if (this.cursor >= this.ids.length) {
        this.phaseIndex++;
        this.cursor = 0;
      } else {
        break;
      }
    }
    return this.phaseIndex >= this.phases.length;
  }
}

/**
 * Build a bounded {@link CsvRowPlan} for a resolved row scope.
 *
 * - `filteredAndSorted`: `fullView`, pin-composed (top, center, bottom).
 * - `currentPage`: `pageView`, pin-composed.
 * - `all`: source order, pins ignored.
 * - `selected`: `fullView`, filtered by selected-row membership, pin-composed.
 * - `ids`: caller id order, pins ignored.
 *
 * Pinned lanes compose as top -> center -> bottom for display-derived scopes;
 * `includePinnedTopRows` / `includePinnedBottomRows` omit those lanes entirely.
 * Empty scopes (`selected` with no selection, `ids: []`) complete without any
 * row inspection.
 */
export function planCsvRowScope(
  snapshot: CsvExportSnapshot,
  scope: CsvRowScope,
  options: {
    includePinnedTopRows: boolean;
    includePinnedBottomRows: boolean;
  },
): CsvRowPlan {
  switch (scope.mode) {
    case "all":
      return new AllRowsPlan(snapshot.sourceRows.length);
    case "ids":
      return scope.ids.length === 0
        ? EMPTY_ROW_PLAN
        : new IdsRowsPlan(snapshot, scope.ids);
    case "currentPage":
      return new DisplayRowsPlan(
        snapshot.pageView,
        snapshot,
        options.includePinnedTopRows,
        options.includePinnedBottomRows,
        undefined,
      );
    case "filteredAndSorted":
      return new DisplayRowsPlan(
        snapshot.fullView,
        snapshot,
        options.includePinnedTopRows,
        options.includePinnedBottomRows,
        undefined,
      );
    case "selected":
      return snapshot.selectedRowIds.definitelyEmpty
        ? EMPTY_ROW_PLAN
        : new DisplayRowsPlan(
            snapshot.fullView,
            snapshot,
            options.includePinnedTopRows,
            options.includePinnedBottomRows,
            (rowId) => snapshot.selectedRowIds.has(rowId),
          );
  }
}
