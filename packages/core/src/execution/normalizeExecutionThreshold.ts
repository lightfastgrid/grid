export function normalizeExecutionThreshold(
  value: number | undefined,
  operationDefault: number,
): number {
  if (value === undefined) return operationDefault;
  if (!Number.isFinite(value) || value < 0) return operationDefault;
  return Math.floor(value);
}
