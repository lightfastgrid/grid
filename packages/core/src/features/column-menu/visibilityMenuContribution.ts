import { isInternalColumn } from "../../internal/internalColumns";
import type { ColumnMenuOptions, ColumnMenuVisibilityOptions } from "../../types";

import {
  isColumnMenuSectionItemEnabled,
  resolveColumnMenuSectionMode,
} from "./columnMenuSectionMode";
import type { ColumnMenuContext, ColumnMenuContribution, ColumnMenuSection } from "./types";

export interface VisibilityMenuContributionOptions {
  hideColumns: (fields: string[]) => void;
  getOptions?: () => ColumnMenuOptions | undefined;
}

export function visibilityMenuContribution(
  options: VisibilityMenuContributionOptions,
): ColumnMenuContribution {
  return {
    id: "visibility",
    getSections(ctx: ColumnMenuContext): ColumnMenuSection[] {
      const mode = resolveColumnMenuSectionMode<ColumnMenuVisibilityOptions>(
        options.getOptions?.(),
        "visibility",
      );
      if (mode.hidden) return [];

      const visibleUserFields = new Set(
        ctx.columns
          .filter((c) => c.visible !== false && !isInternalColumn(c))
          .map((c) => c.field),
      );

      const clickedIsSelected = ctx.selectedColumnIds.includes(ctx.field);
      const selectedVisibleUser = ctx.selectedColumnIds.filter((id) =>
        visibleUserFields.has(id),
      );
      const useMulti = clickedIsSelected && selectedVisibleUser.length > 1;

      if (useMulti && isColumnMenuSectionItemEnabled(mode, "hideSelectedColumns")) {
        return [
          {
            id: "visibility",
            items: [
              {
                id: "hide-column",
                label: "Hide selected columns",
                icon: "⊘",
                action: () => {
                  ctx.close();
                  options.hideColumns(selectedVisibleUser);
                },
              },
            ],
          },
        ];
      }

      if (!isColumnMenuSectionItemEnabled(mode, "hideColumn")) return [];

      return [
        {
          id: "visibility",
          items: [
            {
              id: "hide-column",
              label: "Hide column",
              icon: "⊘",
              action: () => {
                ctx.close();
                options.hideColumns([ctx.field]);
              },
            },
          ],
        },
      ];
    },
  };
}
