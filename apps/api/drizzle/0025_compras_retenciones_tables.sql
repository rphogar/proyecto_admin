CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"party_id" uuid NOT NULL,
	"proveedor_rif" text NOT NULL,
	"proveedor_nombre" text NOT NULL,
	"tipo_documento" text DEFAULT 'FACTURA' NOT NULL,
	"numero_documento" text NOT NULL,
	"numero_control" text NOT NULL,
	"numero_documento_afectado" text,
	"cuenta_destino" text DEFAULT '5.2' NOT NULL,
	"fecha_documento" timestamp with time zone NOT NULL,
	"fecha_fiscal" date NOT NULL,
	"currency" text NOT NULL,
	"exchange_rate_id" uuid,
	"rate_bcv" numeric(20, 8),
	"rate_usd_mgmt" numeric(20, 8),
	"journal_entry_id" uuid,
	"base_origen" numeric(20, 8),
	"base_ves" numeric(20, 8),
	"base_usd_mgmt" numeric(20, 8),
	"iva_origen" numeric(20, 8),
	"iva_ves" numeric(20, 8),
	"iva_usd_mgmt" numeric(20, 8),
	"total_origen" numeric(20, 8),
	"total_ves" numeric(20, 8),
	"total_usd_mgmt" numeric(20, 8),
	"retencion_iva_ves" numeric(20, 8),
	"retencion_islr_ves" numeric(20, 8),
	"hash_integridad" text,
	"status" text DEFAULT 'REGISTERED' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_company_proveedor_doc_uq" UNIQUE("company_id","party_id","numero_documento")
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
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
	CONSTRAINT "purchase_lines_purchase_linea_uq" UNIQUE("purchase_id","linea_no")
);
--> statement-breakpoint
CREATE TABLE "purchase_taxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"alicuota_codigo" text NOT NULL,
	"alicuota_tasa" numeric(5, 2) NOT NULL,
	"base_origen" numeric(20, 8) NOT NULL,
	"base_ves" numeric(20, 8) NOT NULL,
	"base_usd_mgmt" numeric(20, 8) NOT NULL,
	"monto_origen" numeric(20, 8) NOT NULL,
	"monto_ves" numeric(20, 8) NOT NULL,
	"monto_usd_mgmt" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_taxes_purchase_alicuota_uq" UNIQUE("purchase_id","alicuota_codigo")
);
--> statement-breakpoint
CREATE TABLE "retentions_issued" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"proveedor_rif" text NOT NULL,
	"proveedor_nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"numero_comprobante" text NOT NULL,
	"correlativo" integer NOT NULL,
	"periodo_anio" integer NOT NULL,
	"periodo_mes" integer NOT NULL,
	"concepto_islr" text,
	"currency" text NOT NULL,
	"rate_bcv" numeric(20, 8),
	"base_origen" numeric(20, 8) NOT NULL,
	"base_ves" numeric(20, 8) NOT NULL,
	"porcentaje" numeric(5, 2) NOT NULL,
	"sustraendo_ves" numeric(20, 8) DEFAULT '0' NOT NULL,
	"monto_origen" numeric(20, 8) NOT NULL,
	"monto_ves" numeric(20, 8) NOT NULL,
	"fecha_fiscal" date NOT NULL,
	"txt_export" text,
	"hash_integridad" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retentions_issued_company_tipo_numero_uq" UNIQUE("company_id","tipo","numero_comprobante")
);
--> statement-breakpoint
CREATE TABLE "retentions_received" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid,
	"party_id" uuid NOT NULL,
	"agente_rif" text NOT NULL,
	"agente_nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"numero_comprobante" text NOT NULL,
	"periodo_anio" integer NOT NULL,
	"periodo_mes" integer NOT NULL,
	"concepto_islr" text,
	"currency" text NOT NULL,
	"rate_bcv" numeric(20, 8),
	"rate_usd_mgmt" numeric(20, 8),
	"base_origen" numeric(20, 8) NOT NULL,
	"base_ves" numeric(20, 8) NOT NULL,
	"porcentaje" numeric(5, 2) NOT NULL,
	"monto_origen" numeric(20, 8) NOT NULL,
	"monto_ves" numeric(20, 8) NOT NULL,
	"monto_usd_mgmt" numeric(20, 8) NOT NULL,
	"fecha_comprobante" date NOT NULL,
	"fecha_recepcion" date NOT NULL,
	"journal_entry_id" uuid,
	"hash_integridad" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retentions_received_company_agente_numero_uq" UNIQUE("company_id","party_id","numero_comprobante")
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_taxes" ADD CONSTRAINT "purchase_taxes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_taxes" ADD CONSTRAINT "purchase_taxes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_taxes" ADD CONSTRAINT "purchase_taxes_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_issued" ADD CONSTRAINT "retentions_issued_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_issued" ADD CONSTRAINT "retentions_issued_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_issued" ADD CONSTRAINT "retentions_issued_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_issued" ADD CONSTRAINT "retentions_issued_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_issued" ADD CONSTRAINT "retentions_issued_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_received" ADD CONSTRAINT "retentions_received_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_received" ADD CONSTRAINT "retentions_received_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_received" ADD CONSTRAINT "retentions_received_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_received" ADD CONSTRAINT "retentions_received_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_received" ADD CONSTRAINT "retentions_received_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retentions_received" ADD CONSTRAINT "retentions_received_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;