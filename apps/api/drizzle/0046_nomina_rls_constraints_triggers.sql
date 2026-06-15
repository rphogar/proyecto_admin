-- P15 — Nómina: CHECKs, RLS e inmutabilidad (reglas 4, 9, 12 de CLAUDE.md; docs/04, docs/06).
-- El kardex de prestaciones es APPEND-ONLY (verdad auditable de la garantía art. 142); la corrida
-- CONTABILIZADA, los recibos de una corrida ya aprobada, las planillas PRESENTADAS y los ARC
-- emitidos son INMUTABLES (triggers además de la capa de aplicación). SQL custom (Drizzle no lo expresa).

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "nomina_trabajadores"
  ADD CONSTRAINT "nomina_trabajadores_frecuencia_valida" CHECK ("frecuencia_pago" IN ('SEMANAL', 'QUINCENAL', 'MENSUAL'));--> statement-breakpoint
ALTER TABLE "nomina_conceptos"
  ADD CONSTRAINT "nomina_conceptos_tipo_valido" CHECK ("tipo" IN ('ASIGNACION', 'DEDUCCION'));--> statement-breakpoint
ALTER TABLE "nomina_corridas"
  ADD CONSTRAINT "nomina_corridas_estado_valido" CHECK ("estado" IN ('BORRADOR', 'APROBADA', 'CONTABILIZADA'));--> statement-breakpoint
ALTER TABLE "nomina_corridas"
  ADD CONSTRAINT "nomina_corridas_frecuencia_valida" CHECK ("frecuencia" IN ('SEMANAL', 'QUINCENAL', 'MENSUAL'));--> statement-breakpoint
ALTER TABLE "nomina_corridas"
  ADD CONSTRAINT "nomina_corridas_mes_valido" CHECK ("mes" BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "nomina_recibo_lineas"
  ADD CONSTRAINT "nomina_recibo_lineas_tipo_valido" CHECK ("tipo" IN ('ASIGNACION', 'DEDUCCION'));--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex"
  ADD CONSTRAINT "nomina_prestaciones_kardex_tipo_valido"
  CHECK ("tipo" IN ('DEPOSITO_TRIMESTRAL', 'DIAS_ADICIONALES', 'INTERES', 'ADELANTO', 'LIQUIDACION'));--> statement-breakpoint
ALTER TABLE "nomina_provisiones"
  ADD CONSTRAINT "nomina_provisiones_mes_valido" CHECK ("mes" BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "nomina_parafiscales"
  ADD CONSTRAINT "nomina_parafiscales_regimen_valido" CHECK ("regimen" IN ('IVSS', 'RPE', 'FAOV', 'INCES'));--> statement-breakpoint
ALTER TABLE "nomina_parafiscales"
  ADD CONSTRAINT "nomina_parafiscales_estado_valido" CHECK ("estado_planilla" IN ('BORRADOR', 'GENERADA', 'PRESENTADA'));--> statement-breakpoint
ALTER TABLE "nomina_parafiscales"
  ADD CONSTRAINT "nomina_parafiscales_mes_valido" CHECK ("mes" BETWEEN 1 AND 12);--> statement-breakpoint
ALTER TABLE "nomina_ari"
  ADD CONSTRAINT "nomina_ari_origen_valido" CHECK ("origen" IN ('TRABAJADOR', 'PATRONO'));--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "nomina_trabajadores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_trabajadores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_trabajadores"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_conceptos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_conceptos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_conceptos"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_corridas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_corridas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_corridas"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_recibos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_recibos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_recibos"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_recibo_lineas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_recibo_lineas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_recibo_lineas"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_prestaciones_kardex"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_provisiones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_provisiones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_provisiones"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_parafiscales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_parafiscales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_parafiscales"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_ari" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_ari" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_ari"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint
ALTER TABLE "nomina_arc" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nomina_arc" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "nomina_arc"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

-- ── Kardex de prestaciones APPEND-ONLY (regla 4: verdad auditable de la garantía art. 142) ─────
CREATE FUNCTION nomina_prestaciones_kardex_append_only_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El kardex de prestaciones es append-only (regla 4): % no permitido; registre un movimiento de corrección', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "nomina_prestaciones_kardex_append_only"
  BEFORE UPDATE OR DELETE ON "nomina_prestaciones_kardex"
  FOR EACH ROW EXECUTE FUNCTION nomina_prestaciones_kardex_append_only_trg();--> statement-breakpoint

-- ── Corrida CONTABILIZADA inmutable (regla 4) ─────────────────────────────────
CREATE FUNCTION nomina_corridas_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'CONTABILIZADA' THEN
    RAISE EXCEPTION 'La corrida de nómina CONTABILIZADA es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "nomina_corridas_inmutable"
  BEFORE UPDATE OR DELETE ON "nomina_corridas"
  FOR EACH ROW EXECUTE FUNCTION nomina_corridas_inmutable_trg();--> statement-breakpoint

-- ── Recibos y sus líneas inmutables cuando la corrida ya salió de BORRADOR (regla 4) ──────────
CREATE FUNCTION nomina_recibos_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM nomina_corridas WHERE id = COALESCE(OLD.corrida_id, NEW.corrida_id);
  IF v_estado IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'El recibo de una corrida aprobada/contabilizada es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "nomina_recibos_inmutable"
  BEFORE UPDATE OR DELETE ON "nomina_recibos"
  FOR EACH ROW EXECUTE FUNCTION nomina_recibos_inmutable_trg();--> statement-breakpoint
CREATE FUNCTION nomina_recibo_lineas_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT c.estado INTO v_estado
    FROM nomina_recibos r JOIN nomina_corridas c ON c.id = r.corrida_id
    WHERE r.id = COALESCE(OLD.recibo_id, NEW.recibo_id);
  IF v_estado IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'Las líneas de un recibo aprobado/contabilizado son inmutables (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "nomina_recibo_lineas_inmutable"
  BEFORE UPDATE OR DELETE ON "nomina_recibo_lineas"
  FOR EACH ROW EXECUTE FUNCTION nomina_recibo_lineas_inmutable_trg();--> statement-breakpoint

-- ── Planilla parafiscal PRESENTADA inmutable (regla 4) ────────────────────────
CREATE FUNCTION nomina_parafiscales_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado_planilla = 'PRESENTADA' THEN
    RAISE EXCEPTION 'La planilla parafiscal PRESENTADA es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "nomina_parafiscales_inmutable"
  BEFORE UPDATE OR DELETE ON "nomina_parafiscales"
  FOR EACH ROW EXECUTE FUNCTION nomina_parafiscales_inmutable_trg();--> statement-breakpoint

-- ── Certificado ARC emitido inmutable (regla 4) ───────────────────────────────
CREATE FUNCTION nomina_arc_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.emitido_en IS NOT NULL THEN
    RAISE EXCEPTION 'El certificado ARC emitido es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "nomina_arc_inmutable"
  BEFORE UPDATE OR DELETE ON "nomina_arc"
  FOR EACH ROW EXECUTE FUNCTION nomina_arc_inmutable_trg();
