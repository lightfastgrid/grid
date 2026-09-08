import type { LightFastGridColumnInput } from "@lightfastgrid/core";

/** Pinned-left leaves stay top-level so pin lanes stay valid. */
const TOP_LEVEL_PINNED_FIELDS = new Set(["__rowNumber", "name"]);

type DemoColumnGroupSpec = {
  headerName: string;
  groupId: string;
  fields: readonly string[];
};

/**
 * Logical groups for the demo dashboard columns.
 * Order of groups and fields within each group is intentional.
 */
export const DEMO_COLUMN_GROUP_SPECS: readonly DemoColumnGroupSpec[] = [
  {
    headerName: "Customer",
    groupId: "customer",
    fields: ["email"],
  },
  {
    headerName: "Status & location",
    groupId: "status-location",
    fields: ["status", "country", "city", "region", "language"],
  },
  {
    headerName: "Financial",
    groupId: "financial",
    fields: [
      "bankBalance",
      "tier",
      "totalWinnings",
      "revenueYtd",
      "marginPct",
      "creditUsedPct",
    ],
  },
  {
    headerName: "Timeline",
    groupId: "timeline",
    fields: ["createdAt", "joinDate", "lastActiveAt"],
  },
  {
    headerName: "Operations",
    groupId: "operations",
    fields: [
      "progressPct",
      "rating",
      "department",
      "jobTitle",
      "employeeCode",
    ],
  },
  {
    headerName: "Product",
    groupId: "product",
    fields: ["game.name", "game.bought"],
  },
  {
    headerName: "Actions",
    groupId: "actions",
    fields: ["customPanel", "actions"],
  },
];

type LeafColumn = Extract<LightFastGridColumnInput, { field: string }>;

function isLeafColumn(
  column: LightFastGridColumnInput,
): column is LeafColumn {
  return "field" in column && typeof column.field === "string";
}

/**
 * Wrap flat demo leaf columns in nested groups for column group headers.
 * Pinned-left leaves stay ungrouped; unknown fields append as ungrouped leaves.
 */
export function groupDemoColumns(
  columns: readonly LightFastGridColumnInput[],
): LightFastGridColumnInput[] {
  const leaves = columns.filter(isLeafColumn);
  const byField = new Map(leaves.map((leaf) => [leaf.field, leaf]));
  const consumed = new Set<string>();
  const result: LightFastGridColumnInput[] = [];

  for (const field of TOP_LEVEL_PINNED_FIELDS) {
    const leaf = byField.get(field);
    if (!leaf) continue;
    result.push(leaf);
    consumed.add(field);
  }

  for (const spec of DEMO_COLUMN_GROUP_SPECS) {
    const children: LeafColumn[] = [];
    for (const field of spec.fields) {
      if (consumed.has(field)) continue;
      const leaf = byField.get(field);
      if (!leaf) continue;
      children.push(leaf);
      consumed.add(field);
    }
    if (children.length === 0) continue;
    result.push({
      headerName: spec.headerName,
      groupId: spec.groupId,
      children,
    });
  }

  for (const leaf of leaves) {
    if (consumed.has(leaf.field)) continue;
    result.push(leaf);
  }

  return result;
}

/** Flat leaves when grouped headers are off; nested tree when on. */
export function resolveDemoColumns(
  columns: readonly LightFastGridColumnInput[],
  groupedHeadersEnabled: boolean,
): LightFastGridColumnInput[] {
  return groupedHeadersEnabled ? groupDemoColumns(columns) : [...columns];
}
