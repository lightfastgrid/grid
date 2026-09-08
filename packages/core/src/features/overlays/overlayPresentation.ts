import type {
  GridOverlayKind,
  GridOverlayOptions,
  LightFastGridOverlayPresentationChangedEvent,
} from "../../types";

import { DEFAULT_OVERLAY_TEXT } from "./types";

export const MAX_OVERLAY_PRESENTATION_TEXT_LENGTH = 512;
const WHITESPACE_CHARACTER = /\s/u;

function boundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const leadingScanLimit = Math.min(
    value.length,
    MAX_OVERLAY_PRESENTATION_TEXT_LENGTH,
  );
  let start = 0;
  while (
    start < leadingScanLimit &&
    WHITESPACE_CHARACTER.test(value.charAt(start))
  ) {
    start += 1;
  }
  if (start === leadingScanLimit) return null;
  const prefix =
    value.length - start <= MAX_OVERLAY_PRESENTATION_TEXT_LENGTH
      ? value.slice(start)
      : value.slice(
          start,
          start + MAX_OVERLAY_PRESENTATION_TEXT_LENGTH,
        );
  const normalized = prefix.trimEnd();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolve the scalar semantic presentation only after the overlay owner accepts
 * its visual update. Custom renderers use `text` as their equivalent status.
 */
export function resolveOverlayPresentation(
  kind: GridOverlayKind,
  options: GridOverlayOptions | undefined,
): LightFastGridOverlayPresentationChangedEvent {
  return {
    kind,
    text: boundedText(options?.text) ?? DEFAULT_OVERLAY_TEXT[kind],
  };
}
