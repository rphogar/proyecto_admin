-- P16 — GRANTs del portal al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El panel multi-empresa, el calendario consolidado de obligaciones y el checklist masivo de cierre
-- son LECTURA agregada sobre tablas que el rol ya puede leer (periods, cierres_mensuales, tax_returns,
-- companies): no requieren grants nuevos. Solo `delegaciones` es tabla nueva: el rol puede
-- INSERT/SELECT/UPDATE (otorgar/reotorgar y revocar); no se borra (se revoca con estado).

GRANT SELECT, INSERT, UPDATE, DELETE ON "delegaciones" TO contave_app;
