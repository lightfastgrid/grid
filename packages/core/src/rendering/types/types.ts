export type PrimitiveDomValue = string | number | boolean;

export type NullableDomValue =
  | PrimitiveDomValue
  | null
  | undefined;

export type DomChild =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined;

export type ClassName =
  | string
  | readonly string[]
  | null
  | undefined;

export type DomAttributes = Record<string, NullableDomValue>;

export type DomDataset = Record<string, NullableDomValue>;

export type DomStyles = Partial<CSSStyleDeclaration>;

export interface GridSkeleton {
  root: HTMLDivElement;
  /**
   * Neutral viewport-only composite-grid surface. Wraps the viewport; owns the
   * base `tabindex="0"` and (via the accessibility plugin) `role="grid"` and
   * composite ARIA. Auxiliary layers stay outside it as root siblings.
   */
  surface: HTMLDivElement;
  header: HTMLDivElement;
  viewport: HTMLDivElement;
  scrollContainer: HTMLDivElement;
  /** Pinned-left body overlay; created lazily when pinned columns exist. */
  pinnedLeftLayer?: HTMLDivElement;
  /** Header row inside the pinned-left layer. */
  pinnedHeaderRow?: HTMLDivElement;
  /** Container for pinned body rows inside the pinned-left layer. */
  pinnedBodyContainer?: HTMLDivElement;
  /** Pinned-right body overlay; created lazily when right-pinned columns exist. */
  pinnedRightLayer?: HTMLDivElement;
  /** Header row inside the pinned-right layer. */
  pinnedRightHeaderRow?: HTMLDivElement;
  /** Container for pinned-right body rows. */
  pinnedRightBodyContainer?: HTMLDivElement;
  /** Row-pinned top layer; created lazily when top-pinned rows exist. */
  rowPinnedTopLayer?: HTMLDivElement;
  /** Row-pinned bottom layer; created lazily when bottom-pinned rows exist. */
  rowPinnedBottomLayer?: HTMLDivElement;
}

export type { PooledCell, PooledRow } from "../../internal/poolTypes";
