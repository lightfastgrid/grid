import type { CellShellValueSource } from "../../types";

import type { CellShellConfig } from "./cellShellTypes";

/**
 * Whether a value source reads a row field other than the column's own.
 *
 * `"value"` / `"formattedValue"` resolve from the column's own field, and a
 * `{ literal }` source is constant — none introduce an external dependency.
 * Only `{ field }` pointing at a different field does.
 */
function sourceRefsOtherField(
  source: CellShellValueSource | undefined,
  ownField: string,
): boolean {
  if (source === undefined) return false;
  if (typeof source === "string") return false;
  if ("field" in source) return source.field !== ownField;
  return false;
}

/**
 * Whether a cell shell's rendered output depends only on the column's own
 * field value. Returns `false` when any value source (text, image src/alt,
 * tone, or a nested part) reads a different row field — such a column must
 * refresh when that other field changes, so it cannot take the field-level
 * dirty-skip fast path.
 */
export function cellShellDependsOnlyOnOwnField(
  config: CellShellConfig,
  ownField: string,
): boolean {
  if (sourceRefsOtherField(config.text, ownField)) return false;
  if (config.image) {
    if (sourceRefsOtherField(config.image.src, ownField)) return false;
    if (sourceRefsOtherField(config.image.alt, ownField)) return false;
  }
  if (config.tone && sourceRefsOtherField(config.tone.from, ownField)) {
    return false;
  }
  if (config.parts) {
    for (const part of config.parts) {
      if (!cellShellDependsOnlyOnOwnField(part, ownField)) return false;
    }
  }
  return true;
}
