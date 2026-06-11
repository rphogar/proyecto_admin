'use client';

import { RecursoCrud } from '@/components/maestros/recurso-crud';
import { type Serie, seriesApi } from '@/lib/maestros-api';

const DOC_TYPES = [
  'FACTURA',
  'NOTA_CREDITO',
  'NOTA_DEBITO',
  'GUIA_DESPACHO',
  'PEDIDO',
  'PRESUPUESTO',
  'COMPRA',
  'NOTA_ENTREGA',
  'COMPROBANTE_RETENCION_IVA',
  'COMPROBANTE_RETENCION_ISLR',
];

export default function SeriesPage() {
  return (
    <RecursoCrud<Serie>
      titulo="Series de documentos"
      descripcion="Contador transaccional consecutivo sin huecos (docs/05 §3.4 y §4, regla 6)."
      recursoKey="series"
      cliente={seriesApi}
      campos={[
        {
          nombre: 'docType',
          etiqueta: 'Tipo de documento',
          tipo: 'select',
          soloAlta: true,
          opciones: DOC_TYPES.map((d) => ({ valor: d, etiqueta: d })),
        },
        { nombre: 'prefijo', etiqueta: 'Prefijo', tipo: 'text', soloAlta: true, placeholder: 'A' },
        {
          nombre: 'branchId',
          etiqueta: 'Sucursal (UUID, opcional)',
          tipo: 'text',
          soloAlta: true,
          ayuda: 'Vacío = serie a nivel de empresa.',
        },
        {
          nombre: 'nextNumber',
          etiqueta: 'Próximo número',
          tipo: 'number',
          soloAlta: true,
          valorInicial: '1',
          ayuda: 'Solo al crear: la emisión lo gobierna (no se edita, regla 6).',
        },
        { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox', valorInicial: true },
      ]}
      columnas={[
        { nombre: 'docType', etiqueta: 'Tipo' },
        { nombre: 'prefijo', etiqueta: 'Prefijo', render: (s) => s.prefijo || '—' },
        { nombre: 'nextNumber', etiqueta: 'Próximo Nº' },
        { nombre: 'activo', etiqueta: 'Estado', render: (s) => (s.activo ? 'Activa' : 'Inactiva') },
      ]}
    />
  );
}
