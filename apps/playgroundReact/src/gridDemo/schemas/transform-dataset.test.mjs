/**
 * @vitest-environment node
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { transformDataset } from "./datasetTransforms.mjs";
import {
  DEFAULT_OUTPUT_FILE,
  parseArgs,
  writeGridDataset,
} from "./transform-dataset.mjs";
import {
  buildGridDemoDatasetManifest,
  GRID_DEMO_DATASET_PROFILES,
} from "./gridDemoDatasetProfiles.mjs";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const usd = (value) => usdFormatter.format(value);

describe("gridDemo dataset transforms", () => {
  it("adds stable row ids", () => {
    const result = transformDataset({
      columnDefs: [{ field: "name" }],
      rowData: [{ name: "Alice" }, { name: "Bob" }],
    });

    assert.equal(result.rowData[0].id, "row-0");
    assert.equal(result.rowData[1].id, "row-1");
    assert.equal(result.rowData[0].name, "Alice");
    assert.equal(result.rowData[0].__rowNumber, 1);
    assert.equal(result.rowData[1].__rowNumber, 2);
  });

  it("publishes deterministic scale and data-governance metadata", () => {
    const result = transformDataset({
      columnDefs: [],
      rowData: [{ name: "Alice" }, { name: "Bob" }],
    });

    assert.equal(result.gridDemo.schema, "customer-operations-v1");
    assert.equal(result.gridDemo.rowCount, 2);
    assert.equal(result.gridDemo.columnCount, 26);
    assert.equal(result.gridDemo.businessFieldCount, 23);
    assert.equal(result.gridDemo.utilityColumnCount, 3);
    assert.match(result.gridDemo.dataPolicy, /Synthetic, deterministic/);
  });

  it("defines explicit filenames and delivery policies for every scale", () => {
    assert.deepEqual(
      GRID_DEMO_DATASET_PROFILES.map(({ rowCount, file, delivery }) => ({
        rowCount,
        file,
        delivery,
      })),
      [
        {
          rowCount: 1_000,
          file: "lightfastgrid-customer-operations-1k.json",
          delivery: "repository",
        },
        {
          rowCount: 10_000,
          file: "lightfastgrid-customer-operations-10k.json",
          delivery: "repository",
        },
        {
          rowCount: 100_000,
          file: "lightfastgrid-customer-operations-100k.json",
          delivery: "repository",
        },
        { rowCount: 1_000_000, file: null, delivery: "block" },
      ],
    );

    const manifest = buildGridDemoDatasetManifest(26);
    assert.equal(manifest.defaultDatasetId, "customer-operations-1k");
    assert.equal(manifest.columnCount, 26);
  });

  it("derives the default output filename from the requested scale", () => {
    assert.equal(DEFAULT_OUTPUT_FILE, "lightfastgrid-customer-operations-1k.json");
    assert.equal(
      parseArgs(["node", "transform-dataset.mjs", "--rows", "10000"]).out,
      "lightfastgrid-customer-operations-10k.json",
    );
  });

  it("prepends a row-number column definition", () => {
    const result = transformDataset({
      columnDefs: [{ field: "name" }],
      rowData: [{ name: "Alice" }],
    });

    assert.equal(result.columnDefs[0].field, "__rowNumber");
    assert.equal(result.columnDefs[0].sortable, true);
    assert.equal(result.columnDefs[1].field, "name");
  });

  it("generates matching display labels for the Purchased boolean badge", () => {
    const result = transformDataset({ columnDefs: [], rowData: [] });
    const purchased = result.columnDefs.find(
      (column) => column.field === "game.bought",
    );

    assert.deepEqual(purchased.cellShell.text, {
      from: "value",
      map: { true: "Yes", false: "No" },
    });
    assert.equal(purchased.quickFilterTextField, "boughtText");
  });

  it("keeps utility-column headers visually empty and accessibly named", () => {
    const result = transformDataset({ columnDefs: [], rowData: [] });
    const customPanel = result.columnDefs.find(
      (column) => column.field === "customPanel",
    );
    const actions = result.columnDefs.find(
      (column) => column.field === "actions",
    );

    assert.equal(customPanel.headerName, "");
    assert.equal(customPanel.headerAriaLabel, "Customer details panel");
    assert.equal(actions.headerName, "");
    assert.equal(actions.headerAriaLabel, "Row actions");
  });

  it("generates coherent production customer records", () => {
    const inputRows = [
      { name: "Tony Smith", country: "Ireland", bankBalance: 2_397 },
      { name: "Andrew Connell", country: "Sweden", bankBalance: 66_150 },
      { name: "Kevin Flanagan", country: "Uruguay", bankBalance: 84_847 },
      { name: "Sophie McGee", country: "France", bankBalance: 83_081 },
    ];
    const result = transformDataset({ columnDefs: [], rowData: inputRows });

    assert.deepEqual(
      result.rowData.map((row) => row.status),
      ["Active", "Inactive", "Pending", "Suspended"],
    );

    for (const row of result.rowData) {
      assert.match(row.email, /^[a-z0-9.]+\.\d{6}@[a-z]+\.example$/);
      assert.match(row.employeeCode, /^ACC-\d{6}$/);
      assert.ok(row.createdAt <= row.joinDate);
      assert.ok(row.joinDate <= row.lastActiveAt);
      assert.equal(row.bankBalanceFormatted, usd(row.bankBalance));
      assert.equal(row.revenueYtdFormatted, usd(row.revenueYtd));
      assert.equal(row.totalWinningsFormatted, usd(row.totalWinnings));
      assert.equal(
        row.boughtText,
        row.game.bought ? "true Yes Purchased" : "false No Not purchased",
      );
    }

    assert.ok(result.rowData[0].progressPct >= 62);
    assert.ok(result.rowData[0].rating >= 3);
    assert.ok(result.rowData[1].progressPct <= 42);
    assert.ok(result.rowData[1].rating <= 3);
    assert.ok(result.rowData[3].progressPct <= 25);
    assert.ok(result.rowData[3].rating <= 2);
  });

  it("keeps contact identifiers unique when source names repeat", () => {
    const result = transformDataset({
      columnDefs: [],
      rowData: [
        { name: "Alex Morgan", country: "Ireland" },
        { name: "Alex Morgan", country: "Ireland" },
      ],
    });

    assert.notEqual(result.rowData[0].email, result.rowData[1].email);
    assert.notEqual(result.rowData[0].employeeCode, result.rowData[1].employeeCode);
  });

  it("streams columnDefs and rowData to disk", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-demo-schema-"));
    const outPath = path.join(dir, "out.json");

    await writeGridDataset(
      outPath,
      {
        columnDefs: [{ field: "name" }],
        rowData: [{ id: "row-0", name: "Alice" }],
      },
      { progressEvery: 0 },
    );

    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.deepEqual(parsed.columnDefs, [{ field: "name" }]);
    assert.deepEqual(parsed.rowData, [{ id: "row-0", name: "Alice" }]);
  });

  it("streams generated rows without materializing a transformed row array", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grid-demo-schema-"));
    const outPath = path.join(dir, "out.json");

    await writeGridDataset(
      outPath,
      {
        gridDemo: { rowCount: 3 },
        columnDefs: [{ field: "id" }],
        rowCount: 3,
        getRow: (index) => ({ id: `row-${index}` }),
      },
      { progressEvery: 0 },
    );

    const parsed = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(parsed.gridDemo.rowCount, 3);
    assert.deepEqual(
      parsed.rowData.map((row) => row.id),
      ["row-0", "row-1", "row-2"],
    );
  });
});
