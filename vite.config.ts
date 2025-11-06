import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@factoryOwnership': path.resolve(__dirname, './src/factoryOwnership'),
    },
  },
  server: {
    open: false,
  },
  build: {
    sourcemap: true,
  },
});
