import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type DatabaseTx } from '../db/database.service';
import { postingTemplateLines, postingTemplateVersions, postingTemplates } from '../db/schema';
import { asegurarEmpresaDelTenant } from '../maestros/companias';
import { asRecord, optionalBoolean, optionalString, requireEnum, requireString, requireUuid } from '../maestros/validacion';
import { requireTenantContext } from '../tenant/tenant-context';
import { withTenant } from '../tenant/with-tenant';
import type { LineaPlantilla, PlantillaResuelta } from './aplicar-plantilla';

export type PostingTemplate = typeof postingTemplates.$inferSelect;
export type PostingTemplateVersion = typeof postingTemplateVersions.$inferSelect;

interface LineaInput {
  cuentaCodigo: string;
  dc: 'D' | 'C';
  magnitud: string;
  signo: 'POSITIVO' | 'NEGATIVO';
  esAjuste: boolean;
  usaParty: boolean;
}

/**
 * Plantillas de contabilización VERSIONADAS (P13, docs/03 §5). `crear` registra la versión 1;
 * `editar` NO muta la versión en uso: archiva la VIGENTE (→ HISTORICA, inmutable) y crea la
 * siguiente, conservando el historial. Infraestructura aditiva: el posting automático existente no
 * se reescribe. `obtener` resuelve una versión (la vigente por defecto) para alimentar el motor puro
 * `aplicarPlantilla`.
 */
@Injectable()
export class PlantillasService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async crear(body: unknown): Promise<{ template: PostingTemplate; version: PostingTemplateVersion }> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const codigo = requireString(b.codigo, 'codigo', 60);
    const nombre = requireString(b.nombre, 'nombre', 200);
    const operacionTipo = requireString(b.operacionTipo, 'operacionTipo', 60);
    const descripcionAsiento = requireString(b.descripcionAsiento, 'descripcionAsiento', 300);
    const lineas = parseLineas(b.lineas);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);

      const [template] = await tx
        .insert(postingTemplates)
        .values({ tenantId: ctx.tenantId, companyId, codigo, nombre, operacionTipo, versionActual: 1, createdBy: ctx.userId ?? null })
        .returning();
      if (template === undefined) throw new Error('No se pudo crear la plantilla');

      const version = await insertarVersion(tx, { tenantId: ctx.tenantId, companyId, templateId: template.id, version: 1, descripcionAsiento, lineas, createdBy: ctx.userId ?? null });

      await this.audit.registrar(tx, { accion: 'contabilidad.plantilla_crear', entidad: 'posting_templates', entidadId: template.id, after: { template, version } });
      return { template, version };
    });
  }

  async editar(body: unknown): Promise<PostingTemplateVersion> {
    const b = asRecord(body);
    const companyId = requireUuid(b.companyId, 'companyId');
    const codigo = requireString(b.codigo, 'codigo', 60);
    const descripcionAsiento = requireString(b.descripcionAsiento, 'descripcionAsiento', 300);
    const notas = optionalString(b.notas, 'notas', 500);
    const lineas = parseLineas(b.lineas);

    return withTenant(this.database.db, async (tx) => {
      const ctx = requireTenantContext();
      await asegurarEmpresaDelTenant(tx, companyId);

      const template = await requerirTemplate(tx, companyId, codigo);
      const nuevaVersion = template.versionActual + 1;

      // Archiva la versión VIGENTE (queda HISTORICA e inmutable) antes de crear la nueva.
      await tx
        .update(postingTemplateVersions)
        .set({ estado: 'HISTORICA' })
        .where(and(eq(postingTemplateVersions.templateId, template.id), eq(postingTemplateVersions.estado, 'VIGENTE')));

      const version = await insertarVersion(tx, { tenantId: ctx.tenantId, companyId, templateId: template.id, version: nuevaVersion, descripcionAsiento, notas, lineas, createdBy: ctx.userId ?? null });

      await tx.update(postingTemplates).set({ versionActual: nuevaVersion }).where(eq(postingTemplates.id, template.id));

      await this.audit.registrar(tx, { accion: 'contabilidad.plantilla_editar', entidad: 'posting_template_versions', entidadId: version.id, after: version });
      return version;
    });
  }

  async listar(companyId: string): Promise<PostingTemplate[]> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      return tx.select().from(postingTemplates).where(eq(postingTemplates.companyId, companyId)).orderBy(asc(postingTemplates.codigo));
    });
  }

  /** Resuelve una versión de la plantilla (la VIGENTE por defecto) lista para `aplicarPlantilla`. */
  async obtener(companyId: string, codigo: string, version?: number): Promise<PlantillaResuelta> {
    return withTenant(this.database.db, async (tx) => {
      await asegurarEmpresaDelTenant(tx, companyId);
      const template = await requerirTemplate(tx, companyId, codigo);
      const v = version ?? template.versionActual;
      const [versionRow] = await tx
        .select()
        .from(postingTemplateVersions)
        .where(and(eq(postingTemplateVersions.templateId, template.id), eq(postingTemplateVersions.version, v)))
        .limit(1);
      if (versionRow === undefined) throw new NotFoundException(`La plantilla "${codigo}" no tiene versión ${v}`);

      const lineas = await tx
        .select()
        .from(postingTemplateLines)
        .where(eq(postingTemplateLines.versionId, versionRow.id))
        .orderBy(asc(postingTemplateLines.lineaNo));

      return {
        descripcionAsiento: versionRow.descripcionAsiento,
        lineas: lineas.map(
          (l): LineaPlantilla => ({
            lineaNo: l.lineaNo,
            cuentaCodigo: l.cuentaCodigo,
            dc: l.dc as 'D' | 'C',
            magnitud: l.magnitud,
            signo: l.signo as 'POSITIVO' | 'NEGATIVO',
            esAjuste: l.esAjuste,
            usaParty: l.usaParty,
          }),
        ),
      };
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requerirTemplate(tx: DatabaseTx, companyId: string, codigo: string): Promise<PostingTemplate> {
  const [template] = await tx
    .select()
    .from(postingTemplates)
    .where(and(eq(postingTemplates.companyId, companyId), eq(postingTemplates.codigo, codigo)))
    .limit(1);
  if (template === undefined) throw new NotFoundException(`Plantilla "${codigo}" no encontrada en la empresa`);
  return template;
}

async function insertarVersion(
  tx: DatabaseTx,
  p: { tenantId: string; companyId: string; templateId: string; version: number; descripcionAsiento: string; notas?: string | null; lineas: LineaInput[]; createdBy: string | null },
): Promise<PostingTemplateVersion> {
  const [version] = await tx
    .insert(postingTemplateVersions)
    .values({ tenantId: p.tenantId, companyId: p.companyId, templateId: p.templateId, version: p.version, estado: 'VIGENTE', descripcionAsiento: p.descripcionAsiento, notas: p.notas ?? null, createdBy: p.createdBy })
    .returning();
  if (version === undefined) throw new Error('No se pudo crear la versión de la plantilla');

  await tx.insert(postingTemplateLines).values(
    p.lineas.map((l, i) => ({
      tenantId: p.tenantId,
      companyId: p.companyId,
      versionId: version.id,
      lineaNo: i + 1,
      cuentaCodigo: l.cuentaCodigo,
      dc: l.dc,
      magnitud: l.magnitud,
      signo: l.signo,
      esAjuste: l.esAjuste,
      usaParty: l.usaParty,
    })),
  );
  return version;
}

function parseLineas(valor: unknown): LineaInput[] {
  if (!Array.isArray(valor) || valor.length < 2) {
    throw new BadRequestException('La plantilla requiere al menos dos líneas (debe y haber)');
  }
  return valor.map((raw, i) => {
    const l = asRecord(raw);
    return {
      cuentaCodigo: requireString(l.cuentaCodigo, `lineas[${i}].cuentaCodigo`, 60),
      dc: requireEnum(l.dc, `lineas[${i}].dc`, ['D', 'C'] as const, (s) => s.toUpperCase()),
      magnitud: requireString(l.magnitud, `lineas[${i}].magnitud`, 60),
      signo: requireEnum(l.signo ?? 'POSITIVO', `lineas[${i}].signo`, ['POSITIVO', 'NEGATIVO'] as const, (s) => s.toUpperCase()),
      esAjuste: optionalBoolean(l.esAjuste, false),
      usaParty: optionalBoolean(l.usaParty, false),
    };
  });
}
