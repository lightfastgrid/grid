/** Values that may participate in the boolean-cell presentation and commit paths. */
export type BooleanCellValue = boolean | null | undefined;

/**
 * Boolean cells deliberately do not coerce runtime values. In particular,
 * strings such as `"false"` and numeric zero are invalid rather than unchecked.
 */
export function isBooleanCellValue(value: unknown): value is BooleanCellValue {
  return value === true || value === false || value === null || value === undefined;
}
