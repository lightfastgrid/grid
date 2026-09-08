import type {
  ColumnDef,
  ColumnMenuGridApi,
  ColumnMenuOptions,
  ColumnPinState,
  ColumnSizeToFitSource,
  SortChangeSource,
  SortDirection,
  SortModel,
} from "../../types";
import { columnPinningMenuContribution } from "../column-pinning/columnPinningMenuContribution";
import { sizingMenuContribution } from "../resize/sizingMenuContribution";
import { sortColumnMenuContribution } from "../sort/sortColumnMenuContribution";
import type { ColumnMenuCapability, DomGridFeature } from "../types";

import type { ColumnMenuContributionRegistry } from "./columnMenuContributionRegistry";
import { ColumnMenuController } from "./ColumnMenuController";
import type { ColumnMenuContribution } from "./types";
import { visibilityMenuContribution } from "./visibilityMenuContribution";

export interface ColumnMenuFeatureOptions {
  getColumns: () => ColumnDef[];
  getSortModel: () => SortModel;
  setColumnSort: (field: string, direction: SortDirection | null, source?: SortChangeSource, opts?: { multi?: boolean }) => void;
  pinColumn: (field: string, pinned: "left" | "right" | false) => void;
  setColumnPinState?: (state: ColumnPinState[]) => void;
  hideColumns?: (fields: string[]) => void;
  sizeColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  sizeSelectedColumnsToFit?: (source?: ColumnSizeToFitSource) => void;
  resetColumnWidths?: (source?: ColumnSizeToFitSource) => void;
  autoSizeColumn?: (field: string, source?: ColumnSizeToFitSource) => void;
  autoSizeSelectedColumns?: (source?: ColumnSizeToFitSource) => void;
  getSelectedColumnIds?: () => string[];
  getMenuApi?: () => ColumnMenuGridApi;
  getColumnMenuOptions?: () => ColumnMenuOptions | undefined;
  columnMenuContributions?: ColumnMenuContributionRegistry;
  onOpenFieldChange?: (openField: string | null) => void;
}

export function columnMenuFeature(
  options: ColumnMenuFeatureOptions,
): DomGridFeature & ColumnMenuCapability {
  let controller: ColumnMenuController | null = null;

  return {
    name: "column-menu",

    attach(ctx) {
      const contributions: ColumnMenuContribution[] = [
        sortColumnMenuContribution({
          setColumnSort: options.setColumnSort,
          getOptions: () => options.getColumnMenuOptions?.(),
        }),
      ];

      if (options.columnMenuContributions) {
        contributions.push(...options.columnMenuContributions.getAll());
      }

      contributions.push(
        columnPinningMenuContribution({
          pinColumn: options.pinColumn,
          setColumnPinState: options.setColumnPinState,
          getOptions: () => options.getColumnMenuOptions?.(),
        }),
      );

      if (options.hideColumns) {
        contributions.push(
          visibilityMenuContribution({
            hideColumns: options.hideColumns,
            getOptions: () => options.getColumnMenuOptions?.(),
          }),
        );
      }

      if (
        options.sizeColumnsToFit ||
        options.sizeSelectedColumnsToFit ||
        options.resetColumnWidths ||
        options.autoSizeColumn ||
        options.autoSizeSelectedColumns
      ) {
        contributions.push(
          sizingMenuContribution({
            sizeColumnsToFit: options.sizeColumnsToFit,
            sizeSelectedColumnsToFit: options.sizeSelectedColumnsToFit,
            resetColumnWidths: options.resetColumnWidths,
            autoSizeColumn: options.autoSizeColumn,
            autoSizeSelectedColumns: options.autoSizeSelectedColumns,
            getOptions: () => options.getColumnMenuOptions?.(),
          }),
        );
      }

      controller = new ColumnMenuController({
        gridRoot: ctx.root,
        viewport: ctx.viewport,
        getColumns: options.getColumns,
        getSortModel: options.getSortModel,
        getSelectedColumnIds: () => ctx.getSelectedColumnIdsForColumnOrder(),
        contributions,
        getMenuApi: options.getMenuApi,
        getColumnMenuOptions: options.getColumnMenuOptions,
        onOpenFieldChange: options.onOpenFieldChange,
      });
      controller.attach(ctx.root);
    },

    getOpenColumnMenuField(): string | null {
      return controller?.getOpenField() ?? null;
    },

    getOpenColumnMenuPopupId(): string | null {
      return controller?.getOpenPopupId() ?? null;
    },

    requestOpenColumnMenu(field, trigger): boolean {
      return controller?.requestOpenFromCommand(field, trigger) ?? false;
    },

    closeColumnMenuFromCommand(): boolean {
      return controller?.closeFromCommand() ?? false;
    },

    isColumnMenuOpen(): boolean {
      return controller?.isOpen() ?? false;
    },

    detach() {
      controller?.detach();
      controller = null;
    },
  };
}
