import type {
  ColumnMenuOptions,
  ColumnMenuSizingOptions,
  ColumnSizeToFitSource,
} from "../../types";
import {
  isColumnMenuSectionItemEnabled,
  resolveColumnMenuSectionMode,
} from "../column-menu/columnMenuSectionMode";
import type { ColumnMenuContribution, ColumnMenuItem, ColumnMenuSection } from "../column-menu/types";

export interface SizingMenuContributionOptions {
  sizeColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  sizeSelectedColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  resetColumnWidths?: (source?: ColumnSizeToFitSource) => void;
  autoSizeColumn?: (field: string, source?: ColumnSizeToFitSource) => void;
  autoSizeSelectedColumns?: (source?: ColumnSizeToFitSource) => void;
  getOptions?: () => ColumnMenuOptions | undefined;
}

export function sizingMenuContribution(
  options: SizingMenuContributionOptions,
): ColumnMenuContribution {
  return {
    id: "sizing",
    getSections(ctx): ColumnMenuSection[] {
      const mode = resolveColumnMenuSectionMode<ColumnMenuSizingOptions>(
        options.getOptions?.(),
        "sizing",
      );
      if (mode.hidden) return [];

      const items: ColumnMenuItem[] = [];

      if (
        options.autoSizeColumn &&
        isColumnMenuSectionItemEnabled(mode, "autoSizeColumn")
      ) {
        items.push({
          id: "auto-size-column",
          label: "Auto-size this column",
          icon: "↕",
          action: () => {
            ctx.close();
            options.autoSizeColumn!(ctx.field, "ui");
          },
        });
      }

      if (
        options.autoSizeSelectedColumns &&
        isColumnMenuSectionItemEnabled(mode, "autoSizeSelectedColumns") &&
        ctx.selectedColumnIds.length > 0
      ) {
        items.push({
          id: "auto-size-selected-columns",
          label: "Auto-size selected columns",
          icon: "⇕",
          action: () => {
            ctx.close();
            options.autoSizeSelectedColumns!("ui");
          },
        });
      }

      if (
        options.sizeColumnsToFit &&
        isColumnMenuSectionItemEnabled(mode, "sizeColumnsToFit")
      ) {
        items.push({
          id: "size-columns-to-fit",
          label: "Size columns to fit",
          icon: "↔",
          action: () => {
            ctx.close();
            options.sizeColumnsToFit!("ui");
          },
        });
      }

      if (
        options.sizeSelectedColumnsToFit &&
        isColumnMenuSectionItemEnabled(mode, "sizeSelectedColumnsToFit")
      ) {
        items.push({
          id: "size-selected-columns-to-fit",
          label: "Size selected columns to fit",
          icon: "⇔",
          action: () => {
            ctx.close();
            options.sizeSelectedColumnsToFit!("ui");
          },
        });
      }

      const sections: ColumnMenuSection[] = [];
      if (items.length > 0) {
        sections.push({ id: "sizing", items });
      }

      // Separate section so the panel gets a divider before reset (design mock).
      if (
        options.resetColumnWidths &&
        isColumnMenuSectionItemEnabled(mode, "resetColumnWidths")
      ) {
        sections.push({
          id: "sizing-reset",
          items: [
            {
              id: "reset-column-widths",
              label: "Reset column widths",
              icon: "↩",
              action: () => {
                ctx.close();
                options.resetColumnWidths!("ui");
              },
            },
          ],
        });
      }

      return sections;
    },
  };
}
