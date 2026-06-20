# 11 — Guía de pruebas: simular una empresa real

Esta guía te lleva de cero a operar el sistema como lo haría **Distribuidora Demo, C.A.**, una
PYME venezolana. Está pensada para validar a mano que cada módulo funciona de punta a punta.

> **Estado honesto del sistema (jun-2026).** La base de datos, los servicios de cada módulo y sus
> tests están completos. La **autenticación real (login con usuario/clave, JWT, membresías) aún NO
> está construida**: es un STUB planificado. Para poder probar, se usa un **login demo de
> desarrollo** (`/dev/sesion`) que entra a una empresa sembrada. Esto se reemplazará por el login
> real más adelante. No subir el módulo `dev` ni el seed demo a producción (ya está blindado:
> el módulo `dev` no se monta si `NODE_ENV=production`).

---

## 0. Decidir la base de datos (requisito previo)

El sistema **necesita PostgreSQL 16** para funcionar; sin él no hay nada que probar. En esta
máquina no hay Docker. Tres caminos, de menor a mayor fricción:

| Opción | Esfuerzo | Pros | Contras |
|---|---|---|---|
| **PostgreSQL nativo en Windows** (recomendado) | Medio (1 instalador) | Local, rápido, control total, fiel al `docker-compose` | Hay que instalar el servicio |
| **Postgres en la nube (Neon/Supabase, plan gratis)** | Bajo (sin instalar) | Cero mantenimiento | Latencia; hay que crear el rol de app y dar permisos a mano |
| **Instalar Docker Desktop** | Alto | El `docker-compose.yml` ya está listo (`docker compose up -d`) | Requiere WSL2; es lo que se venía evitando |

**Recomendación:** PostgreSQL 16 nativo en Windows. **Redis es opcional**: solo lo usan los *jobs*
en segundo plano (captura BCV automática, etc.). Para probar las pantallas y la carga manual de
datos **no hace falta Redis**; lo puedes dejar para después.

### Instalar Postgres nativo (resumen)
1. Descarga el instalador de PostgreSQL 16 (EnterpriseDB) e instálalo. Anota la contraseña del
   superusuario `postgres`.
2. Crea la base y el usuario owner que esperan los scripts (con `psql` o pgAdmin):
   ```sql
   CREATE ROLE contave LOGIN PASSWORD 'contave_dev' CREATEROLE;
   CREATE DATABASE contave OWNER contave;
   ```

---

## 1. Variables de entorno

Crea `apps/api/.env` (la API y los scripts lo leen):

```env
# Conexión OWNER: la usan migraciones, bootstrap de roles y el seed demo.
DATABASE_URL=postgresql://contave:contave_dev@localhost:5432/contave
# Conexión del RUNTIME de la API: rol de aplicación SIN BYPASSRLS (lo gobierna RLS).
APP_DATABASE_URL=postgresql://contave_app:contave_app_dev@localhost:5432/contave
API_PORT=3001
# Origen del frontend permitido por CORS (default ya es este).
WEB_ORIGIN=http://localhost:3000
# Solo si vas a probar 2FA (enrolamiento TOTP). 32 bytes en base64/hex. Opcional para el resto.
# APP_ENCRYPTION_KEY=<32 bytes base64>
```

Y `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 2. Preparar la base de datos (una sola vez)

Desde `apps/api/`:

```bash
pnpm db:bootstrap-roles   # crea el rol de aplicación contave_app (sin BYPASSRLS)
pnpm db:migrate           # aplica las 57 migraciones (tablas, RLS, triggers, grants, permisos)
pnpm db:seed-demo         # siembra el tenant/empresa/usuario DEMO + una tasa BCV del día
```

Si todo salió bien, `db:seed-demo` imprime los UUID de la empresa DEMO:
- **tenant**: `00000000-0000-0000-0000-0000000000a1` (Grupo Demo)
- **empresa**: `00000000-0000-0000-0000-0000000000c1` (Distribuidora Demo, C.A.)
- **usuario**: `00000000-0000-0000-0000-0000000000b1` (demo@contave.test, rol `owner`)

---

## 3. Arrancar la aplicación

Dos terminales:

```bash
# Terminal 1 — API (NestJS, puerto 3001)
cd apps/api && pnpm start:dev

# Terminal 2 — Web (Next.js, puerto 3000)
cd apps/web && pnpm dev
```

Comprueba que la API responde: abre `http://localhost:3001/health` (debe responder sin pedir
tenant). Luego abre la web en `http://localhost:3000`.

---

## 4. Entrar a la empresa (login demo)

1. En la barra superior, pulsa **“Entrar (empresa demo)”**.
2. Debe mostrarse **Empresa: Distribuidora Demo, C.A.** El frontend ya guarda el contexto
   (tenant + empresa + usuario) y lo envía en cada llamada como cabecera `x-tenant-id`.
3. En la portada, el widget **“Tasa del día”** debe mostrar **Bs 40,00000000** (la tasa sembrada).
   - Prueba la **carga manual**: pulsa **“Cargar tasa manual”**, ingresa una tasa, una fecha y un
     **motivo** (obligatorio, queda auditado), y guarda. El widget se refresca con tu valor.

> Si ves “No se pudo obtener la tasa del día” es porque **no has entrado** a una empresa (la API
> exige contexto de tenant). Pulsa “Entrar” primero.

---

## 5. Recorrido por módulos (simulación de la empresa)

El orden importa: los maestros alimentan a ventas/compras, y estos al ledger e impuestos.

### 5.1 Maestros (`/maestros`)
La base del negocio. Crea, en este orden:
1. **Terceros** (`/maestros/parties`): un **cliente** (p. ej. “Comercial El Sol, C.A.”, RIF
   `J-30123456-7`) y un **proveedor**. El RIF se valida (caso 16: un RIF inválido se rechaza con
   motivo).
2. **Ítems** (`/maestros/items`): 2–3 productos con su alícuota de IVA (16 %, exento, etc.).
3. **Listas de precios** (`/maestros/price-lists`) y precios por ítem.
4. **Almacenes** (`/maestros/warehouses`), **métodos de pago** (`/maestros/payment-methods`) y
   **series** de documentos (`/maestros/series`) — la serie da la numeración consecutiva sin huecos.

### 5.2 Ventas (`/ventas/facturas`)
1. **Nueva factura** (`/ventas/facturas/nueva`): elige el cliente, agrega líneas (ítem, cantidad,
   precio). Observa el cálculo en vivo de IVA/IGTF (lo hace el motor fiscal, la UI solo muestra).
2. Guarda como **borrador**, revísala y luego **emítela**. Al emitir queda **inmutable** (regla 4):
   ya no se puede editar; una corrección es una **nota de crédito/débito**.
3. Descarga el **PDF** de la factura.
4. **Cobro** (`/ventas/cobros`): registra un cobro (efectivo/divisas), aplica a la factura y observa
   el asiento automático (IGTF, vuelto, diferencial cambiario si pagó en otra moneda).

### 5.3 Compras y retenciones (`/compras`)
1. **Nueva compra** (`/compras/nueva`): factura de proveedor (número y nº de control obligatorios),
   líneas e IVA crédito. Si la empresa es agente de retención, genera la **retención de IVA**
   (75/100) e **ISLR** por concepto.
2. Descarga el **comprobante de retención** (PDF/TXT para el SENIAT).
3. **Retenciones recibidas** (`/compras/retenciones-recibidas`): registra una que te practicó un
   cliente, imputada al período.

### 5.4 Impuestos (módulo, vía API/pantalla de declaraciones)
- Prepara una **declaración de IVA** del período. El libro de compras/ventas se deriva en vivo de
  los impuestos de documentos. Al **presentar**, el snapshot queda inmutable.

### 5.5 Tesorería (`/tesoreria/posicion`)
1. **Posición** consolidada (derivada del ledger, regla 8).
2. **Transferencia interna** (`/tesoreria/transferencias`) entre cuentas en distinta moneda →
   genera diferencial cambiario.
3. **Cierre de caja** (`/tesoreria/cierres-caja`) con arqueo por método de pago.
4. **Conciliación** (`/tesoreria/conciliacion`): importa un estado de cuenta y concilia n:m.

### 5.6 Inventario
- Registra un **ajuste** (con motivo y aprobación: separación de deberes), un **traslado** entre
  almacenes (estado EN_TRÁNSITO) y un **conteo físico** cuya diferencia genera un ajuste. El costo
  promedio se deriva del kardex.

### 5.7 Nómina (`/nomina`)
1. **Trabajadores** (`/nomina/trabajadores`): crea una ficha (salario cifrado at-rest).
2. **Conceptos** (`/nomina/conceptos`): asignaciones/deducciones con fórmulas seguras.
3. **Corrida** (`/nomina/corridas`): pre-nómina → aprobación → recibos (PDF) → asiento contable.
4. **Prestaciones** (`/nomina/prestaciones`, art. 142) y **parafiscales** (`/nomina/parafiscales`,
   IVSS/RPE/FAOV/INCES) con descarga de planillas.

### 5.8 Contabilidad y cierre
- Revisa los **asientos** generados automáticamente por ventas/compras/nómina (verifica el
  invariante: `SUM(débitos) == SUM(créditos)` en VES, USD y moneda origen).
- Registra un **asiento manual** con soporte adjunto.
- Corre el **wizard de cierre mensual**: bloquea el período (no acepta asientos con fecha dentro).

### 5.9 Portal del contador (`/portal`)
- **Panel multi-empresa**, **calendario** de obligaciones (`/portal/calendario`), **checklist** de
  cierre (`/portal/checklist`) y **delegaciones** de permisos por empresa (`/portal/delegaciones`).

### 5.10 Dashboard (`/dashboard`)
- Vista del dueño, móvil-primero, en USD gerencial, derivada del ledger.

---

## 6. Qué verificar (criterios de aceptación)
- **Numeración sin huecos**: emite varias facturas; los números son consecutivos por serie.
- **Inmutabilidad**: intenta editar una factura emitida o un asiento posteado → debe rechazarse.
- **Auditoría**: cada escritura deja rastro en `audit_events` (quién/cuándo/antes/después).
- **Multimoneda**: toda línea guarda VES (fiscal) y USD (gerencial); el diferencial cambiario se
  asienta, nunca se “absorbe”.
- **Aislamiento**: con otra empresa/tenant no deberías ver datos ajenos (RLS).

---

## 7. Límites conocidos (aún no construido)
- **Login real**: hoy se entra con el botón demo. No hay usuario/contraseña ni control de a qué
  empresas puede acceder cada usuario (eso es el `TODO(auth)`).
- **Jobs automáticos** (captura BCV diaria, remisión al SENIAT): requieren **Redis**. Sin Redis,
  usa la **carga manual** de tasa y los disparos manuales donde existan.
- **2FA**: requiere `APP_ENCRYPTION_KEY`.
```
