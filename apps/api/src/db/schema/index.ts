// Barrel del esquema Drizzle de ContaVE (P2: identidad, multi-tenancy, auditoría).
// Solo definiciones estructurales: RLS, FORCE, policies, GRANTs, EXCLUDE y triggers viven en
// migraciones SQL custom bajo `drizzle/` (Drizzle no las expresa). Ver el plan de P2.
export * from './tenants';
export * from './users';
export * from './rbac';
export * from './memberships';
export * from './companies';
export * from './branches';
export * from './fiscal-params';
export * from './audit-events';
// P3 — Ledger (motor contable): plan de cuentas, períodos y asientos en triple base.
export * from './accounts';
export * from './periods';
export * from './journal-entries';
export * from './journal-lines';
// P4 — Tasas de cambio (BCV/manual/mercado), alcance híbrido tenant (NULL = global).
export * from './exchange-rates';
// P5 — Maestros (company-scoped): terceros, ítems y precios, almacenes, listas, métodos de pago
// y series de documentos (docs/05 §3.2 y §3.4).
export * from './parties';
export * from './items';
export * from './price-lists';
export * from './item-prices';
export * from './warehouses';
export * from './payment-methods';
export * from './series';
// P6 — Documentos (núcleo administrativo): cabecera, líneas en triple base e IVA por alícuota,
// con numeración consecutiva, emisión transaccional e inmutabilidad (docs/05 §3.4 y §4).
export * from './documents';
export * from './document-lines';
export * from './document-taxes';
// P8 — Ventas: cobros (cabecera, medios y aplicaciones a facturas), con asiento automático
// (IGTF, diferencial cambiario, vuelto) e inmutabilidad de lo posteado (docs/06 M3, docs/03 §4.2).
export * from './cobros';
export * from './cobro-medios';
export * from './cobro-aplicaciones';
// P9 — Compras y retenciones: factura de proveedor (núm. y control obligatorios), líneas e IVA
// crédito por alícuota, retención IVA 75/100 e ISLR por concepto como agente (comprobantes
// emitidos) y comprobantes recibidos con imputación por período (docs/05 §3.4/§3.7, docs/02 §3.3/§4).
export * from './purchases';
export * from './purchase-lines';
export * from './purchase-taxes';
export * from './retentions-issued';
export * from './retentions-received';
// P10 — Impuestos: declaraciones por período (IVA/IGTF/…) con snapshot inmutable al presentar
// (docs/05 §3.7, docs/06 M7). Los libros de compras/ventas se derivan en vivo de document_taxes/
// purchase_taxes (única fuente de verdad), no se materializan como tabla.
export * from './tax-returns';
// P11 — Tesorería y conciliación (docs/06 M4): cuentas bancarias y estados de cuenta importados,
// transferencias internas con conversión y diferencial, cierres de caja con arqueo por método,
// conciliación n:m banco⇄sistema con score, y revaluación mensual idempotente de saldos en divisas
// (diferencial no realizado, casos 5 y 11). La posición consolidada se DERIVA del ledger (regla 8).
export * from './bank-accounts';
export * from './bank-statements';
export * from './statement-lines';
export * from './transferencias';
export * from './cierres-caja';
export * from './cierre-caja-arqueos';
export * from './reconciliations';
export * from './revaluaciones';
// P12 — Inventario (docs/06 M5, docs/05 §3.8): kardex append-only en doble base (stock_moves),
// ajustes con motivo+aprobación (separación de deberes), traslados con estado EN_TRÁNSITO y conteos
// físicos cuyas diferencias generan un ajuste. El costo promedio se deriva con @contave/fiscal-engine.
export * from './stock-moves';
export * from './ajustes-inventario';
export * from './traslados';
export * from './conteos';
