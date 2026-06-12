-- P6 — Documentos: CHECKs, RLS, unicidad del correlativo e inmutabilidad de emitidos (reglas 1, 4,
-- 6, 12 de CLAUDE.md, docs/05 §3.4 y §4). A diferencia de los maestros (mutables), los documentos
-- ISSUED/APPLIED son INMUTABLES (regla 4 / Providencia 121): triggers además de la capa de app.
-- Drizzle no expresa CHECK/RLS/triggers/índices parciales: SQL custom.

-- ── CHECK constraints ────────────────────────────────────────────────────────
-- documents
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_type_valido"
  CHECK ("type" IN ('FACTURA', 'NOTA_CREDITO', 'NOTA_DEBITO', 'GUIA_DESPACHO', 'PEDIDO',
    'PRESUPUESTO', 'COMPRA', 'NOTA_ENTREGA', 'COMPROBANTE_RETENCION_IVA',
    'COMPROBANTE_RETENCION_ISLR'));
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_status_valido"
  CHECK ("status" IN ('DRAFT', 'ISSUED', 'CANCELLED', 'APPLIED'));
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_medio_emision_valido"
  CHECK ("medio_emision" IN ('FORMA_LIBRE', 'MAQUINA_FISCAL', 'IMPRENTA_DIGITAL'));
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_payment_condition_valida"
  CHECK ("payment_condition" IS NULL OR "payment_condition" IN ('CONTADO', 'CREDITO'));
--> statement-breakpoint
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_number_positivo" CHECK ("number" IS NULL OR "number" >= 1);
--> statement-breakpoint
-- Un documento emitido/aplicado SIEMPRE tiene correlativo asignado (regla 6).
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_emitido_con_number"
  CHECK ("status" NOT IN ('ISSUED', 'APPLIED') OR "number" IS NOT NULL);
--> statement-breakpoint
-- document_lines
ALTER TABLE "document_lines"
  ADD CONSTRAINT "document_lines_alicuota_codigo_valido"
  CHECK ("alicuota_codigo" IN ('GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION'));
--> statement-breakpoint
ALTER TABLE "document_lines"
  ADD CONSTRAINT "document_lines_cantidad_positiva" CHECK ("cantidad" > 0);
--> statement-breakpoint
ALTER TABLE "document_lines"
  ADD CONSTRAINT "document_lines_montos_no_negativos" CHECK (
    "precio_unitario_origen" >= 0 AND "descuento_origen" >= 0 AND
    "base_origen" >= 0 AND "base_ves" >= 0 AND "base_usd_mgmt" >= 0 AND
    "iva_origen" >= 0 AND "iva_ves" >= 0 AND "iva_usd_mgmt" >= 0
  );
--> statement-breakpoint
-- document_taxes
ALTER TABLE "document_taxes"
  ADD CONSTRAINT "document_taxes_alicuota_codigo_valido"
  CHECK ("alicuota_codigo" IN ('GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION'));
--> statement-breakpoint
ALTER TABLE "document_taxes"
  ADD CONSTRAINT "document_taxes_montos_no_negativos" CHECK (
    "base_origen" >= 0 AND "base_ves" >= 0 AND "base_usd_mgmt" >= 0 AND
    "monto_origen" >= 0 AND "monto_ves" >= 0 AND "monto_usd_mgmt" >= 0
  );
--> statement-breakpoint

-- ── Correlativo consecutivo SIN huecos ni duplicados por serie (regla 6, casos 21/53) ──
-- Índice parcial (DRAFT no tiene number). Bajo concurrencia, el contador transaccional de `series`
-- (UPDATE ... RETURNING, FOR UPDATE implícito) asigna números distintos; este índice es la red de
-- seguridad que rechaza cualquier duplicado que se colara.
CREATE UNIQUE INDEX "documents_series_number_uq"
  ON "documents" ("series_id", "number") WHERE "number" IS NOT NULL;
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "document_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "document_taxes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_taxes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_taxes"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad de documentos emitidos (regla 4 / Providencia 121, casos 19/20) ──
-- Un documento ISSUED/APPLIED no admite UPDATE ni DELETE; las correcciones van por NC/ND. Un DRAFT
-- (o CANCELLED pre-emisión) sí es editable. Aplica a la cabecera y a sus líneas e impuestos.
CREATE FUNCTION documents_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('ISSUED', 'APPLIED') THEN
    RAISE EXCEPTION 'documents % es inmutable (regla 4, Providencia 121): % no permitido; use NC/ND', OLD.status, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "documents_inmutable"
  BEFORE UPDATE OR DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION documents_inmutable_trg();
--> statement-breakpoint
CREATE FUNCTION document_hijos_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM documents WHERE id = COALESCE(OLD.document_id, NEW.document_id);
  IF v_status IN ('ISSUED', 'APPLIED') THEN
    RAISE EXCEPTION 'Las líneas/impuestos de un documento % son inmutables (regla 4): % no permitido', v_status, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "document_lines_inmutable"
  BEFORE UPDATE OR DELETE ON "document_lines"
  FOR EACH ROW EXECUTE FUNCTION document_hijos_inmutable_trg();
--> statement-breakpoint
CREATE TRIGGER "document_taxes_inmutable"
  BEFORE UPDATE OR DELETE ON "document_taxes"
  FOR EACH ROW EXECUTE FUNCTION document_hijos_inmutable_trg();
