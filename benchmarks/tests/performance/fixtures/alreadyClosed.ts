export function isAlreadyClosedCleanupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed|Browser has been closed|Test ended|already closed/i.test(
    message,
  );
}
