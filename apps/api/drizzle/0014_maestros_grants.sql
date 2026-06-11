-- P5 — GRANTs de los maestros al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- Los maestros son mutables (CRUD completo): SELECT, INSERT, UPDATE, DELETE. La RLS de 0013 acota
-- cada operación al tenant actual; el borrado real lo restringen las FKs de los documentos que los
-- referencien (en la práctica se desactivan con `activo = false`, no se borran).

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "parties", "items", "price_lists", "item_prices", "warehouses", "payment_methods", "series"
  TO contave_app;
