-- P9 — Compras y retenciones: CHECKs, RLS e inmutabilidad (reglas 4, 12 de CLAUDE.md, docs/02 §3.3).
-- La compra REGISTERED y los comprobantes de retención (emitidos/recibidos) son INMUTABLES: las
-- correcciones van por registro de reverso / NC del proveedor. Triggers además de la capa de
-- aplicación. Drizzle no expresa CHECK/RLS/triggers: SQL custom (ver memoria migraciones-sql-custom).

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_status_valido" CHECK ("status" IN ('DRAFT', 'REGISTERED'));
--> statement-breakpoint
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_tipo_documento_valido" CHECK ("tipo_documento" IN ('FACTURA', 'NOTA_DEBITO', 'NOTA_CREDITO'));
--> statement-breakpoint
-- Número y número de control del proveedor OBLIGATORIOS (docs/02 §3.3, §7.2): no vacíos.
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_numero_documento_no_vacio" CHECK (length(btrim("numero_documento")) > 0);
--> statement-breakpoint
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_numero_control_no_vacio" CHECK (length(btrim("numero_control")) > 0);
--> statement-breakpoint
ALTER TABLE "purchase_lines"
  ADD CONSTRAINT "purchase_lines_alicuota_valida" CHECK (
    "alicuota_codigo" IN ('GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION')
  );
--> statement-breakpoint
ALTER TABLE "purchase_taxes"
  ADD CONSTRAINT "purchase_taxes_alicuota_valida" CHECK (
    "alicuota_codigo" IN ('GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION')
  );
--> statement-breakpoint
ALTER TABLE "retentions_issued"
  ADD CONSTRAINT "retentions_issued_tipo_valido" CHECK ("tipo" IN ('IVA', 'ISLR'));
--> statement-breakpoint
ALTER TABLE "retentions_issued"
  ADD CONSTRAINT "retentions_issued_periodo_mes_valido" CHECK ("periodo_mes" BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "retentions_issued"
  ADD CONSTRAINT "retentions_issued_montos_no_negativos" CHECK (
    "base_ves" >= 0 AND "monto_ves" >= 0 AND "sustraendo_ves" >= 0 AND "porcentaje" >= 0
  );
--> statement-breakpoint
ALTER TABLE "retentions_received"
  ADD CONSTRAINT "retentions_received_tipo_valido" CHECK ("tipo" IN ('IVA', 'ISLR'));
--> statement-breakpoint
ALTER TABLE "retentions_received"
  ADD CONSTRAINT "retentions_received_periodo_mes_valido" CHECK ("periodo_mes" BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "retentions_received"
  ADD CONSTRAINT "retentions_received_montos_no_negativos" CHECK (
    "base_ves" >= 0 AND "monto_ves" >= 0 AND "porcentaje" >= 0
  );
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchases"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "purchase_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchase_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "purchase_taxes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchase_taxes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_taxes"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retentions_issued" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retentions_issued" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "retentions_issued"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retentions_received" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retentions_received" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "retentions_received"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad de la compra REGISTERED (regla 4 / Providencia 121) ─────────
CREATE FUNCTION purchases_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'REGISTERED' THEN
    RAISE EXCEPTION 'La compra REGISTERED es inmutable (regla 4): % no permitido; use un registro de reverso', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "purchases_inmutable"
  BEFORE UPDATE OR DELETE ON "purchases"
  FOR EACH ROW EXECUTE FUNCTION purchases_inmutable_trg();
--> statement-breakpoint
CREATE FUNCTION purchase_hijos_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM purchases WHERE id = COALESCE(OLD.purchase_id, NEW.purchase_id);
  IF v_status = 'REGISTERED' THEN
    RAISE EXCEPTION 'Las líneas/impuestos de una compra REGISTERED son inmutables (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "purchase_lines_inmutable"
  BEFORE UPDATE OR DELETE ON "purchase_lines"
  FOR EACH ROW EXECUTE FUNCTION purchase_hijos_inmutable_trg();
--> statement-breakpoint
CREATE TRIGGER "purchase_taxes_inmutable"
  BEFORE UPDATE OR DELETE ON "purchase_taxes"
  FOR EACH ROW EXECUTE FUNCTION purchase_hijos_inmutable_trg();
--> statement-breakpoint

-- ── Inmutabilidad de los comprobantes de retención (append-only, Providencia 121) ──
-- Un comprobante emitido o recibido NO se edita ni se borra: las correcciones se hacen con un
-- comprobante de anulación/ajuste nuevo (caso 33 / TODO-TRIBUTARISTA).
CREATE FUNCTION retenciones_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El comprobante de retención es inmutable (regla 4 / Providencia 121): % no permitido', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "retentions_issued_inmutable"
  BEFORE UPDATE OR DELETE ON "retentions_issued"
  FOR EACH ROW EXECUTE FUNCTION retenciones_inmutable_trg();
--> statement-breakpoint
CREATE TRIGGER "retentions_received_inmutable"
  BEFORE UPDATE OR DELETE ON "retentions_received"
  FOR EACH ROW EXECUTE FUNCTION retenciones_inmutable_trg();
