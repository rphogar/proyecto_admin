/**
 * Plantillas de contabilización BASE que el onboarding precarga (P30, docs/03 §5, doc 06 M12).
 * Set mínimo representativo (venta, compra, cobro): el contador las extiende con la infraestructura
 * versionada de P13 (no reescriben el posting automático, que es aditivo). Las `magnitud` son las
 * claves del monto que el motor entrega en triple base al aplicar la plantilla.
 */
export interface LineaPlantillaBase {
  readonly cuentaCodigo: string;
  readonly dc: 'D' | 'C';
  readonly magnitud: string;
  readonly signo?: 'POSITIVO' | 'NEGATIVO';
  readonly usaParty?: boolean;
}

export interface PlantillaBase {
  readonly codigo: string;
  readonly nombre: string;
  readonly operacionTipo: string;
  readonly descripcionAsiento: string;
  readonly lineas: ReadonlyArray<LineaPlantillaBase>;
}

export const PLANTILLAS_BASE: ReadonlyArray<PlantillaBase> = [
  {
    codigo: 'VENTA',
    nombre: 'Venta a crédito (factura)',
    operacionTipo: 'FACTURA_VENTA',
    descripcionAsiento: 'Venta s/factura {numero}',
    lineas: [
      { cuentaCodigo: '1.2.01', dc: 'D', magnitud: 'TOTAL', usaParty: true },
      { cuentaCodigo: '4.1', dc: 'C', magnitud: 'BASE' },
      { cuentaCodigo: '2.3.01', dc: 'C', magnitud: 'IVA' },
    ],
  },
  {
    codigo: 'COMPRA',
    nombre: 'Compra a crédito (factura de proveedor)',
    operacionTipo: 'FACTURA_COMPRA',
    descripcionAsiento: 'Compra s/factura {numero}',
    lineas: [
      { cuentaCodigo: '5.2', dc: 'D', magnitud: 'BASE' },
      { cuentaCodigo: '1.3.01', dc: 'D', magnitud: 'IVA' },
      { cuentaCodigo: '2.1', dc: 'C', magnitud: 'TOTAL', usaParty: true },
    ],
  },
  {
    codigo: 'COBRO',
    nombre: 'Cobro de cliente',
    operacionTipo: 'COBRO',
    descripcionAsiento: 'Cobro de cliente',
    lineas: [
      { cuentaCodigo: '1.1.01', dc: 'D', magnitud: 'TOTAL' },
      { cuentaCodigo: '1.2.01', dc: 'C', magnitud: 'TOTAL', usaParty: true },
    ],
  },
];
