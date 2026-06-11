'use client';

import { RecursoCrud } from '@/components/maestros/recurso-crud';
import { type Item, itemsApi } from '@/lib/maestros-api';

const ALICUOTAS = ['GENERAL', 'REDUCIDA', 'ADICIONAL', 'EXENTO', 'EXONERADO', 'EXPORTACION'];

export default function ItemsPage() {
  return (
    <RecursoCrud<Item>
      titulo="Ítems"
      descripcion="Productos y servicios con categoría de alícuota de IVA (docs/05 §3.2)."
      recursoKey="items"
      cliente={itemsApi}
      campos={[
        { nombre: 'sku', etiqueta: 'SKU', tipo: 'text', requerido: true, soloAlta: true },
        { nombre: 'descripcion', etiqueta: 'Descripción', tipo: 'text', requerido: true },
        {
          nombre: 'tipo',
          etiqueta: 'Tipo',
          tipo: 'select',
          opciones: [
            { valor: 'producto', etiqueta: 'Producto' },
            { valor: 'servicio', etiqueta: 'Servicio' },
          ],
        },
        {
          nombre: 'alicuotaIva',
          etiqueta: 'Alícuota IVA',
          tipo: 'select',
          opciones: ALICUOTAS.map((a) => ({ valor: a, etiqueta: a })),
          ayuda: 'El % vive en parámetros con vigencia (regla 17).',
        },
        { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'text', placeholder: 'UND' },
        { nombre: 'controlLote', etiqueta: 'Control de lote', tipo: 'checkbox' },
        { nombre: 'controlSerial', etiqueta: 'Control de serial', tipo: 'checkbox' },
        { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox', valorInicial: true },
      ]}
      columnas={[
        { nombre: 'sku', etiqueta: 'SKU' },
        { nombre: 'descripcion', etiqueta: 'Descripción' },
        { nombre: 'tipo', etiqueta: 'Tipo' },
        { nombre: 'alicuotaIva', etiqueta: 'Alícuota' },
        { nombre: 'activo', etiqueta: 'Estado', render: (i) => (i.activo ? 'Activo' : 'Inactivo') },
      ]}
    />
  );
}
