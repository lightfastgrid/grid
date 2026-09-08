import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "../..");
const repoRoot = join(pkgRoot, "../..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("React package publish surface", () => {
  const manifest = readJson(join(pkgRoot, "package.json"));
  const viteConfig = readFileSync(join(pkgRoot, "vite.config.ts"), "utf8");
  const entry = readFileSync(join(pkgRoot, "src/index.ts"), "utf8");

  it("publishes @lightfastgrid/react with Core as a workspace runtime dependency", () => {
    expect(manifest.name).toBe("@lightfastgrid/react");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.license).toBe("MIT");
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(manifest.dependencies).toEqual({
      "@lightfastgrid/core": "workspace:*",
    });
    expect(manifest.peerDependencies).toEqual({
      react: ">=18",
      "react-dom": ">=18",
    });

    const exportsMap = manifest.exports as { ".": Record<string, string> };
    expect(exportsMap["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.mjs",
      require: "./dist/index.cjs",
    });
  });

  it("keeps React, ReactDOM, Core, and Core theme CSS external", () => {
    for (const external of [
      "'react'",
      "'react-dom'",
      "'@lightfastgrid/core'",
      "'@lightfastgrid/core/themes/default.css'",
    ]) {
      expect(viteConfig).toContain(external);
    }
  });

  it("exports the public React component and handle types from source", () => {
    expect(entry).toContain("export { LightFastGrid }");
    expect(entry).toContain("ReactLightFastGridHandle");
    expect(entry).toContain("ReactLightFastGridProps");
  });

  it("does not keep the retired package directory or name in workspace manifests", () => {
    const rootManifest = readFileSync(join(repoRoot, "package.json"), "utf8");
    const playground = readJson(join(repoRoot, "apps/playgroundReact/package.json"));

    expect(rootManifest).toContain("@lightfastgrid/react");
    expect(rootManifest).not.toContain("react-adaptor");
    expect(rootManifest).not.toContain("reactAdaptor");
    expect(playground.dependencies).toMatchObject({
      "@lightfastgrid/react": "workspace:*",
    });
  });
});

describe("React package built declarations", () => {
  const dtsPath = join(pkgRoot, "dist/index.d.ts");
  const esmPath = join(pkgRoot, "dist/index.mjs");
  const cjsPath = join(pkgRoot, "dist/index.cjs");
  const built = existsSync(dtsPath);

  it.skipIf(!built)("emits usable JavaScript and TypeScript entry points", () => {
    const dts = readFileSync(dtsPath, "utf8").trim();
    expect(dts.length).toBeGreaterThan(50);
    expect(dts).not.toBe("export {};");
    expect(dts).toContain("LightFastGrid");
    expect(dts).toContain("ReactLightFastGridHandle");
    expect(dts).toContain("ReactLightFastGridProps");
    expect(readFileSync(esmPath, "utf8")).toMatch(/export\s*\{/);
    expect(readFileSync(cjsPath, "utf8")).toMatch(/exports|module\.exports/);
    const builtJs = readdirSync(join(pkgRoot, "dist"))
      .filter((name) => /\.(mjs|cjs)$/.test(name))
      .map((name) => readFileSync(join(pkgRoot, "dist", name), "utf8"))
      .join("\n");
    expect(builtJs).toContain("@lightfastgrid/core");
    expect(builtJs).not.toContain(`@lightfastgrid/${"react-adaptor"}`);
  });
});
