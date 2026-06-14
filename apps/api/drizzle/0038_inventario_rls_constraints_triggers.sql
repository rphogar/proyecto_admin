-- P12 — Inventario: CHECKs, RLS e inmutabilidad (reglas 4, 12 de CLAUDE.md, docs/06 M5).
-- `stock_moves` es un kardex APPEND-ONLY: una vez insertado un movimiento es inmutable (las
-- correcciones van por nuevo movimiento). Ajustes APROBADOS, traslados RECIBIDOS/ANULADOS y conteos
-- CERRADOS son inmutables (triggers además de la capa de aplicación). Las cabeceras/líneas en estado
-- de trabajo (PENDIENTE/EN_TRANSITO/ABIERTO) SÍ mutan. SQL custom (Drizzle no expresa CHECK/RLS/trg).

-- ── CHECK constraints ────────────────────────────────────────────────────────
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "stock_moves_tipo_valido" CHECK ("tipo" IN ('COMPRA', 'VENTA', 'AJUSTE', 'TRASLADO', 'DEVOLUCION', 'APERTURA', 'CONTEO'));
--> statement-breakpoint
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "stock_moves_direccion_valida" CHECK ("direccion" IN ('ENTRADA', 'SALIDA'));
--> statement-breakpoint
ALTER TABLE "stock_moves"
  ADD CONSTRAINT "stock_moves_cantidad_positiva" CHECK ("cantidad" > 0);
--> statement-breakpoint
ALTER TABLE "ajustes_inventario"
  ADD CONSTRAINT "ajustes_inventario_tipo_valido" CHECK ("tipo" IN ('MERMA', 'ROBO', 'SOBRANTE', 'CONTEO', 'OTRO'));
--> statement-breakpoint
ALTER TABLE "ajustes_inventario"
  ADD CONSTRAINT "ajustes_inventario_estado_valido" CHECK ("estado" IN ('PENDIENTE', 'APROBADO', 'RECHAZADO'));
--> statement-breakpoint
ALTER TABLE "ajuste_lineas"
  ADD CONSTRAINT "ajuste_lineas_direccion_valida" CHECK ("direccion" IN ('ENTRADA', 'SALIDA'));
--> statement-breakpoint
ALTER TABLE "ajuste_lineas"
  ADD CONSTRAINT "ajuste_lineas_cantidad_positiva" CHECK ("cantidad" > 0);
--> statement-breakpoint
ALTER TABLE "traslados"
  ADD CONSTRAINT "traslados_estado_valido" CHECK ("estado" IN ('EN_TRANSITO', 'RECIBIDO', 'ANULADO'));
--> statement-breakpoint
ALTER TABLE "traslados"
  ADD CONSTRAINT "traslados_almacenes_distintos" CHECK ("origen_warehouse_id" <> "destino_warehouse_id");
--> statement-breakpoint
ALTER TABLE "traslado_lineas"
  ADD CONSTRAINT "traslado_lineas_cantidad_positiva" CHECK ("cantidad" > 0);
--> statement-breakpoint
ALTER TABLE "conteos_fisicos"
  ADD CONSTRAINT "conteos_fisicos_estado_valido" CHECK ("estado" IN ('ABIERTO', 'CERRADO'));
--> statement-breakpoint

-- ── Row Level Security (regla 12) ────────────────────────────────────────────
ALTER TABLE "stock_moves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_moves" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_moves"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ajustes_inventario" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ajustes_inventario" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ajustes_inventario"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ajuste_lineas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ajuste_lineas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ajuste_lineas"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "traslados" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "traslados" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "traslados"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "traslado_lineas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "traslado_lineas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "traslado_lineas"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "conteos_fisicos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conteos_fisicos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conteos_fisicos"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "conteo_lineas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conteo_lineas" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conteo_lineas"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());
--> statement-breakpoint

-- ── Inmutabilidad del kardex (append-only): un stock_move no admite UPDATE ni DELETE ──
CREATE FUNCTION stock_moves_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_moves es un kardex append-only e inmutable (regla 4): % no permitido; corrija con un nuevo movimiento (ajuste/devolución)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "stock_moves_inmutable"
  BEFORE UPDATE OR DELETE ON "stock_moves"
  FOR EACH ROW EXECUTE FUNCTION stock_moves_inmutable_trg();
--> statement-breakpoint

-- ── Inmutabilidad del ajuste APROBADO y sus líneas (su efecto se deshace por un ajuste inverso) ──
CREATE FUNCTION ajustes_inventario_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'APROBADO' THEN
    RAISE EXCEPTION 'El ajuste de inventario APROBADO es inmutable (regla 4): % no permitido; use un ajuste inverso', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ajustes_inventario_inmutable"
  BEFORE UPDATE OR DELETE ON "ajustes_inventario"
  FOR EACH ROW EXECUTE FUNCTION ajustes_inventario_inmutable_trg();
--> statement-breakpoint
CREATE FUNCTION ajuste_lineas_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE v_estado text;
BEGIN
  SELECT estado INTO v_estado FROM ajustes_inventario WHERE id = COALESCE(OLD.ajuste_id, NEW.ajuste_id);
  IF v_estado = 'APROBADO' THEN
    RAISE EXCEPTION 'Las líneas de un ajuste APROBADO son inmutables (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ajuste_lineas_inmutable"
  BEFORE UPDATE OR DELETE ON "ajuste_lineas"
  FOR EACH ROW EXECUTE FUNCTION ajuste_lineas_inmutable_trg();
--> statement-breakpoint

-- ── Inmutabilidad del traslado cerrado (RECIBIDO/ANULADO) ─────────────────────
CREATE FUNCTION traslados_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado IN ('RECIBIDO', 'ANULADO') THEN
    RAISE EXCEPTION 'El traslado %  es inmutable (regla 4): % no permitido', OLD.estado, TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "traslados_inmutable"
  BEFORE UPDATE OR DELETE ON "traslados"
  FOR EACH ROW EXECUTE FUNCTION traslados_inmutable_trg();
--> statement-breakpoint

-- ── Inmutabilidad del conteo CERRADO ─────────────────────────────────────────
CREATE FUNCTION conteos_fisicos_inmutable_trg() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'CERRADO' THEN
    RAISE EXCEPTION 'El conteo físico CERRADO es inmutable (regla 4): % no permitido', TG_OP
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "conteos_fisicos_inmutable"
  BEFORE UPDATE OR DELETE ON "conteos_fisicos"
  FOR EACH ROW EXECUTE FUNCTION conteos_fisicos_inmutable_trg();
