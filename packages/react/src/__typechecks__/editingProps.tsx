import type {
  CellEditEligibilityContext,
  CellEditorConfig,
  CellEditorKind,
  LightFastGridBeforeCellEditCommitEvent,
  LightFastGridCellValueChangedEvent,
} from '@lightfastgrid/core';

import type { ReactLightFastGridProps } from '../types';

// Verify editable: boolean
const _boolEditable: ReactLightFastGridProps = {
  columns: [{ field: 'name', editable: true }],
  rows: [],
};

// Verify editable: callback
const _cbEditable: ReactLightFastGridProps = {
  columns: [{
    field: 'name',
    editable: (ctx: CellEditEligibilityContext) => ctx.value !== null,
  }],
  rows: [],
};

// Verify editor: string shorthand
const _kindEditor: ReactLightFastGridProps = {
  columns: [{
    field: 'name',
    editable: true,
    editor: 'select' satisfies CellEditorKind,
  }],
  rows: [],
};

// Verify editor: config object
const _configEditor: ReactLightFastGridProps = {
  columns: [{
    field: 'status',
    editable: true,
    editor: {
      type: 'select',
      options: ['a', 'b', { value: 1, label: 'One' }],
      required: true,
    } satisfies CellEditorConfig,
  }],
  rows: [],
};

// Verify onCellValueChanged callback
const _valueChanged: ReactLightFastGridProps = {
  columns: [{ field: 'name', editable: true }],
  rows: [],
  onCellValueChanged: (e: LightFastGridCellValueChangedEvent) => {
    console.warn(e.oldValue, e.newValue, e.columnId, e.row);
  },
};

// Verify onBeforeCellEditCommit callback (pre-commit derived fields)
const _beforeCommit: ReactLightFastGridProps = {
  columns: [{ field: 'name', editable: true }],
  rows: [],
  onBeforeCellEditCommit: (e: LightFastGridBeforeCellEditCommitEvent) => {
    console.warn(e.columnId, e.newValue, e.row);
  },
};

// Verify deprecated editor form still accepted
const _legacyEditor: ReactLightFastGridProps = {
  columns: [{
    field: 'name',
    editable: true,
    editor: { type: 'boolean' as const, options: ['a'] },
  }],
  rows: [],
};

void [_boolEditable, _cbEditable, _kindEditor, _configEditor, _valueChanged, _beforeCommit, _legacyEditor];
