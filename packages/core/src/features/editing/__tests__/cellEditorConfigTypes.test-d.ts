/**
 * Boolean Cell V1 — Test 21: discriminated-union compile-time contract.
 *
 * `.test-d.ts` is typecheck-only; there is no runtime assertion here. The
 * `@ts-expect-error` directives fail the build if the union ever stops
 * rejecting kind-specific options on the wrong editor.
 */

import type {
  CellEditorConfig,
  CellShellConfig,
  CheckboxActivation,
  CheckboxCellEditorConfig,
  SelectCellEditorConfig,
} from "../../../types";

// ── Valid configurations must keep compiling ──────────────────────────

const text: CellEditorConfig = {
  type: "text",
  maxLength: 10,
  placeholder: "p",
  required: true,
};
const num: CellEditorConfig = {
  type: "number",
  placeholder: "0",
  required: false,
};
const date: CellEditorConfig = { type: "date", required: true };
const select: CellEditorConfig = {
  type: "select",
  options: ["a", "b"],
  required: true,
};
const selectObj: SelectCellEditorConfig = {
  type: "select",
  options: [{ value: 1, label: "one" }],
};
const checkbox: CellEditorConfig = {
  type: "checkbox",
  activation: "toggle",
  required: true,
};
const checkboxAuto: CheckboxCellEditorConfig = { type: "checkbox" };
const booleanAlias: CellEditorConfig = { type: "boolean", activation: "edit" };
const activations: CheckboxActivation[] = ["auto", "toggle", "edit"];

// ── activation must be rejected on every non-checkbox editor ──────────

// @ts-expect-error activation is checkbox-only
const badText: CellEditorConfig = { type: "text", activation: "toggle" };
// @ts-expect-error activation is checkbox-only
const badNumber: CellEditorConfig = { type: "number", activation: "toggle" };
// @ts-expect-error activation is checkbox-only
const badDate: CellEditorConfig = { type: "date", activation: "edit" };
// @ts-expect-error activation is checkbox-only
const badSelect: CellEditorConfig = { type: "select", activation: "auto" };

// ── options must be rejected on non-select editors ────────────────────

// @ts-expect-error options are select-only
const badCheckboxOptions: CellEditorConfig = { type: "checkbox", options: ["a"] };

// ── activation values are constrained ─────────────────────────────────

// @ts-expect-error "always" is not a CheckboxActivation
const badActivationValue: CellEditorConfig = { type: "checkbox", activation: "always" };

// ── tone.from must not accept a mapped source (non-recursive) ─────────

const validTone: CellShellConfig = {
  kind: "badge",
  tone: { from: "value", map: { true: "ok" }, fallback: "neutral" },
};

const validMappedText: CellShellConfig = {
  kind: "text",
  text: { from: "value", map: { true: "Yes", false: "No" }, fallback: "?" },
};

const validMappedImage: CellShellConfig = {
  kind: "image",
  image: {
    src: { from: "value", map: { true: "/y.svg", false: "/n.svg" } },
    alt: { from: "value", map: { true: "Yes", false: "No" } },
  },
};

const nestedFromBase: CellShellConfig = {
  kind: "text",
  text: { from: { field: "status" }, map: { ok: "OK" } },
};

const badTone: CellShellConfig = {
  kind: "badge",
  // @ts-expect-error tone.from is a base source; a mapped source may not nest
  tone: { from: { from: "value", map: { a: "b" } }, map: { x: "y" } },
};

const badNestedFrom: CellShellConfig = {
  kind: "text",
  // @ts-expect-error a mapped source may not nest inside another mapped source
  text: { from: { from: "value", map: { a: "b" } }, map: { x: "y" } },
};

const badFallbackOnly: CellShellConfig = {
  kind: "text",
  // @ts-expect-error map is required on a mapped source
  text: { from: "value", fallback: "only" },
};

// Reference every binding so `noUnusedLocals` stays satisfied.
export const __typeOnlyFixtures = {
  text,
  num,
  date,
  select,
  selectObj,
  checkbox,
  checkboxAuto,
  booleanAlias,
  activations,
  badText,
  badNumber,
  badDate,
  badSelect,
  badCheckboxOptions,
  badActivationValue,
  validTone,
  validMappedText,
  validMappedImage,
  nestedFromBase,
  badTone,
  badNestedFrom,
  badFallbackOnly,
};
