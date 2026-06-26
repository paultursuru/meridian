import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All tests live under tests/ (mirrors src/lib structure).
    include: ['tests/**/*.test.{js,ts}'],
    environment: 'node',
  },
});
