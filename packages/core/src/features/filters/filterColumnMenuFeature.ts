import type { DomGridFeatureContext } from "../../internal/layoutTypes";
import type {
  ColumnDef,
  ColumnFilterModel,
  ColumnMenuOptions,
  FilterChangeSource,
  FilterModel,
  RowData,
} from "../../types";
import type { ColumnMenuContributionRegistry } from "../column-menu/columnMenuContributionRegistry";
import type {
  DedicatedFilterPopupCapability,
  DomGridFeature,
  FilterIndicatorCapability,
} from "../types";

import { DedicatedFilterController } from "./DedicatedFilterController";
import { FilterIndicatorController } from "./FilterIndicatorController";
import { filterMenuContribution } from "./filterMenuContribution";
import { createFilterSelectionValueProvider } from "./filterSelectionValueProvider";
import { hasMainMenu, resolveFilterMenuOptions } from "./resolveFilterMenuOptions";
import type { NormalizedColumnFilterConfig } from "./types";

export interface FilterSelectionPreviewRenderContext {
  column: ColumnDef;
  field: string;
  value: string | number | boolean;
  label: string;
  sampleRowIndex: number;
  sampleRow: RowData | undefined;
}

export interface FilterColumnMenuFeatureOptions {
  getColumns: () => ColumnDef[];
  getColumnFilterModel: (field: string) => ColumnFilterModel | null;
  setColumnFilterModel: (field: string, model: ColumnFilterModel | null, source?: FilterChangeSource) => void;
  clearColumnFilter: (field: string, source?: FilterChangeSource) => void;
  getFilterConfig?: (field: string) => NormalizedColumnFilterConfig | null;
  getFilterModel?: () => FilterModel;
  getColumnMenuOptions?: () => ColumnMenuOptions | undefined;
  getRows?: () => RowData[];
  renderSelectionValuePreview?: (ctx: FilterSelectionPreviewRenderContext) => HTMLElement | null;
  columnMenuContributions?: ColumnMenuContributionRegistry;
}

export function filterColumnMenuFeature(
  options: FilterColumnMenuFeatureOptions,
): DomGridFeature & FilterIndicatorCapability & DedicatedFilterPopupCapability {
  let dedicatedFilter: DedicatedFilterController | null = null;
  let filterIndicator: FilterIndicatorController | null = null;
  let unregisterContribution: (() => void) | null = null;

  const getColumnFilterConfigs = options.getFilterConfig
    ? (): ReadonlyMap<string, NormalizedColumnFilterConfig> => {
        const map = new Map<string, NormalizedColumnFilterConfig>();
        for (const col of options.getColumns()) {
          const cfg = options.getFilterConfig!(col.field);
          if (cfg) map.set(col.field, cfg);
        }
        return map;
      }
    : undefined;

  const getSelectionValues = options.getRows && options.getFilterConfig
    ? createFilterSelectionValueProvider({
        getRows: options.getRows,
        getColumns: options.getColumns,
        getFilterConfig: options.getFilterConfig,
        getFilterModel: options.getFilterModel,
        getColumnFilterConfigs,
      })
    : undefined;

  return {
    name: "filter-column-menu",

    attach(ctx: DomGridFeatureContext): void {
      if (options.columnMenuContributions) {
        unregisterContribution = options.columnMenuContributions.add(
          filterMenuContribution({
            getColumnFilterModel: options.getColumnFilterModel,
            setColumnFilterModel: options.setColumnFilterModel,
            clearColumnFilter: options.clearColumnFilter,
            getFilterConfig: options.getFilterConfig,
            getOptions: () => options.getColumnMenuOptions?.(),
            getSelectionValues,
            getRows: options.getRows,
            renderSelectionValuePreview: options.renderSelectionValuePreview,
          }),
        );
      }
      dedicatedFilter = new DedicatedFilterController({
        gridRoot: ctx.root,
        viewport: ctx.viewport,
        getColumns: options.getColumns,
        getColumnFilterModel: options.getColumnFilterModel,
        setColumnFilterModel: options.setColumnFilterModel,
        clearColumnFilter: options.clearColumnFilter,
        getFilterConfig: options.getFilterConfig,
        getColumnMenuOptions: options.getColumnMenuOptions,
        getSelectionValues,
        getRows: options.getRows,
        renderSelectionValuePreview: options.renderSelectionValuePreview,
      });
      dedicatedFilter.attach(ctx.root);

      if (options.getFilterModel) {
        filterIndicator = new FilterIndicatorController({
          getFilterModel: options.getFilterModel,
          getHeaderIcons: () => {
            const menuOpts = options.getColumnMenuOptions?.();
            const icons = menuOpts?.headerIcons;
            const f = menuOpts?.filter;
            const legacyFilterIcon = typeof f === "object" ? f.activeIcon : undefined;
            if (!icons && !legacyFilterIcon) return undefined;
            if (legacyFilterIcon && !icons?.filtered) {
              return { ...icons, filtered: legacyFilterIcon };
            }
            return icons;
          },
          showMainMenuIndicator: () =>
            hasMainMenu(resolveFilterMenuOptions(options.getColumnMenuOptions?.())),
          gridRoot: ctx.root,
          getHeaderRowEl: () => ctx.getHeaderRowEl(),
          getPinnedHeaderRowEl: () => ctx.getPinnedHeaderRowEl(),
          getPinnedRightHeaderRowEl: () => ctx.getPinnedRightHeaderRowEl(),
        });
      }
    },

    syncFilterIndicatorState(): void {
      filterIndicator?.syncFilterIndicatorState();
      dedicatedFilter?.syncPlacementState();
    },

    requestOpenDedicatedFilter(field, trigger): boolean {
      return dedicatedFilter?.requestOpenFromCommand(field, trigger) ?? false;
    },

    closeDedicatedFilterFromCommand(): boolean {
      return dedicatedFilter?.closeFromCommand() ?? false;
    },

    isDedicatedFilterOpen(): boolean {
      return dedicatedFilter?.isOpen() ?? false;
    },

    detach(): void {
      unregisterContribution?.();
      unregisterContribution = null;
      dedicatedFilter?.detach();
      dedicatedFilter = null;
      filterIndicator = null;
    },
  };
}
