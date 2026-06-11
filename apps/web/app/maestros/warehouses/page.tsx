'use client';

import { RecursoCrud } from '@/components/maestros/recurso-crud';
import { type Warehouse, warehousesApi } from '@/lib/maestros-api';

export default function WarehousesPage() {
  return (
    <RecursoCrud<Warehouse>
      titulo="Almacenes"
      descripcion="Depósitos por empresa para el kardex de inventario (docs/05 §3.2)."
      recursoKey="warehouses"
      cliente={warehousesApi}
      campos={[
        { nombre: 'codigo', etiqueta: 'Código', tipo: 'text', requerido: true, soloAlta: true },
        { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true },
        {
          nombre: 'branchId',
          etiqueta: 'Sucursal (UUID, opcional)',
          tipo: 'text',
          ayuda: 'Vacío = almacén central de la empresa.',
        },
        { nombre: 'direccion', etiqueta: 'Dirección', tipo: 'text' },
        { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox', valorInicial: true },
      ]}
      columnas={[
        { nombre: 'codigo', etiqueta: 'Código' },
        { nombre: 'nombre', etiqueta: 'Nombre' },
        { nombre: 'direccion', etiqueta: 'Dirección', render: (w) => w.direccion ?? '—' },
        { nombre: 'activo', etiqueta: 'Estado', render: (w) => (w.activo ? 'Activo' : 'Inactivo') },
      ]}
    />
  );
}
