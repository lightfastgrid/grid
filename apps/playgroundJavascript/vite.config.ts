import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDir, "../..");

/** Single source of truth — same committed dataset family as the React playground. */
const DATASET_DIR = path.resolve(
  workspaceRoot,
  "apps/playgroundReact/src/gridDemo/schemas",
);
const DATASET_URL_PREFIX = "/grid-demo/schemas/";
const BUNDLED_DATASET_FILES = [
  "grid-demo-datasets.json",
  "lightfastgrid-customer-operations-1k.json",
] as const;

/**
 * Serve / copy the shared grid-demo dataset without bundling it into the app
 * chunk and without aliasing into core source.
 */
function serveSharedGridDemoDataset(): Plugin {
  return {
    name: "serve-shared-grid-demo-dataset",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqUrl = req.url ?? "";
        if (!reqUrl.startsWith(DATASET_URL_PREFIX)) {
          next();
          return;
        }

        const relative =
          reqUrl.slice(DATASET_URL_PREFIX.length).split("?")[0] ?? "";
        if (!relative || relative.includes("..")) {
          next();
          return;
        }

        const filePath = path.resolve(DATASET_DIR, relative);
        if (!filePath.startsWith(DATASET_DIR) || !fs.existsSync(filePath)) {
          next();
          return;
        }

        res.setHeader("Content-Type", "application/json");
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      const destDir = path.resolve(appDir, "dist/grid-demo/schemas");
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of BUNDLED_DATASET_FILES) {
        fs.copyFileSync(
          path.resolve(DATASET_DIR, file),
          path.resolve(destDir, file),
        );
      }
    },
  };
}

/**
 * Resolve the published package entrypoints only (dist / package exports).
 * Do not alias into packages/core/src — this demo is a public-API consumer.
 */
export default defineConfig({
  plugins: [serveSharedGridDemoDataset()],
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
