import { fileURLToPath } from "node:url";

import { BENCHMARK_VITE_PRODUCTION } from "./vite.production.mjs";

const FORBIDDEN_VANILLA_MODULE =
  /(?:^|[\\/])(react|react-dom|react[\\/]jsx-runtime|react[\\/]jsx-dev-runtime|@lightfastgrid[\\/]react)(?:[\\/]|$)/;

export function resolveBenchmarkBuildMode(mode) {
  return mode === "bundle" ? "bundle" : "runtime";
}

export function benchmarkBundleInventoryPlugin(appId) {
  return {
    name: "benchmark-bundle-inventory",
    apply: "build",
    generateBundle(_options, bundle) {
      const modules = [];
      for (const chunk of Object.values(bundle)) {
        if (!chunk || chunk.type !== "chunk") continue;
        const ids = [
          ...Object.keys(chunk.modules ?? {}),
          ...(chunk.moduleIds ?? []),
        ];
        for (const id of ids) {
          modules.push({ fileName: chunk.fileName, moduleId: id });
        }
      }
      this.emitFile({
        type: "asset",
        fileName: "module-inventory.json",
        source: `${JSON.stringify({ appId, modules }, null, 2)}\n`,
      });
    },
  };
}

export function isForbiddenVanillaModuleId(moduleId) {
  const normalized = String(moduleId).replace(/\\/g, "/");
  return FORBIDDEN_VANILLA_MODULE.test(normalized);
}

export function createBenchmarkViteBuild({
  mode,
  rootUrl,
  plugins = [],
  define = {},
  resolve: resolveConfig,
  appId,
}) {
  const buildMode = resolveBenchmarkBuildMode(mode);
  const root = fileURLToPath(new URL(".", rootUrl));
  const htmlEntryPlugin = {
    name: "benchmark-mode-html-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        if (buildMode !== "bundle") return html;
        return html.replaceAll("/src/runtime-main.", "/src/bundle-main.");
      },
    },
  };
  const inventory =
    buildMode === "bundle" && appId ? [benchmarkBundleInventoryPlugin(appId)] : [];
  return {
    plugins: [htmlEntryPlugin, ...plugins, ...inventory],
    define,
    build: {
      ...BENCHMARK_VITE_PRODUCTION,
      outDir: `dist/${buildMode}`,
      emptyOutDir: true,
      rollupOptions: {
        input: `${root}index.html`,
      },
    },
    ...(resolveConfig ? { resolve: resolveConfig } : {}),
  };
}
