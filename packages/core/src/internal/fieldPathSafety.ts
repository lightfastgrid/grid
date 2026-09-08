/**
 * Neutral field-path parsing and safety validation.
 *
 * Extracted from the editing feature so that both editing and any
 * presentation layer that must agree with editing (e.g. the boolean checkbox
 * shell, which renders a disabled control for ineligible cells) share exactly
 * one implementation. See `BOOLEAN_CELL_V1_ARCHITECTURE.md` §7.2.
 *
 * Pure: no DOM or row mutation. Validation is allocation-free; parsing
 * allocates only the returned segment array.
 */

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type FieldPathResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** Split a dotted field path, rejecting empty and prototype-polluting segments. */
export function parseFieldPathSegments(field: string): FieldPathResult<string[]> {
  if (field === "") return { ok: false, reason: "Empty field path" };
  const segments = field.split(".");
  for (const seg of segments) {
    if (seg === "") return { ok: false, reason: "Empty segment in field path" };
    if (UNSAFE_KEYS.has(seg)) {
      return { ok: false, reason: `Unsafe path segment: ${seg}` };
    }
  }
  return { ok: true, value: segments };
}

/** Whether a field path is safe to read and write through. */
export function isFieldPathSafe(field: string): boolean {
  if (field.length === 0) return false;
  let segmentStart = 0;
  for (let index = 0; index <= field.length; index++) {
    if (index !== field.length && field.charCodeAt(index) !== 46) continue;
    if (index === segmentStart) return false;
    const segmentLength = index - segmentStart;
    if (
      (segmentLength === 9 &&
        (field.startsWith("__proto__", segmentStart) ||
          field.startsWith("prototype", segmentStart))) ||
      (segmentLength === 11 && field.startsWith("constructor", segmentStart))
    ) {
      return false;
    }
    segmentStart = index + 1;
  }
  return true;
}
