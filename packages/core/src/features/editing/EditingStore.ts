import type { NormalizedCellEditorConfig } from "./editingTypes";

export interface ActiveEdit {
  rowId: string;
  rowIndex: number;
  field: string;
  sourceIndex: number;
  originalValue: unknown;
  editorConfig: NormalizedCellEditorConfig;
}

export class EditingStore {
  private active: ActiveEdit | null = null;

  get(): ActiveEdit | null {
    return this.active;
  }

  start(edit: ActiveEdit): void {
    this.active = edit;
  }

  clear(): void {
    this.active = null;
  }

  isEditing(rowId: string, field: string): boolean {
    return this.active !== null && this.active.rowId === rowId && this.active.field === field;
  }
}
