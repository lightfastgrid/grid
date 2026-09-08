import { waitAnimationFrames, waitForPredicate, waitWithTimeout } from "./completion.ts";

/**
 * Core marks in-flight Worker sort on the sorted header cell. There is no
 * public `sort-pending:changed` event; `sort:changed` fires when the SortModel
 * is accepted, which can be before Worker rows are committed.
 */
export const LIGHTFASTGRID_SORT_PENDING_SELECTOR = ".lfg-header-sort-pending";

export async function waitForLightFastGridSortVisible(
  host: HTMLElement,
  appLabel: string,
): Promise<void> {
  let sawPending = false;
  for (let frame = 0; frame < 8; frame += 1) {
    await waitAnimationFrames(1);
    if (host.querySelector(LIGHTFASTGRID_SORT_PENDING_SELECTOR)) {
      sawPending = true;
      break;
    }
  }
  if (sawPending || host.querySelector(LIGHTFASTGRID_SORT_PENDING_SELECTOR)) {
    await waitWithTimeout(
      `${appLabel} sort stayed pending`,
      waitForPredicate(
        () => !host.querySelector(LIGHTFASTGRID_SORT_PENDING_SELECTOR),
        undefined,
        { label: `${appLabel} sort stayed pending` },
      ),
    );
  }
  await waitAnimationFrames(2);
}

export async function observeLightFastGridQuickSearchPending(
  isPending: () => boolean,
): Promise<boolean> {
  for (let frame = 0; frame < 16; frame += 1) {
    if (isPending()) return true;
    await waitAnimationFrames(1);
  }
  return isPending();
}

/**
 * Timed Quick Search / clear-search settlement shared by React and Vanilla:
 * accepted event has already fired, then Worker pending is observed when
 * applicable, pending becomes false, then two animation frames. The timed
 * operation ends here. Callers must not wait for a stale accessibility row
 * count and must not mutate loading/overlays to force a11y synchronization.
 */
export async function waitForLightFastGridQuickSearchSettlement(options: {
  readonly appLabel: string;
  readonly operation: string;
  readonly isPending: () => boolean;
  readonly sawPending?: () => boolean;
}): Promise<void> {
  const observed = () => Boolean(options.sawPending?.() || options.isPending());
  await observeLightFastGridQuickSearchPending(observed);
  if (observed()) {
    await waitWithTimeout(
      `${options.appLabel} ${options.operation} stayed pending`,
      waitForPredicate(() => !options.isPending(), undefined, {
        label: `${options.appLabel} ${options.operation} stayed pending`,
      }),
    );
  }
  await waitAnimationFrames(2);
}
