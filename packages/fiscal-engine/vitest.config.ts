import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Tests unitarios junto al código + golden tests fiscales (valores exactos del doc 07).
    include: ['src/**/*.test.ts', 'golden/**/*.golden.test.ts'],
  },
});
