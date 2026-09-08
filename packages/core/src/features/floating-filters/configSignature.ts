import type { FloatingFiltersOptions } from "./types";

export function computeFloatingFilterConfigSignature(
  opt: boolean | FloatingFiltersOptions | undefined,
): string {
  if (opt === undefined || opt === false) return "off";
  if (opt === true) return "on";
  return JSON.stringify(opt);
}
