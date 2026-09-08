export type FloatingPlacement =
  | "cell"
  | "bottom-start"
  | "bottom-center"
  | "bottom-end"
  | "top-start"
  | "top-center"
  | "top-end"
  | "left-start"
  | "left-center"
  | "left-end"
  | "right-start"
  | "right-center"
  | "right-end";

export interface FloatingOptions {
  anchorEl: HTMLElement;
  placement?: FloatingPlacement;
  matchAnchorWidth?: boolean;
  closeOnOutsideClick?: boolean;
  closeOnScroll?: boolean;
  closeOnEscape?: boolean;
  /** Owner-local hook invoked immediately before Escape dismissal. */
  onEscape?: () => void;
  clampToViewport?: boolean;
  /**
   * When true, the floating host gets `data-lfg-arrow` and a small side offset
   * so CSS can paint a popover arrow toward the anchor. Default false.
   */
  arrow?: boolean;
  /**
   * Gap in px between the anchor and the floating host on the placement side.
   * When `arrow` is true and this is omitted, a default offset is applied.
   */
  offset?: number;
  render: (host: HTMLElement) => void | (() => void);
  onClose?: () => void;
}

export interface FloatingPositionResult {
  x: number;
  y: number;
  placement: FloatingPlacement;
}
