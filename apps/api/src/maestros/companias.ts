import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DatabaseTx } from '../db/database.service';
import { companies } from '../db/schema';

/**
 * Verifica que `companyId` exista y pertenezca al tenant actual. Se ejecuta DENTRO de `withTenant`:
 * la RLS de `companies` solo deja ver las del tenant en contexto, así que un id de otra empresa
 * (o de otro tenant) simplemente no aparece → 404. Garantiza que ningún maestro se cree colgando
 * de una empresa ajena (regla 12).
 */
export async function asegurarEmpresaDelTenant(tx: DatabaseTx, companyId: string): Promise<void> {
  const [fila] = await tx
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (fila === undefined) {
    throw new NotFoundException(`Empresa ${companyId} no encontrada en el tenant actual`);
  }
}
