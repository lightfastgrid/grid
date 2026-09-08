import {
  AVATAR_POOL_SIZE,
  COUNTRY_META,
  CUSTOMER_EMAIL_DOMAINS,
  DEPARTMENTS,
  JOB_TITLES,
  PRODUCTS,
} from "./demoConstants.mjs";
import {
  formatGridDemoNumber,
  formatGridDemoUsd,
  GRID_DEMO_STATUS_PROFILES,
  tierForAnnualValue,
} from "./customerOperationsProjection.mjs";

const DAY_MS = 86_400_000;
const REFERENCE_DATE_MS = Date.UTC(2026, 7, 1);

const STATUS_SEQUENCE = [
  "Active",
  "Inactive",
  "Pending",
  "Suspended",
  "Active",
  "Active",
  "Active",
  "Pending",
  "Active",
  "Inactive",
  "Active",
  "Active",
  "Suspended",
  "Active",
  "Pending",
  "Active",
  "Active",
  "Inactive",
  "Active",
  "Active",
];

function hashString(text) {
  let h = 0;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Pooled avatar URLs — browser caches ~48 SVGs regardless of row count. */
export function avatarUrlFromName(name) {
  const h = hashString(name);
  return `https://api.dicebear.com/7.x/notionists/svg?seed=grid-${h % AVATAR_POOL_SIZE}`;
}

function mixSeed(seed, salt) {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function intBetween(seed, salt, min, max) {
  return min + (mixSeed(seed, salt) % (max - min + 1));
}

function emailFromName(name, index, domain) {
  const parts = String(name).trim().split(/\s+/);
  const first = parts[0] ?? "user";
  const last = parts.slice(1).join(".") || `user${index}`;
  const sequence = String(index + 1).padStart(6, "0");
  const local = `${first}.${last}.${sequence}`
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  return `${local}@${domain}`;
}

function dateFromMilliseconds(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Enrich a source row into a deterministic customer-operations record.
 *
 * @param {Record<string, unknown>} row
 * @param {number} index
 * @returns {Record<string, unknown>}
 */
export function enrichGridDemoRow(row, index) {
  const name = String(row.name ?? `Customer ${index + 1}`);
  const country = String(row.country ?? "Ireland");
  const meta = COUNTRY_META[country] ?? {
    region: "Europe",
    cities: ["City"],
  };
  const city = meta.cities[index % meta.cities.length];
  const department = DEPARTMENTS[index % DEPARTMENTS.length];
  const seed = hashString(`${name}|${country}|${index}`);
  const status = STATUS_SEQUENCE[index % STATUS_SEQUENCE.length];
  const profile = GRID_DEMO_STATUS_PROFILES[status];
  const progressPct = intBetween(seed, 1, ...profile.progress);
  const rating = intBetween(seed, 2, ...profile.rating);

  const sourceBalance = Math.abs(Number(row.bankBalance) || 0);
  const annualValue =
    18_000 + ((sourceBalance * 7 + intBetween(seed, 3, 0, 90_000)) % 420_000);
  const tier = tierForAnnualValue(annualValue);
  const revenueYtd = Math.round(
    annualValue * (intBetween(seed, 4, ...profile.revenuePct) / 100),
  );
  const marginPct = intBetween(seed, 5, ...profile.marginPct);
  const customerYears = intBetween(seed, 6, 1, 7);
  const totalWinnings = Math.round(
    annualValue * customerYears * (0.72 + intBetween(seed, 7, 0, 28) / 100),
  );
  const bankBalance = Math.round(
    annualValue * (intBetween(seed, 8, ...profile.balancePct) / 100),
  );
  const creditUsedPct = intBetween(seed, 9, ...profile.creditPct);

  const createdDaysAgo = intBetween(seed, 10, 240, 2_200);
  const createdAtMs = REFERENCE_DATE_MS - createdDaysAgo * DAY_MS;
  const joinDateMs = createdAtMs + intBetween(seed, 11, 3, 45) * DAY_MS;
  const activityDaysAgo = intBetween(seed, 12, ...profile.activityDaysAgo);
  const lastActiveAtMs = Math.max(
    joinDateMs,
    REFERENCE_DATE_MS - activityDaysAgo * DAY_MS,
  );
  const createdAt = dateFromMilliseconds(createdAtMs);
  const joinDate = dateFromMilliseconds(joinDateMs);
  const lastActiveAt = dateFromMilliseconds(lastActiveAtMs);

  const domain = CUSTOMER_EMAIL_DOMAINS[intBetween(
    seed,
    13,
    0,
    CUSTOMER_EMAIL_DOMAINS.length - 1,
  )];
  const email = emailFromName(name, index, domain);
  const product = PRODUCTS[intBetween(seed, 14, 0, PRODUCTS.length - 1)];
  const bought = intBetween(seed, 15, 1, 100) <= profile.purchasedPct;
  const game = { name: product, bought };

  return {
    id: `row-${index}`,
    __rowNumber: index + 1,
    name,
    avatar: avatarUrlFromName(name),
    email,
    status,
    country,
    bankBalance,
    bankBalanceFormatted: formatGridDemoUsd(bankBalance),
    createdAt,
    progressPct,
    rating,
    department,
    jobTitle: `${JOB_TITLES[index % JOB_TITLES.length]} · ${department}`,
    employeeCode: `ACC-${String(index + 1).padStart(6, "0")}`,
    city,
    region: meta.region,
    language: row.language ?? "English",
    tier,
    totalWinnings,
    revenueYtd,
    marginPct,
    joinDate,
    lastActiveAt,
    game,
    creditUsedPct,
    bankBalanceText: `${bankBalance} ${formatGridDemoUsd(bankBalance)}`,
    revenueYtdFormatted: formatGridDemoUsd(revenueYtd),
    totalWinningsFormatted: formatGridDemoUsd(totalWinnings),
    totalWinningsText: `${totalWinnings} ${formatGridDemoNumber(totalWinnings)}`,
    ratingText: String(rating),
    progressText: `${progressPct}%`,
    nameText: name,
    emailText: email,
    gameNameText: String(game.name ?? ""),
    boughtText: bought ? "true Yes Purchased" : "false No Not purchased",
  };
}
