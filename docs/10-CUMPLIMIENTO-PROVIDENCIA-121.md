# 10 — Informe de Cumplimiento: Providencia SNAT/2024/000121

> Mapea cada requisito técnico de la **Providencia Administrativa SNAT/2024/000121** (homologación de
> sistemas de facturación, G.O. 43.032, 19-dic-2024; ver `docs/02 §6.3`) a su implementación y sus
> tests. La **fuente de verdad** de este informe es `apps/api/src/cumplimiento/compliance-report.ts`
> (lo sirve `GET /cumplimiento/informe` y lo incrusta el expediente técnico); un test
> (`compliance-report.spec.ts`) verifica que todos los archivos referenciados existan. Este documento
> es la versión legible para el trámite y debe actualizarse junto con esa fuente.

## Arquitectura del módulo (P17)

```
apps/api/src/cumplimiento/
  cadena-hash.ts            → encadenamiento criptográfico de la bitácora (puro, testeable)
  fiscal-event-log.service  → bitácora fiscal append-only encadenada (emisión/impresión/…/fallos)
  remision-adapter.ts       → contrato + stub + adapter de prueba del canal SENIAT (extensión única)
  backoff.ts                → backoff exponencial de reintentos (puro)
  observabilidad.ts         → estado de la cola + evaluación de alertas (puro, testeable)
  remision.service.ts       → cola de remisión: encolar idempotente, procesar (envío/acuse), estado
  expediente.service.ts     → expediente técnico de homologación (ficha + arquitectura + informe)
  compliance-report.ts      → este informe, como datos verificados por test
  cumplimiento.controller   → /cumplimiento/{eventos,remision,remision/estado,informe,expediente}
```

Tablas (docs/05 §3.9): `fiscal_event_log` (append-only, encadenada), `fiscal_transmission_queue`
(cola mutable con estado/reintentos/acuse), `product_versions` (versionado formal, catálogo global).
La emisión de un documento registra el evento fiscal y encola la remisión **en la misma transacción**
(`apps/api/src/documentos/emision.service.ts`): atómico con la emisión (req. 2: automática e inmediata).

## Mapa requisito → implementación → test (§6.3)

### 6.3.1 — Integridad, conservación, trazabilidad, inalterabilidad e inviolabilidad — ✅ IMPLEMENTADO
Documentos `ISSUED` y asientos `POSTED` inmutables (trigger PostgreSQL + rol app sin UPDATE/DELETE);
cada documento lleva hash de integridad SHA-256. La bitácora fiscal es **append-only y encadenada por
hash** (cada evento incorpora el hash del anterior del tenant): alterar o reordenar un evento rompe la
cadena y se detecta con `verificarCadena()`.
- Impl.: `db/schema/documents.ts`, `drizzle/0017_*`, `drizzle/0006_*`, `cumplimiento/cadena-hash.ts`, `cumplimiento/fiscal-event-log.service.ts`, `drizzle/0054_*`
- Test: `cumplimiento/cadena-hash.spec.ts`, `cumplimiento/cumplimiento.int.spec.ts`, `audit/audit-append-only.int.spec.ts`

### 6.3.2 — Remisión electrónica al SENIAT (continua, automática, consecutiva, inmediata, fehaciente) — 🟡 PARCIAL
Cola de remisión desacoplada (`fiscal_transmission_queue`): cada documento emitido se encola
automáticamente en la transacción de emisión, de forma **idempotente por documento** (índice único
`(tenant_id, idempotency_key)`; un documento no se remite dos veces → "consecutiva" sin duplicados). Un
procesador con **reintentos y backoff exponencial** intenta la remisión vía un adapter y registra el
**acuse** (fehaciencia). El contrato del adapter soporta canal **síncrono** (ACUSADO inmediato) y
**asíncrono** (ENVIADO + `consultarAcuse`); el `idempotency_key` viaja al canal como token de
deduplicación. **Observabilidad** (`GET /cumplimiento/remision/estado`): conteos por estado, backlog
elegible, antigüedad del registro sin acusar más viejo, tasa de error y **alertas** operativas.
- El adapter por defecto es un *stub* (`StubRemisionAdapter`, canal no disponible) porque el SENIAT aún
  no publica el canal técnico; cuando lo haga, solo se implementa `RemisionAdapter` (serialización al
  formato firmado, firma, envío seguro, acuse). Esos puntos están marcados con `TODO-SENIAT` en
  `remision-adapter.ts`; `RemisionAdapterDePrueba` ejercita el pipeline completo sin inventar el formato.
- Impl.: `db/schema/fiscal-transmission-queue.ts`, `cumplimiento/remision.service.ts`, `cumplimiento/remision-adapter.ts`, `cumplimiento/backoff.ts`, `cumplimiento/observabilidad.ts`, `drizzle/0054_*`, `drizzle/0068_*`
- Test: `cumplimiento/remision.spec.ts`, `cumplimiento/observabilidad.spec.ts`, `cumplimiento/cumplimiento.int.spec.ts`
- Nota: desacoplado a propósito (docs/05 §5); la cola, los reintentos, el acuse, la idempotencia y la
  observabilidad ya están listos. Pendiente SOLO el formato/firma/envío del canal real (TODO-SENIAT).

### 6.3.3 — Registro automático de eventos, fechado con fecha y hora — ✅ IMPLEMENTADO
`fiscal_event_log` registra emisión, impresión, reimpresión, NC/ND, anulación y fallos, con fecha/hora
en UTC y en hora legal de Venezuela (−04:00); append-only por trigger. Complementa a `audit_events`
(auditoría de toda escritura de dominio).
- Impl.: `db/schema/fiscal-event-log.ts`, `cumplimiento/fiscal-event-log.service.ts`, `audit/audit.service.ts`, `db/schema/audit-events.ts`, `drizzle/0002_*`
- Test: `cumplimiento/cumplimiento.int.spec.ts`, `audit/audit-append-only.int.spec.ts`

### 6.3.4 — Corrección/anulación solo por nota de débito/crédito, conservando el original — ✅ IMPLEMENTADO
La emisión rechaza UPDATE/DELETE de documentos `ISSUED` (trigger). Las correcciones se hacen con
`NOTA_CREDITO`/`NOTA_DEBITO` que referencian la factura afectada (`affected_document_id`) y generan su
asiento de reverso/aditivo; el original queda intacto. La NC valida el saldo acreditable.
- Impl.: `documentos/emision.service.ts`, `documentos/calculo-nota.ts`, `drizzle/0017_*`
- Test: `documentos/notas.int.spec.ts`, `documentos/calculo-nota.spec.ts`

### 6.3.5 — Impedir equipos no fiscales / contabilidad paralela — 🟡 PARCIAL
Numeración consecutiva sin huecos por serie (contador transaccional con bloqueo de fila, nunca
`SERIAL`); multi-tenant con RLS forzada en toda tabla (sin contabilidad paralela cruzada); inmutables
protegidos por trigger; toda escritura auditada. La versión del producto guarda el hash del artefacto
homologado para detectar binarios alterados.
- Impl.: `documentos/emision.service.ts`, `drizzle/0017_*`, `db/schema/product-versions.ts`
- Test: `documentos/emision.int.spec.ts`, `cumplimiento/cumplimiento.int.spec.ts`
- Nota: el control de impresoras fiscales homologadas (hardware) llega en F2 con su driver.

### 6.3.6 — Versionado formal del producto; cada versión requiere nueva homologación — ✅ IMPLEMENTADO
`product_versions` registra versión, changelog, estado de homologación, nº de resolución y hash del
artefacto. El endpoint de expediente técnico ensambla ficha, arquitectura de seguridad e informe de
cumplimiento contra la versión vigente, listo para el trámite.
- Impl.: `db/schema/product-versions.ts`, `cumplimiento/expediente.service.ts`, `drizzle/0056_*`
- Test: `cumplimiento/expediente.spec.ts`, `cumplimiento/cumplimiento.int.spec.ts`

## Endpoints

| Método | Ruta | Descripción | Permiso |
|---|---|---|---|
| GET  | `/cumplimiento/eventos` | Lista la bitácora fiscal (filtros: company/document/eventType) | `cumplimiento.view` |
| POST | `/cumplimiento/eventos` | Registra evento manual (impresión/reimpresión/anulación/fallo) | `cumplimiento.evento` |
| GET  | `/cumplimiento/eventos/verificacion` | Reverifica la integridad de la cadena del tenant | `cumplimiento.view` |
| GET  | `/cumplimiento/remision` | Lista la cola de remisión (filtros: company/estado) | `cumplimiento.view` |
| POST | `/cumplimiento/remision/procesar` | Procesa pendientes (job/scheduler) | `cumplimiento.remision` |
| POST | `/cumplimiento/remision/reintentar` | Reabre un ítem en ERROR | `cumplimiento.remision` |
| GET  | `/cumplimiento/informe` | Informe de cumplimiento (este documento, como datos) | `cumplimiento.view` |
| GET  | `/cumplimiento/expediente` | Expediente técnico (JSON) | `cumplimiento.expediente` |
| GET  | `/cumplimiento/expediente/export` | Descarga el expediente técnico | `cumplimiento.expediente` |

## Pendiente para la homologación (roadmap F3)

- Implementar el `RemisionAdapter` real cuando el SENIAT publique la especificación del canal.
- Driver de impresora fiscal homologada (F2) para el control de equipos físicos (req. 6.3.5).
- Pasar `product_versions` a estado `SOLICITADA` al presentar el trámite y registrar el hash del
  artefacto del build homologado.
- Asesoría legal del trámite SNAT/2024/000121 y ficha técnica/manuales de usuario anexos.
