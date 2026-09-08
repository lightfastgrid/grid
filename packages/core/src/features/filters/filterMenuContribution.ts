import type {
  ColumnDef,
  ColumnFilterModel,
  ColumnMenuFilterOptions,
  ColumnMenuOptions,
  FilterChangeSource,
  RowData,
} from "../../types";
import {
  isColumnMenuSectionItemEnabled,
  resolveColumnMenuSectionMode,
} from "../column-menu/columnMenuSectionMode";
import type {
  ColumnMenuContext,
  ColumnMenuContribution,
  ColumnMenuItem,
  ColumnMenuSection,
} from "../column-menu/types";

import type { GetSelectionValuesArgs } from "./filterMenuForm";
import { createFilterMenuForm } from "./filterMenuForm";
import type { FilterSelectionValueResult } from "./filterSelectionValues";
import { buildFilterValueLabel } from "./filterValueLabel";
import { resolveFilterMenuOptions } from "./resolveFilterMenuOptions";
import type { NormalizedColumnFilterConfig } from "./types";

export interface FilterSelectionPreviewRenderContext {
  column: ColumnDef;
  field: string;
  value: string | number | boolean;
  label: string;
  sampleRowIndex: number;
  sampleRow: RowData | undefined;
}

export interface FilterMenuContributionOptions {
  getColumnFilterModel: (field: string) => ColumnFilterModel | null;
  setColumnFilterModel: (field: string, model: ColumnFilterModel | null, source?: FilterChangeSource) => void;
  clearColumnFilter: (field: string, source?: FilterChangeSource) => void;
  getFilterConfig?: (field: string) => NormalizedColumnFilterConfig | null;
  getOptions?: () => ColumnMenuOptions | undefined;
  getSelectionValues?: (args: GetSelectionValuesArgs) => FilterSelectionValueResult;
  getRows?: () => RowData[];
  renderSelectionValuePreview?: (ctx: FilterSelectionPreviewRenderContext) => HTMLElement | null;
}

export function filterMenuContribution(
  options: FilterMenuContributionOptions,
): ColumnMenuContribution {
  return {
    id: "filter",
    getSections(ctx: ColumnMenuContext): ColumnMenuSection[] {
      if (!ctx.column.filterable) return [];

      const menuOpts = options.getOptions?.();
      const resolved = resolveFilterMenuOptions(menuOpts);
      if (!resolved.conditionMainMenu && !resolved.selectionMainMenu) return [];

      const mode = resolveColumnMenuSectionMode<ColumnMenuFilterOptions>(
        menuOpts,
        "filter",
      );
      if (mode.hidden) return [];

      const activeModel = options.getColumnFilterModel(ctx.field);
      const config = options.getFilterConfig?.(ctx.field) ?? null;
      const items: ColumnMenuItem[] = [];

      if (isColumnMenuSectionItemEnabled(mode, "clear")) {
        items.push({
          id: "filter-clear",
          label: "Clear filter",
          icon: "✕",
          hidden: activeModel === null,
          action: () => {
            ctx.close();
            options.clearColumnFilter(ctx.field, "ui");
          },
        });
      }

      const section: ColumnMenuSection = { id: "filter", items };

      if (config) {
        section.render = (host) => {
          const formatBooleanLabel = buildFilterValueLabel(ctx.column, config);
          const { element, cleanup } = createFilterMenuForm({
            field: ctx.field,
            headerName: ctx.column.headerName,
            config,
            currentModel: activeModel,
            setColumnFilterModel: options.setColumnFilterModel,
            clearColumnFilter: options.clearColumnFilter,
            close: ctx.close,
            formatBooleanLabel,
            showConditions: resolved.conditionMainMenu,
            showSelectionList: resolved.selectionMainMenu,
            getSelectionValues: resolved.selectionMainMenu ? options.getSelectionValues : undefined,
            renderSelectionValuePreview: options.renderSelectionValuePreview
              ? (previewCtx) => options.renderSelectionValuePreview!({
                  ...previewCtx,
                  column: ctx.column,
                  sampleRow: options.getRows?.()[previewCtx.sampleRowIndex],
                })
              : undefined,
          });
          host.appendChild(element);
          return cleanup;
        };
      }

      return [section];
    },
  };
}
