/**
 * Preserve visible control text in a custom accessible name (WCAG 2.5.3).
 * Icon-only controls pass empty/undefined visible text and skip the rule.
 */
export function composeAccessibleNameWithVisibleText(
  visibleText: string | undefined,
  customName: string,
): string {
  const visible = visibleText?.trim() ?? "";
  if (visible.length === 0 || customName.includes(visible)) {
    return customName;
  }
  return `${visible} ${customName}`;
}
