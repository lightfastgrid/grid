import { createLibraryConfig } from '@lightfastgrid/shared/vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default createLibraryConfig({
  entry: 'src/index.ts',
  dirname: __dirname,
  external: [
    'react',
    'react-dom',
    'react-dom/client',
    'react/jsx-runtime',
    '@lightfastgrid/core',
    '@lightfastgrid/core/themes/default.css',
  ],
  globals: {
    react: 'React',
    'react-dom': 'ReactDOM',
    'react-dom/client': 'ReactDOMClient',
  },
  dtsOptions: {
    tsconfigPath: resolve(__dirname, 'tsconfig.build.json'),
    rollupTypes: true,
  },
  plugins: [
    react({
      jsxRuntime: 'automatic',
    }),
  ],
});
