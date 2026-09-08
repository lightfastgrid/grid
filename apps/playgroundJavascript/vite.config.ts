import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { createPlaygroundDatasetPlugin } from "../../schemas/vite-plugin.ts";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDir, "../..");

/**
 * Resolve the published package entrypoints only (dist / package exports).
 * Do not alias into packages/core/src — this demo is a public-API consumer.
 */
export default defineConfig({
  plugins: [createPlaygroundDatasetPlugin(workspaceRoot, appDir)],
  server: {
    // Keep distinct from playgroundReact (Vite default 5173).
    port: 5174,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@lightfastgrid/core"],
  },
});
