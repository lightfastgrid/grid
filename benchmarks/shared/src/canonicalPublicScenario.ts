export const CANONICAL_PUBLIC_SCENARIO_NAME = "runtime-publish";
export const CANONICAL_PUBLIC_ROW_COUNT = 100_000;
export const CANONICAL_PUBLIC_COLUMN_COUNT = 50;

export function isCanonicalPublicScenario(options: {
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
}): boolean {
  return (
    options.name === CANONICAL_PUBLIC_SCENARIO_NAME &&
    options.rowCount === CANONICAL_PUBLIC_ROW_COUNT &&
    options.columnCount === CANONICAL_PUBLIC_COLUMN_COUNT
  );
}

export function assertCanonicalPublicScenario(
  profileId: string,
  scenario: { readonly name: string; readonly rowCount: number; readonly columnCount: number },
): void {
  if (profileId !== "publish" && profileId !== "publish-native") return;
  if (isCanonicalPublicScenario(scenario)) return;
  throw new Error(
    `Public-candidate profile "${profileId}" must use ${CANONICAL_PUBLIC_SCENARIO_NAME} at ${CANONICAL_PUBLIC_ROW_COUNT} × ${CANONICAL_PUBLIC_COLUMN_COUNT}, got ${scenario.name} ${scenario.rowCount} × ${scenario.columnCount}`,
  );
}
