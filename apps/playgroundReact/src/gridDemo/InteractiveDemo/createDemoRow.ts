import type { RowData } from "@lightfastgrid/core";

/** Minimal synthetic row for toolbar "Add Row" → `applyTransaction({ add })`. */
export function createDemoRow(seed = Date.now()): RowData {
  const id = `demo-${seed.toString(36)}`;
  const name = `New Customer ${seed.toString(36).slice(-4).toUpperCase()}`;

  return {
    id,
    name,
    nameText: name,
    email: `${id}@example.com`,
    emailText: `${id}@example.com`,
    status: "Pending",
    country: "Ireland",
    bankBalance: 0,
    bankBalanceFormatted: "$0",
    bankBalanceText: "0",
    createdAt: new Date().toISOString().slice(0, 10),
    progressPct: 0,
    progressText: "0",
    rating: 0,
    ratingText: "0",
    avatar: `https://api.dicebear.com/7.x/notionists/svg?seed=${id}`,
  };
}
