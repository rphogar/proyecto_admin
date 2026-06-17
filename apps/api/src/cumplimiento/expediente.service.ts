import { Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { productVersions } from '../db/schema';
import { type InformeCumplimiento, informeCumplimiento } from './compliance-report';

export interface ExpedienteTecnico {
  /** Norma que regula la homologación. */
  norma: string;
  generadoEn: string;
  /** Identificación del producto y del proveedor (ficha técnica). */
  ficha: {
    producto: string;
    descripcion: string;
    versionVigente: typeof productVersions.$inferSelect | null;
    versiones: (typeof productVersions.$inferSelect)[];
  };
  /** Arquitectura técnica y de seguridad (insumo de la evaluación del SENIAT). */
  arquitectura: {
    stack: string[];
    seguridad: string[];
    inmutabilidad: string[];
    multiTenancy: string[];
  };
  /** Informe de cumplimiento requisito-por-requisito. */
  cumplimiento: InformeCumplimiento;
}

/**
 * Expediente técnico de homologación (P17, Providencia 121 §6.3 req. 6). Ensambla la ficha del
 * producto (con su versionado formal desde `product_versions`), la arquitectura técnica y de
 * seguridad, y el informe de cumplimiento, en un documento exportable que acompaña la solicitud ante
 * el SENIAT. El proceso exige actualizarlo en cada nueva versión: por eso la versión vigente se lee de
 * la base, no se hardcodea.
 */
@Injectable()
export class ExpedienteService {
  constructor(private readonly database: DatabaseService) {}

  async generar(ahora: Date = new Date()): Promise<ExpedienteTecnico> {
    // product_versions es catálogo global (sin RLS): se lee sin contexto de tenant.
    const versiones = await this.database.db.select().from(productVersions).orderBy(desc(productVersions.createdAt));
    const versionVigente = versiones.find((v) => v.estadoHomologacion === 'HOMOLOGADA') ?? versiones[0] ?? null;

    return {
      norma: 'Providencia Administrativa SNAT/2024/000121 — Homologación de sistemas de facturación',
      generadoEn: ahora.toISOString(),
      ficha: {
        producto: 'ContaVE — Sistema administrativo-contable-fiscal SaaS multi-tenant',
        descripcion:
          'Gestión administrativa, contable y fiscal para PYMEs venezolanas. Multimoneda nativa ' +
          '(VES fiscal / USD gerencial / cripto), motor fiscal determinista (IVA/IGTF/retenciones), ' +
          'ledger de partida doble en triple base y emisión de documentos fiscales inmutables.',
        versionVigente,
        versiones,
      },
      arquitectura: {
        stack: [
          'Backend: NestJS (TypeScript estricto), PostgreSQL 16, Drizzle ORM, BullMQ + Redis',
          'Frontend: Next.js (App Router) + TypeScript, Tailwind, shadcn/ui',
          'Cálculo fiscal y contable en paquetes puros (fiscal-engine, ledger) con golden/property tests',
        ],
        seguridad: [
          'Autenticación con Argon2 y 2FA TOTP obligatorio para owner/admin/contador',
          'RBAC por acción (no por pantalla); separación de deberes configurable',
          'Cifrado at-rest de columnas sensibles (RIF, salarios); TLS en tránsito; secretos solo por entorno',
          'Conservación ≥ 10 años sin purga (COT); backups cifrados con restore drill',
        ],
        inmutabilidad: [
          'Documentos ISSUED y asientos POSTED inmutables por trigger PostgreSQL + rol app sin UPDATE/DELETE',
          'Numeración consecutiva sin huecos por serie (contador transaccional, no SERIAL)',
          'Bitácora fiscal append-only encadenada por hash (verificable con verificarCadena)',
          'Correcciones solo por nota de crédito/débito que referencian el documento afectado',
        ],
        multiTenancy: [
          'Aislamiento por tenant_id con Row Level Security forzada en toda tabla',
          'Toda escritura auditada en audit_events (append-only) con actor, IP, device y hora de Caracas',
        ],
      },
      cumplimiento: informeCumplimiento(ahora),
    };
  }

  /** Serializa el expediente como JSON descargable. */
  async exportar(ahora: Date = new Date()): Promise<{ buffer: Buffer; filename: string }> {
    const expediente = await this.generar(ahora);
    const fecha = ahora.toISOString().slice(0, 10);
    return {
      buffer: Buffer.from(JSON.stringify(expediente, null, 2), 'utf8'),
      filename: `expediente-tecnico-providencia-121-${fecha}.json`,
    };
  }
}
