-- P8 — Cobros: CHECKs, RLS e inmutabilidad de lo posteado (reglas 4, 12 de CLAUDE.md, docs/06 M3).
-- Como registro financiero, un cobro POSTED es INMUTABLE (las correcciones van por cobro de reverso):
-- triggers además de la capa de aplicación. Drizzle no expresa CHECK/RLS/triggers: SQL custom.

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "cobros"
  ADD CONSTRAINT "cobros_status_valido" CHECK ("status" IN ('DRAFT', 'POSTED'));
--> statement-breakpoint
ALTER TABLE "cobro_medios"
  ADD CONSTRAINT "cobro_medios_monto_no_negativo" CHECK (
    "monto_origen" >= 0 AND "monto_ves" >= 0 AND "monto_usd_mgmt" >= 0
  );
--> statement-breakpoint
ALTER TABLE "cobro_aplicaciones"
  ADD CONSTRAINT "cobro_aplicaciones_monto_no_negativo" CHECK (
    "monto_aplicado_origen" >= 0 AND "monto_aplicado_ves" >= 0 AND "monto_aplicado_usd_mgmt" >= 0
  );
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "cobros" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cobros" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cobros"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "cobro_medios" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cobro_medios" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cobro_medios"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "cobro_aplicaciones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cobro_aplicaciones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cobro_aplicaciones"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad del cobro posteado (regla 4 / Providencia 121) ──────────────
CREATE FUNCTION cobros_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'El cobro POSTED es inmutable (regla 4): % no permitido; use un cobro de reverso', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cobros_inmutable"
  BEFORE UPDATE OR DELETE ON "cobros"
  FOR EACH ROW EXECUTE FUNCTION cobros_inmutable_trg();
--> statement-breakpoint
CREATE FUNCTION cobro_hijos_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM cobros WHERE id = COALESCE(OLD.cobro_id, NEW.cobro_id);
  IF v_status = 'POSTED' THEN
    RAISE EXCEPTION 'Los medios/aplicaciones de un cobro POSTED son inmutables (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cobro_medios_inmutable"
  BEFORE UPDATE OR DELETE ON "cobro_medios"
  FOR EACH ROW EXECUTE FUNCTION cobro_hijos_inmutable_trg();
--> statement-breakpoint
CREATE TRIGGER "cobro_aplicaciones_inmutable"
  BEFORE UPDATE OR DELETE ON "cobro_aplicaciones"
  FOR EACH ROW EXECUTE FUNCTION cobro_hijos_inmutable_trg();
