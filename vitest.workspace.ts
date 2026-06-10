import { defineWorkspace } from 'vitest/config';

// Permite correr `vitest` desde la raíz sobre todos los proyectos.
// Turbo (`pnpm test`) corre además el script `test` de cada workspace en paralelo.
export default defineWorkspace([
  'packages/shared',
  'packages/ledger',
  'packages/fiscal-engine',
  'apps/api',
  'apps/web',
]);
