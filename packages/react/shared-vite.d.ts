declare module '@lightfastgrid/shared/vite' {
  import type { PluginOption, UserConfig } from 'vite';

  export interface CreateLibraryConfigOptions {
    entry: string;
    dirname: string;
    external?: string[];
    plugins?: PluginOption[];
    globals?: Record<string, string>;
    dtsOptions?: {
      tsconfigPath?: string;
      rollupTypes?: boolean;
    };
  }

  export function createLibraryConfig(options: CreateLibraryConfigOptions): UserConfig;
}
