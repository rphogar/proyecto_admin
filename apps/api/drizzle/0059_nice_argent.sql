-- P21 — Anticipos de SPE: el subperíodo (quincena/semana) permite varias declaraciones por mes y se
-- amplían los tipos válidos con ANTICIPO_IVA/ANTICIPO_ISLR. La UNIQUE y la columna las genera Drizzle;
-- los CHECK son SQL custom (Drizzle no los expresa — ver memoria migraciones-sql-custom y 0030).
ALTER TABLE "tax_returns" DROP CONSTRAINT "tax_returns_company_tipo_periodo_uq";--> statement-breakpoint
ALTER TABLE "tax_returns" ADD COLUMN "subperiodo" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_company_tipo_periodo_uq" UNIQUE("company_id","tipo","periodo_anio","periodo_mes","subperiodo");--> statement-breakpoint

-- Ampliar los tipos válidos con los anticipos de SPE (reemplaza el CHECK de 0030).
ALTER TABLE "tax_returns" DROP CONSTRAINT "tax_returns_tipo_valido";--> statement-breakpoint
ALTER TABLE "tax_returns"
  ADD CONSTRAINT "tax_returns_tipo_valido" CHECK ("tipo" IN ('IVA', 'ISLR', 'IGTF', 'RET_IVA', 'RET_ISLR', 'ISAE', 'ANTICIPO_IVA', 'ANTICIPO_ISLR'));--> statement-breakpoint

-- El subperíodo es 0 (mensual) o un índice positivo de fracción (quincena/semana).
ALTER TABLE "tax_returns"
  ADD CONSTRAINT "tax_returns_subperiodo_valido" CHECK ("subperiodo" >= 0);