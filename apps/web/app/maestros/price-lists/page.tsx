'use client';

import { RecursoCrud } from '@/components/maestros/recurso-crud';
import { type PriceList, priceListsApi } from '@/lib/maestros-api';

export default function PriceListsPage() {
  return (
    <RecursoCrud<PriceList>
      titulo="Listas de precios"
      descripcion="Precios multimoneda por lista (docs/05 §3.2, doc 06 M5)."
      recursoKey="price-lists"
      cliente={priceListsApi}
      campos={[
        { nombre: 'codigo', etiqueta: 'Código', tipo: 'text', requerido: true, soloAlta: true },
        { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true },
        {
          nombre: 'moneda',
          etiqueta: 'Moneda',
          tipo: 'select',
          opciones: [
            { valor: 'USD', etiqueta: 'USD' },
            { valor: 'VES', etiqueta: 'VES' },
            { valor: 'EUR', etiqueta: 'EUR' },
          ],
        },
        {
          nombre: 'esDefault',
          etiqueta: 'Lista por defecto',
          tipo: 'checkbox',
          ayuda: 'Solo una lista por defecto por empresa.',
        },
        { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox', valorInicial: true },
      ]}
      columnas={[
        { nombre: 'codigo', etiqueta: 'Código' },
        { nombre: 'nombre', etiqueta: 'Nombre' },
        { nombre: 'moneda', etiqueta: 'Moneda' },
        { nombre: 'esDefault', etiqueta: 'Default', render: (l) => (l.esDefault ? 'Sí' : '') },
        { nombre: 'activo', etiqueta: 'Estado', render: (l) => (l.activo ? 'Activo' : 'Inactivo') },
      ]}
    />
  );
}
