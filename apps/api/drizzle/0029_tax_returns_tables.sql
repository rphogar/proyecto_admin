CREATE TABLE "tax_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"periodo_anio" integer NOT NULL,
	"periodo_mes" integer NOT NULL,
	"status" text DEFAULT 'BORRADOR' NOT NULL,
	"numero_declaracion" text,
	"snapshot" jsonb,
	"hash_integridad" text,
	"presentado_at" timestamp with time zone,
	"presentado_por" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_returns_company_tipo_periodo_uq" UNIQUE("company_id","tipo","periodo_anio","periodo_mes")
);
--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_presentado_por_users_id_fk" FOREIGN KEY ("presentado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;