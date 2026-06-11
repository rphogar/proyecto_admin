-- P5 — Maestros: CHECKs, RLS e índices de unicidad con expresión (reglas 1, 6, 12, 17 de
-- CLAUDE.md, docs/05 §3.2 y §3.4). Los maestros son MUTABLES (CRUD): a diferencia de documentos
-- emitidos/asientos posteados (regla 4) NO llevan triggers de inmutabilidad. Drizzle no expresa
-- CHECK/RLS/índices parciales ni con expresión: SQL custom.

-- ── CHECK constraints ────────────────────────────────────────────────────────
-- parties
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_tipo_valido" CHECK ("tipo" IN ('cliente', 'proveedor', 'ambos'));
--> statement-breakpoint
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_condicion_iva_valida"
  CHECK ("condicion_iva" IN ('ordinario', 'formal', 'especial', 'no_contribuyente'));
--> statement-breakpoint
-- Si es agente de retención de IVA, el % debe ser 75 o 100 (docs/02 §1.20, casos 26/27).
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_pct_retencion_iva_valido"
  CHECK ("pct_retencion_iva" IS NULL OR "pct_retencion_iva" IN (75, 100));
--> statement-breakpoint
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_agente_iva_con_pct"
  CHECK ("es_agente_retencion_iva" = false OR "pct_retencion_iva" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_dias_credito_no_negativo" CHECK ("dias_credito" >= 0);
--> statement-breakpoint
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_limite_credito_no_negativo"
  CHECK ("limite_credito" IS NULL OR "limite_credito" >= 0);
--> statement-breakpoint
-- items
ALTER TABLE "items"
  ADD CONSTRAINT "items_tipo_valido" CHECK ("tipo" IN ('producto', 'servicio'));
--> statement-breakpoint
ALTER TABLE "items"
  ADD CONSTRAINT "items_alicuota_iva_valida"
  CHECK ("alicuota_iva" IN ('GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION'));
--> statement-breakpoint
-- price_lists / item_prices
ALTER TABLE "price_lists"
  ADD CONSTRAINT "price_lists_moneda_valida" CHECK ("moneda" IN ('VES', 'USD', 'EUR'));
--> statement-breakpoint
ALTER TABLE "item_prices"
  ADD CONSTRAINT "item_prices_precio_no_negativo" CHECK ("precio" >= 0);
--> statement-breakpoint
-- payment_methods
ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_codigo_valido"
  CHECK ("codigo" IN ('EFECTIVO_BS', 'EFECTIVO_USD', 'PAGO_MOVIL', 'TRANSFERENCIA',
    'PUNTO_VENTA', 'ZELLE', 'USDT', 'OTRO'));
--> statement-breakpoint
ALTER TABLE "payment_methods"
  ADD CONSTRAINT "payment_methods_moneda_valida" CHECK ("moneda" IN ('VES', 'USD', 'EUR'));
--> statement-breakpoint
-- series
ALTER TABLE "series"
  ADD CONSTRAINT "series_doc_type_valido"
  CHECK ("doc_type" IN ('FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'GUIA_DESPACHO', 'PEDIDO',
    'PRESUPUESTO', 'COMPRA', 'NOTA_ENTREGA', 'COMPROBANTE_RETENCION_IVA',
    'COMPROBANTE_RETENCION_ISLR'));
--> statement-breakpoint
-- next_number es el PRÓXIMO a asignar: arranca en 1 y nunca retrocede (regla 6).
ALTER TABLE "series"
  ADD CONSTRAINT "series_next_number_positivo" CHECK ("next_number" >= 1);
--> statement-breakpoint

-- ── Índices de unicidad con expresión (Drizzle no los expresa) ───────────────
-- Una serie por (empresa, sucursal?, tipo, prefijo). NULLS NOT DISTINCT (PG15+, ver 0009) hace
-- que dos series de empresa (branch_id NULL) con mismo tipo/prefijo colisionen.
CREATE UNIQUE INDEX "series_company_branch_doctype_prefijo_uq"
  ON "series" ("company_id", "branch_id", "doc_type", "prefijo") NULLS NOT DISTINCT;
--> statement-breakpoint
-- A lo sumo una lista de precios por defecto por empresa (índice parcial).
CREATE UNIQUE INDEX "price_lists_una_default_por_empresa_uq"
  ON "price_lists" ("company_id") WHERE "es_default" = true;
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "parties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "parties"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "items"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "price_lists" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "price_lists" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "price_lists"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "item_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "item_prices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "item_prices"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "warehouses"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_methods"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "series" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "series" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "series"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
