-- P6 — GRANTs de los documentos al rol de aplicación `contave_app` (decisión P2: rol sin BYPASSRLS).
-- El rol puede SELECT/INSERT/UPDATE/DELETE para gestionar el ciclo del borrador (DRAFT) y anular
-- pre-emisión; la inmutabilidad de los ISSUED/APPLIED la imponen los triggers de 0017 (el intento
-- de UPDATE/DELETE se aborta), igual que con los asientos POSTED.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "documents", "document_lines", "document_taxes" TO contave_app;
