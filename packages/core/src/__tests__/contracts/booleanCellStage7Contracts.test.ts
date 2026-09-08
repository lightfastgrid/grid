/** Boolean Cell V1 — Stage 7 packaging and playground guards. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../../../..");

function read(path: string): string {
  return readFileSync(join(repo, path), "utf8");
}

describe("Boolean Cell V1 Stage 7 contracts", () => {
  // Test 128
  it("keeps the public boolean types on core and React package roots", () => {
    const core = read("packages/core/src/index.ts");
    const react = read("packages/react/src/index.ts");
    const coreConsumer = read(
      "packages/core/package-output-typecheck/booleanCellConsumer.ts",
    );
    const reactConsumer = read(
      "packages/react/package-output-typecheck/booleanCellConsumer.tsx",
    );

    for (const name of [
      "CheckboxActivation",
      "CheckboxCellEditorConfig",
      "CellShellBaseValueSource",
      "CellShellMappedValueSource",
    ]) {
      expect(core).toContain(name);
      expect(react).toContain(name);
      expect(coreConsumer).toContain(name);
      expect(reactConsumer).toContain(name);
    }
    expect(coreConsumer).toContain("checkbox: {");
    expect(reactConsumer).toContain("ariaLabel:");
  });

  // Test 129
  it("ships playground boolean columns through public column configuration", () => {
    const columns = read(
      "apps/playgroundReact/src/gridDemo/schemas/gridDemoColumnDefs.mjs",
    );
    const app = read("apps/playgroundReact/src/gridDemo/gridDemo.tsx");

    expect(columns).toContain('cellDataType: "boolean"');
    expect(columns).toContain('filter: "boolean"');
    expect(columns).toContain('kind: "badge"');
    expect(columns).toContain('map: { true: "Yes", false: "No" }');
    expect(columns).toContain('kind: "imageText"');
    expect(columns).not.toMatch(/packages\/core|@lightfastgrid\/core\/src/);
    expect(app).toContain("useGridDataset(datasetUrl)");
    expect(app).toContain("columns={displayColumns}");
  });

});
