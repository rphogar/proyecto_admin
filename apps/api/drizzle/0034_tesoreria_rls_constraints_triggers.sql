-- P11 — Tesorería: CHECKs, RLS e inmutabilidad (reglas 4, 11, 12 de CLAUDE.md, docs/06 M4).
-- Transferencias y revaluaciones POSTED, y cierres de caja CERRADOS, son INMUTABLES (las correcciones
-- van por reverso): triggers además de la capa de aplicación. Las líneas de extracto y las
-- conciliaciones SÍ mutan de estado (sin trigger de inmutabilidad; sí RLS). SQL custom (Drizzle no
-- expresa CHECK/RLS/triggers).

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_banco_valido" CHECK ("banco" IN ('BANESCO', 'MERCANTIL', 'BNC', 'PROVINCIAL', 'BDV', 'OTRO'));
--> statement-breakpoint
ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_moneda_valida" CHECK ("moneda" IN ('VES', 'USD', 'EUR', 'USDT'));
--> statement-breakpoint
ALTER TABLE "statement_lines"
  ADD CONSTRAINT "statement_lines_estado_valido" CHECK ("estado" IN ('PENDIENTE', 'CONCILIADO', 'EN_TRANSITO', 'DESCARTADO'));
--> statement-breakpoint
ALTER TABLE "transferencias"
  ADD CONSTRAINT "transferencias_status_valido" CHECK ("status" IN ('POSTED'));
--> statement-breakpoint
ALTER TABLE "transferencias"
  ADD CONSTRAINT "transferencias_montos_positivos" CHECK ("monto_origen" > 0 AND "monto_destino" > 0);
--> statement-breakpoint
ALTER TABLE "transferencias"
  ADD CONSTRAINT "transferencias_cuentas_distintas" CHECK ("origen_cuenta_id" <> "destino_cuenta_id");
--> statement-breakpoint
ALTER TABLE "cierres_caja"
  ADD CONSTRAINT "cierres_caja_status_valido" CHECK ("status" IN ('ABIERTO', 'CERRADO'));
--> statement-breakpoint
ALTER TABLE "cierre_caja_arqueos"
  ADD CONSTRAINT "cierre_caja_arqueos_montos_no_negativos" CHECK ("monto_sistema" >= 0 AND "monto_declarado" >= 0);
--> statement-breakpoint
ALTER TABLE "reconciliations"
  ADD CONSTRAINT "reconciliations_tipo_valido" CHECK ("tipo" IN ('UNO_A_UNO', 'UNO_A_N', 'N_A_UNO'));
--> statement-breakpoint
ALTER TABLE "reconciliations"
  ADD CONSTRAINT "reconciliations_estado_valido" CHECK ("estado" IN ('SUGERIDO', 'CONCILIADO', 'EN_TRANSITO', 'DESCARTADO'));
--> statement-breakpoint
ALTER TABLE "reconciliations"
  ADD CONSTRAINT "reconciliations_un_lado_minimo" CHECK ("statement_line_id" IS NOT NULL OR "journal_line_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "revaluaciones"
  ADD CONSTRAINT "revaluaciones_status_valido" CHECK ("status" IN ('POSTED'));
--> statement-breakpoint
ALTER TABLE "revaluaciones"
  ADD CONSTRAINT "revaluaciones_mes_valido" CHECK ("mes" BETWEEN 1 AND 12);
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_accounts"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "bank_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_statements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bank_statements"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "statement_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "statement_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "statement_lines"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "transferencias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transferencias" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "transferencias"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "cierres_caja" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cierres_caja" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cierres_caja"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "cierre_caja_arqueos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cierre_caja_arqueos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cierre_caja_arqueos"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reconciliations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reconciliations"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "revaluaciones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "revaluaciones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "revaluaciones"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad de la transferencia POSTED (regla 4 / Providencia 121) ──────
CREATE FUNCTION transferencias_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'La transferencia POSTED es inmutable (regla 4): % no permitido; use una transferencia de reverso', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "transferencias_inmutable"
  BEFORE UPDATE OR DELETE ON "transferencias"
  FOR EACH ROW EXECUTE FUNCTION transferencias_inmutable_trg();
--> statement-breakpoint

-- ── Inmutabilidad de la revaluación POSTED (su efecto se deshace por el reverso) ──
CREATE TRIGGER "revaluaciones_inmutable"
  BEFORE UPDATE OR DELETE ON "revaluaciones"
  FOR EACH ROW EXECUTE FUNCTION transferencias_inmutable_trg();
--> statement-breakpoint

-- ── Inmutabilidad del cierre de caja CERRADO y su arqueo (modelo cobros) ──────
CREATE FUNCTION cierres_caja_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CERRADO' THEN
    RAISE EXCEPTION 'El cierre de caja CERRADO es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cierres_caja_inmutable"
  BEFORE UPDATE OR DELETE ON "cierres_caja"
  FOR EACH ROW EXECUTE FUNCTION cierres_caja_inmutable_trg();
--> statement-breakpoint
CREATE FUNCTION cierre_arqueo_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM cierres_caja WHERE id = COALESCE(OLD.cierre_id, NEW.cierre_id);
  IF v_status = 'CERRADO' THEN
    RAISE EXCEPTION 'El arqueo de un cierre CERRADO es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "cierre_caja_arqueos_inmutable"
  BEFORE UPDATE OR DELETE ON "cierre_caja_arqueos"
  FOR EACH ROW EXECUTE FUNCTION cierre_arqueo_inmutable_trg();
