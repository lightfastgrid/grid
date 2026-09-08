export function resolveFilterColumnLabel(
  field: string,
  headerName: string | undefined,
): string {
  const visible = headerName?.trim() ?? "";
  if (visible !== "") return visible;
  const fallback = field.trim();
  return fallback === "" ? "Column" : fallback;
}

export function filterConditionOperatorName(
  columnLabel: string,
  conditionNumber: 1 | 2,
): string {
  return `${columnLabel} filter condition ${conditionNumber} operator`;
}

export function filterConditionValueName(
  columnLabel: string,
  conditionNumber: 1 | 2,
): string {
  return `${columnLabel} filter condition ${conditionNumber} value`;
}

export function filterConditionEndingValueName(
  columnLabel: string,
  conditionNumber: 1 | 2,
): string {
  return `${columnLabel} filter condition ${conditionNumber} ending value`;
}

export function filterJoinName(
  columnLabel: string,
  join: "AND" | "OR",
): string {
  return `${join}, combine ${columnLabel} filter conditions`;
}

export function filterSelectionSearchName(columnLabel: string): string {
  return `Search ${columnLabel} filter values`;
}

export function filterSelectionValueName(
  columnLabel: string,
  visibleValueLabel: string,
): string {
  const visible = visibleValueLabel.trim();
  return visible === ""
    ? `Blank value, filter ${columnLabel}`
    : `${visible}, filter ${columnLabel}`;
}

export function floatingFilterValueName(columnLabel: string): string {
  return `Filter ${columnLabel}`;
}

export function floatingFilterMinimumName(columnLabel: string): string {
  return `Minimum ${columnLabel} filter`;
}

export function floatingFilterMaximumName(columnLabel: string): string {
  return `Maximum ${columnLabel} filter`;
}

export function floatingFilterStartDateName(columnLabel: string): string {
  return `Start ${columnLabel} date filter`;
}

export function floatingFilterEndDateName(columnLabel: string): string {
  return `End ${columnLabel} date filter`;
}

export function openFilterMenuName(columnLabel: string): string {
  return `Open filter menu for ${columnLabel}`;
}
