import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/__tests__/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
