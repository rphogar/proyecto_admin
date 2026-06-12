CREATE TABLE "document_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"linea_no" integer NOT NULL,
	"item_id" uuid,
	"descripcion" text NOT NULL,
	"cantidad" numeric(20, 8) NOT NULL,
	"precio_unitario_origen" numeric(20, 8) NOT NULL,
	"descuento_origen" numeric(20, 8) DEFAULT '0' NOT NULL,
	"alicuota_codigo" text NOT NULL,
	"alicuota_tasa" numeric(5, 2) NOT NULL,
	"base_origen" numeric(20, 8) NOT NULL,
	"base_ves" numeric(20, 8) NOT NULL,
	"base_usd_mgmt" numeric(20, 8) NOT NULL,
	"iva_origen" numeric(20, 8) DEFAULT '0' NOT NULL,
	"iva_ves" numeric(20, 8) DEFAULT '0' NOT NULL,
	"iva_usd_mgmt" numeric(20, 8) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_lines_document_linea_uq" UNIQUE("document_id","linea_no")
);
--> statement-breakpoint
CREATE TABLE "document_taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"alicuota_codigo" text NOT NULL,
	"alicuota_tasa" numeric(5, 2) NOT NULL,
	"base_origen" numeric(20, 8) NOT NULL,
	"base_ves" numeric(20, 8) NOT NULL,
	"base_usd_mgmt" numeric(20, 8) NOT NULL,
	"monto_origen" numeric(20, 8) NOT NULL,
	"monto_ves" numeric(20, 8) NOT NULL,
	"monto_usd_mgmt" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_taxes_document_alicuota_uq" UNIQUE("document_id","alicuota_codigo")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"type" text NOT NULL,
	"series_id" uuid NOT NULL,
	"number" integer,
	"control_number" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"medio_emision" text DEFAULT 'FORMA_LIBRE' NOT NULL,
	"party_id" uuid,
	"party_rif" text,
	"party_nombre" text,
	"issue_date" timestamp with time zone NOT NULL,
	"issue_fecha_fiscal" date NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate_id" uuid,
	"rate_bcv" numeric(20, 8),
	"rate_usd_mgmt" numeric(20, 8),
	"payment_condition" text,
	"affected_document_id" uuid,
	"journal_entry_id" uuid,
	"total_origen" numeric(20, 8),
	"total_ves" numeric(20, 8),
	"total_usd_mgmt" numeric(20, 8),
	"hash_integridad" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_lines" ADD CONSTRAINT "document_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_taxes" ADD CONSTRAINT "document_taxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_taxes" ADD CONSTRAINT "document_taxes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_taxes" ADD CONSTRAINT "document_taxes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_affected_document_id_documents_id_fk" FOREIGN KEY ("affected_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;