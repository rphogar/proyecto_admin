# 12 — Arranque productivo

Guía para poner ContaVE en producción con la **autenticación real** (P27–P28) ya en su sitio. A
diferencia de `docs/11` (que monta una empresa de juguete para probar a mano), aquí **no se siembran
datos demo**: se provisiona un `owner` real y todo lo demás entra por la app.

> El **login demo (`/dev/sesion`) fue retirado** (P28). El único modo de entrar es `/login` con
> credenciales reales (Argon2 + JWT de sesión acotado al tenant + refresh rotativo + 2FA). El
> `db:seed-demo` quedó **solo para desarrollo local y fixtures de CI**; su entrada CLI rechaza
> `NODE_ENV=production`. Nunca lo ejecutes contra una base productiva.

---

## 1. Requisitos

- **PostgreSQL 16** (gestionado o propio). Dos roles: el **owner** (migraciones, bootstrap, provisión)
  y el **rol de aplicación** sin `BYPASSRLS` (lo gobierna la RLS) — ver `docs/11 §0` y
  `pnpm db:bootstrap-roles`.
- **Redis** para los jobs en segundo plano (captura BCV diaria, remisión al SENIAT, recordatorios).
  Sin Redis la app opera, pero esas automatizaciones no corren (usa carga manual de tasa).
- Node 22 + pnpm (vía Corepack).

## 2. Variables de entorno (API)

Obligatorias en producción (jamás en el repo — regla 14, solo por entorno):

```env
# Conexión OWNER: migraciones, bootstrap de roles y provisión del primer owner.
DATABASE_URL=postgresql://contave:***@HOST:5432/contave
# Conexión del RUNTIME de la API: rol de aplicación SIN BYPASSRLS.
APP_DATABASE_URL=postgresql://contave_app:***@HOST:5432/contave
API_PORT=3001
# Origen del frontend permitido por CORS.
WEB_ORIGIN=https://app.tudominio.com
# Firma del JWT de sesión (≥ 32 bytes aleatorios). Obligatoria para /auth/*.
AUTH_JWT_SECRET=***
# Cifrado at-rest del secreto TOTP (2FA). 32 bytes en base64/hex. Necesaria para enrolar 2FA.
APP_ENCRYPTION_KEY=***
# Opcionales (tienen default): TTL del access (seg) y del refresh (seg).
# AUTH_ACCESS_TTL=900
# AUTH_REFRESH_TTL=604800
```

Frontend (`apps/web`): `NEXT_PUBLIC_API_URL=https://api.tudominio.com`.

## 3. Preparar la base de datos (una sola vez)

Desde `apps/api/`:

```bash
pnpm db:bootstrap-roles   # crea el rol de aplicación contave_app (sin BYPASSRLS)
pnpm db:migrate           # aplica TODAS las migraciones (tablas, RLS, triggers, grants, permisos)
```

No corras `db:seed-demo` en producción.

## 4. Provisionar el primer `owner`

El sistema **no tiene auto-registro público**: la primera cuenta de cada tenant la crea un operador.
Usa el script de provisión (reemplazo productivo del seed demo):

```bash
OWNER_EMAIL=dueno@empresa.com \
OWNER_PASSWORD='una-clave-larga-y-fuerte' \   # ≥ 12 caracteres
OWNER_NOMBRE='Nombre Apellido' \
TENANT_NOMBRE='Mi Empresa, C.A.' \
TENANT_SLUG='mi-empresa' \
pnpm db:provisionar-owner
```

Crea el `tenant`, el `user` (`owner`, contraseña Argon2id, email ya verificado) y su `membership`. Se
pasan por variables de entorno —no por argumentos— para no dejar la clave en el historial del shell.
Imprime los UUID creados. A partir de aquí **todo es self-service por la app**.

## 5. Arrancar y entrar

```bash
cd apps/api && pnpm build && pnpm start    # API NestJS
cd apps/web && pnpm build && pnpm start    # UI Next.js
```

1. El owner entra por **`/login`** con su correo y clave.
   - Las acciones protegidas (`@RequierePermiso`) exigen **2FA** para owner/admin/contador: la
     primera vez verás `DOS_FACTORES_REQUERIDO` hasta enrolar TOTP (requiere `APP_ENCRYPTION_KEY`).
2. Da de alta la empresa con el **asistente de onboarding** (P30, `/onboarding`): RIF → perfil
   tributario inferido → plan de cuentas y plantillas precargados → saldos iniciales → asiento de
   apertura. Meta: facturando en < 30 minutos.
3. **Más usuarios**: se incorporan por **invitación** (P29, `/configuracion/usuarios`), no
   provisionando a mano. **Más empresas** del mismo dueño: el selector de empresa de la barra
   superior cambia de tenant re-emitiendo un token acotado (P28).

## 6. Manejo de sesión y errores (P32)

- **Sesión expirada**: cualquier llamada de negocio que reciba **401** (token vencido o revocado)
  cierra la sesión local y redirige a `/login?expirada=1` con un aviso claro. El refresh rotativo
  renueva el access de forma proactiva antes de que expire; si el refresh falla, se fuerza el
  re-login.
- **Permisos (403)**: una acción sin permiso muestra el mensaje del backend
  (`RBAC_PERMISO_DENEGADO`) y queda auditada (`access.denied`, caso 54). La UI nunca deja la acción
  a medias en silencio.
- **Tasa BCV rezagada** (caso 57): si el job de captura no corrió, la app sigue operando con la
  última tasa publicada y muestra un **banner de advertencia**; usa la carga manual mientras tanto.

## 7. Verificación de salud

- `GET /health` responde sin requerir tenant.
- Drill de invariantes del ledger (regla 7/8, caso 56): `pnpm drill:invariantes` (puede agendarse).
- Pruebas: `pnpm turbo run lint typecheck test build`, integración con Postgres real
  (`pnpm --filter @contave/api test:int`) y e2e de UI (`pnpm --filter @contave/web test:e2e`).
