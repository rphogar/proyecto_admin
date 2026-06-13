CREATE TABLE "cobro_aplicaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"cobro_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"monto_aplicado_origen" numeric(20, 8) NOT NULL,
	"monto_aplicado_ves" numeric(20, 8) NOT NULL,
	"monto_aplicado_usd_mgmt" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cobro_aplicaciones_cobro_documento_uq" UNIQUE("cobro_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "cobro_medios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"cobro_id" uuid NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"moneda" text NOT NULL,
	"monto_origen" numeric(20, 8) NOT NULL,
	"rate_bcv" numeric(20, 8),
	"monto_ves" numeric(20, 8) NOT NULL,
	"monto_usd_mgmt" numeric(20, 8) NOT NULL,
	"causa_igtf" boolean DEFAULT false NOT NULL,
	"es_vuelto" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"party_id" uuid,
	"fecha" timestamp with time zone NOT NULL,
	"fecha_fiscal" date NOT NULL,
	"journal_entry_id" uuid,
	"igtf_total_ves" numeric(20, 8),
	"total_origen" numeric(20, 8),
	"total_ves" numeric(20, 8),
	"total_usd_mgmt" numeric(20, 8),
	"hash_integridad" text,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cobro_aplicaciones" ADD CONSTRAINT "cobro_aplicaciones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro_aplicaciones" ADD CONSTRAINT "cobro_aplicaciones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro_aplicaciones" ADD CONSTRAINT "cobro_aplicaciones_cobro_id_cobros_id_fk" FOREIGN KEY ("cobro_id") REFERENCES "public"."cobros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro_aplicaciones" ADD CONSTRAINT "cobro_aplicaciones_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro_medios" ADD CONSTRAINT "cobro_medios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro_medios" ADD CONSTRAINT "cobro_medios_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro_medios" ADD CONSTRAINT "cobro_medios_cobro_id_cobros_id_fk" FOREIGN KEY ("cobro_id") REFERENCES "public"."cobros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobro_medios" ADD CONSTRAINT "cobro_medios_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobros" ADD CONSTRAINT "cobros_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;