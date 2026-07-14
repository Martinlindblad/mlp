import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { src: path.resolve(__dirname) } },
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
