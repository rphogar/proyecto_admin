-- P25 — Remisión SENIAT: idempotencia por documento, soporte de acuse asíncrono e integridad de
-- estados terminales sobre `fiscal_transmission_queue` (docs/02 §6.3 req. 2, docs/10 §6.3.2).
-- SQL custom (Drizzle no expresa índices parciales/únicos ni CHECK). Endurece la cola desacoplada
-- mientras el SENIAT publica el canal técnico; el adapter sigue siendo stub.

-- ── idempotency_key: token estable por documento (dedup en el canal) ──────────────────────────────
ALTER TABLE "fiscal_transmission_queue" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
-- Referencia de envío para canales asíncronos (acuse diferido).
ALTER TABLE "fiscal_transmission_queue" ADD COLUMN "ref_envio" text;--> statement-breakpoint

-- Backfill de filas previas: clave = document_id (cuando lo hay) o el propio id de la fila.
UPDATE "fiscal_transmission_queue"
  SET "idempotency_key" = coalesce("document_id"::text, "id"::text)
  WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint

-- Idempotencia por documento: un mismo idempotency_key no se encola dos veces en el tenant
-- (req. 2: remisión "consecutiva" sin duplicados). `encolar` usa este índice como ON CONFLICT.
CREATE UNIQUE INDEX "fiscal_transmission_queue_idempotency_uq"
  ON "fiscal_transmission_queue" ("tenant_id", "idempotency_key");--> statement-breakpoint

-- Integridad de estados terminales/asíncronos: un ACUSADO debe llevar su constancia (fehaciencia),
-- y un ENVIADO debe llevar la referencia del envío con la que se consulta el acuse.
ALTER TABLE "fiscal_transmission_queue"
  ADD CONSTRAINT "fiscal_transmission_queue_acusado_con_constancia"
  CHECK ("estado" <> 'ACUSADO' OR "acuse_ref" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "fiscal_transmission_queue"
  ADD CONSTRAINT "fiscal_transmission_queue_enviado_con_referencia"
  CHECK ("estado" <> 'ENVIADO' OR "ref_envio" IS NOT NULL);
