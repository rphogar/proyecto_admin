import { existsSync } from 'node:fs';

/**
 * Carga `apps/api/.env` en `process.env` usando el cargador nativo de Node (sin dependencias).
 * Importarlo ANTES de cualquier módulo que lea `process.env` (DatabaseService, drizzle, scripts
 * CLI). Es no-op si el archivo no existe (CI/producción inyectan las variables por el entorno).
 * El path es relativo al cwd, que es `apps/api` en todos los comandos documentados (regla 14).
 */
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
