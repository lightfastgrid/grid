import tsParser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import accessibilityArchitecture from "../../../../../../scripts/eslint/accessibilityArchitecture.mjs";

const linter = new Linter({ configType: "flat" });
const pluginName = "lfg-architecture";

function verify(
  code: string,
  filename: string,
  rule:
    | "accessibility-import-boundary"
    | "composite-semantic-ownership",
): Linter.LintMessage[] {
  return linter.verify(
    code,
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      languageOptions: {
        ecmaVersion: "latest",
        parser: tsParser,
        sourceType: "module",
        parserOptions: {
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: {
        [pluginName]: accessibilityArchitecture,
      },
      rules: {
        [`${pluginName}/${rule}`]: "error",
      },
    },
    { filename },
  );
}

const CORE_SOURCE = join(process.cwd(), "src");
const FEATURE_FILE = join(CORE_SOURCE, "features", "example.tsx");
const REGISTRY_FILE = join(CORE_SOURCE, "features", "registry.ts");
const ACCESSIBILITY_FILE = join(
  CORE_SOURCE,
  "features",
  "accessibility",
  "example.tsx",
);

describe("accessibility architecture ESLint rules", () => {
  it("rejects every supported private-import syntax outside the registry", () => {
    const examples = [
      'import "./accessibility";',
      'import type { PrivateType } from "./accessibility/types";',
      'type PrivateType = import("./accessibility/types").PrivateType;',
      'export * from "./accessibility/index";',
      'export { helper } from "./accessibility/utils/helper";',
      'const module = await import("./accessibility/utils/rowSemantics");',
      'const module = require("./accessibility");',
      'import privateModule = require("./accessibility");',
    ];

    for (const code of examples) {
      const messages = verify(
        code,
        FEATURE_FILE,
        "accessibility-import-boundary",
      );
      expect(messages.map((message) => message.ruleId)).toEqual([
        `${pluginName}/accessibility-import-boundary`,
      ]);
    }
  });

  it("allows the registry seam and imports within the plugin", () => {
    expect(
      verify(
        'import { accessibilityFeature } from "./accessibility";',
        REGISTRY_FILE,
        "accessibility-import-boundary",
      ),
    ).toEqual([]);
    expect(
      verify(
        'import { helper } from "./utils/helper";',
        ACCESSIBILITY_FILE,
        "accessibility-import-boundary",
      ),
    ).toEqual([]);
  });

  it("rejects composite roles through calls, constants, objects, and properties", () => {
    const examples = [
      'setAttributeIfChanged(node, "role", "gridcell");',
      'const ROLE = "columnheader"; node.setAttribute("role", ROLE);',
      'createDiv("row", "row");',
      'const semantics = { role: "rowgroup" };',
      'node.role = "treegrid";',
      'const element = <div role="presentation" />;',
      'function bind() { const ROLE = "grid" + "cell"; node.setAttribute("role", ROLE); }',
      'const PREFIX = "column"; node.setAttribute("role", `${PREFIX}header`);',
    ];

    for (const code of examples) {
      expect(
        verify(code, FEATURE_FILE, "composite-semantic-ownership").some(
          (message) =>
            message.ruleId ===
            `${pluginName}/composite-semantic-ownership`,
        ),
      ).toBe(true);
    }
  });

  it("rejects composite attributes through calls, constants, and reflected properties", () => {
    const examples = [
      'node.setAttribute("aria-owns", ids);',
      'const ATTRIBUTE = "aria-rowindex"; writeAttribute(node, ATTRIBUTE, "1");',
      'node.ariaSelected = "true";',
      'Reflect.set(node, "ariaActiveDescendantElement", active);',
      'const semantics = { "aria-colindex": 1 };',
      'function bind() { const ATTRIBUTE = "aria-" + "sort"; writeAttribute(node, ATTRIBUTE, "ascending"); }',
    ];

    for (const code of examples) {
      expect(
        verify(code, FEATURE_FILE, "composite-semantic-ownership").some(
          (message) =>
            message.ruleId ===
            `${pluginName}/composite-semantic-ownership`,
        ),
      ).toBe(true);
    }
  });

  it("allows owner-local control semantics and plugin-owned composite semantics", () => {
    expect(
      verify(
        [
          'node.setAttribute("role", "dialog");',
          'node.setAttribute("aria-label", "Filter");',
          'node.setAttribute("aria-expanded", "false");',
        ].join("\n"),
        FEATURE_FILE,
        "composite-semantic-ownership",
      ),
    ).toEqual([]);
    expect(
      verify(
        'node.setAttribute("role", "gridcell");',
        ACCESSIBILITY_FILE,
        "composite-semantic-ownership",
      ),
    ).toEqual([]);
  });
});
