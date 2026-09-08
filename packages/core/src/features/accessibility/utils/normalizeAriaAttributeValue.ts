/** Trim and treat blank strings as unset for optional ARIA string attrs. */
export function normalizeAriaAttributeValue(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
