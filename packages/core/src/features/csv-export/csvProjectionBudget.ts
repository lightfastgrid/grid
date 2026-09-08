/** Normalize a projection budget so every active step makes progress. */
export function normalizeCsvProjectionBudget(budget: number): number {
  const floored = Math.floor(budget);
  if (!Number.isFinite(floored) || floored < 1) return 1;
  return floored;
}
