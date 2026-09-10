import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  root: 'frontend',
  plugins: [
    react(),
    electron([
      {
        entry: path.resolve(__dirname, 'electron/main/main.ts'),
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            rollupOptions: {
              external: ['sql.js', 'electron'],
            },
          },
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'shared'),
            },
          },
        },
      },
      {
        entry: path.resolve(__dirname, 'electron/preload/index.ts'),
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/preload'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: path.resolve(__dirname, 'electron/preload/overlay-preload.ts'),
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/preload'),
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    // Stress/integration tests (100-1000 signals, DB churn) flake under the
    // default 5s timeout when the prebuild guard runs alongside the build on
    // slow machines — give them a real budget.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'frontend/index.html'),
        overlay: path.resolve(__dirname, 'frontend/overlay.html'),
      },
    },
  },
});
