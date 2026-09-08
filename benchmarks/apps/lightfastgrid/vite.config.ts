import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { createBenchmarkViteBuild } from "../../shared/vite.app.mjs";

function readInstalledPackageJson(packageName: string) {
  const require = createRequire(fileURLToPath(import.meta.url));
  const resolved = require.resolve(packageName);
  let dir = dirname(resolved);
  while (dir !== dirname(dir)) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === packageName && typeof pkg.version === "string") {
        return pkg;
      }
    }
    dir = dirname(dir);
  }
  throw new Error(`Could not resolve ${packageName} package.json from ${resolved}`);
}

const packedReact = readInstalledPackageJson("@lightfastgrid/react");
const packedCore = readInstalledPackageJson("@lightfastgrid/core");

export default defineConfig(({ mode }) =>
  createBenchmarkViteBuild({
    mode,
    rootUrl: import.meta.url,
    appId: "lightfastgrid",
    plugins: [react()],
    define: {
      __LFG_REACT_VERSION__: JSON.stringify(packedReact.version),
      __LFG_CORE_VERSION__: JSON.stringify(packedCore.version),
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  }),
);
