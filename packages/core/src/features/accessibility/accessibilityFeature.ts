import type { Grid } from "../../Grid";
import { DEFAULT_GRID_LAYOUT_METRICS } from "../../layout/gridLayoutMetrics";
import type {
  DomGridFeature,
  ExactFocusBindingCapability,
} from "../types";
import type { DomGridFeatureContext } from "../types";

import { KeyboardNavigationController } from "./keyboard/KeyboardNavigationController";
import {
  type KeyboardTargetState,
  setFloatingFilterTarget,
  setGroupHeaderTarget,
  setLeafHeaderTarget,
} from "./keyboard/keyboardTarget";
import {
  BodyCellSemanticsReconciler,
  type BodyKeyboardPointerTarget,
} from "./utils/bodyCellSemantics";
import {
  HeaderSemanticsReconciler,
} from "./utils/headerSemantics";
import { resolveRowgroupRoleHost } from "./utils/rowgroupRoles";
import {
  RowSemanticsReconciler,
} from "./utils/rowSemantics";
import {
  ACCESSIBILITY_DIRTY_ROOT,
  AccessibilityController,
  type AccessibilityDirtyScope,
} from "./AccessibilityController";
import {
  type AccessibilityGridReadSeam,
  createAccessibilityGridReadSeam,
} from "./accessibilityGridReadSeam";
import { AccessibilityLiveRegion } from "./accessibilityLiveRegion";
import {
  AccessibilityPersistentDescription,
} from "./accessibilityPersistentDescription";
import { captureGridRootSnapshot } from "./gridRootStructuralSnapshot";
import { subscribeAccessibilityAnnouncements } from "./subscribeAccessibilityAnnouncements";
import { subscribeAccessibilityUpdates } from "./subscribeAccessibilityUpdates";

export interface AccessibilityFeatureDeps {
  readonly read: AccessibilityGridReadSeam;
  getGrid: () => Grid | null;
}

export function accessibilityFeature(
  deps: AccessibilityFeatureDeps = {
    read: {
      getAccessibilityOptions: () => undefined,
      getRowSelectionMode: () => "none",
      isGridBusy: () => false,
    },
    getGrid: () => null,
  },
): DomGridFeature & ExactFocusBindingCapability {
  const controller = new AccessibilityController();
  const rowSemantics = new RowSemanticsReconciler();
  const bodyCellSemantics = new BodyCellSemanticsReconciler();
  const headerSemantics = new HeaderSemanticsReconciler();
  const liveRegion = new AccessibilityLiveRegion();
  const persistentDescription = new AccessibilityPersistentDescription();
  const keyboard = new KeyboardNavigationController();
  const bodyPointerTarget: BodyKeyboardPointerTarget = {
    displayRowIndex: -1,
    field: "",
  };
  let unsubscribeAnnouncements: (() => void) | null = null;
  let unsubscribePersistentDescription: (() => void) | null = null;
  let unsubscribeUpdates: (() => void) | null = null;
  let featureCtx: DomGridFeatureContext | null = null;

  return {
    name: "accessibility",

    attach(ctx) {
      unsubscribeAnnouncements?.();
      unsubscribeAnnouncements = null;
      featureCtx = ctx;
      const writingDirection =
        ctx.surface.dir === "rtl" || ctx.root.dir === "rtl" ? "rtl" : "ltr";
      keyboard.attach({
        surface: ctx.surface,
        readPageSize: () => {
          const metrics = ctx.layoutMetrics ?? DEFAULT_GRID_LAYOUT_METRICS;
          const viewportHeight = ctx.getCachedViewportHeight?.() ?? -1;
          const bodyHeight = viewportHeight - metrics.headerHeight;
          return bodyHeight > 0
            ? Math.max(1, Math.floor(bodyHeight / metrics.rowHeight))
            : 10;
        },
        readWritingDirection: () => writingDirection,
        focusBodyCell: (displayRowIndex, field) =>
          ctx.setFocusedCellAtDisplayIndex?.(
            displayRowIndex,
            field,
            "keyboard",
          ) ?? false,
        toggleRowSelection: (displayRowIndex) =>
          ctx.toggleRowSelectionAtDisplayIndex?.(
            displayRowIndex,
            "keyboard",
          ) ?? false,
        selectRow: (displayRowIndex) =>
          ctx.selectRowAtDisplayIndex?.(
            displayRowIndex,
            "keyboard",
          ) ?? false,
        extendRowSelection: (previousDisplayRowIndex, nextDisplayRowIndex) =>
          ctx.extendRowSelectionStep?.(
            previousDisplayRowIndex,
            nextDisplayRowIndex,
            "keyboard",
          ) ?? false,
        toggleAllRows: () =>
          ctx.toggleAllRowSelection?.("keyboard") ?? false,
        toggleColumnSelection: (field) =>
          ctx.toggleColumnSelection?.(field, "keyboard") ?? false,
        toggleSort: (field, multi) =>
          ctx.toggleSortFromCommand?.(field, multi) ?? false,
        isCellEditing: () => ctx.isCellEditing?.() ?? false,
        startCellEdit: (displayRowIndex, field, cellElement, charSeed) =>
          ctx.startCellEditAtDisplayIndex?.(
            displayRowIndex,
            field,
            cellElement,
            charSeed,
          ) ?? false,
        stopCellEdit: (commit) => ctx.stopCellEdit?.(commit) ?? true,
        toggleBooleanCell: (displayRowIndex, field) =>
          ctx.toggleBooleanCellAtDisplayIndex?.(
            displayRowIndex,
            field,
          ) ?? false,
        getBooleanCellKeyboardMode: (displayRowIndex, field) =>
          ctx.getBooleanCellKeyboardModeAtDisplayIndex?.(
            displayRowIndex,
            field,
          ) ?? null,
        resolveTargetWidgetCount: (displayRowIndex, field) =>
          bodyCellSemantics.resolveTargetWidgetCount(
            displayRowIndex,
            field,
          ),
        resolveTargetWidget: (displayRowIndex, field, widgetIndex) =>
          bodyCellSemantics.resolveTargetWidget(
            displayRowIndex,
            field,
            widgetIndex,
          ),
        resolveHeaderWidgetCount: (kind, field) =>
          headerSemantics.resolveTargetWidgetCount(kind, field),
        resolveHeaderWidget: (kind, field, widgetIndex) =>
          headerSemantics.resolveTargetWidget(kind, field, widgetIndex),
        ensureFieldVisible: ctx.ensureFieldVisible,
        resolveTargetElement: (target) => {
          const plan = keyboard.getPlan();
          if (plan === null || target.kind === "none") return null;
          if (target.kind === "bodyCell") {
            const field = plan.columns[target.columnOrdinal]?.field;
            return field === undefined
              ? null
              : bodyCellSemantics.resolveTargetElement(
                  target.displayRowIndex,
                  field,
                );
          }
          const ordinal = target.kind === "groupHeader"
            ? target.anchorColumnOrdinal
            : target.columnOrdinal;
          const field = plan.columns[ordinal]?.field ?? null;
          return headerSemantics.resolveTargetElement(
            target.kind,
            target.level,
            target.spanIndex,
            field,
          );
        },
        readPointerTarget: (eventTarget, out) =>
          readHeaderPointerTarget(
            headerSemantics,
            keyboard,
            eventTarget,
            out,
          ) ||
          readBodyPointerTarget(
            bodyCellSemantics,
            keyboard,
            bodyPointerTarget,
            eventTarget,
            out,
          ),
        resolveColumnMenuTrigger: (field) =>
          headerSemantics.resolveColumnMenuTrigger(field),
        resolveDedicatedFilterTrigger: (field) =>
          headerSemantics.resolveDedicatedFilterTrigger(field),
        resolveResizeHandle: (field) =>
          headerSemantics.resolveResizeHandle(field),
        requestOpenColumnMenu: (field, trigger) =>
          ctx.requestOpenColumnMenu?.(field, trigger) ?? false,
        requestOpenCellMenu: (rowIndex, field, cell, invoker) =>
          ctx.requestOpenCellMenu?.(
            rowIndex,
            field,
            cell,
            invoker,
          ) ?? false,
        resolveVisibleCellMenuTrigger: (rowIndex, field, cell) =>
          ctx.resolveVisibleCellMenuTrigger?.(
            rowIndex,
            field,
            cell,
          ) ?? null,
        requestOpenRowAction: (rowIndex, field, trigger, invoker) =>
          ctx.requestOpenRowAction?.(
            rowIndex,
            field,
            trigger,
            invoker,
          ) ?? false,
        requestOpenDedicatedFilter: (field, trigger) =>
          ctx.requestOpenDedicatedFilter?.(field, trigger) ?? false,
        closeOpenPopup: () => ctx.closeOpenPopupFromCommand?.() ?? false,
        requestKeyboardTooltip: (target) =>
          ctx.requestTooltipForKeyboardTarget?.(target),
        dismissKeyboardTooltip: () =>
          ctx.dismissKeyboardTooltip?.() ?? false,
        clearRowSelection: () =>
          ctx.clearRowSelectionFromKeyboard?.() ?? false,
        clearColumnSelection: () =>
          ctx.clearColumnSelectionFromKeyboard?.() ?? false,
        moveColumn: (field, visualDelta) =>
          ctx.moveColumnFromCommand?.(field, visualDelta) ?? false,
        moveRow: (rowIndex, adjacentRowIndex) =>
          ctx.moveRowFromCommand?.(rowIndex, adjacentRowIndex) ?? false,
        resizeColumn: (field, deltaPx) =>
          ctx.resizeColumnFromCommand?.(field, deltaPx) ?? false,
        setExactFocusBindingActive: ctx.setExactFocusBindingActive,
      });
      // Section 12 status node stays a sibling of the outer root, outside the
      // composite grid surface.
      liveRegion.attach(ctx.root);
      persistentDescription.attach(ctx.root);
      const rowRead = {
        getRowSelectionMode: () => deps.read.getRowSelectionMode(),
        isRowSelected: (rowId: string) => ctx.isRowSelectedForRowOrder(rowId),
      };
      controller.attach({
        // Composite-grid attributes (role, counts, naming, busy, selection
        // metadata) target the neutral surface, not the outer root.
        root: ctx.surface,
        viewport: ctx.viewport,
        rowgroup: resolveRowgroupRoleHost(ctx.surface),
        readSnapshot: () =>
          captureGridRootSnapshot(
            ctx,
            deps.read,
            persistentDescription.getActiveId(),
          ),
        syncRowStructure: () => {
          if (featureCtx !== null) {
            keyboard.syncRowLayout(resolveKeyboardRowLayout(featureCtx));
            rowSemantics.syncStructure(featureCtx, rowRead);
            bodyCellSemantics.syncStructure(featureCtx);
            keyboard.syncResolvedActiveDescendant();
          }
        },
        syncRowPosition: () => {
          if (featureCtx === null) return true;
          const rowsComplete = rowSemantics.syncPosition(featureCtx, rowRead);
          const cellsComplete = bodyCellSemantics.syncPosition(featureCtx);
          keyboard.syncResolvedActiveDescendant();
          return rowsComplete && cellsComplete;
        },
        syncHeaderTopology: () => {
          if (featureCtx !== null) {
            keyboard.syncTopology({
              columns: featureCtx.getColumns(),
              columnGroupHeaders: featureCtx.getColumnGroupHeaders?.(),
              hasFloatingFilterRow:
                featureCtx.hasFloatingFilterRow?.() ?? false,
            });
            headerSemantics.syncTopology(featureCtx);
            keyboard.syncResolvedActiveDescendant();
          }
        },
        syncHeaderBinding: () => {
          const complete = headerSemantics.syncBindings();
          if (complete) keyboard.syncResolvedActiveDescendant();
          return complete;
        },
        syncHeaderSort: () => {
          if (featureCtx !== null) {
            headerSemantics.syncSort(featureCtx);
          }
        },
        syncHeaderSelection: () => {
          if (featureCtx !== null) {
            headerSemantics.syncSelection(featureCtx);
          }
        },
        syncHeaderMenu: () => {
          if (featureCtx !== null) {
            headerSemantics.syncMenu(featureCtx);
          }
        },
        syncActiveDescendant: () => {
          keyboard.syncResolvedActiveDescendant();
        },
        clearSemantics: () => {
          if (featureCtx !== null) {
            rowSemantics.clear(featureCtx);
            bodyCellSemantics.clear(featureCtx);
            headerSemantics.clear();
          }
        },
      });

      unsubscribeUpdates?.();
      unsubscribeUpdates = null;
      unsubscribePersistentDescription?.();
      unsubscribePersistentDescription = null;

      const grid = deps.getGrid();
      if (grid !== null) {
        unsubscribeUpdates = subscribeAccessibilityUpdates(
          grid,
          (scopes: AccessibilityDirtyScope, immediate = false) => {
            if (immediate) {
              controller.reconcileImmediate(scopes);
            } else {
              controller.requestReconcile(scopes);
            }
          },
          (focusedCell) => {
            if (focusedCell === null) {
              keyboard.clearTarget();
              return;
            }
            keyboard.syncFocusedBodyTarget(
              focusedCell.rowIndex,
              focusedCell.field,
            );
            keyboard.syncResolvedActiveDescendant();
          },
        );
        unsubscribeAnnouncements = subscribeAccessibilityAnnouncements(
          grid,
          liveRegion,
          {
            isGridBusy: () => deps.read.isGridBusy(),
            getRowCount: () => grid.getRowCount(),
            resolveColumnLabel: (field) =>
              headerSemantics.resolveColumnLabel(
                field,
                featureCtx?.getColumns(),
              ),
          },
        );
        unsubscribePersistentDescription = grid.on(
          "overlay:presentation-changed",
          (event) => {
            if (!persistentDescription.update(event)) return;
            controller.reconcileImmediate(ACCESSIBILITY_DIRTY_ROOT);
          },
        );
      }
    },

    syncExactFocusBinding() {
      const focusedCell = featureCtx?.getFocusedCell?.() ?? null;
      if (focusedCell !== null) {
        keyboard.syncRetainedBodyFocusPosition(
          focusedCell.rowIndex,
          focusedCell.field,
        );
      }
      keyboard.syncExactFocusBinding();
    },

    detach() {
      unsubscribePersistentDescription?.();
      unsubscribePersistentDescription = null;
      unsubscribeAnnouncements?.();
      unsubscribeAnnouncements = null;
      unsubscribeUpdates?.();
      unsubscribeUpdates = null;
      persistentDescription.detach();
      liveRegion.detach();
      controller.detach();
      keyboard.detach();
      featureCtx = null;
    },
  };
}

export { createAccessibilityGridReadSeam };

function resolveKeyboardRowLayout(
  ctx: DomGridFeatureContext,
): ReturnType<NonNullable<DomGridFeatureContext["getVisualRowLayout"]>> {
  return ctx.getVisualRowLayout?.() ?? {
    topDisplayIndexes: [],
    centerRowCount: ctx.getDisplayRows().rowCount,
    centerToDisplayIndex: null,
    bottomDisplayIndexes: [],
  };
}

function readHeaderPointerTarget(
  headerSemantics: HeaderSemanticsReconciler,
  keyboard: KeyboardNavigationController,
  eventTarget: EventTarget | null,
  out: KeyboardTargetState,
): boolean {
  const pointer = headerSemantics.resolvePointerTarget(eventTarget);
  const plan = keyboard.getPlan();
  if (pointer === null || plan === null) return false;
  if (pointer.kind === "groupHeader") {
    const ordinal = plan.columnOrdinalByField.get(pointer.anchorField);
    if (ordinal === undefined) return false;
    setGroupHeaderTarget(
      out,
      pointer.level,
      pointer.spanIndex,
      ordinal,
    );
    return true;
  }
  const ordinal = plan.columnOrdinalByField.get(pointer.field);
  if (ordinal === undefined) return false;
  if (pointer.kind === "leafHeader") {
    setLeafHeaderTarget(out, ordinal);
  } else {
    setFloatingFilterTarget(out, ordinal);
  }
  return true;
}

function readBodyPointerTarget(
  bodyCellSemantics: BodyCellSemanticsReconciler,
  keyboard: KeyboardNavigationController,
  pointer: BodyKeyboardPointerTarget,
  eventTarget: EventTarget | null,
  out: KeyboardTargetState,
): boolean {
  return bodyCellSemantics.resolvePointerTarget(eventTarget, pointer) &&
    keyboard.writeBodyTargetFromDisplayIndex(
      pointer.displayRowIndex,
      pointer.field,
      out,
    );
}
