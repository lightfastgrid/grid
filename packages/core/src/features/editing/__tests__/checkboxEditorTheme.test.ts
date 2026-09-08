import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../themes/default.css"),
  "utf8",
);

describe("checkbox editor chrome", () => {
  it("does not let the stretched editor rule hide the checkbox control", () => {
    expect(css).toMatch(
      /\.lfg-editor:not\(\.lfg-editor-checkbox\)\s*\{[^}]*\bwidth\s*:\s*100%[^}]*\bheight\s*:\s*100%[^}]*\bborder\s*:\s*none/,
    );
    expect(css).not.toMatch(/(^|\n)\.lfg-editor\s*\{/);

    expect(css).toMatch(
      /\.lfg-editor-checkbox,[\s\S]*?width:\s*var\(--lfg-checkbox-size\)/,
    );
    expect(css).toMatch(
      /\.lfg-editor-checkbox,[\s\S]*?height:\s*var\(--lfg-checkbox-size\)/,
    );
    expect(css).toMatch(
      /\.lfg-editor-checkbox,[\s\S]*?border:\s*1px solid var\(--lfg-checkbox-border\)/,
    );
  });
});
