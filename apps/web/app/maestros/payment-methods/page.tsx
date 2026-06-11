'use client';

import { RecursoCrud } from '@/components/maestros/recurso-crud';
import { type PaymentMethod, paymentMethodsApi } from '@/lib/maestros-api';

const CODIGOS = [
  'EFECTIVO_BS',
  'EFECTIVO_USD',
  'PAGO_MOVIL',
  'TRANSFERENCIA',
  'PUNTO_VENTA',
  'ZELLE',
  'USDT',
  'OTRO',
];

export default function PaymentMethodsPage() {
  return (
    <RecursoCrud<PaymentMethod>
      titulo="Métodos de pago"
      descripcion="Cada método mapeado a una cuenta contable y a si causa IGTF (docs/05 §3.6)."
      recursoKey="payment-methods"
      cliente={paymentMethodsApi}
      campos={[
        {
          nombre: 'codigo',
          etiqueta: 'Código',
          tipo: 'select',
          soloAlta: true,
          opciones: CODIGOS.map((c) => ({ valor: c, etiqueta: c })),
        },
        { nombre: 'nombre', etiqueta: 'Nombre', tipo: 'text', requerido: true },
        {
          nombre: 'moneda',
          etiqueta: 'Moneda',
          tipo: 'select',
          opciones: [
            { valor: 'VES', etiqueta: 'VES' },
            { valor: 'USD', etiqueta: 'USD' },
            { valor: 'EUR', etiqueta: 'EUR' },
          ],
        },
        {
          nombre: 'cuentaId',
          etiqueta: 'Cuenta contable (UUID)',
          tipo: 'text',
          requerido: true,
          ayuda: 'Cuenta de movimiento del plan de la empresa.',
        },
        { nombre: 'causaIgtf', etiqueta: 'Causa IGTF', tipo: 'checkbox' },
        { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox', valorInicial: true },
      ]}
      columnas={[
        { nombre: 'codigo', etiqueta: 'Código' },
        { nombre: 'nombre', etiqueta: 'Nombre' },
        { nombre: 'moneda', etiqueta: 'Moneda' },
        { nombre: 'causaIgtf', etiqueta: 'IGTF', render: (m) => (m.causaIgtf ? 'Sí' : '') },
        { nombre: 'activo', etiqueta: 'Estado', render: (m) => (m.activo ? 'Activo' : 'Inactivo') },
      ]}
    />
  );
}
