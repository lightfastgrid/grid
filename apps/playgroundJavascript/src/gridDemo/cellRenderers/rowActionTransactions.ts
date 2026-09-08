import type { RowData } from "@lightfastgrid/core";

/** Status options for the demo Edit dialog (matches dataset enrichment). */
export const GRID_DEMO_EDIT_STATUSES = [
  "Active",
  "Inactive",
  "Pending",
  "Suspended",
] as const;

/** Country options for the demo Edit dialog (matches dataset enrichment). */
export const GRID_DEMO_EDIT_COUNTRIES = [
  "Argentina",
  "Belgium",
  "Brazil",
  "Colombia",
  "France",
  "Germany",
  "Greece",
  "Iceland",
  "Ireland",
  "Italy",
  "Luxembourg",
  "Malta",
  "Norway",
  "Peru",
  "Portugal",
  "Spain",
  "Sweden",
  "United Kingdom",
  "Uruguay",
  "Venezuela",
] as const;

const AVATAR_POOL_SIZE = 48;

function avatarUrlFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `https://api.dicebear.com/7.x/notionists/svg?seed=grid-${h % AVATAR_POOL_SIZE}`;
}

/** Editable fields shown in the demo Edit dialog. */
export type GridDemoRowEditFields = {
  name: string;
  email: string;
  status: string;
  country: string;
};

/** Snapshot of a row for View / Edit dialogs. */
export type GridDemoRowRecord = GridDemoRowEditFields & {
  rowId: string;
};

export function toGridDemoRowRecord(
  row: RowData,
  rowId: string,
): GridDemoRowRecord {
  return {
    rowId,
    name: typeof row.name === "string" ? row.name : "",
    email: typeof row.email === "string" ? row.email : "",
    status: typeof row.status === "string" ? row.status : "Active",
    country: typeof row.country === "string" ? row.country : "Ireland",
  };
}

/** Clone a row for `applyTransaction({ add })` with a new stable id. */
export function buildDuplicateRow(row: RowData, sourceRowId: string): RowData {
  const nextId = `${sourceRowId}-copy-${Date.now().toString(36)}`;
  const name =
    typeof row.name === "string"
      ? `${row.name} (copy)`
      : `Copy of ${sourceRowId}`;

  return {
    ...row,
    id: nextId,
    name,
    nameText: name,
    avatar: avatarUrlFromName(name),
  };
}

/** Merge dialog fields into a full row for `applyTransaction({ update })`. */
export function buildUpdatedRow(
  row: RowData,
  fields: GridDemoRowEditFields,
): RowData {
  return {
    ...row,
    name: fields.name,
    email: fields.email,
    status: fields.status,
    country: fields.country,
    nameText: fields.name,
    emailText: fields.email,
    avatar: avatarUrlFromName(fields.name),
  };
}
