# 12 — Agente de impresión fiscal (P23)

Soporte de **impresora fiscal homologada** (docs/02 §6.1, docs/05 §5, docs/10 §6.3.5). Primera marca:
**The Factory HKA** (la más común en VE). Este documento describe la arquitectura y el **contrato del
agente local**; el agente como aplicación se empaqueta en una iteración posterior (TODO-HARDWARE).

## Principio: la API SaaS no habla con el hardware

La API en la nube **no** abre puertos serie/USB. Define un adapter limpio `ImpresoraFiscal` (punto de
extensión único, misma filosofía que `RemisionAdapter`) y una **cola de impresión** (`fiscal_print_queue`).
Un **agente local** ligero corre en la tienda del cliente, reclama trabajos de la cola, los traduce al
protocolo del fabricante y reporta el resultado. Todo el código de protocolo, mapeo y driver vive en el
paquete reutilizable **`@contave/impresora-fiscal`** (puro y testeable en CI con un adapter simulado);
el agente solo aporta el **transporte serie/USB real** (`TransporteSerie`).

```
POS (web) ──/impresion/solicitar──▶ API SaaS ──INSERT──▶ fiscal_print_queue (PENDIENTE)
                                                              ▲           │
agente local ──/impresion/reclamar──────────────────────────┘           │ (RECLAMADO)
   │  imprime con DriverTheFactoryHka(TransporteSerie)  ◀──comandos───────┘
   └──/impresion/reportar (IMPRESO|REINTENTABLE|PERMANENTE)──▶ API: emite el documento / contingencia
```

## Autoridad de numeración (decisión P23)

La **memoria fiscal del hardware** asigna el número y el control fiscal (modelo real venezolano). En
consecuencia:

- La emisión por máquina fiscal **no consume** el correlativo de la serie del SaaS.
- La venta **no queda fiscalmente cerrada** hasta el acuse `IMPRESO`. Recién entonces el SaaS **emite**
  el documento (`EmisionService.emitir` con `numeracionExterna`): `documents.number` = número fiscal del
  hardware, `documents.control_number` = control fiscal, y se registran `EMISION` + `IMPRESION` en la
  bitácora encadenada (`fiscal_event_log`), todo atómico.
- `TODO-TRIBUTARISTA`: si la venta puede registrarse comercialmente antes del cierre fiscal y la UX de
  contingencia (impresora caída a mitad de turno). Hoy: el documento solo existe tras el acuse.

## Contrato del agente (endpoints)

Todos bajo contexto de tenant y permisos `impresion.*` (seed 0063). El agente se autentica con
credenciales del tenant (rol con `impresion.reclamar`/`impresion.reportar`, p. ej. `cajero`).

| Método | Endpoint | Cuerpo | Efecto |
| --- | --- | --- | --- |
| POST | `/impresion/solicitar` | cuerpo de emisión (factura, `medioEmision: MAQUINA_FISCAL`) | Valida (00071/00102), mapea a comandos y **encola** (PENDIENTE). No emite ni consume serie. |
| POST | `/impresion/reclamar` | `{ agenteId, limite? }` | Reclama trabajos elegibles (`FOR UPDATE SKIP LOCKED`), los marca `RECLAMADO` y devuelve `[{ id, comandos }]`. |
| POST | `/impresion/reportar` | `{ jobId, resultado }` | `IMPRESO` → emite el documento con la numeración del hardware. `REINTENTABLE` → backoff. `PERMANENTE` → ERROR. |
| POST | `/impresion/reporte-x` | `{ companyId }` | Reporte X (corte parcial). |
| POST | `/impresion/reporte-z` | `{ companyId }` | Reporte Z (cierre diario). |
| POST | `/impresion/memoria-fiscal` | `{ companyId, desdeZ?, hastaZ?, desdeFecha?, hastaFecha? }` | Lectura de memoria fiscal. |
| GET | `/impresion/cola` | query `companyId?`, `estado?` | Diagnóstico de la cola. |
| POST | `/impresion/imprimir-directo` | cuerpo de emisión | CI / despliegue **sin agente**: cierra el ciclo en proceso con el adapter inyectado (simulado). |

`resultado` (lo que reporta el agente tras hablar con el hardware):

```jsonc
// éxito
{ "tipo": "IMPRESO", "numeroFiscal": "00000123", "controlFiscal": "HKA-00000123", "acuse": { /* libre */ } }
// contingencia recuperable (impresora caída / sin papel / ocupada)
{ "tipo": "REINTENTABLE", "motivo": "sin papel" }
// rechazo definitivo (documento mal formado / rechazo fiscal)
{ "tipo": "PERMANENTE", "motivo": "comando inválido" }
```

## Contingencia (impresora caída)

`REINTENTABLE` mantiene el trabajo `PENDIENTE` reintentándose con **backoff exponencial** (reutiliza
`cumplimiento/backoff.ts`) hasta `max_reintentos`, luego `ERROR`. Cada fallo registra un evento `FALLO`
en la bitácora. La numeración no se rompe y la emisión no se inicia hasta el acuse: un corte de luz o
una impresora caída nunca dejan huecos ni documentos a medias.

## Idempotencia y multi-caja

- Cada trabajo tiene `id` (UUID). `reportar` sobre un trabajo ya `IMPRESO` se rechaza (no re-emite).
- `reclamar` usa `SKIP LOCKED`: varias cajas/agentes del mismo tenant no toman el mismo trabajo.
- `agente_id` queda registrado en el trabajo para trazabilidad.

## Paquete `@contave/impresora-fiscal`

- `ImpresoraFiscal` (adapter), `ResultadoImpresion`/`ResultadoReporte` (uniones que no lanzan).
- `mapearDocumentoAComandos` (mapeo puro documento→comandos fiscales, determinista, golden-tested).
- `DriverTheFactoryHka` (traduce comandos al protocolo HKA; `TransporteSerie` inyectado).
- `ImpresoraFiscalSimulada` (máquina fiscal en memoria; default en CI y en el SaaS sin hardware).
- `TODO-HARDWARE`: octetos/ACK/checksum del protocolo HKA, tabla de códigos de estado y el transporte
  serie/USB real (los provee el agente al cablear el puerto).
- `TODO-TRIBUTARISTA`: correspondencia código de alícuota → ranura de impuesto de la máquina, según la
  parametrización fiscal cargada en cada equipo.

## El agente (pendiente, TODO-HARDWARE)

App local ligera que: (1) autentica contra el tenant; (2) hace polling de `/impresion/reclamar`;
(3) por cada trabajo construye `new DriverTheFactoryHka(transporteSerieReal).imprimirDocumento(comandos)`;
(4) reporta a `/impresion/reportar`. El único componente nuevo respecto al paquete es la implementación
real de `TransporteSerie` sobre el puerto COM/USB.
