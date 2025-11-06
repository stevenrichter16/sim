import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@factoryOwnership': path.resolve(__dirname, './src/factoryOwnership'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,ts}'],
  },
});
