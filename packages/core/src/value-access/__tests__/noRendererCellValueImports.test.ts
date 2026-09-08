import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FEATURES_DIR = fileURLToPath(new URL("../../features", import.meta.url));

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      out.push(full);
    }
  }
}

describe("value-access extraction - dependency direction", () => {
  it("no feature imports rendering/helpers/cellValue", () => {
    const files: string[] = [];
    collectSourceFiles(FEATURES_DIR, files);
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8").includes("rendering/helpers/cellValue"),
    );
    expect(offenders).toEqual([]);
  });
});
