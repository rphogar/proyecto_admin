-- P12 — GRANTs de inventario al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- `stock_moves` es append-only: el rol solo necesita SELECT/INSERT (la inmutabilidad la imponen los
-- triggers de 0038). Las cabeceras/líneas de trabajo cambian de estado → necesitan UPDATE; los
-- triggers abortan cualquier UPDATE/DELETE sobre lo ya finalizado (APROBADO/RECIBIDO/CERRADO).

GRANT SELECT, INSERT ON "stock_moves" TO contave_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ajustes_inventario", "ajuste_lineas", "traslados", "traslado_lineas",
  "conteos_fisicos", "conteo_lineas" TO contave_app;
