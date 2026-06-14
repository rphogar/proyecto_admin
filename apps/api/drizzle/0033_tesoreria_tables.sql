CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"banco" text NOT NULL,
	"nombre" text NOT NULL,
	"numero_mascara" text NOT NULL,
	"moneda" text DEFAULT 'VES' NOT NULL,
	"cuenta_id" uuid NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_company_banco_mascara_uq" UNIQUE("company_id","banco","numero_mascara")
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"banco" text NOT NULL,
	"parser_version" text NOT NULL,
	"archivo_nombre" text NOT NULL,
	"hash_archivo" text NOT NULL,
	"desde" date,
	"hasta" date,
	"saldo_inicial" numeric(20, 8),
	"saldo_final" numeric(20, 8),
	"importado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_company_hash_uq" UNIQUE("company_id","hash_archivo")
);
--> statement-breakpoint
CREATE TABLE "cierre_caja_arqueos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"cierre_id" uuid NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"moneda" text NOT NULL,
	"monto_sistema" numeric(20, 8) NOT NULL,
	"monto_declarado" numeric(20, 8) NOT NULL,
	"diferencia" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cierre_caja_arqueos_cierre_metodo_uq" UNIQUE("cierre_id","payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "cierres_caja" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"apertura" timestamp with time zone NOT NULL,
	"cierre" timestamp with time zone,
	"fecha_fiscal" date NOT NULL,
	"journal_entry_id" uuid,
	"total_diferencia_ves" numeric(20, 8),
	"status" text DEFAULT 'ABIERTO' NOT NULL,
	"hash_integridad" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"fecha" date NOT NULL,
	"descripcion" text,
	"referencia" text,
	"monto" numeric(20, 8) NOT NULL,
	"moneda" text DEFAULT 'VES' NOT NULL,
	"saldo" numeric(20, 8),
	"hash_linea" text NOT NULL,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_lines_statement_hash_uq" UNIQUE("statement_id","hash_linea")
);
--> statement-breakpoint
CREATE TABLE "transferencias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"origen_cuenta_id" uuid NOT NULL,
	"destino_cuenta_id" uuid NOT NULL,
	"moneda_origen" text NOT NULL,
	"monto_origen" numeric(20, 8) NOT NULL,
	"moneda_destino" text NOT NULL,
	"monto_destino" numeric(20, 8) NOT NULL,
	"rate_bcv" numeric(20, 8),
	"rate_usd_mgmt" numeric(20, 8),
	"diferencial_ves" numeric(20, 8),
	"journal_entry_id" uuid,
	"fecha" timestamp with time zone NOT NULL,
	"fecha_fiscal" date NOT NULL,
	"descripcion" text,
	"hash_integridad" text,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"grupo_id" uuid NOT NULL,
	"statement_line_id" uuid,
	"journal_line_id" uuid,
	"tipo" text DEFAULT 'UNO_A_UNO' NOT NULL,
	"score" numeric(5, 2),
	"estado" text DEFAULT 'SUGERIDO' NOT NULL,
	"conciliado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revaluaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"fecha_corte" date NOT NULL,
	"rate_cierre" numeric(20, 8),
	"journal_entry_id" uuid,
	"reverso_entry_id" uuid,
	"diferencial_ves" numeric(20, 8),
	"status" text DEFAULT 'POSTED' NOT NULL,
	"hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revaluaciones_company_periodo_uq" UNIQUE("company_id","anio","mes")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_cuenta_id_accounts_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_importado_por_users_id_fk" FOREIGN KEY ("importado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierre_caja_arqueos" ADD CONSTRAINT "cierre_caja_arqueos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierre_caja_arqueos" ADD CONSTRAINT "cierre_caja_arqueos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierre_caja_arqueos" ADD CONSTRAINT "cierre_caja_arqueos_cierre_id_cierres_caja_id_fk" FOREIGN KEY ("cierre_id") REFERENCES "public"."cierres_caja"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierre_caja_arqueos" ADD CONSTRAINT "cierre_caja_arqueos_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_origen_cuenta_id_accounts_id_fk" FOREIGN KEY ("origen_cuenta_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_destino_cuenta_id_accounts_id_fk" FOREIGN KEY ("destino_cuenta_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transferencias" ADD CONSTRAINT "transferencias_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_statement_line_id_statement_lines_id_fk" FOREIGN KEY ("statement_line_id") REFERENCES "public"."statement_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_journal_line_id_journal_lines_id_fk" FOREIGN KEY ("journal_line_id") REFERENCES "public"."journal_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_conciliado_por_users_id_fk" FOREIGN KEY ("conciliado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluaciones" ADD CONSTRAINT "revaluaciones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluaciones" ADD CONSTRAINT "revaluaciones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluaciones" ADD CONSTRAINT "revaluaciones_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluaciones" ADD CONSTRAINT "revaluaciones_reverso_entry_id_journal_entries_id_fk" FOREIGN KEY ("reverso_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluaciones" ADD CONSTRAINT "revaluaciones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;