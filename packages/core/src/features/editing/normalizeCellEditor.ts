import type {
  CellEditorConfig,
  CellEditorKind,
  CheckboxActivation,
  SelectCellEditorConfig,
  SelectOptionValue,
} from "../../types";

import type { NormalizedCellEditorConfig, SelectOption } from "./editingTypes";

function normalizeKind(kind: CellEditorKind): NormalizedCellEditorConfig["kind"] {
  return kind === "boolean" ? "checkbox" : kind;
}

function isSupportedOptionValue(v: unknown): v is SelectOptionValue {
  if (v === null) return true;
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean";
}

function normalizeOptions(
  raw: SelectCellEditorConfig["options"],
): readonly SelectOption[] {
  if (!raw || !Array.isArray(raw)) return [];
  const out: SelectOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push({ value: item, label: item });
    } else if (
      item !== null &&
      typeof item === "object" &&
      "value" in item &&
      "label" in item
    ) {
      if (!isSupportedOptionValue(item.value)) continue;
      const key = String(item.value);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ value: item.value, label: String(item.label) });
    }
  }
  return out;
}

export function normalizeCellEditor(
  editor: CellEditorKind | CellEditorConfig | undefined,
): NormalizedCellEditorConfig {
  if (editor === undefined) {
    return { kind: "text", options: [] };
  }

  if (typeof editor === "string") {
    return { kind: normalizeKind(editor), options: [] };
  }

  return {
    kind: normalizeKind(editor.type),
    options: normalizeOptions(readOptions(editor)),
    maxLength: editor.maxLength,
    placeholder: editor.placeholder,
    required: editor.required === true ? true : undefined,
    activation: readActivation(editor),
  };
}

/**
 * Read `options` from a select editor config. Returns `undefined` for every
 * other kind, so the option cannot leak onto an unrelated editor at runtime
 * even when the compile-time union is bypassed.
 */
function readOptions(
  editor: CellEditorConfig,
): SelectCellEditorConfig["options"] {
  return editor.type === "select" ? editor.options : undefined;
}

/**
 * Read `activation` from a checkbox editor config. Returns `undefined` for
 * every other kind, so the option can never leak onto an unrelated editor at
 * runtime even when the compile-time union is bypassed.
 */
function readActivation(
  editor: CellEditorConfig,
): CheckboxActivation | undefined {
  return editor.type === "checkbox" || editor.type === "boolean"
    ? editor.activation
    : undefined;
}
