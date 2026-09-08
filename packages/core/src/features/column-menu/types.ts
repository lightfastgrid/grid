import type { ColumnDef, ColumnMenuItem, ColumnMenuSection, SortModel } from "../../types";

export type { ColumnMenuItem, ColumnMenuSection };

export interface ColumnMenuContext {
  field: string;
  column: ColumnDef;
  columns: ColumnDef[];
  sortModel: SortModel;
  selectedColumnIds: string[];
  close: () => void;
}

export interface ColumnMenuContribution {
  id: string;
  getSections(ctx: ColumnMenuContext): ColumnMenuSection[];
}
