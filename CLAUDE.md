# CLAUDE.md — Memoria de Proyecto: ContaVE

Sistema administrativo-contable-fiscal SaaS multi-tenant para PYMEs venezolanas. Multimoneda nativa (VES fiscal / USD gerencial / cripto), cumplimiento SENIAT, arquitectura preparada para homologación bajo Providencia SNAT/2024/000121.

## Documentación obligatoria

Antes de implementar cualquier feature, leer el documento relevante en `docs/`:
- Lógica fiscal o tributaria → `docs/02-NORMATIVA-FISCAL.md`
- Asientos, cuentas, monedas → `docs/03-PRINCIPIOS-CONTABLES.md`
- Nómina → `docs/04-NOMINA-LABORAL.md`
- Modelo de datos / servicios → `docs/05-ARQUITECTURA.md`
- Pantallas y UX → `docs/06-MODULOS-UI.md`
- Tests → incluir SIEMPRE los casos de `docs/07-CASOS-BORDE.md` que apliquen al feature

## Reglas duras (NUNCA violar)

### Dinero y precisión
1. **PROHIBIDO usar `number`/float para dinero.** Usar `Decimal` (decimal.js) en aplicación y `NUMERIC(20,8)` en PostgreSQL. Montos en VES requieren hasta 8 decimales por las tasas de cambio; redondear SOLO en presentación y en documentos fiscales (2 decimales, half-up), nunca en almacenamiento intermedio.
2. Las tasas de cambio se almacenan con la precisión exacta publicada por el BCV (hasta 8 decimales) y se congelan por documento (`exchange_rate_id` en cada documento, no lookup dinámico).
3. Todo cálculo fiscal (IVA, IGTF, retenciones) debe ser una **función pura, determinista y testeada con golden tests**, en `packages/fiscal-engine/`. La UI jamás calcula impuestos; solo muestra lo que devuelve el motor.

### Inmutabilidad y auditoría (requisito legal — Providencia 121)
4. **Los documentos fiscales emitidos y los asientos contables registrados son INMUTABLES.** Prohibido `UPDATE` o `DELETE` sobre `documents` con `status='issued'` y sobre `journal_entries` con `status='posted'`. Correcciones: nota de crédito/débito (documentos) o asiento de reverso (contabilidad). Implementar esto con triggers de PostgreSQL además de la capa de aplicación.
5. Toda operación de escritura genera un registro en `audit_events` (append-only): quién, cuándo (UTC + hora legal de Venezuela), qué, valores antes/después, IP, device. La tabla `audit_events` no tiene UPDATE ni DELETE concedidos a ningún rol de aplicación.
6. La numeración de documentos fiscales es **estrictamente consecutiva y sin huecos** por serie. Usar el patrón de secuencia transaccional documentado en `docs/05-ARQUITECTURA.md` (tabla de contadores con `SELECT ... FOR UPDATE`), nunca `SERIAL`/`IDENTITY` (dejan huecos en rollback).

### Invariantes contables
7. Invariante del ledger: para todo `journal_entry`, `SUM(debits) == SUM(credits)` **en cada una de las tres bases** (VES, USD-gerencial, moneda origen cuando aplique). Verificado con CHECK diferido + property tests.
8. Ningún saldo se almacena como verdad; los saldos se derivan del ledger (con materialized views/snapshots para performance, siempre reconstruibles).
9. Períodos contables cerrados no aceptan asientos con fecha dentro del período; los ajustes post-cierre van al período abierto con referencia al período afectado.

### Multimoneda
10. Cada `journal_line` y cada línea de documento guarda: `currency_code`, `amount_origin`, `rate_bcv`, `amount_ves`, `amount_usd_mgmt`, `rate_usd_mgmt`. La base fiscal SIEMPRE es VES a tasa BCV. La base gerencial SIEMPRE es USD. Ver `docs/03-PRINCIPIOS-CONTABLES.md` §4.
11. El diferencial cambiario se registra automáticamente como asiento, nunca se "absorbe" silenciosamente en redondeos.

### Multi-tenancy y seguridad
12. Multi-tenant por `tenant_id` en todas las tablas + **Row Level Security de PostgreSQL activado**. Ninguna query sin contexto de tenant. Tests que verifican aislamiento entre tenants.
13. RBAC con roles: `owner`, `admin`, `contador`, `cajero`, `vendedor`, `auditor` (solo lectura). Permisos a nivel de acción, no de pantalla.
14. Datos sensibles (RIF de clientes, salarios) cifrados at-rest; secretos solo por variables de entorno; jamás credenciales en el repo.

### Zona horaria, idioma y dominio
15. Timezone de negocio: `America/Caracas` (UTC-4, sin DST). Almacenar timestamps en UTC, mostrar y cortar períodos fiscales en hora de Caracas. La "fecha fiscal" de un documento es la fecha en Caracas, no en UTC.
16. Términos de dominio en español en el código (`facturas`, `retenciones`, `comprobante`), comentarios y commits en español, código de infraestructura genérica en inglés estándar.
17. Valores normativos variables (UT, alícuotas, topes, salario mínimo, cestaticket, calendarios) viven en tablas de parámetros con `vigente_desde`/`vigente_hasta`, NUNCA hardcodeados.

## Stack (decidido — no cambiar sin discusión)

- **Monorepo**: pnpm workspaces + Turborepo
- **Backend**: NestJS (TypeScript estricto), PostgreSQL 16, Drizzle ORM, BullMQ + Redis para jobs
- **Frontend**: Next.js (App Router) + TypeScript, Tailwind, shadcn/ui, TanStack Query/Table
- **Compartido**: `packages/fiscal-engine` (cálculo fiscal puro), `packages/ledger` (motor contable puro), `packages/shared` (tipos, Decimal utils)
- **Tests**: Vitest (unit + property con fast-check), Playwright (e2e), golden tests fiscales en `packages/fiscal-engine/golden/`
- **PDF**: generación server-side de facturas/comprobantes/libros
- **Tasas BCV**: job diario con fuente primaria (web BCV) + fallback, tabla `exchange_rates` con fuente y timestamp

## Estructura del repo

```
apps/web          → Next.js (UI)
apps/api          → NestJS (API + jobs)
packages/ledger   → motor de partida doble (puro, sin IO)
packages/fiscal-engine → IVA, IGTF, retenciones, nómina (puro, sin IO)
packages/shared   → tipos, Decimal, fechas Caracas
docs/             → especificación (esta carpeta)
```

## Flujo de trabajo

- TDD para `ledger` y `fiscal-engine`: primero los golden tests del caso (ver `docs/07-CASOS-BORDE.md`), luego la implementación.
- Migraciones de BD versionadas, reversibles cuando sea posible; nunca editar migraciones ya aplicadas.
- Cada PR/commit que toque lógica fiscal debe citar en el mensaje la norma que implementa (ej: `feat(iva): prorrata de crédito fiscal — Ley IVA art. 34`).
- Si una regla fiscal es ambigua o el documento no la cubre: **DETENERSE y preguntar al usuario**, no asumir. Marcar con `// TODO-TRIBUTARISTA:` cualquier interpretación pendiente de validación profesional.
