import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Tests de integración (RLS, triggers, constraints) contra un Postgres real efímero
// (testcontainers). Separados de los unit (`*.spec.ts`) porque requieren Docker y son lentos.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.int.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    // Levantar el contenedor + migraciones puede tardar; márgenes amplios.
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Un contenedor por archivo: sin paralelismo entre suites para no saturar Docker.
    fileParallelism: false,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
