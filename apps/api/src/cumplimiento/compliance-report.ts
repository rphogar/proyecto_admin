/**
 * Informe de cumplimiento de la Providencia SNAT/2024/000121 (P17, docs/02 §6.3). Mapea cada
 * requisito técnico de la norma a su implementación (archivos) y a sus tests. Es la **única fuente de
 * verdad** del informe: lo sirve `GET /cumplimiento/informe`, lo incrusta el expediente técnico
 * (`expediente.service`) y lo refleja `docs/10-CUMPLIMIENTO-PROVIDENCIA-121.md`. Un test
 * (`compliance-report.spec.ts`) verifica que cada archivo referenciado exista, para que el informe no
 * se desactualice silenciosamente.
 *
 * Las rutas son relativas a la raíz del monorepo (posix), para resolverlas desde cualquier paquete.
 */

export type EstadoRequisito = 'IMPLEMENTADO' | 'PARCIAL' | 'PENDIENTE';

export interface RequisitoCumplimiento {
  /** Identificador del requisito dentro de §6.3 de la providencia. */
  id: string;
  /** Texto del requisito tal como lo exige la norma. */
  requisito: string;
  estado: EstadoRequisito;
  /** Cómo lo cumple el sistema. */
  implementacion: string;
  /** Archivos que implementan el requisito (relativos a la raíz del repo). */
  archivos: string[];
  /** Archivos de test que lo verifican (relativos a la raíz del repo). */
  tests: string[];
  /** Notas/limitaciones (p. ej. dependencia de que el SENIAT publique el canal). */
  notas?: string;
}

export interface InformeCumplimiento {
  norma: string;
  generadoEn: string;
  resumen: { total: number; implementado: number; parcial: number; pendiente: number };
  requisitos: RequisitoCumplimiento[];
}

const REQUISITOS: readonly RequisitoCumplimiento[] = [
  {
    id: '6.3.1',
    requisito:
      'Garantizar integridad, continuidad, confiabilidad, conservación, accesibilidad, legibilidad, ' +
      'trazabilidad, inalterabilidad e inviolabilidad de los registros.',
    estado: 'IMPLEMENTADO',
    implementacion:
      'Documentos fiscales y asientos contables son INMUTABLES (trigger PostgreSQL + rol app sin ' +
      'UPDATE/DELETE). Cada documento lleva hash de integridad (SHA-256). La bitácora fiscal es ' +
      'append-only y encadenada por hash (cada evento incorpora el hash del anterior): alterar o ' +
      'reordenar un evento rompe la cadena y se detecta con verificarCadena().',
    archivos: [
      'apps/api/src/db/schema/documents.ts',
      'apps/api/drizzle/0017_documents_rls_constraints_triggers.sql',
      'apps/api/drizzle/0006_ledger_rls_constraints_triggers.sql',
      'apps/api/src/cumplimiento/cadena-hash.ts',
      'apps/api/src/cumplimiento/fiscal-event-log.service.ts',
      'apps/api/drizzle/0054_cumplimiento_rls_constraints_triggers.sql',
    ],
    tests: [
      'apps/api/src/cumplimiento/cadena-hash.spec.ts',
      'apps/api/src/cumplimiento/cumplimiento.int.spec.ts',
      'apps/api/src/cumplimiento/inviolabilidad.int.spec.ts',
      'apps/api/src/audit/audit-append-only.int.spec.ts',
    ],
  },
  {
    id: '6.3.2',
    requisito:
      'Remisión por medios electrónicos al SENIAT, de forma continua, segura, correcta, íntegra, ' +
      'automática, consecutiva, inmediata y fehaciente de los registros de facturación.',
    estado: 'PARCIAL',
    implementacion:
      'Cola de remisión desacoplada (fiscal_transmission_queue): cada documento emitido se encola ' +
      'automáticamente en la misma transacción de emisión, de forma idempotente por documento (índice ' +
      'único tenant+idempotency_key → sin duplicados). Un procesador con reintentos y backoff ' +
      'exponencial intenta la remisión vía un adapter y registra el acuse (fehaciencia); soporta canal ' +
      'síncrono (acuse inmediato) y asíncrono (envío + consulta de acuse). Observabilidad de la cola ' +
      '(conteos, antigüedad del pendiente más viejo, tasa de error) con alertas. El adapter es hoy un ' +
      'stub porque el SENIAT aún no publica el canal técnico.',
    archivos: [
      'apps/api/src/db/schema/fiscal-transmission-queue.ts',
      'apps/api/src/cumplimiento/remision.service.ts',
      'apps/api/src/cumplimiento/remision-adapter.ts',
      'apps/api/src/cumplimiento/backoff.ts',
      'apps/api/src/cumplimiento/observabilidad.ts',
      'apps/api/drizzle/0054_cumplimiento_rls_constraints_triggers.sql',
      'apps/api/drizzle/0068_remision_idempotencia_observabilidad.sql',
    ],
    tests: [
      'apps/api/src/cumplimiento/remision.spec.ts',
      'apps/api/src/cumplimiento/observabilidad.spec.ts',
      'apps/api/src/cumplimiento/cumplimiento.int.spec.ts',
    ],
    notas:
      'Desacoplado a propósito (docs/05 §5): cola, reintentos, acuse, idempotencia y observabilidad ya ' +
      'están listos; pendiente SOLO el formato/firma/envío del canal real (marcado TODO-SENIAT en ' +
      'remision-adapter.ts). Cuando el SENIAT publique la especificación, se implementa RemisionAdapter.',
  },
  {
    id: '6.3.3',
    requisito: 'Registro automático de eventos (event log inmutable): toda operación con el sistema, fechada con fecha y hora.',
    estado: 'IMPLEMENTADO',
    implementacion:
      'Bitácora fiscal (fiscal_event_log) que registra emisión, impresión, reimpresión, NC/ND, ' +
      'anulación y fallos, con fecha/hora en UTC y en hora legal de Venezuela (−04:00). Append-only ' +
      'por trigger. Complementa a audit_events (auditoría de toda escritura de dominio).',
    archivos: [
      'apps/api/src/db/schema/fiscal-event-log.ts',
      'apps/api/src/cumplimiento/fiscal-event-log.service.ts',
      'apps/api/src/audit/audit.service.ts',
      'apps/api/src/db/schema/audit-events.ts',
      'apps/api/drizzle/0002_audit_append_only.sql',
    ],
    tests: ['apps/api/src/cumplimiento/cumplimiento.int.spec.ts', 'apps/api/src/audit/audit-append-only.int.spec.ts'],
  },
  {
    id: '6.3.4',
    requisito: 'Corrección o anulación de facturas únicamente mediante notas de débito o crédito, conservando inalterables los datos originales.',
    estado: 'IMPLEMENTADO',
    implementacion:
      'La emisión rechaza UPDATE/DELETE de documentos ISSUED (trigger). Las correcciones se hacen con ' +
      'NOTA_CREDITO/NOTA_DEBITO que referencian la factura afectada (affected_document_id) y generan ' +
      'su asiento de reverso/aditivo; el original queda intacto. La NC valida el saldo acreditable.',
    archivos: [
      'apps/api/src/documentos/emision.service.ts',
      'apps/api/src/documentos/calculo-nota.ts',
      'apps/api/drizzle/0017_documents_rls_constraints_triggers.sql',
    ],
    tests: ['apps/api/src/documentos/notas.int.spec.ts', 'apps/api/src/documentos/calculo-nota.spec.ts'],
  },
  {
    id: '6.3.5',
    requisito: 'Impedir conexión de equipos no fiscales / desvío de contabilidad paralela; el proveedor responde por alteraciones.',
    estado: 'PARCIAL',
    implementacion:
      'Numeración consecutiva sin huecos por serie (contador transaccional con bloqueo de fila, nunca ' +
      'SERIAL), verificada bajo 500 emisiones simultáneas. Multi-tenant con RLS forzada en toda tabla ' +
      '(sin contabilidad paralela cruzada). Inmutables protegidos por trigger; toda escritura auditada. ' +
      'La versión del producto guarda el hash REPRODUCIBLE del artefacto de build homologado (huella ' +
      'determinista e independiente del orden) para detectar binarios alterados.',
    archivos: [
      'apps/api/src/documentos/emision.service.ts',
      'apps/api/drizzle/0017_documents_rls_constraints_triggers.sql',
      'apps/api/src/db/schema/product-versions.ts',
      'apps/api/src/cumplimiento/artefacto.ts',
      'apps/api/src/cumplimiento/solicitar-homologacion.ts',
    ],
    tests: [
      'apps/api/src/documentos/emision.int.spec.ts',
      'apps/api/src/cumplimiento/cumplimiento.int.spec.ts',
      'apps/api/src/cumplimiento/inviolabilidad.int.spec.ts',
      'apps/api/src/cumplimiento/artefacto.spec.ts',
    ],
    notas:
      'El control de equipos físicos no fiscales (impresoras fiscales homologadas) llega en F2 con el ' +
      'driver de impresora fiscal; aquí se cubre el desvío de datos a nivel de software.',
  },
  {
    id: '6.3.6',
    requisito:
      'Versionado formal del producto: cada nueva versión del sistema requiere nueva homologación; ' +
      'mantener un expediente de homologación actualizado.',
    estado: 'IMPLEMENTADO',
    implementacion:
      'Registro product_versions con versión, changelog, estado de homologación, nº de resolución y ' +
      'hash del artefacto. El expediente técnico ensambla ficha, MANUALES de usuario por rol, ' +
      'arquitectura de seguridad, pruebas de inviolabilidad e informe de cumplimiento contra la versión ' +
      'vigente, listo para el trámite. Un flujo del proveedor (solicitar-homologacion) computa el hash ' +
      'reproducible del build, verifica su reproducibilidad y pasa la versión a SOLICITADA.',
    archivos: [
      'apps/api/src/db/schema/product-versions.ts',
      'apps/api/src/cumplimiento/expediente.service.ts',
      'apps/api/src/cumplimiento/artefacto.ts',
      'apps/api/src/cumplimiento/solicitar-homologacion.ts',
      'apps/api/drizzle/0056_seed_cumplimiento_permissions.sql',
    ],
    tests: [
      'apps/api/src/cumplimiento/expediente.spec.ts',
      'apps/api/src/cumplimiento/artefacto.spec.ts',
      'apps/api/src/cumplimiento/cumplimiento.int.spec.ts',
    ],
    notas:
      'Pendientes NO-software del trámite (marcados explícitos en el expediente, campo ' +
      'pendientesNoSoftware): asesoría legal, anexos legales, manuales en PDF firmados y el ' +
      'RemisionAdapter real cuando el SENIAT publique el canal.',
  },
];

/** Construye el informe de cumplimiento con su resumen agregado. */
export function informeCumplimiento(ahora: Date = new Date()): InformeCumplimiento {
  const resumen = {
    total: REQUISITOS.length,
    implementado: REQUISITOS.filter((r) => r.estado === 'IMPLEMENTADO').length,
    parcial: REQUISITOS.filter((r) => r.estado === 'PARCIAL').length,
    pendiente: REQUISITOS.filter((r) => r.estado === 'PENDIENTE').length,
  };
  return {
    norma: 'Providencia Administrativa SNAT/2024/000121 — Homologación de sistemas de facturación',
    generadoEn: ahora.toISOString(),
    resumen,
    requisitos: REQUISITOS.map((r) => ({ ...r, archivos: [...r.archivos], tests: [...r.tests] })),
  };
}
