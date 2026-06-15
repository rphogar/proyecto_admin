CREATE TABLE "nomina_trabajadores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"cedula" text NOT NULL,
	"nombre" text NOT NULL,
	"cargo" text,
	"fecha_ingreso" date NOT NULL,
	"fecha_egreso" date,
	"frecuencia_pago" text DEFAULT 'QUINCENAL' NOT NULL,
	"salario_normal_mensual" numeric(20, 8) NOT NULL,
	"salario_moneda_extra" text,
	"salario_monto_extra" numeric(20, 8),
	"dias_utilidades" integer,
	"dias_bono_vacacional" integer,
	"dias_vacaciones" integer,
	"riesgo_ivss" text,
	"ari_porcentaje" numeric(20, 8) DEFAULT '0' NOT NULL,
	"cuenta_pago" text,
	"dependientes" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_trabajadores_company_cedula_uq" UNIQUE("company_id","cedula")
);
--> statement-breakpoint
CREATE TABLE "nomina_conceptos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"formula" text NOT NULL,
	"salarial" boolean DEFAULT false NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"vigente_desde" date,
	"vigente_hasta" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_conceptos_company_codigo_uq" UNIQUE("company_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "nomina_corridas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"periodo_etiqueta" text NOT NULL,
	"frecuencia" text NOT NULL,
	"fecha_inicio" timestamp with time zone NOT NULL,
	"fecha_fin" timestamp with time zone NOT NULL,
	"estado" text DEFAULT 'BORRADOR' NOT NULL,
	"journal_entry_id" uuid,
	"total_asignaciones" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_deducciones" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_neto" numeric(20, 8) DEFAULT '0' NOT NULL,
	"total_aportes_patronales" numeric(20, 8) DEFAULT '0' NOT NULL,
	"aprobada_por" uuid,
	"aprobada_en" timestamp with time zone,
	"contabilizada_en" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_corridas_company_periodo_uq" UNIQUE("company_id","periodo_etiqueta")
);
--> statement-breakpoint
CREATE TABLE "nomina_recibo_lineas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"recibo_id" uuid NOT NULL,
	"concepto_codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"salarial" boolean DEFAULT false NOT NULL,
	"moneda" text DEFAULT 'VES' NOT NULL,
	"monto_origen" numeric(20, 8) NOT NULL,
	"monto_ves" numeric(20, 8) NOT NULL,
	"monto_usd_mgmt" numeric(20, 8) NOT NULL,
	"rate_bcv" numeric(20, 8),
	"rate_usd_mgmt" numeric(20, 8),
	"orden" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nomina_recibos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"corrida_id" uuid NOT NULL,
	"trabajador_id" uuid NOT NULL,
	"dias_efectivos" numeric(20, 4) NOT NULL,
	"salario_diario" numeric(20, 8) NOT NULL,
	"salario_diario_integral" numeric(20, 8) NOT NULL,
	"total_asignaciones" numeric(20, 8) NOT NULL,
	"total_deducciones" numeric(20, 8) NOT NULL,
	"neto" numeric(20, 8) NOT NULL,
	"neto_usd" numeric(20, 8),
	"rate_bcv" numeric(20, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_recibos_corrida_trabajador_uq" UNIQUE("corrida_id","trabajador_id")
);
--> statement-breakpoint
CREATE TABLE "nomina_prestaciones_kardex" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"trabajador_id" uuid NOT NULL,
	"fecha" timestamp with time zone NOT NULL,
	"tipo" text NOT NULL,
	"dias_integral" numeric(20, 4),
	"salario_integral_diario" numeric(20, 8),
	"monto_ves" numeric(20, 8) NOT NULL,
	"monto_usd" numeric(20, 8),
	"saldo_garantia_ves" numeric(20, 8),
	"nota" text,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nomina_provisiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"trabajador_id" uuid NOT NULL,
	"utilidades" numeric(20, 8) NOT NULL,
	"vacaciones" numeric(20, 8) NOT NULL,
	"bono_vacacional" numeric(20, 8) NOT NULL,
	"prestaciones" numeric(20, 8) NOT NULL,
	"intereses" numeric(20, 8) NOT NULL,
	"total" numeric(20, 8) NOT NULL,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_provisiones_company_periodo_trab_uq" UNIQUE("company_id","anio","mes","trabajador_id")
);
--> statement-breakpoint
CREATE TABLE "nomina_arc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"trabajador_id" uuid NOT NULL,
	"ejercicio" integer NOT NULL,
	"total_remuneracion_ves" numeric(20, 8) NOT NULL,
	"total_retenido_ves" numeric(20, 8) NOT NULL,
	"emitido_en" timestamp with time zone,
	"archivo_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_arc_company_trab_ejercicio_uq" UNIQUE("company_id","trabajador_id","ejercicio")
);
--> statement-breakpoint
CREATE TABLE "nomina_ari" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"trabajador_id" uuid NOT NULL,
	"ejercicio" integer NOT NULL,
	"porcentaje" numeric(20, 8) NOT NULL,
	"vigente_desde" date NOT NULL,
	"origen" text DEFAULT 'TRABAJADOR' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_ari_company_trab_ejercicio_desde_uq" UNIQUE("company_id","trabajador_id","ejercicio","vigente_desde")
);
--> statement-breakpoint
CREATE TABLE "nomina_parafiscales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"regimen" text NOT NULL,
	"base_ves" numeric(20, 8) NOT NULL,
	"monto_trabajador_ves" numeric(20, 8) NOT NULL,
	"monto_patrono_ves" numeric(20, 8) NOT NULL,
	"semanas_cotizables" integer,
	"estado_planilla" text DEFAULT 'BORRADOR' NOT NULL,
	"archivo_ref" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nomina_parafiscales_company_periodo_regimen_uq" UNIQUE("company_id","anio","mes","regimen")
);
--> statement-breakpoint
ALTER TABLE "nomina_trabajadores" ADD CONSTRAINT "nomina_trabajadores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_trabajadores" ADD CONSTRAINT "nomina_trabajadores_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_trabajadores" ADD CONSTRAINT "nomina_trabajadores_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_conceptos" ADD CONSTRAINT "nomina_conceptos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_conceptos" ADD CONSTRAINT "nomina_conceptos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_conceptos" ADD CONSTRAINT "nomina_conceptos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_corridas" ADD CONSTRAINT "nomina_corridas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_corridas" ADD CONSTRAINT "nomina_corridas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_corridas" ADD CONSTRAINT "nomina_corridas_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_corridas" ADD CONSTRAINT "nomina_corridas_aprobada_por_users_id_fk" FOREIGN KEY ("aprobada_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_corridas" ADD CONSTRAINT "nomina_corridas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_recibo_lineas" ADD CONSTRAINT "nomina_recibo_lineas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_recibo_lineas" ADD CONSTRAINT "nomina_recibo_lineas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_recibo_lineas" ADD CONSTRAINT "nomina_recibo_lineas_recibo_id_nomina_recibos_id_fk" FOREIGN KEY ("recibo_id") REFERENCES "public"."nomina_recibos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_recibos" ADD CONSTRAINT "nomina_recibos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_recibos" ADD CONSTRAINT "nomina_recibos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_recibos" ADD CONSTRAINT "nomina_recibos_corrida_id_nomina_corridas_id_fk" FOREIGN KEY ("corrida_id") REFERENCES "public"."nomina_corridas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_recibos" ADD CONSTRAINT "nomina_recibos_trabajador_id_nomina_trabajadores_id_fk" FOREIGN KEY ("trabajador_id") REFERENCES "public"."nomina_trabajadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex" ADD CONSTRAINT "nomina_prestaciones_kardex_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex" ADD CONSTRAINT "nomina_prestaciones_kardex_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex" ADD CONSTRAINT "nomina_prestaciones_kardex_trabajador_id_nomina_trabajadores_id_fk" FOREIGN KEY ("trabajador_id") REFERENCES "public"."nomina_trabajadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex" ADD CONSTRAINT "nomina_prestaciones_kardex_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_prestaciones_kardex" ADD CONSTRAINT "nomina_prestaciones_kardex_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_provisiones" ADD CONSTRAINT "nomina_provisiones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_provisiones" ADD CONSTRAINT "nomina_provisiones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_provisiones" ADD CONSTRAINT "nomina_provisiones_trabajador_id_nomina_trabajadores_id_fk" FOREIGN KEY ("trabajador_id") REFERENCES "public"."nomina_trabajadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_provisiones" ADD CONSTRAINT "nomina_provisiones_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_provisiones" ADD CONSTRAINT "nomina_provisiones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_arc" ADD CONSTRAINT "nomina_arc_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_arc" ADD CONSTRAINT "nomina_arc_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_arc" ADD CONSTRAINT "nomina_arc_trabajador_id_nomina_trabajadores_id_fk" FOREIGN KEY ("trabajador_id") REFERENCES "public"."nomina_trabajadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_arc" ADD CONSTRAINT "nomina_arc_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_ari" ADD CONSTRAINT "nomina_ari_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_ari" ADD CONSTRAINT "nomina_ari_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_ari" ADD CONSTRAINT "nomina_ari_trabajador_id_nomina_trabajadores_id_fk" FOREIGN KEY ("trabajador_id") REFERENCES "public"."nomina_trabajadores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_ari" ADD CONSTRAINT "nomina_ari_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_parafiscales" ADD CONSTRAINT "nomina_parafiscales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_parafiscales" ADD CONSTRAINT "nomina_parafiscales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nomina_parafiscales" ADD CONSTRAINT "nomina_parafiscales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;