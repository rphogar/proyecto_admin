-- P3 — Ledger: CHECKs, RLS y triggers de integridad/inmutabilidad (reglas 4, 7, 9 de CLAUDE.md,
-- docs/05 §3.5 y §7). Drizzle no expresa CHECK/RLS/triggers: van en SQL custom.

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "periods"
  ADD CONSTRAINT "periods_mes_valido" CHECK ("mes" BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "periods"
  ADD CONSTRAINT "periods_estado_valido" CHECK ("estado" IN ('OPEN', 'CLOSED'));
--> statement-breakpoint
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_estado_valido" CHECK ("estado" IN ('DRAFT', 'POSTED'));
--> statement-breakpoint
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_dc_valido" CHECK ("dc" IN ('D', 'C'));
--> statement-breakpoint
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_montos_no_negativos" CHECK (
    "monto_origen" >= 0 AND "monto_ves" >= 0 AND "monto_usd_mgmt" >= 0
  );
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounts"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "periods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "periods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "periods"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_entries"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_lines"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Cuadre ΣD=ΣC en triple base — CHECK DIFERIDO por asiento (regla 7, docs/05 §3.5) ──
-- Verifica un asiento POSTED: ΣD=ΣC en VES y USD (tolerancia 0) y en moneda origen por cada
-- currency_code, EXCLUYENDO líneas de ajuste (diferencial/redondeo). Exige ambos lados. Se
-- evalúa al COMMIT (constraint triggers DEFERRABLE), de modo que insertar cabecera + líneas en
-- una transacción no falla por el orden de inserción.
CREATE FUNCTION ledger_verificar_cuadre(p_entry uuid) RETURNS void
  LANGUAGE plpgsql AS $$
DECLARE
  v_estado   text;
  v_dif_ves  numeric(20, 8);
  v_dif_usd  numeric(20, 8);
  v_debitos  bigint;
  v_creditos bigint;
  r          record;
BEGIN
  SELECT estado INTO v_estado FROM journal_entries WHERE id = p_entry;
  IF v_estado IS NULL OR v_estado <> 'POSTED' THEN
    RETURN;  -- el asiento no existe (borrado) o es DRAFT: no se exige cuadre
  END IF;

  SELECT
    count(*) FILTER (WHERE dc = 'D'),
    count(*) FILTER (WHERE dc = 'C'),
    COALESCE(SUM(CASE WHEN dc = 'D' THEN monto_ves ELSE -monto_ves END), 0),
    COALESCE(SUM(CASE WHEN dc = 'D' THEN monto_usd_mgmt ELSE -monto_usd_mgmt END), 0)
  INTO v_debitos, v_creditos, v_dif_ves, v_dif_usd
  FROM journal_lines WHERE entry_id = p_entry;

  IF v_debitos = 0 OR v_creditos = 0 THEN
    RAISE EXCEPTION 'Asiento % POSTED requiere al menos una línea al debe y una al haber', p_entry
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_dif_ves <> 0 THEN
    RAISE EXCEPTION 'Asiento % desbalanceado en VES (ΣD−ΣC = %)', p_entry, v_dif_ves
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_dif_usd <> 0 THEN
    RAISE EXCEPTION 'Asiento % desbalanceado en USD gerencial (ΣD−ΣC = %)', p_entry, v_dif_usd
      USING ERRCODE = 'check_violation';
  END IF;

  FOR r IN
    SELECT moneda,
      COALESCE(SUM(CASE WHEN dc = 'D' THEN monto_origen ELSE -monto_origen END), 0) AS dif
    FROM journal_lines
    WHERE entry_id = p_entry AND es_ajuste = false
    GROUP BY moneda
  LOOP
    IF r.dif <> 0 THEN
      RAISE EXCEPTION 'Asiento % desbalanceado en moneda origen % (ΣD−ΣC = %)', p_entry, r.moneda, r.dif
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION journal_lines_cuadre_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_verificar_cuadre(COALESCE(NEW.entry_id, OLD.entry_id));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_lines_cuadre"
  AFTER INSERT OR UPDATE OR DELETE ON "journal_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_lines_cuadre_trg();
--> statement-breakpoint
CREATE FUNCTION journal_entries_cuadre_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_verificar_cuadre(NEW.id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "journal_entries_cuadre"
  AFTER INSERT OR UPDATE ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entries_cuadre_trg();
--> statement-breakpoint

-- ── Inmutabilidad de asientos POSTED (regla 4 / Providencia 121) ─────────────
-- El reverso es un asiento NUEVO (no se toca el original). Una vez POSTED, ni UPDATE ni DELETE.
CREATE FUNCTION journal_entries_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'POSTED' THEN
    RAISE EXCEPTION 'journal_entries POSTED es inmutable (regla 4, Providencia 121): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_inmutable"
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entries_inmutable_trg();
--> statement-breakpoint
CREATE FUNCTION journal_lines_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM journal_entries WHERE id = COALESCE(OLD.entry_id, NEW.entry_id);
  IF v_estado = 'POSTED' THEN
    RAISE EXCEPTION 'journal_lines de un asiento POSTED es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "journal_lines_inmutable"
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_lines_inmutable_trg();
--> statement-breakpoint

-- ── Período cerrado no acepta asientos POSTED (regla 9, caso 42) ─────────────
CREATE FUNCTION journal_entries_periodo_abierto_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_estado_periodo text;
BEGIN
  IF NEW.estado = 'POSTED' THEN
    SELECT estado INTO v_estado_periodo FROM periods WHERE id = NEW.period_id;
    IF v_estado_periodo = 'CLOSED' THEN
      RAISE EXCEPTION 'No se puede postear en un período CERRADO (regla 9, caso 42)'
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "journal_entries_periodo_abierto"
  BEFORE INSERT OR UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_entries_periodo_abierto_trg();
