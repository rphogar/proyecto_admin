# 09 — Secuencia de Prompts para Claude Code

Cómo usar: ejecutar en orden, uno por sesión de trabajo. `[PLAN]` = activar plan mode (shift+tab) y revisar el plan antes de aprobar. Tras cada prompt: correr tests, revisar el diff, commitear. Si Claude Code propone desviarse del stack o de las reglas de `CLAUDE.md`, rechazar y pedir alternativa conforme.

Consejos generales: (1) mantener sesiones enfocadas en UN objetivo; (2) pedir siempre "tests primero" en ledger/fiscal-engine; (3) usar `/clear` entre prompts grandes para no arrastrar contexto sucio; (4) cuando un prompt toque normativa, pedirle que cite el artículo del doc 02/03/04 que implementa.

---

### P0 — Bootstrap `[PLAN]`
> Lee CLAUDE.md, docs/05-ARQUITECTURA.md y docs/08-ROADMAP.md. Crea el monorepo (pnpm + Turborepo) con apps/web (Next.js App Router + Tailwind + shadcn/ui), apps/api (NestJS), packages/ledger, packages/fiscal-engine, packages/shared. Configura TypeScript estricto, ESLint, Vitest, Playwright, docker-compose con PostgreSQL 16 y Redis, y CI de GitHub Actions que corra lint+tests. No implementes lógica de negocio todavía. Entrega un README de desarrollo con los comandos.

### P1 — Shared: dinero y fechas
> Lee CLAUDE.md (reglas 1–3, 15) y docs/03 §4. En packages/shared implementa con TDD: tipo `Money` sobre decimal.js (operaciones, comparaciones, redondeo fiscal half-up a 2 decimales, distribución proporcional sin perder céntimos), utilidades de fecha `America/Caracas` (fechaFiscal(tsUtc), límites de período mensual), y validador de RIF venezolano con dígito verificador (formato [VEJPG]-XXXXXXXX-X) con suite de casos válidos e inválidos.

### P2 — Esquema base + multi-tenancy `[PLAN]`
> Lee docs/05 §2–3.1. Crea las migraciones de: tenants, users, memberships, roles/permissions, companies, branches, fiscal_params (con vigencias) y audit_events (append-only, sin grants de UPDATE/DELETE). Activa Row Level Security con la política de tenant en todas las tablas. Implementa en la API el contexto de tenant (middleware que setea app.tenant_id) y el servicio de auditoría. Tests de aislamiento cross-tenant (caso 55 del doc 07).

### P3 — Motor de ledger `[PLAN]`
> Lee docs/03 §1–2 y §4 completo, docs/05 §3.5 y §7. Implementa packages/ledger con TDD: cuentas (árbol, naturaleza), asientos triple base (origen/VES/USD) con invariante ΣD=ΣC en las tres columnas, posting/reversal, períodos con cierre/bloqueo. Luego las migraciones (journal_entries, journal_lines, periods) con CHECK diferido y triggers de inmutabilidad (regla 4 de CLAUDE.md). Property tests con fast-check para los invariantes 1, 6 y 9, y los casos 9, 24 y 42 del doc 07. Seed del plan de cuentas del doc 03 §2.

### P4 — Tasas BCV
> Lee docs/05 §3.3 y casos 1–3, 11 y 57 del doc 07. Implementa exchange_rates, el job diario de captura con fuente primaria y fallback, entrada manual auditada, y rateFor(date, currency) con regla de última tasa publicada. Idempotencia del job. Endpoint y widget de tasa del día. Tests de todos los casos citados.

### P5 — Maestros
> Lee docs/05 §3.2 y docs/06 (convenciones + M12). Implementa parties (con validación RIF y condición tributaria), items con alícuotas, warehouses, price_lists, payment_methods mapeados a cuentas, series de documentos. CRUDs en la UI con las convenciones globales del doc 06. Tests del caso 16.

### P6 — Documentos y numeración `[PLAN]`
> Lee docs/05 §3.4 y §4, docs/02 §6 (requisitos de factura) y casos 19–21, 24, 53 del doc 07. Implementa el núcleo de documents/document_lines/document_taxes con estados, el patrón de numeración consecutiva transaccional, la emisión como transacción única (número+documento+impuestos+asiento+auditoría) y el validador pre-emisión de requisitos (00071/00102) como función pura en fiscal-engine que devuelve la lista de incumplimientos. Test de concurrencia de 100 emisiones paralelas.

### P7 — Motor de IVA e IGTF
> Lee docs/02 §3 y §5 y casos 4, 12–14, 22, 34–35 del doc 07. En fiscal-engine implementa con golden tests: cálculo de IVA multi-alícuota por documento, prorrata mensual de crédito fiscal, e IGTF causado al pago sobre la porción en divisas según condición SPE. Estructura los golden tests en packages/fiscal-engine/golden/ con los valores exactos del doc 07.

### P8 — Ventas: editor de factura + cobros
> Lee docs/06 M1 y M3, casos 4–8, 15, 17–18 del doc 07. Construye el editor de factura completo (cabecera, líneas, panel de totales en vivo con IGTF estimado, validador visible, botones Emitir / Emitir y cobrar), las NC/ND con asistente parcial/total, y el registro de cobros con split multimoneda, vuelto cruzado y diferencial cambiario automático. PDF de factura con plantilla configurable que muestre equivalente en Bs y tasa BCV.

### P9 — Compras y retenciones `[PLAN]`
> Lee docs/02 §3.3 y §4 (tabla 1.808), docs/06 M2, casos 26–33 del doc 07. Implementa registro de facturas de compra (número y control del proveedor obligatorios), retención de IVA 75/100 como agente con comprobante PDF (numeración AAAAMMNNNNNNNN) y archivo TXT del portal SENIAT, retenciones ISLR por concepto con sustraendo, y el registro de comprobantes recibidos con imputación por período. Golden tests 26, 27, 31.

### P10 — Libros y declaraciones
> Lee docs/02 §3.2 y §7.2, docs/06 M7, caso de triple igualdad (doc 05 §7.3). Genera Libro de Compras y Libro de Ventas con las columnas exactas del Reglamento, PDF legal + Excel; la planilla borrador de IVA con retenciones soportadas y excedentes; declaración de IGTF; snapshots inmutables al marcar presentada; y el test de triple igualdad libro=documentos=planilla sobre un mes sintético completo.

### P11 — Tesorería y conciliación
> Lee docs/06 M4 y casos 5, 11 del doc 07. Implementa posición consolidada, transferencias internas con conversión, cierres de caja con arqueo por método, importadores de estados de cuenta (empieza por Banesco y Mercantil; parsers versionados con fixtures reales anonimizados), y el motor de matching con score + UI de conciliación de dos columnas.

### P12 — Inventario
> Lee docs/06 M5 y casos 37–41. Implementa stock_moves, kardex y costo promedio en doble base, ajustes con aprobación, traslados con tránsito, conteo físico, actualización masiva de precios y alerta de margen negativo en USD. Golden test 37.

### P13 — Contabilidad y cierre
> Lee docs/03 §5–6, docs/06 M6, casos 11, 42–43. Implementa asientos manuales, plantillas de contabilización versionadas, balance de comprobación y estados financieros en ambas bases con drill-down, y el wizard de cierre mensual completo (incluye asiento reversible de diferencial no realizado, idempotente).

### P14 — Dashboard del dueño
> Lee docs/06 M0 y docs/01 §2 (persona "dueño"). Construye el dashboard móvil-primero con todos los widgets, en USD por defecto con toggle a Bs, datos en tiempo real desde el ledger (sin cifras cacheadas que puedan descuadrar) y los accesos rápidos.

### P15 — Nómina `[PLAN]`
> Lee docs/04 COMPLETO y casos 47–52. Implementa fichas, conceptos con fórmulas seguras, pre-nómina→aprobación→recibos→asiento, kardex de prestaciones con doble cálculo art. 142, provisiones mensuales, parafiscales con planillas TIUNA/FAOV/INCES y ARI/ARC. Golden tests 47–50. Marca TODO-TRIBUTARISTA donde el doc lo indica.

### P16 — Portal del contador + multi-empresa
> Lee docs/06 M11. Panel multi-empresa con estado de cierres, calendario consolidado de obligaciones, checklist masivo y permisos delegados.

### P17 — Cumplimiento Providencia 121
> Lee docs/02 §6.3 y docs/05 §3.9. Implementa fiscal_event_log integral (emisión, impresión, reimpresión, fallos), la cola de remisión con adapter stub y reintentos, el endpoint de exportación del expediente técnico, y un informe de cumplimiento que mapee cada requisito de la providencia a su implementación y test.

### P18 — Endurecimiento
> Lee docs/05 §6–7 y los casos H del doc 07. Auditoría de seguridad (RBAC por acción, 2FA, rate limits), drill de backup/restore automatizado con verificación de invariantes, pruebas e2e de los 5 flujos transversales del doc 06, y carga (500 documentos/minuto) sin romper numeración.

---

## Fase 2 (continuación: P19+) — dos pistas

Continúa la secuencia tras P0–P18. **Pista B** (P19–P26): profundidad fiscal → homologación
SNAT/2024/000121 (rumbo elegido). **Pista A** (P27–P32): cerrar la brecha de **autenticación real y
onboarding** (hoy el sistema entra con un login demo provisional; ver `docs/11-GUIA-PRUEBAS.md`).
Mismas convenciones: uno por sesión, `[PLAN]` en los grandes, tests primero en `ledger`/`fiscal-engine`,
citar la norma en el commit, `TODO-TRIBUTARISTA` ante cualquier ambigüedad (no asumir). Antes de
empezar, leer `docs/02` (§3–7), `docs/05` (§2, §6), `docs/06` (M12 + flujos transversales), `docs/10`
y los casos B/C/D/F/H de `docs/07`.

### Pista B — Profundidad fiscal → homologación SENIAT

Orden: primero la profundidad de software puro verificable con golden tests (P19–P22), luego el
hardware y los canales externos (P23–P25), y al final el empaquetado de homologación (P26). P25
depende de que el SENIAT publique el canal técnico.

#### P19 — Validador 00071/00102 completo + endurecimiento del generador
> Lee docs/02 §6.1 (requisitos mínimos de factura) y §6.2, docs/06 M1 (editor de factura con
> validador pre-emisión visible) y casos 12, 14, 15, 16, 19–23 del doc 07.
> Revisa lo ya hecho en P6 (`documentos/` y el validador pre-emisión en `fiscal-engine`). Completa el
> validador pre-emisión como función **pura** que devuelva la lista EXHAUSTIVA de incumplimientos
> contra TODOS los requisitos de la 00071: denominación, numeración consecutiva, número de control,
> datos del emisor (RIF + domicilio fiscal), identificación del adquirente con la regla de
> **"consumidor final" bajo umbral** vs RIF obligatorio para contribuyentes (caso 15), descripción con
> cantidad/precio, descuentos, base imponible y **IVA discriminados por alícuota**, total, y —si el
> documento se expresa en divisas— **equivalente en Bs y tasa BCV aplicada** (docs/02 §6.1, §9).
> Añade golden/unit tests por cada requisito que falla aisladamente. Incluye: factura multi-alícuota
> 16%/8%/exento (caso 12), exportación 0% sin IGTF marcando créditos para recuperación (caso 22),
> factura en EUR con doble conversión (caso 23), y cambio de alícuota a mitad de mes por parámetro con
> vigencia (caso 14). La UI del editor debe mostrar los incumplimientos y bloquear "Emitir" hasta
> resolverlos. No tocar documentos ya emitidos.

#### P20 — Libros de Compras y Ventas exactos + triple igualdad auditada `[PLAN]`
> Lee docs/02 §7.2 (Reglamento IVA arts. 70–78), §11.8 (una sola fuente de verdad), docs/06 M7
> (Libros) y docs/05 §7.3 (triple igualdad). Revisa P10. Genera el **Libro de Compras** y el **Libro de Ventas** con las
> columnas EXACTAS del Reglamento: fecha; RIF y nombre; nº de factura, de control, de NC/ND, de
> comprobante de retención; tipo de operación (interna/importación/exportación); monto total; base
> imponible **por alícuota**; IVA **por alícuota**; exentas/exoneradas/no sujetas; IVA retenido; con
> resumen mensual que cuadre con la declaración. Exporta en **PDF legal imprimible** y **Excel**
> (SpreadsheetML, sin dep nueva). Deriva los libros de los MISMOS registros que la declaración
> (`document_taxes`/`purchase_taxes`), nunca de una tabla materializada aparte. Test estrella:
> **triple igualdad libro = documentos = planilla** sobre un mes sintético completo con todas las
> alícuotas, NC/ND, retenciones y una exportación — cero diferencias (si no cuadra, es bug).

#### P21 — Declaraciones definitivas IVA/IGTF + anticipos y calendario SPE
> Lee docs/02 §3.2 (débito/crédito/cuota, prorrata), §5 (IGTF), §10 (calendario), docs/06 M7 (planilla
> 99030, IGTF, calendario) y casos 13, 17, 30, 34–35 del doc 07. Revisa P10. Implementa: **planilla borrador de IVA (forma 99030)** con
> débitos − créditos − retenciones soportadas acumuladas − excedentes de períodos anteriores, con
> **prorrata mensual** del crédito común (caso 13) y arrastre de excedentes (caso 30); **declaración
> de IGTF percibido** sobre la porción en divisas (casos 34–35, sin duplicar en anticipos); y el
> **régimen de anticipos quincenales/semanales de IVA e ISLR para SPE** y su calendario. El **calendario
> SPE se importa como datos por providencia anual** (por terminal de RIF), NUNCA hardcodeado (regla 17).
> Snapshot inmutable al marcar "presentada"; una NC de período ya declarado se imputa al período
> corriente y nunca reabre lo presentado (caso 17). Golden tests de la cuota y del IGTF. Marca
> `TODO-TRIBUTARISTA` los umbrales/porcentajes de anticipos sujetos a providencia vigente.

#### P22 — Retenciones IVA/ISLR: TXT/XML SENIAT + tabla 1.808 completa + ARC
> Lee docs/02 §3.3 (Providencia 0049), §4 (Decreto 1.808), docs/06 M7 (Retenciones IVA/ISLR + ARC) y
> casos 26–33 del doc 07. Revisa P9. Endurece:
> el **TXT de declaración de retenciones de IVA** con el formato EXACTO del portal SENIAT, validado
> contra un archivo de ejemplo real anonimizado (caso 33: rechazo del portal = bug crítico); la **tabla
> 1.808 de ISLR** completa y parametrizable por concepto con **sustraendo** para personas naturales
> (caso 31: si la base no supera el umbral, retención 0); el **comprobante de retención de ISLR** y el
> **ARC anual**; y los bordes 28 (comprobante recibido tarde → período de recepción + control de
> facturas a SPE sin comprobante > 30 días), 29 (factura sin IVA discriminado/ sin nº de control →
> 100% / no deducible + alerta) y 30 (excedente de retenciones con arrastre). Caso 32 (pago mixto
> servicio+materiales) configurable por línea y marcado `TODO-TRIBUTARISTA`. Golden tests 26, 27, 31.

#### P23 — Impresora fiscal: driver + agente local `[PLAN]`
> Lee docs/02 §6.1 (máquinas fiscales y obligados), docs/05 §5 (integración de impresoras fiscales:
> agente/driver local con cola), docs/06 M1 (POS con soporte de impresora fiscal) y docs/10 req. 6.3.5.
> Implementa el **soporte de
> impresora fiscal homologada** para UNA marca primero (The Factory HKA, la más común en VE), con esta
> arquitectura: la API SaaS NO habla directo con el hardware; define un **adapter `ImpresoraFiscal`**
> (interfaz limpia, punto de extensión único, igual filosofía que `RemisionAdapter`) y un **agente
> local** ligero que corre en la tienda del cliente y traduce las órdenes al protocolo del fabricante
> por puerto serie/USB. Implementa: mapeo documento→comandos fiscales, **reportes X y Z**, lectura de
> **memoria fiscal**, manejo de **contingencia** (impresora caída → política definida, sin romper la
> numeración ni la atomicidad de la emisión), y registro del evento de impresión en `fiscal_event_log`.
> Tests del mapeo y de contingencia con un **adapter simulado** (sin hardware en CI). Marca
> `TODO-TRIBUTARISTA`/`TODO-HARDWARE` lo que requiera validación con el equipo físico real.

#### P24 — Facturación digital 00102 + números de control digitales `[PLAN]`
> Lee docs/02 §6.2 (Providencia 00102, imprenta digital autorizada) y §6.1, docs/05 §5 (adapter de
> imprenta digital por proveedor) y docs/06 M12 (plantillas de impresión digital). Implementa el **régimen de
> factura digital**: un **adapter `ImprentaDigital`** (punto de extensión único) que solicita y asigna
> el **número de control digital** a cada documento al emitir, la **entrega electrónica** (correo/otro
> medio) del documento con todos los requisitos de la 00071 + elementos de control digital (incluido un
> identificador/QR verificable), y la conservación digital a disposición del SENIAT (10 años por COT).
> Deja explícitamente preparada —pero sin implementar— la futura **validación en línea del SENIAT**
> (factura electrónica con acuse en tiempo real), documentando el punto de integración. Tests del
> ciclo emisión→asignación de control→entrega con un adapter simulado. Marca `TODO-TRIBUTARISTA` los
> supuestos de obligatoriedad (ventas por medios electrónicos) y el formato del control digital pendiente
> de la especificación oficial de la imprenta autorizada.

#### P25 — Remisión real al SENIAT (cuando publiquen el canal)
> Lee docs/02 §6.3 req. 2 y docs/10 §6.3.2. Revisa el `RemisionAdapter` stub y la cola
> `fiscal_transmission_queue` (P17). Implementa el **adapter real** de remisión electrónica cuando el
> SENIAT publique el canal técnico: serialización al formato requerido (XML/JSON firmado), **firma**,
> envío seguro, manejo del **acuse** (fehaciencia), idempotencia por documento, y los reintentos con
> backoff ya existentes. Añade **observabilidad** (estado de la cola, antigüedad del pendiente más viejo,
> tasa de error) y alertas. Mientras la especificación no exista, NO inventes el formato: endurece la
> cola, define contratos y tests con un adapter de prueba, y deja `TODO-TRIBUTARISTA`/`TODO-SENIAT`
> claramente marcado en el punto exacto que depende de la norma. No romper el desacople (docs/05 §5).

#### P26 — Expediente técnico de homologación + pruebas de inviolabilidad `[PLAN]`
> Lee docs/02 §6.3 req. 6, docs/10 ("Pendiente para la homologación") y docs/05 §6–7. Completa el
> **expediente técnico** que ya ensambla `expediente.service.ts`: ficha técnica del producto,
> **manuales de usuario**, arquitectura de seguridad e informe de cumplimiento, todo contra la versión
> vigente de `product_versions`. Implementa las **pruebas de inviolabilidad documentadas**: tests que
> intentan (y demuestran que se detecta/rechaza) alterar la bitácora encadenada, modificar un documento
> emitido o un asiento posteado saltando la API, y crear huecos de numeración bajo concurrencia
> (refuerza el caso 21 con 500 emisiones simultáneas). Añade el flujo para pasar `product_versions` a
> estado **`SOLICITADA`** registrando el **hash del artefacto** del build homologado y verificar su
> reproducibilidad. Actualiza `docs/10` y el `compliance-report.ts` (fuente de verdad) en el mismo
> commit. Marca como pendientes explícitos los entregables NO-software (asesoría legal, anexos).

### Pista A — Autenticación real y onboarding

Cierra la brecha que hoy cubre el login demo (`docs/11`). Construir en orden: la base de auth (P27),
el contexto de tenant desde el token (P28), la gestión de usuarios (P29), el alta guiada de empresa
(P30), la migración de datos (P31) y las pruebas e2e que retiran el demo (P32).

#### P27 — Autenticación base: login, sesión JWT, recuperación `[PLAN]`
> Lee docs/05 §6 (Argon2, 2FA TOTP obligatorio para owner/admin/contador, sesiones cortas, refresh
> rotativo) y revisa P18 (guards `@RequierePermiso`, 2FA TOTP cifrado, rate-limit). Implementa el login
> real: endpoint de inicio de sesión con email+password verificado con **Argon2** (la columna
> `password_hash` de `users` ya existe), emisión de **access token JWT corto** + **refresh token
> rotativo** (revocable, guardado con hash), logout que revoca el refresh, y **recuperación de
> contraseña** (token de un solo uso con expiración; sin revelar si el email existe). Integra el **2FA
> TOTP de P18** como segundo paso del login, **obligatorio** para owner/admin/contador. Aplica el
> **rate-limit de P18** y bloqueo temporal tras N intentos a los endpoints de auth. La clave de firma
> del JWT va SOLO por variable de entorno (regla 14), jamás en el repo. Tests: login ok/fallo,
> expiración y **rotación de refresh** (un refresh reutilizado se invalida — detección de robo), 2FA
> exigido en roles privilegiados, recuperación, rate-limit/lockout. Deja marcado el punto donde luego
> se conecta la verificación de email.

#### P28 — Tenant desde JWT + multi-empresa + cambio seguro `[PLAN]`
> Lee docs/05 §2 (multi-tenancy, `memberships`) y casos 54–55 del doc 07. **Cierra el `TODO(auth)`**:
> reemplaza el `TenantContextMiddleware` stub (hoy lee `x-tenant-id`/`x-user-id` de cabeceras del
> cliente) por la **derivación del tenant y el actor desde el claim del JWT verificado**. El token lleva
> el `userId` y la **empresa/tenant activos**; el contexto de tenant (`app.tenant_id` vía `withTenant`)
> se fija desde ahí, **nunca** desde datos del cliente. Implementa el **cambio de empresa**: un usuario
> con varias membresías puede cambiar de tenant/empresa, lo que **re-emite un token acotado** a esa
> empresa validando la membresía contra `memberships`. En el frontend, **reemplaza el login demo y
> `cabecerasTenant()`** (docs/11) por el flujo real (cookies httpOnly o `Authorization: Bearer`); el
> `selector-empresa` pasa a listar las empresas del usuario desde la API. Tests: caso 55 (token de un
> tenant usado contra datos de otro → 0 filas + alerta), caso 54 (rol sin permiso → 403 + auditoría),
> imposibilidad de forzar un tenant sin membresía. Retira/blindar el módulo `dev` de login demo.

#### P29 — Usuarios, roles e invitaciones `[PLAN]`
> Lee docs/05 §6 (RBAC por acción, separación de deberes), docs/06 M12 (Usuarios/roles/permisos) y
> docs/02 §1. Implementa la **gestión de usuarios por tenant/empresa**: invitar por email con un **rol**
> (crea `membership` pendiente → correo de invitación → aceptación que vincula o crea el `user`),
> reasignar rol, **desactivar/reactivar** membresías y **transferencia de propiedad** (owner → otro,
> auditada). Aplica la **separación de deberes** configurable (quien aprueba nómina ≠ quien la crea;
> quien registra ≠ quien concilia) y la regla de que **nadie escala su propio rol**. UI en M12 con el
> visor de permisos por rol (catálogo `permissions` de P2/P18). Todo cambio deja `audit_events`. Tests:
> ciclo de invitación, enforcement de rol (caso 54), no auto-escalada, el **último owner** no puede
> quedar sin owner, aislamiento por tenant.

#### P30 — Onboarding wizard de empresa `[PLAN]`
> Lee docs/06 (flujo transversal #5 "Onboarding" y M12), docs/02 §1 (perfiles de contribuyente),
> docs/03 §2 (plan de cuentas base) y caso 45 del doc 07. Construye el **asistente de alta de empresa**
> (meta: facturando en < 30 min): captura **RIF** (validar dígito verificador), infiere el **perfil
> tributario** (ordinario/formal/SPE, agente de retención, % que le aplican, ejercicio fiscal, riesgo
> IVSS, días de utilidades — docs/02 §1 y schema `companies`), **precarga** el plan de cuentas
> venezolano (docs/03 §2), las **plantillas de contabilización**, los **métodos de pago↔cuenta** y las
> **series** por defecto, y guía la **carga de saldos iniciales** (caja, bancos, CxC/CxP por tercero,
> inventario con costo y **fecha de origen** para reexpresión, capital) generando un **asiento de
> apertura balanceado en las 3 bases**. Un tenant puede tener **varias empresas** (repetir el asistente).
> Idempotente. Tests: asiento de apertura cuadra en VES/USD/origen, inferencia de perfil, precarga
> completa, multi-empresa aislada.

#### P31 — Importador de migración (Galac/Profit/Excel)
> Lee casos 45–46 del doc 07 y docs/02 §9 (escala monetaria). Implementa **importadores** para arrancar
> a un cliente que viene de otro sistema: **terceros** (validación y deduplicación por RIF), **ítems**
> (con costo y alícuota), **CxC/CxP abiertas** por documento/tercero, y **saldos iniciales** que se
> integran al **asiento de apertura** del onboarding (P30). Plantillas **CSV/Excel** descargables,
> **vista previa en seco (dry-run)** con reporte de errores por fila antes de confirmar, y
> **normalización de reconversión monetaria** histórica (caso 46). Los saldos iniciales cargan con
> **costo y fecha de origen** para reexpresión (caso 45). Sigue el patrón de **parsers versionados**
> (como los de bancos, docs/05 §5). Tests con fixtures anonimizados: importación correcta, deduplicación,
> dry-run que no escribe, asiento de apertura resultante balanceado.

#### P32 — e2e de flujos transversales + retiro del login demo
> Lee docs/06 ("Flujos transversales que deben ser perfectos") y casos 53–57 del doc 07. Con la auth
> real ya en su sitio (P27–P28), implementa **pruebas e2e (Playwright)** de los 5 flujos transversales:
> (1) vender y cobrar en POS con vuelto cruzado, (2) registrar compra con retención, (3) cerrar el mes
> (wizard), (4) dashboard del dueño, (5) **onboarding** completo hasta emitir el primer documento.
> Verifica de punta a punta: login + 2FA, cambio de empresa, RLS entre tenants (caso 55), permisos por
> rol (caso 54), concurrencia de numeración (caso 53) y operación con tasa rezagada (caso 57). **Retira
> definitivamente** el login demo (`/dev/sesion`; `db:seed-demo` queda solo para CI/fixtures) y documenta
> el arranque productivo. Endurece el manejo de errores de la UI (sesión expirada → re-login; 403 con
> mensaje claro).

---

### Prompts de mantenimiento (recurrentes)
- **Cambio normativo**: "Salió la providencia X que modifica [resumen + texto pegado]. Lee docs/02 §relevante, propón el cambio mínimo (datos vs código), actualiza el doc, implementa con golden test y cita la norma en el commit."
- **Bug fiscal**: "La declaración de [cliente] difiere del sistema en Bs X. Reproduce con un test que falle, encuentra la causa en fiscal-engine, corrige sin tocar documentos emitidos, y agrega el caso al doc 07."
- **Nuevo banco**: "Agrega importador de estados de cuenta de [banco] siguiendo el patrón de parsers versionados; aquí hay 3 archivos de muestra anonimizados."
