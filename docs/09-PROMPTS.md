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

### Prompts de mantenimiento (recurrentes)
- **Cambio normativo**: "Salió la providencia X que modifica [resumen + texto pegado]. Lee docs/02 §relevante, propón el cambio mínimo (datos vs código), actualiza el doc, implementa con golden test y cita la norma en el commit."
- **Bug fiscal**: "La declaración de [cliente] difiere del sistema en Bs X. Reproduce con un test que falle, encuentra la causa en fiscal-engine, corrige sin tocar documentos emitidos, y agrega el caso al doc 07."
- **Nuevo banco**: "Agrega importador de estados de cuenta de [banco] siguiendo el patrón de parsers versionados; aquí hay 3 archivos de muestra anonimizados."
