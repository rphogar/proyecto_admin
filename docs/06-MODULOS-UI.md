# 06 — Módulos, Pantallas y UX

Convenciones globales de UI: navegación lateral por módulos; barra superior con **selector de empresa** (multi-empresa), **selector de moneda de vista (Bs ⇄ USD)** presente en TODOS los reportes y listados, buscador global (⌘K: documentos, terceros, cuentas, montos), campana de alertas fiscales. Toda tabla: filtros guardables, export Excel/PDF, columnas configurables. Todo monto: tooltip con su expresión en la otra moneda y la tasa usada. Todo total: drill-down. Acciones destructivas: confirmación con texto. Estados vacíos con guía. Móvil: dashboard, cobranza, aprobaciones y consulta completas; captura pesada optimizada para desktop.

---

## M0 · Dashboard (vista del dueño — móvil primero)

**Widgets**: Caja consolidada hoy (por método: efectivo Bs/USD, bancos, Zelle, USDT — en USD con detalle), Ventas del día/semana/mes vs período anterior, Utilidad del mes (USD gerencial), CxC vencidas (top deudores, botón "recordar por WhatsApp"), CxP próximas, Semáforo fiscal (próximas obligaciones del calendario con días restantes y monto estimado), Tasa BCV del día + variación, Top productos, Alertas (stock mínimo, facturas sin cobrar > X días, declaración por vencer).
**Botones rápidos**: + Factura, + Cobro, + Gasto, Ver caja.

## M1 · Ventas y Facturación

**Pestañas**: Facturas · Notas de crédito · Notas de débito · Presupuestos · Pedidos · Guías de despacho · POS.

**Vista lista**: estado (borrador/emitida/cobrada/parcial/vencida/anulada-NC), filtros por fecha/cliente/vendedor/moneda/estado, totales del filtro en ambas monedas.

**Editor de factura** (la pantalla más importante del sistema):
- Cabecera: cliente (autocomplete por RIF/nombre; "+ nuevo" inline con validación de RIF y consulta de condición), fecha, condición (contado/crédito N días), moneda del documento, **tasa BCV del día visible y bloqueada**, vendedor, sucursal/serie.
- Líneas: ítem (buscador con stock visible por almacén), cantidad, precio (en moneda del doc; muestra equivalente), % descuento, alícuota (heredada del ítem, editable con permiso), subtotal.
- Panel de totales EN VIVO: base por alícuota, IVA por alícuota, exento, total; si hay pago en divisas: **IGTF estimado**; equivalentes Bs/USD lado a lado.
- Validador pre-emisión (checklist visible): requisitos Providencia 00071/00102 — bloquea el botón Emitir si falla algo y explica qué falta.
- Botones: `Guardar borrador` · `Emitir` (irreversible, asigna número; modal de confirmación con resumen) · `Emitir y cobrar` (abre modal de cobro) · `Imprimir/PDF/Enviar` (correo/WhatsApp) · `Duplicar` · sobre emitida: `Nota de crédito` (asistente: total o parcial por líneas) / `Nota de débito`.

**POS (modo caja)**: pantalla táctil, búsqueda por código de barras/SKU, teclado numérico, cliente "consumidor final" por defecto, **cobro multimoneda con calculadora de vuelto cruzado** (paga $20 por 14.50$ de compra → vuelto sugerido en Bs a tasa, en USD, o mixto), cierre de caja por turno (arqueo: declarado vs sistema por método de pago, diferencia a cuenta de faltantes/sobrantes), modo offline con cola, soporte de impresora fiscal y gaveta.

## M2 · Compras y Gastos

**Pestañas**: Facturas de compra · Órdenes de compra · Gastos rápidos · Importaciones (F4).
- Registro de factura de proveedor: validación RIF, número y **número de control del proveedor** (obligatorios para el libro de compras y deducir crédito fiscal), captura de base/IVA por alícuota, retención de IVA automática si la empresa es agente (75/100 según proveedor) con **emisión del comprobante de retención en el mismo flujo**, retención ISLR por concepto de pago.
- `Gasto rápido`: foto del soporte (OCR sugiere monto/RIF/fecha → F4), categoría, método de pago, listo.
- Botones: `Registrar` · `Registrar y pagar` · `Generar comprobante de retención` · `Adjuntar soporte`.

## M3 · Cuentas por Cobrar / Pagar

- **CxC**: antigüedad de saldos (corriente/30/60/90+), por moneda de origen, estado de cuenta por cliente (PDF/WhatsApp), registro de cobros con **split multimoneda** (Pago Móvil Bs 500 + Zelle $30 + efectivo $10 sobre la misma factura), cálculo automático de **diferencial cambiario** al cobrar CxC en divisas, recordatorios automáticos configurables, límite de crédito con bloqueo suave.
- **CxP**: vencimientos, programación de pagos, lotes de pago, control de comprobantes de retención que nos emitieron (cruce contra lo declarado).
- Anticipos de clientes/proveedores con aplicación posterior a facturas.

## M4 · Tesorería y Bancos

**Pestañas**: Posición (saldos por cuenta/método/moneda, consolidado USD) · Movimientos · Conciliación · Transferencias internas (con conversión y diferencial) · Cierres de caja.

**Conciliación (feature estrella)**:
1. Importar estado de cuenta (CSV/Excel por banco; parser detecta formato) o capturar notificaciones de Pago Móvil.
2. Motor de matching: empareja por monto+fecha+referencia con score; tolerancia configurable por diferencias de céntimos de tasa; sugerencias 1:1, 1:n y n:1.
3. UI de dos columnas (banco ⇄ sistema) con drag-to-match, botones `Aceptar sugerencias (n)` · `Conciliar` · `Crear movimiento faltante` · `Marcar en tránsito`.
4. Resumen de partidas en conciliación y reporte mensual imprimible.

## M5 · Inventario

**Pestañas**: Ítems · Existencias por almacén · Movimientos/Kardex (doble base Bs/USD) · Ajustes (con motivo y aprobación) · Traslados · Listas de precios (por moneda, % sobre costo con redondeo psicológico) · Conteo físico (planilla, captura por lector, diferencias → ajuste) · Lotes/seriales/vencimientos (configurable por ítem).
- Alertas de stock mínimo y de **margen negativo** (precio < costo de reposición USD — error común con inflación).
- Botones clave: `Actualizar precios masivo` (por % o por nueva tasa, con vista previa), `Recosteo` (admin).

## M6 · Contabilidad (vista del contador)

**Pestañas**: Plan de cuentas (árbol editable) · Asientos (lista + editor manual balanceado en vivo) · Plantillas de contabilización · Libro Diario · Libro Mayor · Balance de comprobación · Estados financieros (Situación, Resultados, Flujo, Patrimonio — históricos/reexpresados/USD) · Centros de costo · Períodos.

**Cierre mensual (wizard con checklist)**:
1. Tasas del mes completas ✓ 2. Documentos en borrador (resolver) ✓ 3. Conciliaciones bancarias ✓ 4. Diferencial cambiario no realizado (asiento auto, vista previa) ✓ 5. Depreciación ✓ 6. Provisiones laborales ✓ 7. Prorrata IVA si aplica ✓ 8. Balance de comprobación cuadrado ✓ → `Cerrar período` (bloquea; reapertura solo owner+contador con motivo auditado).

## M7 · Impuestos (el módulo que vende el sistema al contador)

**Pestañas**: Resumen del período · IVA · Retenciones IVA (emitidas/recibidas) · Retenciones ISLR (emitidas/recibidas + ARC) · IGTF · Libros de compras/ventas · ISLR anual y conciliación fiscal · ISAE municipal · Calendario fiscal.

- **IVA**: planilla borrador 99030 auto-llenada (débitos por alícuota, créditos, prorrata, retenciones soportadas aplicadas, excedentes), cuadre automático contra libros (si difiere: lista de causas), botón `Marcar como presentada` (snapshot inmutable + adjuntar certificado).
- **Retenciones IVA como agente**: lote del período, comprobantes PDF, **archivo TXT formato SENIAT** para carga en el portal, control de enteración.
- **Libros**: generación exacta según Reglamento (ver doc 02 §7.2), PDF legal + Excel, advertencia de huecos de correlativo.
- **IGTF**: percibido por período, declaración borrador, detalle por documento/pago.
- **Calendario**: obligaciones generadas por perfil (ordinario/SPE con su calendario por RIF), semáforo, recordatorios por correo/WhatsApp, marca de cumplimiento con soporte adjunto.

## M8 · Nómina

**Pestañas**: Trabajadores (ficha completa, historial salarial, ARI) · Períodos de pago · Conceptos y fórmulas · Prestaciones (kardex por trabajador: garantía, días adicionales, intereses, anticipos) · Vacaciones (calendario, solicitudes) · Utilidades · Liquidaciones (asistente de doble cálculo art. 142) · Parafiscales (planillas IVSS/TIUNA, FAOV, INCES, RPE) · Recibos.
- Flujo: pre-nómina → revisión (diff vs período anterior resaltado) → aprobación (rol separado) → recibos PDF → asiento automático → archivo de pago a bancos (formato por banco).

## M9 · Activos Fijos

Ficha (costo en 3 bases, vida útil, ubicación, responsable, foto), depreciación mensual automática línea recta, mejoras capitalizables, retiro/venta con cálculo de resultado, reporte para reexpresión.

## M10 · Reportes y BI

Catálogo: ventas (por vendedor/producto/cliente/hora/sucursal), márgenes reales en USD, flujo de caja proyectado (CxC/CxP + recurrentes), P&L por centro de costo, comparativos, ranking de clientes (Pareto), rotación de inventario, punto de equilibrio. Constructor simple (dimensiones × métricas), reportes programados por correo, export Excel con datos crudos.

## M11 · Portal del Contador (multi-empresa)

Panel con TODAS sus empresas: estado del cierre, obligaciones próximas por empresa, alertas, accesos directos a declarar; checklist de cierre masivo; permisos delegados por el dueño de cada empresa; marca blanca ligera (su logo en reportes a clientes). **Este módulo es el motor del modelo de distribución.**

## M12 · Configuración

Empresa (datos fiscales, logo, condición SPE, ejercicio), Sucursales y cajas, Series de documentos, Usuarios/roles/permisos, Métodos de pago ↔ cuentas, Impuestos y parámetros con vigencia, Plantillas de impresión de factura (formato libre/forma libre/fiscal/digital/ticket), Plantillas de contabilización, Integraciones, Auditoría (visor de `audit_events` con filtros), Suscripción y facturación del SaaS, Respaldo/export total de datos del cliente (derecho de salida: dump completo en formatos abiertos).

---

## Flujos transversales que deben ser perfectos

1. **Vender y cobrar en 30 segundos** (POS): producto → total → cobro mixto → vuelto cruzado → ticket.
2. **Registrar compra con retención en 60 segundos**: foto factura → datos → retención auto → comprobante PDF al proveedor.
3. **Cerrar el mes en una mañana** (contador): wizard M6 + planillas M7 listas.
4. **Saber cómo voy** (dueño, móvil, 5 segundos): abrir app → dashboard USD.
5. **Onboarding**: asistente inicial (datos RIF → perfil tributario inferido → plan de cuentas y plantillas precargados → saldos iniciales guiados: caja, bancos, CxC/CxP, inventario con costo, capital) — meta: facturando en < 30 minutos.
