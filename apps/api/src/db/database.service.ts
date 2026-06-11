import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
/** Handle de transacción de Drizzle (lo que recibe el callback de `db.transaction`). */
export type DatabaseTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** URL de conexión del runtime: el rol de aplicación `contave_app` (SIN BYPASSRLS). */
function appDatabaseUrl(): string {
  return (
    process.env.APP_DATABASE_URL ??
    'postgresql://contave_app:contave_app_dev@localhost:5432/contave'
  );
}

/**
 * Provee la instancia Drizzle conectada como el rol de aplicación. NUNCA usar el owner en el
 * runtime: RLS solo gobierna a roles sin BYPASSRLS (decisión P2). El acceso de negocio se hace
 * vía `withTenant()` para que cada request fije `app.tenant_id` (ver `tenant/with-tenant.ts`).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly client: Sql;
  readonly db: Database;

  constructor() {
    this.client = postgres(appDatabaseUrl());
    this.db = drizzle(this.client, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end();
  }
}
