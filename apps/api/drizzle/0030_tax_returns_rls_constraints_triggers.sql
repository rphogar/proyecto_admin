-- P10 — Declaraciones (tax_returns): CHECKs, RLS e inmutabilidad de lo PRESENTADA (reglas 4, 12 de
-- CLAUDE.md, docs/05 §3.7, Providencia 121). Una declaración PRESENTADA es INMUTABLE: el snapshot de
-- cifras congelado no se edita ni se borra; una corrección va por declaración sustitutiva. Trigger
-- además de la capa de aplicación. Drizzle no expresa CHECK/RLS/triggers: SQL custom (ver memoria
-- migraciones-sql-custom).

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "tax_returns"
  ADD CONSTRAINT "tax_returns_tipo_valido" CHECK ("tipo" IN ('IVA', 'ISLR', 'IGTF', 'RET_IVA', 'RET_ISLR', 'ISAE'));
--> statement-breakpoint
ALTER TABLE "tax_returns"
  ADD CONSTRAINT "tax_returns_status_valido" CHECK ("status" IN ('BORRADOR', 'PRESENTADA'));
--> statement-breakpoint
ALTER TABLE "tax_returns"
  ADD CONSTRAINT "tax_returns_periodo_mes_valido" CHECK ("periodo_mes" BETWEEN 1 AND 12);
--> statement-breakpoint
-- Una declaración PRESENTADA debe tener su snapshot y su sello de tiempo (Providencia 121).
ALTER TABLE "tax_returns"
  ADD CONSTRAINT "tax_returns_presentada_completa" CHECK (
    "status" <> 'PRESENTADA' OR ("snapshot" IS NOT NULL AND "presentado_at" IS NOT NULL)
  );
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "tax_returns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tax_returns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tax_returns"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad de la declaración PRESENTADA (regla 4 / Providencia 121) ─────
-- Un BORRADOR sí es mutable (puede recalcularse o presentarse); una vez PRESENTADA, el snapshot
-- queda inalterable. Las correcciones se hacen con una declaración sustitutiva.
CREATE FUNCTION tax_returns_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PRESENTADA' THEN
    RAISE EXCEPTION 'La declaración PRESENTADA es inmutable (regla 4 / Providencia 121): % no permitido; use una declaración sustitutiva', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "tax_returns_inmutable"
  BEFORE UPDATE OR DELETE ON "tax_returns"
  FOR EACH ROW EXECUTE FUNCTION tax_returns_inmutable_trg();
