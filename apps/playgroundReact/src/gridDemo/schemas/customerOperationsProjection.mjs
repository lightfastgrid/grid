const numberFormatter = new Intl.NumberFormat("en-US");
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export const GRID_DEMO_STATUS_PROFILES = Object.freeze({
  Active: Object.freeze({
    progress: Object.freeze([62, 98]),
    rating: Object.freeze([3, 5]),
    activityDaysAgo: Object.freeze([0, 18]),
    balancePct: Object.freeze([2, 12]),
    creditPct: Object.freeze([8, 55]),
    purchasedPct: 88,
    revenuePct: Object.freeze([68, 100]),
    marginPct: Object.freeze([34, 58]),
  }),
  Pending: Object.freeze({
    progress: Object.freeze([28, 68]),
    rating: Object.freeze([2, 4]),
    activityDaysAgo: Object.freeze([3, 45]),
    balancePct: Object.freeze([1, 9]),
    creditPct: Object.freeze([18, 68]),
    purchasedPct: 52,
    revenuePct: Object.freeze([32, 64]),
    marginPct: Object.freeze([24, 44]),
  }),
  Inactive: Object.freeze({
    progress: Object.freeze([8, 42]),
    rating: Object.freeze([1, 3]),
    activityDaysAgo: Object.freeze([65, 210]),
    balancePct: Object.freeze([8, 22]),
    creditPct: Object.freeze([48, 86]),
    purchasedPct: 24,
    revenuePct: Object.freeze([12, 38]),
    marginPct: Object.freeze([12, 30]),
  }),
  Suspended: Object.freeze({
    progress: Object.freeze([3, 25]),
    rating: Object.freeze([0, 2]),
    activityDaysAgo: Object.freeze([180, 540]),
    balancePct: Object.freeze([18, 34]),
    creditPct: Object.freeze([72, 98]),
    purchasedPct: 10,
    revenuePct: Object.freeze([4, 20]),
    marginPct: Object.freeze([4, 18]),
  }),
});

export function formatGridDemoNumber(value) {
  return numberFormatter.format(Number(value) || 0);
}

export function formatGridDemoUsd(value) {
  return usdFormatter.format(Number(value) || 0);
}

export function tierForAnnualValue(value) {
  if (value >= 320_000) return "Diamond";
  if (value >= 220_000) return "Platinum";
  if (value >= 130_000) return "Gold";
  if (value >= 65_000) return "Silver";
  return "Bronze";
}
