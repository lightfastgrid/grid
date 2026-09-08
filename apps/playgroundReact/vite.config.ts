import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDir, '../..');

const staticJsonMounts = [
  {
    urlPrefix: '/grid-demo/schemas/',
    dir: path.resolve(appDir, 'src/gridDemo/schemas'),
  },
] as const;

const bundledGridDemoDatasetFiles = [
  'grid-demo-datasets.json',
  'lightfastgrid-customer-operations-1k.json',
] as const;

/**
 * Serve large local JSON from app folders (not bundled).
 */
function serveStaticJsonMounts(): Plugin {
  return {
    name: 'serve-static-json-mounts',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqUrl = req.url ?? '';
        const mount = staticJsonMounts.find((entry) =>
          reqUrl.startsWith(entry.urlPrefix),
        );
        if (!mount) {
          next();
          return;
        }

        const relative = reqUrl.slice(mount.urlPrefix.length).split('?')[0] ?? '';
        if (!relative || relative.includes('..')) {
          next();
          return;
        }

        const filePath = path.resolve(mount.dir, relative);
        if (!filePath.startsWith(mount.dir) || !fs.existsSync(filePath)) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      const sourceDir = path.resolve(appDir, 'src/gridDemo/schemas');
      const destDir = path.resolve(appDir, 'dist/grid-demo/schemas');
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of bundledGridDemoDatasetFiles) {
        fs.copyFileSync(path.resolve(sourceDir, file), path.resolve(destDir, file));
      }
    },
  };
}

/**
 * Core / adapter use imperative Grid instances created in an effect with `[]` deps.
 * Vite HMR can replace the module graph, but existing class instances keep the old behavior.
 * Full reload ensures the browser runs the new `Grid` implementation.
 */
function fullReloadOnLinkedPackages(root: string): Plugin {
  const watchedRoots = [
    path.resolve(root, 'packages/core/src'),
    path.resolve(root, 'packages/react/src'),
  ].map((p) => path.normalize(p));

  function shouldReload(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    return watchedRoots.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`),
    );
  }

  return {
    name: 'full-reload-linked-packages',
    configureServer(server) {
      const reload = (changedPath: string) => {
        if (shouldReload(changedPath)) {
          server.ws.send({ type: 'full-reload', path: '*' });
        }
      };
      server.watcher.on('change', reload);
      server.watcher.on('add', reload);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serveStaticJsonMounts(), fullReloadOnLinkedPackages(workspaceRoot)],
  resolve: {
    alias: {
      "@lightfastgrid/core/themes/default.css": path.resolve(
        workspaceRoot,
        "packages/core/src/themes/default.css",
      ),
      "@lightfastgrid/core": path.resolve(workspaceRoot, "packages/core/src/index.ts"),
      "@lightfastgrid/react": path.resolve(
        workspaceRoot,
        "packages/react/src/index.ts",
      ),
    },
  },
  server: {
    // Keep distinct from playgroundJavascript (5174).
    port: 5173,
    strictPort: true,
    fs: {
      // Allow importing TS sources from linked workspace packages outside this app folder.
      allow: [workspaceRoot],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  optimizeDeps: {
    // Don't pre-bundle workspace packages: cached deps won't see edits until restart / cache clear.
    exclude: ['@lightfastgrid/react', '@lightfastgrid/core'],
  },
});
