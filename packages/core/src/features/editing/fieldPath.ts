import type { FieldPathResult } from "../../internal/fieldPathSafety";
import { parseFieldPathSegments } from "../../internal/fieldPathSafety";
import type { RowData } from "../../types";

// Path parsing and safety validation live in the neutral internal module so
// editing and presentation share one implementation (architecture §7.2).
export type { FieldPathResult } from "../../internal/fieldPathSafety";
export { isFieldPathSafe } from "../../internal/fieldPathSafety";

const parseSegments = parseFieldPathSegments;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function getEditableFieldValue(row: RowData, field: string): FieldPathResult {
  const parsed = parseSegments(field);
  if (!parsed.ok) return parsed;

  let current: unknown = row;
  for (const seg of parsed.value) {
    if (current === null || current === undefined || typeof current !== "object") {
      return { ok: true, value: undefined };
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return { ok: true, value: current };
}

export function setEditableFieldValue(
  row: RowData,
  field: string,
  value: unknown,
): FieldPathResult<{ row: RowData; changed: boolean }> {
  const parsed = parseSegments(field);
  if (!parsed.ok) return parsed;

  const segments = parsed.value;

  const existing = getEditableFieldValue(row, field);
  if (existing.ok && Object.is(existing.value, value)) {
    return { ok: true, value: { row, changed: false } };
  }

  if (segments.length === 1) {
    return { ok: true, value: { row: { ...row, [segments[0]!]: value }, changed: true } };
  }

  // Clone only objects along the edited path.
  const newRow = { ...row };
  let target: Record<string, unknown> = newRow;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const child = target[seg];
    const cloned = isPlainRecord(child) ? { ...child } : {};
    target[seg] = cloned;
    target = cloned;
  }

  target[segments[segments.length - 1]!] = value;
  return { ok: true, value: { row: newRow, changed: true } };
}
