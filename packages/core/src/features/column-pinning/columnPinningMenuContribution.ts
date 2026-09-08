import type { ColumnDef, ColumnMenuOptions, ColumnMenuPinningOptions, ColumnPinState } from "../../types";
import {
  isColumnMenuSectionItemEnabled,
  resolveColumnMenuSectionMode,
} from "../column-menu/columnMenuSectionMode";
import type { ColumnMenuContext, ColumnMenuContribution, ColumnMenuItem, ColumnMenuSection } from "../column-menu/types";

export interface PinningMenuContributionOptions {
  pinColumn: (field: string, pinned: "left" | "right" | false) => void;
  setColumnPinState?: (state: ColumnPinState[]) => void;
  getOptions?: () => ColumnMenuOptions | undefined;
}

/**
 * Resolve which columns the pin action should target.
 *
 * Multi-target when `ctx.field` is inside `ctx.selectedColumnIds` and there
 * is more than one selected column.  Otherwise single-target.
 *
 * Targets are filtered to visible, non-internal, pinnable user columns.
 */
function resolveTargets(ctx: ColumnMenuContext): ColumnDef[] {
  const clickedIsSelected = ctx.selectedColumnIds.includes(ctx.field);
  const selectedSet = new Set(ctx.selectedColumnIds);
  const useMulti = clickedIsSelected && ctx.selectedColumnIds.length > 1;

  return ctx.columns.filter((col) => {
    if (col.visible === false) return false;
    if (col.internal) return false;
    if (col.pinnable === false) return false;
    return useMulti ? selectedSet.has(col.field) : col.field === ctx.field;
  });
}

export function columnPinningMenuContribution(
  options: PinningMenuContributionOptions,
): ColumnMenuContribution {
  return {
    id: "pin",
    getSections(ctx: ColumnMenuContext): ColumnMenuSection[] {
      if (ctx.column.pinnable === false) return [];

      const mode = resolveColumnMenuSectionMode<ColumnMenuPinningOptions>(
        options.getOptions?.(),
        "pinning",
      );
      if (mode.hidden) return [];

      const targets = resolveTargets(ctx);
      if (targets.length === 0) return [];

      const isMulti = targets.length > 1;

      const items: ColumnMenuItem[] = [];

      if (isColumnMenuSectionItemEnabled(mode, "pinLeft")) {
        items.push({
          id: "pin-left",
          label: isMulti ? "Pin selected left" : "Pin left",
          icon: "◧",
          disabled: targets.every((c) => (c.pinned || false) === "left"),
          action: () => {
            ctx.close();
            applyPin(targets, "left", ctx, options);
          },
        });
      }

      if (isColumnMenuSectionItemEnabled(mode, "pinRight")) {
        items.push({
          id: "pin-right",
          label: isMulti ? "Pin selected right" : "Pin right",
          icon: "◨",
          disabled: targets.every((c) => (c.pinned || false) === "right"),
          action: () => {
            ctx.close();
            applyPin(targets, "right", ctx, options);
          },
        });
      }

      if (isColumnMenuSectionItemEnabled(mode, "unpin")) {
        const anyPinned = targets.some((c) => !!(c.pinned));
        items.push({
          id: "unpin",
          label: isMulti ? "Unpin selected" : "Unpin",
          icon: "▣",
          hidden: !anyPinned,
          action: () => {
            ctx.close();
            applyPin(targets, false, ctx, options);
          },
        });
      }

      if (items.length === 0) return [];

      return [{ id: "pin", items }];
    },
  };
}

/**
 * Apply a pin state to one or more target columns.
 *
 * Single-column uses the original `pinColumn` callback.
 * Multi-column builds a full {@link ColumnPinState} array that preserves
 * the existing pin state of non-target columns, then calls
 * `setColumnPinState` for one batch update + one render.
 */
function applyPin(
  targets: ColumnDef[],
  pinned: "left" | "right" | false,
  ctx: ColumnMenuContext,
  options: PinningMenuContributionOptions,
): void {
  if (targets.length === 1) {
    options.pinColumn(targets[0]!.field, pinned);
    return;
  }

  if (!options.setColumnPinState) {
    // Fallback: call pinColumn per target (shouldn't happen with proper wiring).
    for (const col of targets) {
      options.pinColumn(col.field, pinned);
    }
    return;
  }

  const targetFields = new Set(targets.map((c) => c.field));

  // Build next state: preserve existing pins for non-target columns,
  // apply new pin for target columns.
  const nextState: ColumnPinState[] = [];
  for (const col of ctx.columns) {
    if (col.internal) continue;
    if (col.pinnable === false) continue;
    if (col.visible === false) continue;

    if (targetFields.has(col.field)) {
      if (pinned) {
        nextState.push({ field: col.field, pinned });
      }
      // When unpinning, omit from state (setColumnPinState unpins omitted columns).
    } else if (col.pinned) {
      // Preserve existing pin for non-target columns.
      nextState.push({ field: col.field, pinned: col.pinned });
    }
  }

  options.setColumnPinState(nextState);
}
