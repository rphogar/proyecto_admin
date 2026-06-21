import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Tests unitarios junto al código: construcción del control verificable (identificador/QR),
    // representación del documento digital y adapter simulado (sin proveedor real en CI).
    include: ['src/**/*.test.ts'],
  },
});
