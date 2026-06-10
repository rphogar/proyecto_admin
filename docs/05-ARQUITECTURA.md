# 05 — Arquitectura Técnica

## 1. Stack (decisión cerrada)

Monorepo pnpm + Turborepo. **API**: NestJS + TypeScript estricto. **DB**: PostgreSQL 16 + Drizzle ORM (migraciones SQL versionadas). **Jobs**: BullMQ + Redis (tasas BCV, cierres, remisión fiscal, PDFs). **Web**: Next.js App Router + Tailwind + shadcn/ui + TanStack Query/Table. **Decimales**: decimal.js en app, `NUMERIC(20,8)` en DB. **PDF**: server-side (playwright/print CSS o pdfkit). **Tests**: Vitest + fast-check (property), Playwright (e2e), golden tests fiscales.

Paquetes puros (sin IO, 100% testeables):
- `packages/ledger` — partida doble, períodos, saldos, multimoneda.
- `packages/fiscal-engine` — IVA (alícuotas, prorrata), IGTF, retenciones IVA/ISLR, nómina, validador de facturas, validador de RIF.
- `packages/shared` — tipos, Money/Decimal utils, fechas `America/Caracas`, redondeo fiscal (half-up 2 decimales).

## 2. Multi-tenancy

- Una fila = un tenant (`tenant_id UUID NOT NULL` en TODAS las tablas de negocio) + **RLS activado** con política `tenant_id = current_setting('app.tenant_id')::uuid`.
- Un tenant puede tener varias **empresas** (RIF) — el caso del contador con cartera. Jerarquía: `tenant → companies → branches (sucursales) → pos_stations (cajas)`.
- Tests automáticos de aislamiento: intento de lectura cross-tenant debe devolver 0 filas.

## 3. Modelo de datos (tablas núcleo)

### 3.1 Identidad y configuración
```
tenants, users, memberships(user,tenant,role), companies(rif, razon_social, tipo_contribuyente,
  spe boolean, pct_retencion_que_le_aplican, ejercicio_fiscal_inicio, riesgo_ivss, dias_utilidades),
branches, pos_stations, roles/permissions,
fiscal_params(clave, valor jsonb, vigente_desde, vigente_hasta)  -- UT, alícuotas, salario mínimo,
  cestaticket, tasas retención, calendario SPE importado, feriados
```

### 3.2 Maestros
```
parties(tipo: cliente|proveedor|ambos, rif validado, condicion_iva, es_agente_retencion,
  pct_retencion_iva: 75|100, dirección fiscal, contactos, límite crédito, días crédito)
items(sku, descripcion, tipo: producto|servicio, alicuota_iva: GENERAL|REDUCIDA|EXENTO|EXONERADO|
  ADICIONAL, precios multimoneda con lista de precios, unidad, control_lote/serial opcional)
warehouses, price_lists, taxes(code, rate, vigencia), accounts (plan de cuentas, árbol),
posting_templates (plantillas de contabilización por tipo de documento, versionadas)
```

### 3.3 Tasas de cambio
```
exchange_rates(id, currency, rate NUMERIC(20,8), rate_date, source: BCV|MANUAL|MARKET,
  captured_at, published_at, hash_fuente)
```
- Job diario ~9:00 y ~17:00 VET: scrape/API del BCV con fallback y alerta si falla; nunca se sobreescribe una tasa usada por documentos (corrección = nueva fila + marca).
- Función `rateFor(date, currency)`: tasa de esa fecha o **última publicada anterior** (fines de semana/feriados).

### 3.4 Documentos (núcleo administrativo)
```
documents(id, company, branch, type: FACTURA|NOTA_CREDITO|NOTA_DEBITO|GUIA_DESPACHO|PEDIDO|
  PRESUPUESTO|COMPRA|NOTA_ENTREGA|COMPROBANTE_RETENCION_IVA|COMPROBANTE_RETENCION_ISLR,
  series_id, number, control_number, status: DRAFT|ISSUED|CANCELLED(solo pre-emisión)|APPLIED,
  party_id, issue_date(fecha Caracas), currency, exchange_rate_id, payment_condition,
  affected_document_id (NC/ND → factura), totals jsonb, hash_integridad, created_by)
document_lines(item, qty, unit_price_origin, discount, tax_code, base_*, iva_*, … en 3 bases)
document_taxes(por alícuota: base, monto — fuente única para libros y declaración)
series(company, branch, doc_type, prefijo, next_number)  -- ver §4 numeración
```

### 3.5 Ledger
```
journal_entries(id, company, date, period_id, status: DRAFT|POSTED|REVERSED, source_type/source_id
  (documento origen), reversal_of, description, created_by)
journal_lines(entry, account, branch?, cost_center?, currency, amount_origin, rate_bcv,
  amount_ves, amount_usd_mgmt, dc: D|C, party_id?, due_date?)
periods(company, year, month, status: OPEN|CLOSED, closed_by, closed_at)
```
- CHECK diferido por asiento: sumas D=C en las tres bases (tolerancia 0).
- Trigger: prohibido UPDATE/DELETE sobre `journal_entries POSTED` y `documents ISSUED`.

### 3.6 Tesorería y conciliación
```
payment_methods(EFECTIVO_BS, EFECTIVO_USD, PAGO_MOVIL, TRANSFERENCIA, PUNTO_VENTA, ZELLE,
  USDT, OTRO; cada uno mapeado a cuenta contable y a si causa IGTF)
payments(document?, party, fecha, splits[método, moneda, monto_origen, referencia], igtf_calc)
bank_accounts, bank_statements(import CSV/Excel/OFX por banco), statement_lines,
reconciliations(matching n:m statement_lines ↔ payments/journal_lines, score de auto-match)
```

### 3.7 Impuestos
```
tax_returns(IVA|ISLR|IGTF|RET_IVA|RET_ISLR|ISAE, período, status: BORRADOR|PRESENTADA, planilla pdf,
  número de declaración, snapshot jsonb de las cifras al momento de presentar)
retentions_issued / retentions_received(comprobante número AAAAMM########, factura afectada,
  base, %, monto, período de imputación, archivo TXT export)
fiscal_books(generación de libro compras/ventas como vista materializada del período)
```

### 3.8 Inventario, activos, nómina
```
stock_moves(item, warehouse, qty, costo_unit_ves, costo_unit_usd, tipo: COMPRA|VENTA|AJUSTE|
  TRASLADO|DEVOLUCION, documento origen)  → kardex y costo promedio en doble base
fixed_assets(fecha adquisición, costo en 3 bases, vida útil, método línea recta, depreciación
  mensual automática, mejoras, retiro/venta)
employees, salary_history, payroll_concepts(fórmulas), payroll_runs, payroll_lines,
benefit_ledgers(kardex de prestaciones/intereses/anticipos por trabajador), ari_forms
```

### 3.9 Cumplimiento Providencia 121
```
audit_events(append-only: actor, acción, entidad, before/after, ts_utc, ts_caracas, ip, device)
fiscal_event_log(eventos de facturación: emisión, impresión, reimpresión, NC/ND, fallos)
fiscal_transmission_queue(payload, estado: PENDIENTE|ENVIADO|ACUSADO|ERROR, reintentos)
  -- módulo desacoplado: cuando el SENIAT publique el canal técnico, solo se implementa el adapter
product_versions(versión del sistema, changelog, estado de homologación)
```

## 4. Numeración consecutiva sin huecos (patrón obligatorio)

```sql
-- Dentro de la MISMA transacción que inserta el documento:
UPDATE series SET next_number = next_number + 1
WHERE id = $serie RETURNING next_number;  -- bloquea la fila (FOR UPDATE implícito)
-- si la transacción falla, el número no se consume.
```
- Nunca `SERIAL`/secuencias nativas (dejan huecos en rollback). Emisión de documento = transacción única: número + documento + líneas + impuestos + asiento + evento de auditoría. Si algo falla, todo revierte (resiliencia a cortes de luz).
- Reimpresión ≠ reemisión: se marca `reimpresion` en `fiscal_event_log`.

## 5. Integraciones

| Integración | Fase | Notas |
|---|---|---|
| Tasa BCV | F0 | Job + fallback + entrada manual con auditoría |
| Impresoras fiscales (The Factory HKA, Bematech…) | F2 | Driver local (agente de impresión en el cliente / app puente) con cola |
| Imprenta digital autorizada (números de control digitales, Prov. 00102) | F2 | Adapter por proveedor |
| Importación de estados de cuenta (Banesco, Mercantil, BNC, Provincial, BDV) | F1 | Parsers CSV/Excel por banco; formato cambia → parsers versionados |
| Notificaciones Pago Móvil (correo/SMS parsing o API C2P si disponible) | F1+ | Para conciliación automática |
| Remisión SENIAT | F3 | Stub + cola lista; adapter cuando exista especificación |
| API pública + webhooks | F4 | document.issued, payment.received, etc. |

## 6. Seguridad y operación

- Auth: email+password con Argon2, **2FA TOTP obligatorio para roles owner/admin/contador**, sesiones cortas, refresh rotativo.
- RBAC por acción (`document.issue`, `period.close`, `payroll.approve`…); separación de deberes: quien aprueba nómina ≠ quien la crea (configurable).
- Cifrado at-rest (volumen + columnas sensibles con pgcrypto para salarios), TLS everywhere, backups automáticos cifrados con restore drill mensual, retención ≥ 10 años.
- Rate limiting, logging estructurado, alertas (tasa BCV no capturada, declaración próxima a vencer sin presentar, asiento desbalanceado imposible).
- **Offline/PWA (POS)**: cola local IndexedDB para ventas; al reconectar, sincroniza y el servidor asigna numeración definitiva (los tickets offline usan numeración provisional de la estación claramente marcada — validar este flujo con tributarista; alternativa conservadora: POS offline solo en modalidad máquina fiscal, que numera por hardware).

## 7. Invariantes verificados por tests de propiedad

1. ∀ asiento POSTED: ΣD=ΣC en VES, USD y origen.
2. ∀ serie: números consecutivos sin huecos ni duplicados bajo concurrencia (test con 100 emisiones paralelas).
3. Libro de ventas del período ≡ Σ documentos del período ≡ cifras de la declaración IVA (triple igualdad).
4. Kardex: stock nunca negativo (salvo configuración explícita), costo promedio recalculado determinista.
5. Reproceso del ledger desde documentos = mismos saldos (event-sourcing verificable).
6. Ningún UPDATE/DELETE lógico sobre inmutables pasa los triggers.
7. Cross-tenant: 0 filas visibles.
