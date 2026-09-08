import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

import { createPlaygroundDatasetPlugin } from '../../schemas/vite-plugin.ts';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appDir, '../..');

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
  plugins: [
    react(),
    createPlaygroundDatasetPlugin(workspaceRoot, appDir),
    fullReloadOnLinkedPackages(workspaceRoot),
  ],
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
