import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "../../../dist");
const assetsDir = join(distDir, "assets");
const built = existsSync(assetsDir);

const REQUIRED_WORKERS = [
  "csvExportWorker",
  "filterWorker",
  "quickSearchWorker",
  "sortWorker",
] as const;

const ABSOLUTE_WORKER_URL =
  /new URL\((["'])\/assets\/[^"']+Worker-[^"']+\.js\1/;
const ESM_WORKER_URL =
  /new URL\((["'])([^"']+Worker-[^"']+\.js)\1,\s*import\.meta\.url\)/g;
const CJS_WORKER_URL =
  /new URL\((["'])([^"']+Worker-[^"']+\.js)\1,\s*require\("url"\)\.pathToFileURL\(__dirname\s*\+\s*["']\/["']\)\.href\)/g;

function collectJs(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJs(path));
      continue;
    }
    if (/\.(mjs|cjs|js)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function requireWorkerPath(match: RegExpMatchArray, file: string): string {
  const url = match[2];
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(
      `${file} matched a Worker URL without a path capture: ${match[0]}`,
    );
  }
  return url;
}

describe("Core worker publish surface", () => {
  it.skipIf(!built)(
    "emits hashed Worker files under dist/assets for packed consumers",
    () => {
      const files = readdirSync(assetsDir).filter((name) =>
        /Worker-[A-Za-z0-9_-]+\.js$/.test(name),
      );
      for (const prefix of REQUIRED_WORKERS) {
        expect(
          files.some((name) => name.startsWith(`${prefix}-`)),
          `missing ${prefix}-*.js in dist/assets`,
        ).toBe(true);
      }
    },
  );

  it.skipIf(!built)(
    "addresses ESM Workers with package-relative import.meta.url, not /assets site-root paths",
    () => {
      const jsFiles = collectJs(distDir).filter((file) => file.endsWith(".mjs"));
      const referenced = new Set<string>();

      for (const file of jsFiles) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toMatch(ABSOLUTE_WORKER_URL);
        expect(source, file).not.toMatch(/\{\}\.url/);
        expect(source, file).not.toMatch(/""\+import\.meta\.url/);

        for (const match of source.matchAll(ESM_WORKER_URL)) {
          const url = requireWorkerPath(match, file);
          expect(url.startsWith("/"), `${file} uses absolute Worker URL ${url}`).toBe(
            false,
          );
          const resolved = resolve(dirname(file), url);
          expect(existsSync(resolved), `${url} from ${file} -> ${resolved}`).toBe(
            true,
          );
          referenced.add(resolved.split(/[/\\]/).pop() ?? "");
        }
      }

      for (const prefix of REQUIRED_WORKERS) {
        expect(
          [...referenced].some((name) => name.startsWith(`${prefix}-`)),
          `no package-relative ${prefix}-*.js Worker URL in ESM dist`,
        ).toBe(true);
      }
    },
  );

  it.skipIf(!built)(
    "addresses CJS Workers with a valid pathToFileURL(__dirname) base",
    () => {
      const jsFiles = collectJs(distDir).filter((file) => file.endsWith(".cjs"));
      const referenced = new Set<string>();

      for (const file of jsFiles) {
        const source = readFileSync(file, "utf8");
        expect(source, file).not.toMatch(/\{\}\.url/);
        expect(source, file).not.toMatch(/new URL\([^)]*"undefined"/);
        expect(source, file).not.toMatch(ABSOLUTE_WORKER_URL);

        for (const match of source.matchAll(CJS_WORKER_URL)) {
          const constructed = runInNewContext(match[0], {
            require: createRequire(file),
            __dirname: dirname(file),
            URL,
          }) as URL;
          expect(constructed).toBeInstanceOf(URL);
          expect(constructed.protocol).toBe("file:");
          const resolved = fileURLToPath(constructed);
          expect(existsSync(resolved), `${match[0]} -> ${resolved}`).toBe(true);
          referenced.add(resolved.split(/[/\\]/).pop() ?? "");
        }
      }

      for (const prefix of REQUIRED_WORKERS) {
        expect(
          [...referenced].some((name) => name.startsWith(`${prefix}-`)),
          `no evaluable CJS ${prefix}-*.js Worker URL in dist`,
        ).toBe(true);
      }
    },
  );
});
