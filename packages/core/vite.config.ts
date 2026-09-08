import { createLibraryConfig } from '@lightfastgrid/shared/vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WORKER_URL =
  /new URL\((["'])([^"']+Worker-[^"']+\.js)\1,\s*(""\+import\.meta\.url|""\+\{\}\.url|import\.meta\.url|require\("url"\)\.pathToFileURL\(__dirname\s*\+\s*["']\/["']\)\.href)/g;

const CJS_WORKER_BASE =
  'require("url").pathToFileURL(__dirname+"/").href';

/** Copy public theme assets after build; do not copy theme source/tests. */
function copyThemes(): Plugin {
  return {
    name: 'copy-themes',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist/themes');
      mkdirSync(outDir, { recursive: true });
      copyFileSync(
        resolve(__dirname, 'src/themes/default.css'),
        resolve(outDir, 'default.css'),
      );
    },
  };
}

function workerUrlFromChunk(chunkFileName: string, workerFileName: string): string {
  const relative = posix.relative(
    posix.dirname(chunkFileName),
    `assets/${posix.basename(workerFileName)}`,
  );
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * Packed consumers resolve Workers from the package, not the site root.
 * ESM keeps a static `new URL("./assets/…", import.meta.url)` so Vite
 * consumers emit Worker assets. CJS uses Node `pathToFileURL(__dirname)`
 * as a valid URL base — never `{}.url` or the string `"undefined"`.
 */
function relativeWorkerUrls(): Plugin {
  const rewrite = (code: string, chunkFileName: string): string =>
    code.replace(
      WORKER_URL,
      (match, quote: string, url: string) => {
        if (!(url.startsWith('/') || url.includes('/assets/') || url.startsWith('assets/'))) {
          return match;
        }
        const relative = workerUrlFromChunk(chunkFileName, url);
        const nextBase = chunkFileName.endsWith('.mjs')
          ? 'import.meta.url'
          : CJS_WORKER_BASE;
        return `new URL(${quote}${relative}${quote}, ${nextBase}`;
      },
    );

  return {
    name: 'relative-worker-urls',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk' || !item.code.includes('Worker')) continue;
        item.code = rewrite(item.code, item.fileName);
        if (item.fileName.endsWith('.cjs') && /\{\}\.url/.test(item.code)) {
          throw new Error(
            `${item.fileName} still contains invalid {}.url as a Worker URL base`,
          );
        }
      }
    },
  };
}

export default createLibraryConfig({
  entry: 'src/index.ts',
  dirname: __dirname,
  external: [],
  plugins: [copyThemes(), relativeWorkerUrls()],
  dtsOptions: {
    // Dedicated production declaration project: source-only, rootDir src, no
    // declaration maps, no path-alias leakage. Mirrors the React adaptor.
    tsconfigPath: resolve(__dirname, 'tsconfig.build.json'),
    rollupTypes: true,
  },
});
