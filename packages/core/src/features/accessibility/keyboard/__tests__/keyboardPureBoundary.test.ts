import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PURE_FILES = [
  "keyboardTarget.ts",
  "navigationIntent.ts",
  "navigationPlan.ts",
  "visualRows.ts",
  "planNavigationTopology.ts",
  "resolveInitialTarget.ts",
  "resolveNavigationTarget.ts",
] as const;

describe("Accessibility V2 pure keyboard boundary", () => {
  it("keeps DOM, renderer, row data, and hot-path allocation APIs out", () => {
    const directory = fileURLToPath(new URL("..", import.meta.url));
    for (const file of PURE_FILES) {
      const source = readFileSync(`${directory}/${file}`, "utf8");
      expect(source, file).not.toMatch(/KeyboardEvent|HTMLElement|Element\b/);
      expect(source, file).not.toMatch(/RowData|PooledRow|PooledCell/);
      expect(source, file).not.toMatch(/rendering\/(?!.*layoutTypes)/);
      expect(source, file).not.toMatch(/querySelector|getBoundingClientRect|clientHeight/);
    }

    const hotSource = [
      "navigationIntent.ts",
      "resolveInitialTarget.ts",
      "resolveNavigationTarget.ts",
      "visualRows.ts",
      "keyboardTarget.ts",
    ].map((file) => readFileSync(`${directory}/${file}`, "utf8")).join("\n");
    expect(hotSource).not.toMatch(/new (?:Array|Map|Set)\b/);
    expect(hotSource).not.toMatch(/\.\.\./);
  });
});
