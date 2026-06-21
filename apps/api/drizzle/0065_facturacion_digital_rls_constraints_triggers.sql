-- P24 — Factura digital: CHECKs, RLS e índices de la cola de entregas digitales
-- `digital_invoice_deliveries` (docs/02 §6.2, docs/05 §5, docs/13). SQL custom (Drizzle no expresa
-- RLS/CHECK/índices). Molde de 0061 (cola de impresión fiscal).

-- Dominio de estado de la ENTREGA electrónica.
ALTER TABLE "digital_invoice_deliveries"
  ADD CONSTRAINT "digital_invoice_deliveries_estado_valido"
  CHECK ("estado" IN ('PENDIENTE', 'ENTREGADO', 'ERROR'));--> statement-breakpoint
-- Dominio de estado de la CONSERVACIÓN a disposición del SENIAT.
ALTER TABLE "digital_invoice_deliveries"
  ADD CONSTRAINT "digital_invoice_deliveries_conservacion_estado_valido"
  CHECK ("conservacion_estado" IN ('PENDIENTE', 'CONSERVADO', 'ERROR'));--> statement-breakpoint
-- Canal de entrega (00102: correo u otro medio electrónico).
ALTER TABLE "digital_invoice_deliveries"
  ADD CONSTRAINT "digital_invoice_deliveries_canal_valido"
  CHECK ("canal" IN ('EMAIL', 'OTRO'));--> statement-breakpoint
ALTER TABLE "digital_invoice_deliveries"
  ADD CONSTRAINT "digital_invoice_deliveries_reintentos_no_negativo"
  CHECK ("reintentos" >= 0 AND "reintentos" <= "max_reintentos");--> statement-breakpoint

-- RLS (regla 12): aislamiento por tenant, forzado incluso para el owner de la tabla.
ALTER TABLE "digital_invoice_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "digital_invoice_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "digital_invoice_deliveries"
  USING ("tenant_id" = app_current_tenant()) WITH CHECK ("tenant_id" = app_current_tenant());--> statement-breakpoint

-- Índice del procesador de cola: entregas pendientes ordenadas por próximo intento.
CREATE INDEX "digital_invoice_deliveries_pendientes_idx"
  ON "digital_invoice_deliveries" ("tenant_id", "estado", "proximo_intento");--> statement-breakpoint

-- Ampliación del dominio de `fiscal_event_log.event_type` (definido en 0054) con los eventos del
-- régimen digital: ENTREGA (entrega electrónica del documento) y CONSERVACION (puesta a disposición
-- del SENIAT). Se reemplaza el CHECK por uno con la lista extendida.
ALTER TABLE "fiscal_event_log" DROP CONSTRAINT "fiscal_event_log_event_type_valido";--> statement-breakpoint
ALTER TABLE "fiscal_event_log"
  ADD CONSTRAINT "fiscal_event_log_event_type_valido"
  CHECK ("event_type" IN ('EMISION', 'IMPRESION', 'REIMPRESION', 'NOTA_CREDITO', 'NOTA_DEBITO', 'ANULACION', 'FALLO', 'ENTREGA', 'CONSERVACION'));
