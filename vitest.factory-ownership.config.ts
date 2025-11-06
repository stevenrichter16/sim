import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        'tests/factory.ownership.test.{js,ts}',
        'tests/factory.gameplay.test.{js,ts}',
        'tests/factory.workers.test.{js,ts}',
        'tests/factoryOwnership/**/*.test.{js,ts}',
      ],
    },
  }),
);
