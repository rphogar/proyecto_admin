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
  /** Manuales de usuario por rol (exigidos por §6.3 req. 6: la solicitud incluye manuales). */
  manuales: readonly ManualUsuario[];
  /** Pruebas de inviolabilidad documentadas (qué intentan demostrar y dónde están). */
  pruebasInviolabilidad: readonly PruebaInviolabilidad[];
  /** Informe de cumplimiento requisito-por-requisito. */
  cumplimiento: InformeCumplimiento;
  /** Entregables del trámite que NO son software (se marcan pendientes explícitos). */
  pendientesNoSoftware: readonly string[];
}

/** Manual de usuario dirigido a un rol/audiencia, con sus secciones y la referencia documental. */
export interface ManualUsuario {
  audiencia: string;
  titulo: string;
  secciones: string[];
  /** Documento del repo que desarrolla el manual (la versión PDF firmada es anexo NO-software). */
  referencia: string;
}

/** Prueba de inviolabilidad: qué intenta vulnerar, el resultado esperado y el archivo de test. */
export interface PruebaInviolabilidad {
  escenario: string;
  resultadoEsperado: string;
  test: string;
}

/**
 * Manuales de usuario por rol (§6.3 req. 6: la solicitud de homologación incluye manuales de usuario).
 * El contenido vivo se desarrolla en `docs/06-MODULOS-UI.md`; la versión PDF firmada para el trámite
 * es un anexo NO-software (ver `pendientesNoSoftware`).
 */
const MANUALES: readonly ManualUsuario[] = [
  {
    audiencia: 'owner / admin',
    titulo: 'Administración del tenant, empresas y seguridad',
    secciones: [
      'Alta de empresa, series y numeración fiscal',
      'Usuarios, roles (RBAC) y 2FA TOTP obligatorio',
      'Parámetros fiscales vigentes (UT, alícuotas, calendarios) y cierre de períodos',
    ],
    referencia: 'docs/06-MODULOS-UI.md',
  },
  {
    audiencia: 'contador',
    titulo: 'Operación contable y fiscal',
    secciones: [
      'Asientos, plantillas de contabilización y cierre mensual',
      'Declaraciones IVA/ISLR/retenciones, libros de compras/ventas y diferencial cambiario',
      'Bitácora fiscal, informe de cumplimiento y expediente de homologación',
    ],
    referencia: 'docs/06-MODULOS-UI.md',
  },
  {
    audiencia: 'cajero / vendedor',
    titulo: 'Emisión de documentos y cobranza',
    secciones: [
      'Emisión de facturas y notas de crédito/débito (corrección sin alterar el original)',
      'Cobros, IGTF y manejo multimoneda con tasa BCV congelada por documento',
      'Reimpresión e impresión fiscal',
    ],
    referencia: 'docs/06-MODULOS-UI.md',
  },
  {
    audiencia: 'auditor (solo lectura)',
    titulo: 'Consulta y trazabilidad',
    secciones: [
      'Consulta de documentos, asientos y libros',
      'Verificación de la cadena de la bitácora fiscal y descarga del expediente técnico',
    ],
    referencia: 'docs/06-MODULOS-UI.md',
  },
];

/**
 * Pruebas de inviolabilidad documentadas (§6.3 req. 1 y 5): cada escenario intenta vulnerar un
 * invariante "saltando la API" y demuestra que el sistema lo rechaza o lo detecta. El expediente las
 * lista para la evaluación técnica; los archivos se ejecutan en CI.
 */
const PRUEBAS_INVIOLABILIDAD: readonly PruebaInviolabilidad[] = [
  {
    escenario: 'Alterar o borrar un evento de la bitácora fiscal encadenada (SQL directo)',
    resultadoEsperado:
      'El rol de aplicación no tiene UPDATE/DELETE (permission denied) y el trigger aborta incluso al ' +
      'owner (append-only); una alteración forzada rompe la cadena y verificarCadena() la detecta.',
    test: 'apps/api/src/cumplimiento/inviolabilidad.int.spec.ts',
  },
  {
    escenario: 'Modificar o borrar un documento ISSUED saltando la API',
    resultadoEsperado: 'Trigger de inmutabilidad lo rechaza (inmutable) y el rol app no tiene UPDATE/DELETE.',
    test: 'apps/api/src/cumplimiento/inviolabilidad.int.spec.ts',
  },
  {
    escenario: 'Modificar o borrar un asiento POSTED (o sus líneas) saltando la API',
    resultadoEsperado: 'Trigger de inmutabilidad del ledger lo rechaza (inmutable).',
    test: 'apps/api/src/cumplimiento/inviolabilidad.int.spec.ts',
  },
  {
    escenario: 'Crear huecos de numeración bajo concurrencia (500 emisiones simultáneas, caso 21)',
    resultadoEsperado: 'Correlativo 1..500 consecutivo sin huecos ni duplicados (contador transaccional).',
    test: 'apps/api/src/cumplimiento/inviolabilidad.int.spec.ts',
  },
];

/**
 * Entregables del trámite SNAT/2024/000121 que NO son software: se listan explícitos para que el
 * expediente no aparente cubrirlos. El software queda listo; estos los aporta el proveedor/legal.
 */
const PENDIENTES_NO_SOFTWARE: readonly string[] = [
  'Asesoría legal del trámite de homologación ante el SENIAT (presentación y seguimiento).',
  'Anexos legales: documento constitutivo, RIF del proveedor y poderes/representación.',
  'Manuales de usuario en PDF firmados (la versión viva está en docs/06; ver "manuales").',
  'Implementación del RemisionAdapter real cuando el SENIAT publique la especificación del canal.',
];

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
      manuales: MANUALES,
      pruebasInviolabilidad: PRUEBAS_INVIOLABILIDAD,
      cumplimiento: informeCumplimiento(ahora),
      pendientesNoSoftware: PENDIENTES_NO_SOFTWARE,
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
