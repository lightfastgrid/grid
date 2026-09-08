import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

/**
 * @typedef {Object} LibraryConfigOptions
 * @property {string} entry - Entry file path relative to dirname
 * @property {string} dirname - __dirname of the calling package
 * @property {string[]} [external] - External dependencies
 * @property {import('vite').PluginOption[]} [plugins] - Additional Vite plugins
 * @property {Record<string, string>} [globals] - Global variable names for UMD
 * @property {import('vite-plugin-dts').PluginOptions} [dtsOptions] - Declaration plugin overrides
 */

/**
 * Creates a Vite config for library packages
 * @param {LibraryConfigOptions} options
 * @returns {import('vite').UserConfig}
 */
export function createLibraryConfig(options) {
  const {
    entry,
    dirname,
    external = [],
    plugins = [],
    globals = {},
    dtsOptions = {},
  } = options;

  const defaultDtsExclude = [
    '**/__tests__/**',
    '**/__typechecks__/**',
    '**/*.test.*',
    '**/*.spec.*',
  ];

  return defineConfig({
    plugins: [
      ...plugins,
      dts({
        ...dtsOptions,
        insertTypesEntry: dtsOptions.insertTypesEntry ?? true,
        rollupTypes: dtsOptions.rollupTypes ?? true,
        exclude: dtsOptions.exclude ?? defaultDtsExclude,
      }),
    ],
    build: {
      lib: {
        entry: resolve(dirname, entry),
        formats: ['es', 'cjs'],
        fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
      },
      rollupOptions: {
        external,
        output: {
          globals,
          preserveModules: true,
          preserveModulesRoot: 'src',
          exports: 'named',
        },
        treeshake: {
          moduleSideEffects: (id) => /\.css$/i.test(id),
          propertyReadSideEffects: false,
        },
      },
      target: 'es2020',
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.info', 'console.debug'],
          passes: 2,
        },
        mangle: {
          safari10: true,
        },
        format: {
          comments: false,
        },
      },
      sourcemap: false,
      reportCompressedSize: true,
      cssCodeSplit: true,
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
    worker: {
      format: 'es',
    },
  });
}
