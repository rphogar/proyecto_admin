import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS usa decoradores + emitDecoratorMetadata; SWC los transpila para Vitest.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
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
