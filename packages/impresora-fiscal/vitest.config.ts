import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Tests unitarios junto al código: mapeo (golden-style), driver HKA con transporte simulado y
    // adapter simulado (sin hardware en CI; ver docs/12 §contingencia).
    include: ['src/**/*.test.ts'],
  },
});
