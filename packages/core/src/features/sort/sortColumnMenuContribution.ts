import type {
  ColumnMenuOptions,
  ColumnMenuSortOptions,
  SortChangeSource,
  SortDirection,
} from "../../types";
import {
  isColumnMenuSectionItemEnabled,
  resolveColumnMenuSectionMode,
} from "../column-menu/columnMenuSectionMode";
import type { ColumnMenuContext, ColumnMenuContribution, ColumnMenuItem, ColumnMenuSection } from "../column-menu/types";

export interface SortMenuContributionOptions {
  setColumnSort: (
    field: string,
    direction: SortDirection | null,
    source?: SortChangeSource,
    opts?: { multi?: boolean },
  ) => void;
  getOptions?: () => ColumnMenuOptions | undefined;
}

export function sortColumnMenuContribution(
  options: SortMenuContributionOptions,
): ColumnMenuContribution {
  return {
    id: "sort",
    getSections(ctx: ColumnMenuContext): ColumnMenuSection[] {
      if (ctx.column.sortable === false) return [];

      const mode = resolveColumnMenuSectionMode<ColumnMenuSortOptions>(
        options.getOptions?.(),
        "sort",
      );
      if (mode.hidden) return [];

      const currentDir =
        ctx.sortModel.find((s) => s.field === ctx.field)?.sort ?? null;

      const items: ColumnMenuItem[] = [];

      if (isColumnMenuSectionItemEnabled(mode, "asc")) {
        items.push({
          id: "sort-asc",
          label: "Sort ascending",
          icon: "▲",
          disabled: currentDir === "asc",
          action: () => {
            ctx.close();
            options.setColumnSort(ctx.field, "asc", "ui", { multi: true });
          },
        });
      }

      if (isColumnMenuSectionItemEnabled(mode, "desc")) {
        items.push({
          id: "sort-desc",
          label: "Sort descending",
          icon: "▼",
          disabled: currentDir === "desc",
          action: () => {
            ctx.close();
            options.setColumnSort(ctx.field, "desc", "ui", { multi: true });
          },
        });
      }

      if (isColumnMenuSectionItemEnabled(mode, "clear")) {
        items.push({
          id: "sort-clear",
          label: "Clear sort",
          icon: "✕",
          hidden: currentDir === null,
          action: () => {
            ctx.close();
            options.setColumnSort(ctx.field, null, "ui", { multi: true });
          },
        });
      }

      if (items.length === 0) return [];

      return [{ id: "sort", items }];
    },
  };
}
