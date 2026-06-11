-- P2 — audit_events append-only (regla 5 de CLAUDE.md, Providencia 121).
-- Segunda capa de defensa además de no conceder UPDATE/DELETE al rol app (migración 0003):
-- un trigger aborta cualquier intento de mutación aunque alguien salte la capa de aplicación
-- o use el rol owner.
CREATE FUNCTION audit_events_no_mutate() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'audit_events es append-only (Providencia 121): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER "audit_events_no_mutate"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION audit_events_no_mutate();
