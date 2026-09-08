/**
 * Boolean Cell V1 — Test 22 (React half).
 *
 * Typechecks the **built** `@lightfastgrid/react` declaration output.
 * Proves the architecture's direct re-export requirement: the new public
 * boolean-cell types are reachable from the adaptor entry point, and the exact
 * editor union survives into `ReactLightFastGridProps`.
 */

import type {
  BaseCellEditorConfig as CoreBaseCellEditorConfig,
  CellEditorConfig as CoreCellEditorConfig,
  CheckboxActivation as CoreCheckboxActivation,
  ColumnDef,
} from '@lightfastgrid/core';
import {
  type BaseCellEditorConfig,
  type CellEditorConfig,
  type CellShellBaseValueSource,
  type CellShellMappedValueSource,
  type CheckboxActivation,
  type CheckboxCellEditorConfig,
  type DateCellEditorConfig,
  LightFastGrid,
  type NumberCellEditorConfig,
  type ReactLightFastGridProps,
  type SelectCellEditorConfig,
  type TextCellEditorConfig,
} from '@lightfastgrid/react';

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

// ── Re-exported adaptor types are identical to the core types ─────────

const activationReExportIsExact: IsExact<CheckboxActivation, CoreCheckboxActivation> =
  true;
const editorReExportIsExact: IsExact<CellEditorConfig, CoreCellEditorConfig> = true;
const baseEditorReExportIsExact: IsExact<
  BaseCellEditorConfig,
  CoreBaseCellEditorConfig
> = true;

// ── The union keeps its exact five members through the adaptor ────────

const adaptorUnionIsExact: IsExact<
  CellEditorConfig,
  | TextCellEditorConfig
  | NumberCellEditorConfig
  | DateCellEditorConfig
  | SelectCellEditorConfig
  | CheckboxCellEditorConfig
> = true;

// ── Columns flow through ReactLightFastGridProps ──────────────────────

const toggleColumn: ColumnDef = {
  field: 'bought',
  editable: true,
  cellShell: {
    kind: 'checkbox',
    checkbox: {
      label: { from: 'value', map: { true: 'Purchased', false: 'Not purchased' } },
      ariaLabel: { literal: 'Purchase status' },
    },
  },
  editor: { type: 'checkbox', activation: 'toggle' },
};

const src: CellShellMappedValueSource = {
  from: 'value',
  map: { true: '/y.svg', false: '/n.svg' },
};
const altBase: CellShellBaseValueSource = 'formattedValue';

const editGatedColumn: ColumnDef = {
  field: 'shipped',
  editable: true,
  editor: { type: 'checkbox', activation: 'edit' },
  valueFormatter: ({ value }) => (value ? 'Shipped' : 'Pending'),
  cellShell: { kind: 'image', image: { src, alt: altBase } },
};

const requiredEditorColumn: ColumnDef = {
  field: 'name',
  editable: true,
  editor: { type: 'text', required: true },
};

const props: ReactLightFastGridProps = {
  columns: [toggleColumn, editGatedColumn, requiredEditorColumn],
  rows: [{ bought: true, shipped: false, name: 'Ada' }],
};

function Consumer() {
  return <LightFastGrid {...props} />;
}

export const __reactDeclarationFixtures = {
  activationReExportIsExact,
  editorReExportIsExact,
  baseEditorReExportIsExact,
  adaptorUnionIsExact,
  props,
  Consumer,
};
