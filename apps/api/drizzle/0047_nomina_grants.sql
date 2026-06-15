-- P15 — GRANTs de nómina al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El rol puede INSERT/SELECT/UPDATE/DELETE; la inmutabilidad (kardex append-only, corrida
-- CONTABILIZADA, recibos de corrida aprobada, planillas PRESENTADAS, ARC emitidos) la imponen los
-- triggers de 0046. Las corridas necesitan UPDATE legítimo (BORRADOR→APROBADA→CONTABILIZADA) y las
-- planillas/ARC UPDATE legítimo (BORRADOR→GENERADA→PRESENTADA, emisión).

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "nomina_trabajadores", "nomina_conceptos", "nomina_corridas", "nomina_recibos",
  "nomina_recibo_lineas", "nomina_prestaciones_kardex", "nomina_provisiones",
  "nomina_parafiscales", "nomina_ari", "nomina_arc" TO contave_app;
