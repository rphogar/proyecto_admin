CREATE TABLE "cierres_mensuales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"period_id" uuid NOT NULL,
	"estado" text DEFAULT 'EN_PROCESO' NOT NULL,
	"checklist" jsonb NOT NULL,
	"revaluacion_id" uuid,
	"balance_cuadra" boolean,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cierres_mensuales_company_periodo_uq" UNIQUE("company_id","anio","mes")
);
--> statement-breakpoint
CREATE TABLE "posting_template_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"linea_no" integer NOT NULL,
	"cuenta_codigo" text NOT NULL,
	"dc" text NOT NULL,
	"magnitud" text NOT NULL,
	"signo" text DEFAULT 'POSITIVO' NOT NULL,
	"es_ajuste" boolean DEFAULT false NOT NULL,
	"usa_party" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_template_lines_version_linea_uq" UNIQUE("version_id","linea_no")
);
--> statement-breakpoint
CREATE TABLE "posting_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"estado" text DEFAULT 'VIGENTE' NOT NULL,
	"descripcion_asiento" text NOT NULL,
	"notas" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_template_versions_template_version_uq" UNIQUE("template_id","version")
);
--> statement-breakpoint
CREATE TABLE "posting_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"operacion_tipo" text NOT NULL,
	"version_actual" integer DEFAULT 1 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_templates_company_codigo_uq" UNIQUE("company_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "manual_entry_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"nombre_archivo" text NOT NULL,
	"content_type" text,
	"hash_archivo" text NOT NULL,
	"storage_url" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_entry_attachments_entry_hash_uq" UNIQUE("entry_id","hash_archivo")
);
--> statement-breakpoint
ALTER TABLE "cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_revaluacion_id_revaluaciones_id_fk" FOREIGN KEY ("revaluacion_id") REFERENCES "public"."revaluaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_reopened_by_users_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_template_lines" ADD CONSTRAINT "posting_template_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_template_lines" ADD CONSTRAINT "posting_template_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_template_lines" ADD CONSTRAINT "posting_template_lines_version_id_posting_template_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."posting_template_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_template_versions" ADD CONSTRAINT "posting_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_template_versions" ADD CONSTRAINT "posting_template_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_template_versions" ADD CONSTRAINT "posting_template_versions_template_id_posting_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."posting_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_template_versions" ADD CONSTRAINT "posting_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_templates" ADD CONSTRAINT "posting_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_templates" ADD CONSTRAINT "posting_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_templates" ADD CONSTRAINT "posting_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_entry_attachments" ADD CONSTRAINT "manual_entry_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_entry_attachments" ADD CONSTRAINT "manual_entry_attachments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_entry_attachments" ADD CONSTRAINT "manual_entry_attachments_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_entry_attachments" ADD CONSTRAINT "manual_entry_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;