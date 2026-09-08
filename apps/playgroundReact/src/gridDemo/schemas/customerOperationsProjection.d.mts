export type GridDemoStatus = "Active" | "Pending" | "Inactive" | "Suspended";

export interface GridDemoStatusProfile {
  readonly progress: readonly [number, number];
  readonly rating: readonly [number, number];
  readonly activityDaysAgo: readonly [number, number];
  readonly balancePct: readonly [number, number];
  readonly creditPct: readonly [number, number];
  readonly purchasedPct: number;
  readonly revenuePct: readonly [number, number];
  readonly marginPct: readonly [number, number];
}

export const GRID_DEMO_STATUS_PROFILES: Readonly<
  Record<GridDemoStatus, GridDemoStatusProfile>
>;

export function formatGridDemoNumber(value: unknown): string;
export function formatGridDemoUsd(value: unknown): string;
export function tierForAnnualValue(value: number):
  | "Diamond"
  | "Platinum"
  | "Gold"
  | "Silver"
  | "Bronze";
