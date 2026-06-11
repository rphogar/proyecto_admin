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
