/**
 * Accessibility plugin — registry-facing private surface.
 *
 * Only the feature registry may import these constructors. Row/rowgroup ARIA
 * helpers remain private under `utils/`; the one-way boundary is enforced by
 * `__tests__/accessibilityPluginBoundary.test.ts`.
 */
export {
  accessibilityFeature,
  createAccessibilityGridReadSeam,
} from "./accessibilityFeature";
