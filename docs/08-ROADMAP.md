# 08 — Roadmap de Construcción

Estrategia: el negocio valida primero como **capa gerencial** (fase GTM-1 del plan de negocio) mientras el producto madura hacia la **homologación SENIAT**. Cada fase tiene criterio de salida verificable; no se avanza con tests en rojo.

## Fase 0 — Fundaciones (semanas 1–3)
Monorepo, CI, DB con RLS, auth+RBAC+2FA, multi-tenant/empresas, `audit_events`, **motor de tasas BCV** (job + histórico + manual), `packages/shared` (Money, fechas Caracas, redondeo), **`packages/ledger` completo**: plan de cuentas, asientos triple base, períodos, inmutabilidad con triggers.
**Salida**: property tests del ledger en verde (invariantes 1, 6, 7 del doc 05 §7); asiento manual desde UI mínima; seed del plan de cuentas venezolano.

## Fase 1 — Capa gerencial vendible (semanas 4–9) → *esto ya se puede cobrar*
Terceros con RIF, métodos de pago, **tesorería multimoneda** (cajas, bancos, Zelle, USDT, transferencias internas), registro de ventas/compras como documentos NO fiscales (el cliente sigue facturando con su medio actual), CxC/CxP con cobros split multimoneda y diferencial automático, **conciliación bancaria con importadores** (4 bancos principales) y auto-matching, **dashboard del dueño en USD** (móvil), cierre mensual wizard básico, export Excel.
**Salida**: 10 empresas piloto operando un mes completo; conciliación de un mes real de Banesco/Mercantil en < 1 hora; dashboard consultado ≥ 3 veces/semana por los dueños piloto.

## Fase 2 — Cumplimiento fiscal completo (semanas 10–18)
`fiscal-engine` completo con golden tests: IVA multi-alícuota + prorrata, IGTF, retenciones IVA (agente y sujeto, comprobantes + TXT), retenciones ISLR (tabla 1.808 + ARC), **generador y validador de documentos fiscales** (00071/00102), series/numeración sin huecos, NC/ND, **libros de compras y ventas exactos**, planillas borrador (IVA 99030, IGTF), calendario fiscal por perfil, inventario permanente con costo promedio doble base, listas de precios, POS con cobro multimoneda y soporte de **impresora fiscal** (1 marca primero), guías de despacho.
**Salida**: un mes fiscal completo de una empresa real cerrado en el sistema y validado por su contador contra su declaración presentada — cero diferencias; los 25 `[GOLDEN]` de impuestos en verde.

## Fase 3 — Preparación de homologación (paralelo a F2, semanas 12–22)
`fiscal_event_log` integral, cola de remisión con adapter stub, expediente técnico (ficha, manuales, arquitectura de seguridad), versionado formal del producto, pruebas de inviolabilidad documentadas, asesoría legal contratada para el trámite SNAT/2024/000121, integración con **imprenta digital autorizada** para números de control digitales.
**Salida**: solicitud de homologación presentada ante el SENIAT.

## Fase 4 — Paridad total Gálac y diferenciación (semanas 18–30)
**Nómina completa** (doc 04, con planillas TIUNA/FAOV/INCES y liquidaciones), activos fijos y depreciación, ISLR anual con conciliación fiscal básica, ISAE municipal, **portal del contador multi-empresa**, reportes/BI, importadores de migración desde Gálac/Profit/Excel, OCR de facturas de compra, recordatorios de cobranza por WhatsApp, API pública + webhooks, PWA offline del POS endurecida, reexpresión por inflación (BA VEN-NIF 2) como módulo beta.
**Salida**: una empresa migrada 100% desde Gálac operando sin sistema paralelo; un contador gestionando ≥ 10 empresas en el portal; primera nómina real pagada con planillas aceptadas por los entes.

## Reglas de gestión
1. Las fases 1 y 2 definen el negocio: si la F1 no retiene a los pilotos, replantear antes de invertir en F2.
2. Todo `TODO-TRIBUTARISTA` abierto se resuelve con el asesor antes del fin de la fase en que aparece.
3. Cambios normativos durante el desarrollo (nuevas providencias) entran como parámetros/datos siempre que sea posible; si requieren código, branch dedicado con su golden test.
