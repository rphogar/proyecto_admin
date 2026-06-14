CREATE TABLE "ajuste_lineas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"ajuste_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"direccion" text NOT NULL,
	"cantidad" numeric(20, 4) NOT NULL,
	"costo_unit_ves" numeric(20, 8),
	"costo_unit_usd" numeric(20, 8),
	"valor_ves" numeric(20, 8),
	"valor_usd" numeric(20, 8),
	"stock_move_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ajustes_inventario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"tipo" text NOT NULL,
	"motivo" text NOT NULL,
	"deducible" boolean DEFAULT false NOT NULL,
	"estado" text DEFAULT 'PENDIENTE' NOT NULL,
	"conteo_id" uuid,
	"fecha" timestamp with time zone NOT NULL,
	"fecha_fiscal" date NOT NULL,
	"journal_entry_id" uuid,
	"total_valor_ves" numeric(20, 8),
	"total_valor_usd" numeric(20, 8),
	"hash_integridad" text,
	"created_by" uuid,
	"aprobado_por" uuid,
	"aprobado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conteo_lineas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"conteo_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"cantidad_sistema" numeric(20, 4) NOT NULL,
	"cantidad_contada" numeric(20, 4),
	"diferencia" numeric(20, 4)
);
--> statement-breakpoint
CREATE TABLE "conteos_fisicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"estado" text DEFAULT 'ABIERTO' NOT NULL,
	"descripcion" text,
	"fecha" timestamp with time zone NOT NULL,
	"fecha_fiscal" date NOT NULL,
	"ajuste_id" uuid,
	"created_by" uuid,
	"cerrado_por" uuid,
	"cerrado_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"direccion" text NOT NULL,
	"cantidad" numeric(20, 4) NOT NULL,
	"costo_unit_ves" numeric(20, 8) NOT NULL,
	"costo_unit_usd" numeric(20, 8) NOT NULL,
	"valor_ves" numeric(20, 8) NOT NULL,
	"valor_usd" numeric(20, 8) NOT NULL,
	"rate_bcv" numeric(20, 8),
	"saldo_cantidad" numeric(20, 4) NOT NULL,
	"saldo_valor_ves" numeric(20, 8) NOT NULL,
	"saldo_valor_usd" numeric(20, 8) NOT NULL,
	"costo_promedio_ves" numeric(20, 8) NOT NULL,
	"costo_promedio_usd" numeric(20, 8) NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"journal_entry_id" uuid,
	"fecha" timestamp with time zone NOT NULL,
	"fecha_fiscal" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "traslado_lineas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"traslado_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"cantidad" numeric(20, 4) NOT NULL,
	"costo_unit_ves" numeric(20, 8) NOT NULL,
	"costo_unit_usd" numeric(20, 8) NOT NULL,
	"salida_move_id" uuid,
	"entrada_move_id" uuid
);
--> statement-breakpoint
CREATE TABLE "traslados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"origen_warehouse_id" uuid NOT NULL,
	"destino_warehouse_id" uuid NOT NULL,
	"estado" text DEFAULT 'EN_TRANSITO' NOT NULL,
	"fecha_despacho" timestamp with time zone NOT NULL,
	"fecha_recepcion" timestamp with time zone,
	"fecha_fiscal" date NOT NULL,
	"descripcion" text,
	"hash_integridad" text,
	"created_by" uuid,
	"recibido_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ajuste_lineas" ADD CONSTRAINT "ajuste_lineas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajuste_lineas" ADD CONSTRAINT "ajuste_lineas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajuste_lineas" ADD CONSTRAINT "ajuste_lineas_ajuste_id_ajustes_inventario_id_fk" FOREIGN KEY ("ajuste_id") REFERENCES "public"."ajustes_inventario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajuste_lineas" ADD CONSTRAINT "ajuste_lineas_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajuste_lineas" ADD CONSTRAINT "ajuste_lineas_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_inventario" ADD CONSTRAINT "ajustes_inventario_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_inventario" ADD CONSTRAINT "ajustes_inventario_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_inventario" ADD CONSTRAINT "ajustes_inventario_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_inventario" ADD CONSTRAINT "ajustes_inventario_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_inventario" ADD CONSTRAINT "ajustes_inventario_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes_inventario" ADD CONSTRAINT "ajustes_inventario_aprobado_por_users_id_fk" FOREIGN KEY ("aprobado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteo_lineas" ADD CONSTRAINT "conteo_lineas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteo_lineas" ADD CONSTRAINT "conteo_lineas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteo_lineas" ADD CONSTRAINT "conteo_lineas_conteo_id_conteos_fisicos_id_fk" FOREIGN KEY ("conteo_id") REFERENCES "public"."conteos_fisicos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteo_lineas" ADD CONSTRAINT "conteo_lineas_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conteos_fisicos" ADD CONSTRAINT "conteos_fisicos_cerrado_por_users_id_fk" FOREIGN KEY ("cerrado_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslado_lineas" ADD CONSTRAINT "traslado_lineas_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslado_lineas" ADD CONSTRAINT "traslado_lineas_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslado_lineas" ADD CONSTRAINT "traslado_lineas_traslado_id_traslados_id_fk" FOREIGN KEY ("traslado_id") REFERENCES "public"."traslados"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslado_lineas" ADD CONSTRAINT "traslado_lineas_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslados" ADD CONSTRAINT "traslados_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslados" ADD CONSTRAINT "traslados_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslados" ADD CONSTRAINT "traslados_origen_warehouse_id_warehouses_id_fk" FOREIGN KEY ("origen_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslados" ADD CONSTRAINT "traslados_destino_warehouse_id_warehouses_id_fk" FOREIGN KEY ("destino_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslados" ADD CONSTRAINT "traslados_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traslados" ADD CONSTRAINT "traslados_recibido_por_users_id_fk" FOREIGN KEY ("recibido_por") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;