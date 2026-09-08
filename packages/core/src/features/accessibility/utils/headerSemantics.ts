import { composeAccessibleNameWithVisibleText } from "../../../internal/accessibleName";
import {
  COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE,
  COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE,
  COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
  COLUMN_GROUP_HEADER_ROW_SELECTOR,
  COLUMN_GROUP_HEADER_SPAN_SELECTOR,
  COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE,
} from "../../../internal/columnGroupHeaderDomMetadata";
import {
  FLOATING_FILTER_HEADER_ROW_SELECTOR,
  HEADER_ADDON_CELL_SELECTOR,
} from "../../../internal/headerAddonDomMetadata";
import { isInternalColumn } from "../../../internal/internalColumns";
import { CSS as LFG_CSS } from "../../../rendering/const/css-classes";
import type { ColumnDef, SortDirection, SortModel } from "../../../types";
import type { DomGridFeatureContext, HeaderLaneRef } from "../../types";
import {
  ACCESSIBILITY_DESCRIPTION_CLASS,
} from "../accessibilityPersistentDescription";

import {
  applyColumnHeaderElementSemantics,
  applyColumnHeaderSelectionSemantics,
  applyColumnHeaderSortDescriptionSemantics,
  applyColumnHeaderSortSemantics,
  applyFloatingFilterCellElementSemantics,
  applyGroupHeaderElementSemantics,
  applyLogicalHeaderRowElementSemantics,
  applyPhysicalHeaderElementId,
  applyPresentationHeaderRowElementSemantics,
  clearColumnHeaderElementSemantics,
  clearColumnMenuTriggerElementSemantics,
  clearFloatingFilterCellElementSemantics,
  clearGroupHeaderElementSemantics,
  clearHeaderRowElementSemantics,
  type ColumnHeaderElementSemantics,
  syncColumnMenuTriggerElementSemantics,
} from "./headerSemanticsDom";
import { resolveAccessibilityHeaderLanes } from "./rowSemantics";

export function toAriaColIndex(logicalColumnIndex: number): number {
  if (
    !Number.isSafeInteger(logicalColumnIndex) ||
    logicalColumnIndex < 0
  ) {
    throw new Error(
      `Invalid aria-colindex input: logicalColumnIndex=${String(logicalColumnIndex)}`,
    );
  }
  const value = logicalColumnIndex + 1;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Unsafe aria-colindex result: ${String(value)}`);
  }
  return value;
}

export function buildFieldToAriaColIndexMap(
  columns: readonly ColumnDef[],
): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  visitColumnsInVisualLaneOrder(columns, (column, logicalIndex) => {
    const field = column.field;
    if (!map.has(field)) {
      map.set(field, toAriaColIndex(logicalIndex));
    }
  });
  return map;
}

export function visitColumnsInVisualLaneOrder(
  columns: readonly ColumnDef[],
  visit: (column: ColumnDef, logicalIndex: number) => void,
): void {
  let logicalIndex = 0;
  const visitLane = (lane: "left" | "center" | "right"): void => {
    for (const column of columns) {
      const matches =
        lane === "left"
          ? column.pinned === "left"
          : lane === "right"
            ? column.pinned === "right"
            : column.pinned !== "left" && column.pinned !== "right";
      if (!matches) continue;
      visit(column, logicalIndex);
      logicalIndex += 1;
    }
  };
  visitLane("left");
  visitLane("center");
  visitLane("right");
}

export function isColumnHeaderSortable(col: ColumnDef): boolean {
  return !isInternalColumn(col) && col.sortable !== false;
}

export type AriaSortValue = "ascending" | "descending";

export function resolveAriaSortValue(
  col: ColumnDef,
  sortDirection: SortDirection | undefined,
): AriaSortValue | null {
  if (!isColumnHeaderSortable(col)) return null;
  if (sortDirection === "asc") return "ascending";
  if (sortDirection === "desc") return "descending";
  return null;
}

export function buildSortDirectionByField(
  sortModel: SortModel,
): ReadonlyMap<string, SortDirection> {
  const map = new Map<string, SortDirection>();
  for (const item of sortModel) {
    if (!map.has(item.field)) {
      map.set(item.field, item.sort);
    }
  }
  return map;
}

export function resolveColumnHeaderAriaLabel(
  col: ColumnDef,
  visibleLabelText: string,
): string | undefined {
  if (isInternalColumn(col)) return undefined;
  const configured = (col.headerName?.trim() || col.field).trim();
  return configured.length === 0
    ? undefined
    : composeAccessibleNameWithVisibleText(visibleLabelText, configured);
}

interface HeaderLogicalState {
  readonly column: ColumnDef;
  readonly ariaColIndex: number;
}

interface HeaderSortState {
  readonly direction: SortDirection;
  readonly priority: number;
  readonly total: number;
}

interface RetainedSortDescription {
  readonly node: HTMLDivElement;
  readonly id: string;
  retained: boolean;
  text: string;
}

type HeaderLaneKind = "left" | "center" | "right";
type HeaderPhysicalKind = "group" | "leaf" | "filter";

interface RetainedHeaderCellState {
  readonly kind: "leaf";
  readonly element: HTMLElement;
  readonly ownerRow: HTMLElement;
  readonly labelElement: HTMLElement | null;
  menuTrigger: HTMLElement | null;
  filterTrigger: HTMLElement | null;
  resizeHandle: HTMLElement | null;
  readonly widgetElements: HTMLElement[];
  readonly id: string;
  readonly sortDescription: RetainedSortDescription;
  field: string | null;
  ariaColIndex: number;
  active: boolean;
}

interface RetainedGroupHeaderState {
  readonly kind: "group";
  readonly element: HTMLElement;
  readonly ownerRow: HTMLElement;
  readonly id: string;
  startField: string | null;
  endField: string | null;
  leafCount: string | null;
  label: string;
  ariaColIndex: number;
  level: number;
  spanIndex: number;
  active: boolean;
}

interface RetainedFloatingFilterCellState {
  readonly kind: "filter";
  readonly element: HTMLElement;
  readonly ownerRow: HTMLElement;
  readonly id: string;
  filterTrigger: HTMLElement | null;
  readonly widgetElements: HTMLElement[];
  field: string | null;
  ariaColIndex: number;
  active: boolean;
}

type RetainedOwnedHeaderCellState =
  | RetainedHeaderCellState
  | RetainedGroupHeaderState
  | RetainedFloatingFilterCellState;

export type HeaderKeyboardPointerTarget =
  | { readonly kind: "leafHeader"; readonly field: string }
  | { readonly kind: "floatingFilter"; readonly field: string }
  | {
      readonly kind: "groupHeader";
      readonly level: number;
      readonly spanIndex: number;
      readonly anchorField: string;
    };

interface RetainedHeaderLaneRowState {
  readonly element: HTMLElement;
  readonly ownerContainer: HTMLElement;
  readonly childCount: number;
  readonly cells: RetainedOwnedHeaderCellState[];
}

interface RetainedLogicalHeaderRowState {
  readonly ariaRowIndex: number;
  bindingChangesOnSettle: boolean;
  left: RetainedHeaderLaneRowState | null;
  center: RetainedHeaderLaneRowState | null;
  right: RetainedHeaderLaneRowState | null;
  readonly candidateIds: string[];
  readonly acceptedIds: string[];
  acceptedOwns: string | undefined;
}

function parsePositiveSafeInteger(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeSafeInteger(value: string | null): number | null {
  if (value === null || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

let nextHeaderSemanticsInstanceId = 1;

function allocateHeaderSemanticsInstanceId(): number {
  const id = nextHeaderSemanticsInstanceId;
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Accessibility header instance id exhausted");
  }
  nextHeaderSemanticsInstanceId =
    id === Number.MAX_SAFE_INTEGER ? Number.NaN : id + 1;
  return id;
}

function isHeaderCell(element: Element): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.classList.contains(LFG_CSS.HEADER_CELL)
  );
}

function isNativeWidgetControl(element: HTMLElement): boolean {
  return element.tagName === "INPUT" ||
    element.tagName === "SELECT" ||
    element.tagName === "BUTTON";
}

function isDedicatedFilterPopupTrigger(element: HTMLElement): boolean {
  return (
    element.tagName === "BUTTON" &&
    element.getAttribute("aria-haspopup") === "dialog" &&
    !element.classList.contains("lfg-column-menu-trigger") &&
    element.dataset.headerActionId === undefined
  );
}

function visibleLabelText(state: RetainedHeaderCellState): string {
  return state.labelElement?.textContent.trim() ?? "";
}

function headerSemantics(
  logical: HeaderLogicalState,
  state: RetainedHeaderCellState,
  sort: HeaderSortState | undefined,
  primarySortField: string | null,
  columnSelectionEnabled: boolean,
  selected: boolean,
): ColumnHeaderElementSemantics {
  return {
    id: state.id,
    ariaColIndex: logical.ariaColIndex,
    ariaSort:
      logical.column.field === primarySortField
        ? resolveAriaSortValue(logical.column, sort?.direction)
        : null,
    ariaSelected: columnSelectionEnabled ? selected : null,
    ariaLabel: resolveColumnHeaderAriaLabel(
      logical.column,
      visibleLabelText(state),
    ),
  };
}

/**
 * Retained header reconciler.
 *
 * Topology sync performs DOM discovery and rebuilds logical maps. Scroll-settle
 * binding sync only visits retained physical cells and reads their current
 * `data-col-id`, label text, and visibility.
 */
export class HeaderSemanticsReconciler {
  private readonly instanceId = allocateHeaderSemanticsInstanceId();
  private nextPhysicalId = 1;
  private physicalIds = new WeakMap<HTMLElement, string>();
  private sortDescriptions =
    new WeakMap<HTMLElement, RetainedSortDescription>();
  private logicalByField = new Map<string, HeaderLogicalState>();
  private sortByField: ReadonlyMap<string, HeaderSortState> = new Map();
  private lastSortModel: SortModel | undefined;
  private primarySortField: string | null = null;
  private columnSelectionEnabled = false;
  private isColumnSelected: ((field: string) => boolean) | null = null;
  private triggerByField = new Map<string, HTMLElement>();
  private filterTriggerByField = new Map<string, HTMLElement>();
  private resizeHandleByField = new Map<string, HTMLElement>();
  private cells: RetainedHeaderCellState[] = [];
  private groupCells: RetainedGroupHeaderState[] = [];
  private floatingFilterCells: RetainedFloatingFilterCellState[] = [];
  private logicalRows: RetainedLogicalHeaderRowState[] = [];
  private lanes: readonly (HeaderLaneRef | null)[] = [];
  private laneChildCounts: number[] = [];
  private openMenuField: string | null = null;
  private openMenuPopupId: string | null = null;
  private hasFloatingFilterRow = false;
  private leafByField = new Map<string, RetainedHeaderCellState>();
  private floatingFilterByField =
    new Map<string, RetainedFloatingFilterCellState>();
  private groupRowsForKeyboard: RetainedGroupHeaderState[][] = [];
  private pointerStateByElement =
    new WeakMap<HTMLElement, RetainedOwnedHeaderCellState>();

  syncTopology(ctx: DomGridFeatureContext): void {
    const previousCells = this.cells;
    for (const state of previousCells) {
      state.sortDescription.retained = false;
    }
    this.clearRetainedCells(false);
    this.logicalByField = new Map<string, HeaderLogicalState>();
    const columns = ctx.getColumns();
    visitColumnsInVisualLaneOrder(columns, (column, logicalIndex) => {
      if (!this.logicalByField.has(column.field)) {
        this.logicalByField.set(column.field, {
          column,
          ariaColIndex: toAriaColIndex(logicalIndex),
        });
      }
    });

    this.syncSortModel(ctx.getSortModel());
    const columnSelection = ctx.getColumnSelectionConfig?.();
    this.columnSelectionEnabled = columnSelection?.enabled === true;
    this.isColumnSelected = ctx.isColumnSelected ?? null;
    this.triggerByField = new Map<string, HTMLElement>();
    this.filterTriggerByField = new Map<string, HTMLElement>();
    this.resizeHandleByField = new Map<string, HTMLElement>();
    this.pointerStateByElement =
      new WeakMap<HTMLElement, RetainedOwnedHeaderCellState>();
    this.cells = [];
    this.groupCells = [];
    this.floatingFilterCells = [];
    this.lanes = resolveAccessibilityHeaderLanes(ctx);
    this.laneChildCounts = [];
    this.openMenuField = ctx.getOpenColumnMenuField?.() ?? null;
    this.openMenuPopupId = ctx.getOpenColumnMenuPopupId?.() ?? null;
    let groupDepth = ctx.getColumnGroupHeaders?.()?.depth ?? 0;
    for (const lane of this.lanes) {
      if (lane === null) continue;
      const rows = lane.container.querySelectorAll<HTMLElement>(
        COLUMN_GROUP_HEADER_ROW_SELECTOR,
      );
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const level = parseNonNegativeSafeInteger(
          rows[rowIndex]!.getAttribute(
            COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE,
          ),
        );
        if (level !== null) {
          groupDepth = Math.max(groupDepth, level + 1);
        }
      }
    }
    const hasFloatingFilterRow = ctx.hasFloatingFilterRow?.() ?? false;
    this.hasFloatingFilterRow = hasFloatingFilterRow;
    this.logicalRows = [];
    for (
      let ariaRowIndex = 1;
      ariaRowIndex <= groupDepth + 1 + (hasFloatingFilterRow ? 1 : 0);
      ariaRowIndex += 1
    ) {
      this.logicalRows.push({
        ariaRowIndex,
        bindingChangesOnSettle: false,
        left: null,
        center: null,
        right: null,
        candidateIds: [],
        acceptedIds: [],
        acceptedOwns: undefined,
      });
    }

    for (let laneIndex = 0; laneIndex < this.lanes.length; laneIndex += 1) {
      const lane = this.lanes[laneIndex];
      const laneKind = this.laneKindAt(laneIndex);
      this.laneChildCounts.push(
        lane === null || lane === undefined
          ? -1
          : lane.leafRow.childElementCount,
      );
      if (lane === null || lane === undefined) continue;
      const groupRows =
        lane.container.querySelectorAll<HTMLElement>(
          COLUMN_GROUP_HEADER_ROW_SELECTOR,
        );
      for (let rowIndex = 0; rowIndex < groupRows.length; rowIndex += 1) {
        const row = groupRows[rowIndex]!;
        const level = parseNonNegativeSafeInteger(
          row.getAttribute(COLUMN_GROUP_HEADER_ROW_LEVEL_ATTRIBUTE),
        );
        if (level === null || level >= groupDepth) continue;
        const rowState: RetainedHeaderLaneRowState = {
          element: row,
          ownerContainer: lane.container,
          childCount: row.childElementCount,
          cells: [],
        };
        this.assignLaneRow(this.logicalRows[level]!, laneKind, rowState);
        this.logicalRows[level]!.bindingChangesOnSettle = true;
        const spans =
          row.querySelectorAll<HTMLElement>(
            COLUMN_GROUP_HEADER_SPAN_SELECTOR,
          );
        for (let spanIndex = 0; spanIndex < spans.length; spanIndex += 1) {
          const state: RetainedGroupHeaderState = {
            kind: "group",
            element: spans[spanIndex]!,
            ownerRow: row,
            id: this.physicalIdFor(spans[spanIndex]!, "group"),
            startField: null,
            endField: null,
            leafCount: null,
            label: "",
            ariaColIndex: 0,
            level: -1,
            spanIndex: -1,
            active: false,
          };
          this.groupCells.push(state);
          rowState.cells.push(state);
          this.syncGroupBinding(state);
        }
      }

      const leafRowState: RetainedHeaderLaneRowState = {
        element: lane.leafRow,
        ownerContainer: lane.container,
        childCount: lane.leafRow.childElementCount,
        cells: [],
      };
      this.assignLaneRow(
        this.logicalRows[groupDepth]!,
        laneKind,
        leafRowState,
      );
      this.logicalRows[groupDepth]!.bindingChangesOnSettle = true;
      const children = lane.leafRow.children;
      for (let index = 0; index < children.length; index += 1) {
        const element = children[index]!;
        if (!isHeaderCell(element)) continue;
        const id = this.physicalIdFor(element, "leaf");
        const state: RetainedHeaderCellState = {
          kind: "leaf",
          element,
          ownerRow: lane.leafRow,
          labelElement:
            element.querySelector<HTMLElement>(".lfg-header-label"),
          menuTrigger: null,
          filterTrigger: null,
          resizeHandle: null,
          widgetElements: [],
          id,
          sortDescription: this.sortDescriptionFor(
            element,
            ctx.root,
            id,
          ),
          field: null,
          ariaColIndex: 0,
          active: false,
        };
        this.refreshLeafWidgetElements(state);
        this.cells.push(state);
        leafRowState.cells.push(state);
        this.syncCellBinding(state);
      }

      if (hasFloatingFilterRow) {
        const floatingRow =
          lane.container.querySelector<HTMLElement>(
            FLOATING_FILTER_HEADER_ROW_SELECTOR,
          );
        if (floatingRow !== null) {
          const floatingRowState: RetainedHeaderLaneRowState = {
            element: floatingRow,
            ownerContainer: lane.container,
            childCount: floatingRow.childElementCount,
            cells: [],
          };
          this.assignLaneRow(
            this.logicalRows[groupDepth + 1]!,
            laneKind,
            floatingRowState,
          );
          const floatingCells =
            floatingRow.querySelectorAll<HTMLElement>(
              HEADER_ADDON_CELL_SELECTOR,
            );
          for (
            let cellIndex = 0;
            cellIndex < floatingCells.length;
            cellIndex += 1
          ) {
            const element = floatingCells[cellIndex]!;
            const state: RetainedFloatingFilterCellState = {
              kind: "filter",
              element,
              ownerRow: floatingRow,
              id: this.physicalIdFor(element, "filter"),
              filterTrigger: null,
              widgetElements: [],
              field: null,
              ariaColIndex: 0,
              active: false,
            };
            this.refreshFloatingFilterWidgetElements(state);
            this.floatingFilterCells.push(state);
            floatingRowState.cells.push(state);
            this.syncFloatingFilterBinding(state);
          }
        }
      }
    }
    this.rebuildKeyboardBindingMaps();

    for (const state of previousCells) {
      if (state.sortDescription.retained) continue;
      state.sortDescription.node.remove();
      this.sortDescriptions.delete(state.element);
    }
    this.syncLogicalRows(true);
  }

  /**
   * Rebind virtualized physical header cells without rebuilding maps or
   * discovering DOM. Returns false when the physical header pool changed.
   */
  syncBindings(): boolean {
    for (let index = 0; index < this.lanes.length; index += 1) {
      const lane = this.lanes[index];
      if (
        lane !== null &&
        lane !== undefined &&
        lane.leafRow.childElementCount !== this.laneChildCounts[index]
      ) {
        return false;
      }
    }

    for (const row of this.logicalRows) {
      if (
        (row.center === null &&
          (row.left !== null || row.right !== null)) ||
        !this.isLaneRowBindingCurrent(row.left) ||
        !this.isLaneRowBindingCurrent(row.center) ||
        !this.isLaneRowBindingCurrent(row.right)
      ) return false;
    }

    this.triggerByField.clear();
    for (const state of this.cells) {
      if (state.element.parentElement !== state.ownerRow) return false;
      this.syncCellBinding(state);
    }
    for (const state of this.groupCells) {
      if (state.element.parentElement !== state.ownerRow) return false;
      this.syncGroupBinding(state);
    }
    for (const state of this.floatingFilterCells) {
      if (state.element.parentElement !== state.ownerRow) return false;
      this.syncFloatingFilterBinding(state);
    }
    this.rebuildKeyboardBindingMaps();
    this.syncLogicalRows(false);
    return true;
  }

  syncSort(ctx: DomGridFeatureContext): void {
    if (!this.syncSortModel(ctx.getSortModel())) return;
    for (const state of this.cells) {
      if (!state.active || state.field === null) continue;
      const logical = this.logicalByField.get(state.field);
      if (logical === undefined) continue;
      const sort = isColumnHeaderSortable(logical.column)
        ? this.sortByField.get(state.field)
        : undefined;
      applyColumnHeaderSortSemantics(
        state.element,
        state.field === this.primarySortField
          ? resolveAriaSortValue(logical.column, sort?.direction)
          : null,
      );
      this.syncSortDescription(state, sort);
    }
  }

  syncSelection(ctx: DomGridFeatureContext): void {
    const columnSelection = ctx.getColumnSelectionConfig?.();
    this.columnSelectionEnabled = columnSelection?.enabled === true;
    this.isColumnSelected = ctx.isColumnSelected ?? null;
    for (const state of this.cells) {
      if (!state.active || state.field === null) continue;
      applyColumnHeaderSelectionSemantics(
        state.element,
        this.columnSelectionEnabled
          ? (this.isColumnSelected?.(state.field) ?? false)
          : null,
      );
    }
  }

  syncMenu(ctx: DomGridFeatureContext): void {
    const nextOpenField = ctx.getOpenColumnMenuField?.() ?? null;
    const nextOpenPopupId = ctx.getOpenColumnMenuPopupId?.() ?? null;
    if (
      nextOpenField === this.openMenuField &&
      nextOpenPopupId === this.openMenuPopupId
    ) {
      return;
    }
    const previousTrigger =
      this.openMenuField === null
        ? null
        : (this.triggerByField.get(this.openMenuField) ?? null);
    const nextTrigger =
      nextOpenField === null
        ? null
        : (this.triggerByField.get(nextOpenField) ?? null);
    syncColumnMenuTriggerElementSemantics(previousTrigger, false, null);
    syncColumnMenuTriggerElementSemantics(
      nextTrigger,
      true,
      nextOpenPopupId,
    );
    this.openMenuField = nextOpenField;
    this.openMenuPopupId = nextOpenPopupId;
  }

  resolveColumnLabel(
    field: string,
    fallbackColumns?: readonly ColumnDef[],
  ): string {
    let column = this.logicalByField.get(field)?.column;
    if (column === undefined && fallbackColumns !== undefined) {
      column = fallbackColumns.find((candidate) => candidate.field === field);
    }
    return (column?.headerName?.trim() || column?.field || field).trim();
  }

  resolveColumnMenuTrigger(field: string): HTMLElement | null {
    const state = this.leafByField.get(field);
    if (state?.active === true) {
      this.refreshLeafKeyboardBindings(state);
    }
    return state?.menuTrigger ?? null;
  }

  resolveDedicatedFilterTrigger(field: string): HTMLElement | null {
    const floating = this.floatingFilterByField.get(field);
    if (floating?.active === true) {
      this.refreshFloatingFilterKeyboardBindings(floating);
      return floating.filterTrigger;
    }
    const leaf = this.leafByField.get(field);
    if (leaf?.active === true) {
      this.refreshLeafKeyboardBindings(leaf);
    }
    return leaf?.filterTrigger ?? null;
  }

  resolveResizeHandle(field: string): HTMLElement | null {
    const state = this.leafByField.get(field);
    if (state?.active === true) {
      this.refreshLeafKeyboardBindings(state);
    }
    return state?.resizeHandle ?? null;
  }

  resolveTargetWidgetCount(
    kind: "leafHeader" | "floatingFilter",
    field: string,
  ): number {
    const state = kind === "leafHeader"
      ? this.leafByField.get(field)
      : this.floatingFilterByField.get(field);
    if (state?.active !== true) return 0;
    if (state.kind === "leaf") this.refreshLeafKeyboardBindings(state);
    else this.refreshFloatingFilterKeyboardBindings(state);
    return state.widgetElements.length;
  }

  resolveTargetWidget(
    kind: "leafHeader" | "floatingFilter",
    field: string,
    widgetIndex: number,
  ): HTMLElement | null {
    const state = kind === "leafHeader"
      ? this.leafByField.get(field)
      : this.floatingFilterByField.get(field);
    if (
      state?.active !== true ||
      !Number.isSafeInteger(widgetIndex) ||
      widgetIndex < 0 ||
      widgetIndex >= state.widgetElements.length
    ) return null;
    return state.widgetElements[widgetIndex] ?? null;
  }

  resolveTargetElement(
    kind: "groupHeader" | "leafHeader" | "floatingFilter",
    level: number,
    spanIndex: number,
    field: string | null,
  ): HTMLElement | null {
    if (kind === "leafHeader") {
      return field === null
        ? null
        : (this.leafByField.get(field)?.element ?? null);
    }
    if (kind === "floatingFilter") {
      return field === null
        ? null
        : (this.floatingFilterByField.get(field)?.element ?? null);
    }
    return this.groupRowsForKeyboard[level]?.[spanIndex]?.element ?? null;
  }

  resolvePointerTarget(target: EventTarget | null): HeaderKeyboardPointerTarget | null {
    let element = target instanceof HTMLElement ? target : null;
    while (element !== null) {
      const state = this.pointerStateByElement.get(element);
      if (state !== undefined && state.active) {
        if (state.kind === "leaf" && state.field !== null) {
          return { kind: "leafHeader", field: state.field };
        }
        if (state.kind === "filter" && state.field !== null) {
          return { kind: "floatingFilter", field: state.field };
        }
        if (
          state.kind === "group" &&
          state.startField !== null &&
          state.level >= 0 &&
          state.spanIndex >= 0
        ) {
          return {
            kind: "groupHeader",
            level: state.level,
            spanIndex: state.spanIndex,
            anchorField: state.startField,
          };
        }
      }
      element = element.parentElement;
    }
    return null;
  }

  clear(): void {
    this.clearRetainedCells(true);
    this.logicalByField.clear();
    this.triggerByField.clear();
    this.filterTriggerByField.clear();
    this.resizeHandleByField.clear();
    this.cells = [];
    this.groupCells = [];
    this.floatingFilterCells = [];
    this.logicalRows = [];
    this.lanes = [];
    this.laneChildCounts = [];
    this.openMenuField = null;
    this.openMenuPopupId = null;
    this.hasFloatingFilterRow = false;
    this.leafByField.clear();
    this.floatingFilterByField.clear();
    this.groupRowsForKeyboard = [];
    this.pointerStateByElement =
      new WeakMap<HTMLElement, RetainedOwnedHeaderCellState>();
    this.primarySortField = null;
    this.lastSortModel = undefined;
    this.columnSelectionEnabled = false;
    this.isColumnSelected = null;
    this.physicalIds = new WeakMap<HTMLElement, string>();
    this.sortDescriptions =
      new WeakMap<HTMLElement, RetainedSortDescription>();
  }

  private rebuildKeyboardBindingMaps(): void {
    this.leafByField.clear();
    this.floatingFilterByField.clear();
    this.triggerByField.clear();
    this.filterTriggerByField.clear();
    this.resizeHandleByField.clear();
    for (const state of this.cells) {
      this.pointerStateByElement.set(state.element, state);
      if (state.active && state.field !== null) {
        this.leafByField.set(state.field, state);
        if (state.menuTrigger !== null) {
          this.triggerByField.set(state.field, state.menuTrigger);
        }
        if (state.filterTrigger !== null) {
          this.filterTriggerByField.set(state.field, state.filterTrigger);
        }
        if (state.resizeHandle !== null) {
          this.resizeHandleByField.set(state.field, state.resizeHandle);
        }
      }
    }
    for (const state of this.floatingFilterCells) {
      this.pointerStateByElement.set(state.element, state);
      if (state.active && state.field !== null) {
        this.floatingFilterByField.set(state.field, state);
        if (state.filterTrigger !== null) {
          this.filterTriggerByField.set(state.field, state.filterTrigger);
        }
      }
    }

    const groupDepth = Math.max(
      0,
      this.logicalRows.length - 1 - (this.hasFloatingFilterRow ? 1 : 0),
    );
    if (this.groupRowsForKeyboard.length !== groupDepth) {
      this.groupRowsForKeyboard = Array.from(
        { length: groupDepth },
        () => [],
      );
    }
    for (let level = 0; level < groupDepth; level += 1) {
      const targets = this.groupRowsForKeyboard[level]!;
      targets.length = 0;
      const row = this.logicalRows[level];
      if (row === undefined) continue;
      this.appendKeyboardGroupStates(targets, row.left, level);
      this.appendKeyboardGroupStates(targets, row.center, level);
      this.appendKeyboardGroupStates(targets, row.right, level);
    }
  }

  private refreshLeafWidgetElements(state: RetainedHeaderCellState): void {
    const widgets = state.widgetElements;
    widgets.length = 0;
    state.menuTrigger = null;
    state.filterTrigger = null;
    state.resizeHandle = null;
    let controls: HTMLElement | null = null;
    for (let index = 0; index < state.element.children.length; index += 1) {
      const child = state.element.children[index];
      if (!(child instanceof HTMLElement)) continue;
      if (child.classList.contains("lfg-header-controls")) controls = child;
      else if (child.classList.contains("lfg-resize-handle")) {
        state.resizeHandle = child;
      } else if (child.classList.contains("lfg-column-menu-trigger")) {
        state.menuTrigger = child;
        widgets.push(child);
      } else if (isDedicatedFilterPopupTrigger(child)) {
        state.filterTrigger = child;
        widgets.push(child);
      } else if (isNativeWidgetControl(child)) {
        widgets.push(child);
      }
    }
    if (controls !== null) {
      for (let index = 0; index < controls.children.length; index += 1) {
        const child = controls.children[index];
        if (!(child instanceof HTMLElement)) continue;
        widgets.push(child);
        if (child.classList.contains("lfg-column-menu-trigger")) {
          state.menuTrigger = child;
        }
        if (isDedicatedFilterPopupTrigger(child)) {
          state.filterTrigger = child;
        }
      }
    }
    if (
      state.resizeHandle !== null &&
      state.resizeHandle.style.display !== "none"
    ) {
      widgets.push(state.resizeHandle);
    }
  }

  private refreshLeafKeyboardBindings(state: RetainedHeaderCellState): void {
    this.refreshLeafWidgetElements(state);
    const field = state.field;
    if (field === null) return;
    this.triggerByField.delete(field);
    this.filterTriggerByField.delete(field);
    this.resizeHandleByField.delete(field);
    if (state.menuTrigger !== null) {
      this.triggerByField.set(field, state.menuTrigger);
    }
    if (state.filterTrigger !== null) {
      this.filterTriggerByField.set(field, state.filterTrigger);
    }
    if (state.resizeHandle !== null) {
      this.resizeHandleByField.set(field, state.resizeHandle);
    }
  }

  private refreshFloatingFilterWidgetElements(
    state: RetainedFloatingFilterCellState,
  ): void {
    const widgets = state.widgetElements;
    widgets.length = 0;
    state.filterTrigger = null;
    for (let index = 0; index < state.element.children.length; index += 1) {
      const child = state.element.children[index];
      if (!(child instanceof HTMLElement)) continue;
      if (isNativeWidgetControl(child)) widgets.push(child);
      else {
        for (let rangeIndex = 0; rangeIndex < child.children.length; rangeIndex += 1) {
          const rangeChild = child.children[rangeIndex];
          if (
            rangeChild instanceof HTMLElement &&
            isNativeWidgetControl(rangeChild)
          ) {
            widgets.push(rangeChild);
          }
        }
      }
      if (isDedicatedFilterPopupTrigger(child)) {
        state.filterTrigger = child;
      }
    }
  }

  private refreshFloatingFilterKeyboardBindings(
    state: RetainedFloatingFilterCellState,
  ): void {
    this.refreshFloatingFilterWidgetElements(state);
    const field = state.field;
    if (field === null) return;
    this.filterTriggerByField.delete(field);
    if (state.filterTrigger !== null) {
      this.filterTriggerByField.set(field, state.filterTrigger);
    }
  }

  private appendKeyboardGroupStates(
    targets: RetainedGroupHeaderState[],
    lane: RetainedHeaderLaneRowState | null,
    level: number,
  ): void {
    if (lane === null) return;
    for (const state of lane.cells) {
      if (state.kind !== "group" || !state.active) continue;
      state.level = level;
      state.spanIndex = targets.length;
      targets.push(state);
      this.pointerStateByElement.set(state.element, state);
    }
  }

  private syncCellBinding(state: RetainedHeaderCellState): void {
    const nextField = state.element.getAttribute("data-col-id");
    const field =
      nextField === null || nextField === "" ? null : nextField;
    const logical =
      field === null ? undefined : this.logicalByField.get(field);
    if (
      state.element.style.display === "none" ||
      field === null ||
      logical === undefined
    ) {
      if (state.field === field && !state.active) return;
      clearColumnHeaderElementSemantics(state.element);
      clearColumnMenuTriggerElementSemantics(state.menuTrigger);
      this.clearSortDescription(state);
      state.field = field;
      state.ariaColIndex = 0;
      state.active = false;
      return;
    }

    if (state.field === field && state.active) {
      if (
        state.menuTrigger !== null &&
        !this.triggerByField.has(field)
      ) {
        this.triggerByField.set(field, state.menuTrigger);
      }
      if (state.filterTrigger !== null) {
        this.filterTriggerByField.set(field, state.filterTrigger);
      }
      if (state.resizeHandle !== null) {
        this.resizeHandleByField.set(field, state.resizeHandle);
      }
      return;
    }

    applyColumnHeaderElementSemantics(
      state.element,
      headerSemantics(
        logical,
        state,
        isColumnHeaderSortable(logical.column)
          ? this.sortByField.get(field)
          : undefined,
        this.primarySortField,
        this.columnSelectionEnabled,
        this.isColumnSelected?.(field) ?? false,
      ),
    );
    this.syncSortDescription(
      state,
      isColumnHeaderSortable(logical.column)
        ? this.sortByField.get(field)
        : undefined,
    );
    syncColumnMenuTriggerElementSemantics(
      state.menuTrigger,
      this.openMenuField === field,
      this.openMenuPopupId,
    );
    if (state.menuTrigger !== null && !this.triggerByField.has(field)) {
      this.triggerByField.set(field, state.menuTrigger);
    }
    if (state.filterTrigger !== null) {
      this.filterTriggerByField.set(field, state.filterTrigger);
    }
    if (state.resizeHandle !== null) {
      this.resizeHandleByField.set(field, state.resizeHandle);
    }
    state.field = field;
    state.ariaColIndex = logical.ariaColIndex;
    state.active = true;
  }

  private syncGroupBinding(state: RetainedGroupHeaderState): void {
    const startField =
      state.element.getAttribute(COLUMN_GROUP_HEADER_START_FIELD_ATTRIBUTE);
    const endField =
      state.element.getAttribute(COLUMN_GROUP_HEADER_END_FIELD_ATTRIBUTE);
    const leafCountText =
      state.element.getAttribute(COLUMN_GROUP_HEADER_LEAF_COUNT_ATTRIBUTE);
    const leafCount = parsePositiveSafeInteger(leafCountText);
    const start =
      startField === null ? undefined : this.logicalByField.get(startField);
    const end =
      endField === null ? undefined : this.logicalByField.get(endField);
    const ariaColSpan =
      start === undefined || end === undefined
        ? 0
        : end.ariaColIndex - start.ariaColIndex + 1;
    if (
      state.element.style.display === "none" ||
      startField === null ||
      endField === null ||
      leafCount === null ||
      start === undefined ||
      end === undefined ||
      !Number.isSafeInteger(ariaColSpan) ||
      ariaColSpan < 1 ||
      ariaColSpan !== leafCount
    ) {
      if (
        state.startField === startField &&
        state.endField === endField &&
        state.leafCount === leafCountText &&
        !state.active
      ) {
        return;
      }
      clearGroupHeaderElementSemantics(state.element);
      state.startField = startField;
      state.endField = endField;
      state.leafCount = leafCountText;
      state.label = "";
      state.ariaColIndex = 0;
      state.active = false;
      return;
    }

    if (
      state.startField === startField &&
      state.endField === endField &&
      state.leafCount === leafCountText &&
      state.active
    ) {
      return;
    }

    const label = state.element.textContent.trim();
    applyGroupHeaderElementSemantics(state.element, {
      id: state.id,
      ariaColIndex: start.ariaColIndex,
      ariaColSpan,
      ariaLabel: label === "" ? undefined : label,
    });
    state.startField = startField;
    state.endField = endField;
    state.leafCount = leafCountText;
    state.label = label;
    state.ariaColIndex = start.ariaColIndex;
    state.active = true;
  }

  private syncFloatingFilterBinding(
    state: RetainedFloatingFilterCellState,
  ): void {
    const fieldValue = state.element.getAttribute("data-col-id");
    const field =
      fieldValue === null || fieldValue === "" ? null : fieldValue;
    const logical =
      field === null ? undefined : this.logicalByField.get(field);
    if (
      state.element.style.display === "none" ||
      field === null ||
      logical === undefined
    ) {
      clearFloatingFilterCellElementSemantics(state.element);
      state.field = field;
      state.ariaColIndex = 0;
      state.active = false;
      return;
    }
    applyFloatingFilterCellElementSemantics(
      state.element,
      state.id,
      logical.ariaColIndex,
    );
    state.field = field;
    state.ariaColIndex = logical.ariaColIndex;
    state.active = true;
    if (state.filterTrigger !== null) {
      this.filterTriggerByField.set(field, state.filterTrigger);
    }
  }

  private syncLogicalRows(includeStaticRows: boolean): void {
    for (const row of this.logicalRows) {
      if (!includeStaticRows && !row.bindingChangesOnSettle) continue;

      const center = row.center;
      if (center === null) {
        this.clearLaneCellBindings(row.left);
        this.clearLaneCellBindings(row.right);
        clearHeaderRowElementSemantics(row.left?.element);
        clearHeaderRowElementSemantics(row.right?.element);
        row.acceptedIds.length = 0;
        row.acceptedOwns = undefined;
        continue;
      }

      if (row.left !== null) {
        applyPresentationHeaderRowElementSemantics(row.left.element);
      }
      if (row.right !== null) {
        applyPresentationHeaderRowElementSemantics(row.right.element);
      }

      const split = row.left !== null || row.right !== null;
      const nextOwns = split
        ? this.resolveOwnedHeaderIds(row)
        : this.clearAcceptedOwns(row);
      applyLogicalHeaderRowElementSemantics(
        center.element,
        row.ariaRowIndex,
        nextOwns,
      );
    }
  }

  private resolveOwnedHeaderIds(
    row: RetainedLogicalHeaderRowState,
  ): string | undefined {
    const candidate = row.candidateIds;
    candidate.length = 0;
    let lastAriaColIndex = 0;
    lastAriaColIndex = this.appendActiveLaneIds(
      row.left,
      candidate,
      lastAriaColIndex,
    );
    if (lastAriaColIndex < 0) return this.clearAcceptedOwns(row);
    lastAriaColIndex = this.appendActiveLaneIds(
      row.center,
      candidate,
      lastAriaColIndex,
    );
    if (lastAriaColIndex < 0) return this.clearAcceptedOwns(row);
    lastAriaColIndex = this.appendActiveLaneIds(
      row.right,
      candidate,
      lastAriaColIndex,
    );
    if (lastAriaColIndex < 0 || candidate.length === 0) {
      return this.clearAcceptedOwns(row);
    }

    let changed = candidate.length !== row.acceptedIds.length;
    if (!changed) {
      for (let index = 0; index < candidate.length; index += 1) {
        if (candidate[index] !== row.acceptedIds[index]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return row.acceptedOwns;

    row.acceptedIds.length = candidate.length;
    for (let index = 0; index < candidate.length; index += 1) {
      row.acceptedIds[index] = candidate[index]!;
    }
    row.acceptedOwns = candidate.join(" ");
    return row.acceptedOwns;
  }

  private appendActiveLaneIds(
    lane: RetainedHeaderLaneRowState | null,
    target: string[],
    lastAriaColIndex: number,
  ): number {
    if (lane === null) return lastAriaColIndex;
    for (const cell of lane.cells) {
      if (!cell.active) continue;
      if (
        !Number.isSafeInteger(cell.ariaColIndex) ||
        cell.ariaColIndex <= lastAriaColIndex ||
        cell.id === ""
      ) {
        return -1;
      }
      target.push(cell.id);
      lastAriaColIndex = cell.ariaColIndex;
    }
    return lastAriaColIndex;
  }

  private clearAcceptedOwns(
    row: RetainedLogicalHeaderRowState,
  ): undefined {
    row.acceptedIds.length = 0;
    row.acceptedOwns = undefined;
    return undefined;
  }

  private clearLaneCellBindings(
    lane: RetainedHeaderLaneRowState | null,
  ): void {
    if (lane === null) return;
    for (const cell of lane.cells) {
      if (cell.kind === "leaf") {
        clearColumnHeaderElementSemantics(cell.element);
        clearColumnMenuTriggerElementSemantics(cell.menuTrigger);
        this.clearSortDescription(cell);
        cell.field = null;
      } else if (cell.kind === "group") {
        clearGroupHeaderElementSemantics(cell.element);
        cell.startField = null;
        cell.endField = null;
        cell.leafCount = null;
        cell.label = "";
      } else {
        clearFloatingFilterCellElementSemantics(cell.element);
        cell.field = null;
      }
      cell.ariaColIndex = 0;
      cell.active = false;
    }
  }

  private isLaneRowBindingCurrent(
    row: RetainedHeaderLaneRowState | null,
  ): boolean {
    return (
      row === null ||
      (row.element.parentElement === row.ownerContainer &&
        row.element.childElementCount === row.childCount)
    );
  }

  private laneKindAt(index: number): HeaderLaneKind {
    if (index === 0) return "left";
    if (index === 1) return "center";
    return "right";
  }

  private assignLaneRow(
    row: RetainedLogicalHeaderRowState,
    lane: HeaderLaneKind,
    value: RetainedHeaderLaneRowState,
  ): void {
    if (row[lane] !== null) {
      throw new Error(
        `Duplicate accessibility header row for ${lane} lane at index ${String(row.ariaRowIndex)}`,
      );
    }
    row[lane] = value;
  }

  private syncSortModel(sortModel: SortModel): boolean {
    if (this.lastSortModel === sortModel) return false;
    const next = new Map<string, HeaderSortState>();
    const total = sortModel.length;
    for (let priority = 0; priority < total; priority += 1) {
      const entry = sortModel[priority]!;
      if (next.has(entry.field)) continue;
      next.set(entry.field, {
        direction: entry.sort,
        priority,
        total,
      });
    }
    this.sortByField = next;
    this.lastSortModel = sortModel;
    this.primarySortField = sortModel[0]?.field ?? null;
    return true;
  }

  private sortDescriptionFor(
    element: HTMLElement,
    root: HTMLElement,
    headerId: string,
  ): RetainedSortDescription {
    const retained = this.sortDescriptions.get(element);
    if (retained !== undefined) {
      retained.retained = true;
      if (retained.node.parentElement !== root) {
        root.appendChild(retained.node);
      }
      return retained;
    }
    const node = root.ownerDocument.createElement("div");
    node.className = ACCESSIBILITY_DESCRIPTION_CLASS;
    node.id = `${headerId}-sort-description`;
    root.appendChild(node);
    const description: RetainedSortDescription = {
      node,
      id: node.id,
      retained: true,
      text: "",
    };
    this.sortDescriptions.set(element, description);
    return description;
  }

  private syncSortDescription(
    state: RetainedHeaderCellState,
    sort: HeaderSortState | undefined,
  ): void {
    if (sort === undefined || sort.total <= 1) {
      this.clearSortDescription(state);
      return;
    }
    const direction =
      sort.direction === "asc" ? "ascending" : "descending";
    const text =
      `Sorted ${direction}, priority ${sort.priority + 1} of ${sort.total}.`;
    if (state.sortDescription.text !== text) {
      state.sortDescription.node.textContent = text;
      state.sortDescription.text = text;
    }
    applyColumnHeaderSortDescriptionSemantics(
      state.element,
      state.sortDescription.id,
    );
  }

  private clearSortDescription(state: RetainedHeaderCellState): void {
    applyColumnHeaderSortDescriptionSemantics(state.element, undefined);
    if (state.sortDescription.text !== "") {
      state.sortDescription.node.textContent = "";
      state.sortDescription.text = "";
    }
  }

  private physicalIdFor(
    element: HTMLElement,
    kind: HeaderPhysicalKind,
  ): string {
    const retained = this.physicalIds.get(element);
    if (retained !== undefined) {
      applyPhysicalHeaderElementId(element, retained);
      return retained;
    }
    const physicalId = this.nextPhysicalId;
    if (!Number.isSafeInteger(physicalId) || physicalId < 1) {
      throw new Error("Accessibility physical header id exhausted");
    }
    this.nextPhysicalId =
      physicalId === Number.MAX_SAFE_INTEGER
        ? Number.NaN
        : physicalId + 1;
    const id =
      `lfg-a11y-${this.instanceId}-header-${kind}-${physicalId}`;
    this.physicalIds.set(element, id);
    applyPhysicalHeaderElementId(element, id);
    return id;
  }

  private clearRetainedCells(removePhysicalIds: boolean): void {
    for (const state of this.cells) {
      this.clearSortDescription(state);
      clearColumnHeaderElementSemantics(
        state.element,
        removePhysicalIds ? state.id : undefined,
      );
      clearColumnMenuTriggerElementSemantics(state.menuTrigger);
      if (removePhysicalIds) {
        state.sortDescription.node.remove();
        this.sortDescriptions.delete(state.element);
      }
    }
    for (const state of this.groupCells) {
      clearGroupHeaderElementSemantics(
        state.element,
        removePhysicalIds ? state.id : undefined,
      );
    }
    for (const state of this.floatingFilterCells) {
      clearFloatingFilterCellElementSemantics(
        state.element,
        removePhysicalIds ? state.id : undefined,
      );
    }
    for (const row of this.logicalRows) {
      clearHeaderRowElementSemantics(row.left?.element);
      clearHeaderRowElementSemantics(row.center?.element);
      clearHeaderRowElementSemantics(row.right?.element);
    }
  }
}

/** One-shot compatibility helper for focused tests. */
export function syncColumnHeaderSemantics(ctx: DomGridFeatureContext): void {
  new HeaderSemanticsReconciler().syncTopology(ctx);
}

export function clearColumnHeaderSemantics(
  ctx: DomGridFeatureContext,
): void {
  const reconciler = new HeaderSemanticsReconciler();
  reconciler.syncTopology(ctx);
  reconciler.clear();
}
