ALTER TABLE "purchases" ADD COLUMN "tipo_operacion" text DEFAULT 'INTERNA' NOT NULL;--> statement-breakpoint
-- CHECK manual (Drizzle no expresa CHECK; ver memoria migraciones-sql-custom): tipo de operación
-- del Libro de Compras (Reglamento IVA arts. 70–78). Exportación no aplica a compras.
ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_tipo_operacion_valido" CHECK ("tipo_operacion" IN ('INTERNA', 'IMPORTACION'));