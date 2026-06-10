# ContaVE — README de desarrollo

Sistema administrativo-contable-fiscal SaaS multi-tenant para PYMEs venezolanas. Multimoneda
nativa (VES fiscal / USD gerencial / cripto), cumplimiento SENIAT, arquitectura preparada para
homologación bajo Providencia SNAT/2024/000121.

> ⚠️ **Advertencia legal:** este es un sistema en construcción. Toda la lógica fiscal debe
> validarse con un contador público colegiado y un abogado tributarista venezolanos antes de
> producción, y la emisión de facturas fiscales válidas requiere homologación ante el SENIAT.
> Los valores normativos (UT, alícuotas, salario mínimo, cestaticket) son parámetros con
> vigencia temporal, nunca constantes en código. Ver `docs/01-VISION.md` y la advertencia legal
> de la especificación.

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Backend:** NestJS 11 (TypeScript estricto), PostgreSQL 16 + Drizzle ORM, BullMQ + Redis
- **Frontend:** Next.js 15 (App Router) + Tailwind v4 + shadcn/ui
- **Tests:** Vitest (unit + property con fast-check), Playwright (e2e), golden tests fiscales
- **Paquetes puros (sin IO):** `ledger` (partida doble), `fiscal-engine` (IVA/IGTF/retenciones/
  nómina), `shared` (Money/Decimal, fechas Caracas, RIF)

## Requisitos previos

- **Node.js ≥ 22** (este repo se desarrolló con v24).
- **pnpm 9** vía Corepack (incluido con Node). No requiere instalación global:
  - Si tienes permisos de administrador: `corepack enable` (instala el shim `pnpm`).
  - Si no (p. ej. Node en `C:\Program Files`): usa `corepack pnpm@9.15.0 <comando>` en lugar de
    `pnpm <comando>`. Todos los comandos de abajo funcionan con cualquiera de las dos formas.
- **Docker** (Docker Desktop en Windows/Mac) para PostgreSQL 16 + Redis 7 locales. Opcional si
  solo vas a correr tests unitarios.

## Puesta en marcha

```bash
# 1. Variables de entorno
cp .env.example .env            # PowerShell: Copy-Item .env.example .env

# 2. Dependencias
pnpm install                    # o: corepack pnpm@9.15.0 install

# 3. Infraestructura local (Postgres + Redis)
docker compose up -d

# 4. Levantar todo en modo dev (web + api en paralelo vía Turbo)
pnpm dev
```

- Web (Next.js): http://localhost:3000
- API (NestJS): http://localhost:3001 — healthcheck en `GET /health`

## Comandos

Todos se ejecutan desde la raíz y Turbo los orquesta por workspace (con caché).

| Comando             | Qué hace                                                   |
| ------------------- | ---------------------------------------------------------- |
| `pnpm dev`          | Levanta `web` + `api` en watch.                            |
| `pnpm build`        | Compila paquetes, API (`nest build`) y web (`next build`). |
| `pnpm lint`         | ESLint en todo el monorepo.                                |
| `pnpm typecheck`    | `tsc --noEmit` por workspace.                              |
| `pnpm test`         | Tests unitarios (Vitest) de todos los workspaces.          |
| `pnpm test:e2e`     | Tests e2e de Playwright (web).                             |
| `pnpm format`       | Prettier `--write` sobre el repo.                          |
| `pnpm format:check` | Verifica formato sin escribir.                             |

Para un solo workspace, usar el filtro de pnpm:

```bash
pnpm --filter @contave/api test
pnpm --filter @contave/web dev
pnpm --filter @contave/ledger build
```

### Playwright (primera vez)

```bash
pnpm --filter @contave/web exec playwright install chromium
pnpm test:e2e
```

### Base de datos (Drizzle)

El esquema se introduce en P2 (ver `docs/09-PROMPTS.md`); por ahora solo está la configuración.

```bash
pnpm --filter @contave/api db:generate   # genera migraciones desde el esquema
pnpm --filter @contave/api db:migrate     # aplica migraciones
```

## Estructura del repositorio

```
apps/
  web/                 → Next.js (UI, App Router + Tailwind + shadcn/ui)
  api/                 → NestJS (API + jobs BullMQ), config Drizzle
packages/
  ledger/              → motor de partida doble (puro, sin IO)   [lógica en P3]
  fiscal-engine/       → IVA, IGTF, retenciones, nómina (puro)   [lógica en P2/P7+]
  shared/              → tipos, Money/Decimal, fechas Caracas     [lógica en P1]
docs/                  → especificación (normativa, arquitectura, roadmap, prompts)
docker-compose.yml     → PostgreSQL 16 + Redis 7
turbo.json             → pipeline de tareas
tsconfig.base.json     → TypeScript estricto compartido
```

> **Estado (P0 — Bootstrap):** solo está la fundación técnica (toolchain, CI, infra, scaffolding).
> Los paquetes exponen un placeholder con su smoke test; **no hay lógica de negocio todavía**.
> La construcción sigue la secuencia de `docs/09-PROMPTS.md` (P1 en adelante) y los criterios de
> salida de `docs/08-ROADMAP.md`. Reglas duras del proyecto: `CLAUDE.md`.

## Documentación

| Archivo                           | Contenido                                               |
| --------------------------------- | ------------------------------------------------------- |
| `CLAUDE.md`                       | Reglas duras, convenciones, stack (lo lee Claude Code). |
| `docs/01-VISION.md`               | Producto, usuarios, competencia.                        |
| `docs/02-NORMATIVA-FISCAL.md`     | Leyes y providencias a cumplir.                         |
| `docs/03-PRINCIPIOS-CONTABLES.md` | Partida doble, VEN-NIF, motor multimoneda.              |
| `docs/04-NOMINA-LABORAL.md`       | LOTTT, parafiscales, cálculos de nómina.                |
| `docs/05-ARQUITECTURA.md`         | Stack, modelo de datos, invariantes, seguridad.         |
| `docs/06-MODULOS-UI.md`           | Módulos, vistas, flujos.                                |
| `docs/07-CASOS-BORDE.md`          | Casos límite (base de tests).                           |
| `docs/08-ROADMAP.md`              | Fases y criterios de salida.                            |
| `docs/09-PROMPTS.md`              | Secuencia de prompts de construcción.                   |

## CI

GitHub Actions (`.github/workflows/ci.yml`) corre en cada push a `main` y en cada PR:
`pnpm install --frozen-lockfile` y luego `lint + typecheck + test + build` vía Turbo (Node 22).
