import fs from "node:fs";
import path from "node:path";

export const PLAYGROUND_DATASET_FILES = [
  "grid-demo-datasets.json",
  "lightfastgrid-customer-operations-1k.json",
  "lightfastgrid-customer-operations-10k.json",
  "lightfastgrid-customer-operations-100k.json",
] as const;

export const PLAYGROUND_DATASET_URL_PREFIX = "/grid-demo/schemas/";

export function playgroundSchemasDir(workspaceRoot: string) {
  return path.resolve(workspaceRoot, "schemas");
}

/**
 * Serve and copy the root `schemas/` JSON into both playgrounds.
 * Files are not bundled into the app JavaScript.
 */
export function createPlaygroundDatasetPlugin(
  workspaceRoot: string,
  appDir: string,
) {
  const datasetDir = playgroundSchemasDir(workspaceRoot);

  function resolveFile(relative: string) {
    if (!relative || relative.includes("..")) return null;
    const filePath = path.resolve(datasetDir, relative);
    if (!filePath.startsWith(datasetDir) || !fs.existsSync(filePath)) {
      return null;
    }
    return filePath;
  }

  function middleware(
    req: { url?: string },
    res: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) {
    const reqUrl = req.url ?? "";
    if (!reqUrl.startsWith(PLAYGROUND_DATASET_URL_PREFIX)) {
      next();
      return;
    }
    const relative =
      reqUrl.slice(PLAYGROUND_DATASET_URL_PREFIX.length).split("?")[0] ?? "";
    const filePath = resolveFile(relative);
    if (!filePath) {
      next();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    fs.createReadStream(filePath).pipe(res as never);
  }

  return {
    name: "serve-root-playground-schemas",
    configureServer(server: {
      middlewares: { use: (handler: typeof middleware) => void };
    }) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: {
      middlewares: { use: (handler: typeof middleware) => void };
    }) {
      server.middlewares.use(middleware);
    },
    closeBundle() {
      const destDir = path.resolve(appDir, "dist/grid-demo/schemas");
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of PLAYGROUND_DATASET_FILES) {
        const source = resolveFile(file);
        if (!source) {
          throw new Error(`Missing playground dataset file: ${file}`);
        }
        fs.copyFileSync(source, path.resolve(destDir, file));
      }
    },
  };
}
