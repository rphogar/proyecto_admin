-- P28 — La sesión recuerda su tenant: `refresh_tokens.tenant_id` es la empresa a la que está
-- acotada la sesión, para que `refresh` re-emita el access con el mismo `tid` y el cambio de
-- empresa emita una sesión nueva. Nullable solo por filas previas a P28. (refresh_tokens ya tiene
-- SELECT/INSERT/UPDATE para contave_app — no hace falta GRANT nuevo.)
ALTER TABLE "refresh_tokens" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;