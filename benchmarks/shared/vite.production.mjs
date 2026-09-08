/**
 * Identical Vite production settings for every benchmark application.
 * Keep this module dependency-free so Node scripts can import it.
 */
export const BENCHMARK_VITE_PRODUCTION = {
  minify: "oxc",
  sourcemap: false,
  manifest: true,
  target: "es2022",
  cssCodeSplit: true,
  cssMinify: true,
  reportCompressedSize: false,
  emptyOutDir: true,
  outDir: "dist",
  assetsInlineLimit: 0,
};

export const BENCHMARK_ZLIB = {
  gzipLevel: 9,
  brotliQuality: 11,
};
