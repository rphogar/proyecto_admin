import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { companies } from '../db/schema';
import { withTenant } from '../tenant/with-tenant';

/** Empresa (RIF) del tenant activo, para el selector de empresa del frontend (P28). */
export interface CompaniaDto {
  id: string;
  rif: string;
  razonSocial: string;
}

/**
 * Listado de las empresas (RIF) del TENANT activo. La sesión (P28) acota el token a un tenant;
 * dentro del tenant puede haber varias empresas (el caso del contador con cartera, docs/05 §2). El
 * frontend usa esto para elegir/defaultear la empresa de trabajo tras entrar. RLS acota a las del
 * tenant en contexto.
 */
@Injectable()
export class CompaniasService {
  constructor(private readonly database: DatabaseService) {}

  async listar(): Promise<CompaniaDto[]> {
    return withTenant(this.database.db, async (tx) => {
      const filas = await tx
        .select({ id: companies.id, rif: companies.rif, razonSocial: companies.razonSocial })
        .from(companies)
        .orderBy(companies.razonSocial);
      return filas;
    });
  }
}
