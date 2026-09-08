/**
 * Boolean Cell V1 — Test 22 (core half).
 *
 * Typechecks the **built** `@lightfastgrid/core` declaration output, not the
 * source tree. It fails if the production `dist/index.d.ts` regresses to an
 * empty/stub declaration, drops any of the new public types, or loses the
 * discriminated shape of the editor union.
 *
 * Run under Bundler, NodeNext, and Node16 module resolution.
 */

import type {
  BaseCellEditorConfig,
  CellEditorConfig,
  CellShellBaseValueSource,
  CellShellConfig,
  CellShellMappedValueSource,
  CellShellValueSource,
  CheckboxActivation,
  CheckboxCellEditorConfig,
  ColumnDef,
  DateCellEditorConfig,
  NumberCellEditorConfig,
  SelectCellEditorConfig,
  TextCellEditorConfig,
} from '@lightfastgrid/core';

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false;

// ── The activation union survives declaration rollup exactly ──────────

const activationIsExact: IsExact<CheckboxActivation, 'auto' | 'toggle' | 'edit'> =
  true;
const requiredIsExact: IsExact<
  BaseCellEditorConfig['required'],
  boolean | undefined
> = true;

// ── The editor config is the exact five-member discriminated union ────

const editorUnionIsExact: IsExact<
  CellEditorConfig,
  | TextCellEditorConfig
  | NumberCellEditorConfig
  | DateCellEditorConfig
  | SelectCellEditorConfig
  | CheckboxCellEditorConfig
> = true;

// Discriminant narrowing must work through the built declaration.
function narrowsByDiscriminant(config: CellEditorConfig): CheckboxActivation | undefined {
  if (config.type === 'checkbox' || config.type === 'boolean') {
    // Narrowed to CheckboxCellEditorConfig: `activation` is reachable.
    return config.activation;
  }
  if (config.type === 'select') {
    // Narrowed to SelectCellEditorConfig: `options` is reachable.
    void config.options;
  }
  return undefined;
}

// Shared base options remain available on every member.
const baseOptionsReachable: BaseCellEditorConfig[] = [
  { maxLength: 4 },
  { placeholder: 'p' },
  { required: true },
];

// ── Mapped shell value sources survive rollup ─────────────────────────

const shellUnionIsExact: IsExact<
  CellShellValueSource,
  CellShellBaseValueSource | CellShellMappedValueSource
> = true;

const mapped: CellShellMappedValueSource = {
  from: 'value',
  map: { true: '/yes.svg', false: '/no.svg' },
  fallback: '',
};

const base: CellShellBaseValueSource = { field: 'status' };

// ── Real column definitions compile against the built types ───────────

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
  editor: { type: 'checkbox', activation: 'auto' },
};

const editGatedColumn: ColumnDef = {
  field: 'bought',
  editable: true,
  editor: { type: 'checkbox', activation: 'edit' },
  valueFormatter: ({ value }) => (value ? 'Purchased' : 'Not purchased'),
  cellShell: {
    kind: 'image',
    image: {
      src: { from: 'value', map: { true: '/y.svg', false: '/n.svg' } },
      alt: { from: 'value', map: { true: 'Purchased', false: 'Not purchased' } },
    },
  },
};

// tone.from stays a base source through the declaration.
const tonedShell: CellShellConfig = {
  kind: 'badge',
  tone: { from: 'value', map: { true: 'ok' }, fallback: 'neutral' },
};

export const __coreDeclarationFixtures = {
  activationIsExact,
  requiredIsExact,
  editorUnionIsExact,
  narrowsByDiscriminant,
  baseOptionsReachable,
  shellUnionIsExact,
  mapped,
  base,
  toggleColumn,
  editGatedColumn,
  tonedShell,
};
