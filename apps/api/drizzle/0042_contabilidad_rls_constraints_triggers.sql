-- P13 — Contabilidad y cierre: CHECKs, RLS e inmutabilidad (reglas 4, 12 de CLAUDE.md, docs/06 M6).
-- Las versiones de plantilla HISTORICAS y los cierres mensuales CERRADOS son INMUTABLES (triggers
-- además de la capa de aplicación). El cierre CERRADO admite UN único cambio: la reapertura auditada
-- (CERRADO→REABIERTO con motivo + reopened_by), que solo owner+contador hace (caso 43). SQL custom
-- (Drizzle no expresa CHECK/RLS/triggers).

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "posting_templates"
  ADD CONSTRAINT "posting_templates_version_actual_positiva" CHECK ("version_actual" >= 1);
--> statement-breakpoint
ALTER TABLE "posting_template_versions"
  ADD CONSTRAINT "posting_template_versions_estado_valido" CHECK ("estado" IN ('VIGENTE', 'HISTORICA'));
--> statement-breakpoint
ALTER TABLE "posting_template_versions"
  ADD CONSTRAINT "posting_template_versions_version_positiva" CHECK ("version" >= 1);
--> statement-breakpoint
ALTER TABLE "posting_template_lines"
  ADD CONSTRAINT "posting_template_lines_dc_valido" CHECK ("dc" IN ('D', 'C'));
--> statement-breakpoint
ALTER TABLE "posting_template_lines"
  ADD CONSTRAINT "posting_template_lines_signo_valido" CHECK ("signo" IN ('POSITIVO', 'NEGATIVO'));
--> statement-breakpoint
ALTER TABLE "posting_template_lines"
  ADD CONSTRAINT "posting_template_lines_linea_no_positiva" CHECK ("linea_no" >= 1);
--> statement-breakpoint
ALTER TABLE "cierres_mensuales"
  ADD CONSTRAINT "cierres_mensuales_estado_valido" CHECK ("estado" IN ('EN_PROCESO', 'CERRADO', 'REABIERTO'));
--> statement-breakpoint
ALTER TABLE "cierres_mensuales"
  ADD CONSTRAINT "cierres_mensuales_mes_valido" CHECK ("mes" BETWEEN 1 AND 12);
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "posting_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posting_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "posting_templates"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "posting_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posting_template_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "posting_template_versions"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "posting_template_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posting_template_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "posting_template_lines"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "manual_entry_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "manual_entry_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "manual_entry_attachments"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "cierres_mensuales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cierres_mensuales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cierres_mensuales"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad de la versión de plantilla HISTORICA (regla 4) ──────────────
-- Una versión archivada conserva exactamente lo que contabilizó: no se edita ni se borra.
CREATE FUNCTION posting_template_versions_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'HISTORICA' THEN
    RAISE EXCEPTION 'La versión de plantilla HISTORICA es inmutable (regla 4): % no permitido; cree una versión nueva', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "posting_template_versions_inmutable"
  BEFORE UPDATE OR DELETE ON "posting_template_versions"
  FOR EACH ROW EXECUTE FUNCTION posting_template_versions_inmutable_trg();
--> statement-breakpoint
-- Las líneas de una versión HISTORICA tampoco se tocan (la versión a la que pertenecen está archivada).
CREATE FUNCTION posting_template_lines_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM posting_template_versions
    WHERE id = COALESCE(OLD.version_id, NEW.version_id);
  IF v_estado = 'HISTORICA' THEN
    RAISE EXCEPTION 'Las líneas de una versión de plantilla HISTORICA son inmutables (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "posting_template_lines_inmutable"
  BEFORE UPDATE OR DELETE ON "posting_template_lines"
  FOR EACH ROW EXECUTE FUNCTION posting_template_lines_inmutable_trg();
--> statement-breakpoint

-- ── Inmutabilidad del cierre mensual CERRADO, con carve-out de reapertura auditada (caso 43) ──
-- Un cierre CERRADO no se borra ni se edita, EXCEPTO la transición CERRADO→REABIERTO que debe traer
-- motivo y autor de reapertura. La autorización por rol (owner+contador) la impone la aplicación.
CREATE FUNCTION cierres_mensuales_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.estado = 'CERRADO' THEN
      RAISE EXCEPTION 'El cierre mensual CERRADO es inmutable (regla 4): DELETE no permitido; reabra con motivo'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE sobre un cierre CERRADO: solo se admite la reapertura auditada.
  IF OLD.estado = 'CERRADO' THEN
    IF NEW.estado = 'REABIERTO'
       AND NEW.reopen_reason IS NOT NULL AND btrim(NEW.reopen_reason) <> ''
       AND NEW.reopened_by IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'El cierre mensual CERRADO solo admite la reapertura auditada (CERRADO→REABIERTO con motivo y autor) (regla 4, caso 43)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cierres_mensuales_inmutable"
  BEFORE UPDATE OR DELETE ON "cierres_mensuales"
  FOR EACH ROW EXECUTE FUNCTION cierres_mensuales_inmutable_trg();
