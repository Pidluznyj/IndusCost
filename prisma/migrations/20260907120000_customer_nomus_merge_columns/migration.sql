-- Sync de clientes Nomus: merge de 3 vias preservando edições locais.
--
-- 1) Colunas de controle (todas opcionais — zero impacto no legado):
--    - nomusExternalPersonId: id da pessoa no Nomus (antes vivia como texto
--      destrutivo dentro de "notes", apagando anotações do usuário);
--    - nomusSnapshotJson: último payload MAPEADO enviado pelo Nomus — base do
--      merge (valor local diferente do snapshot = edição do usuário);
--    - nomusSyncedAt: instante da última sincronização que tocou a linha.
ALTER TABLE "Customer"
  ADD COLUMN "nomusExternalPersonId" INTEGER,
  ADD COLUMN "nomusSnapshotJson" JSONB,
  ADD COLUMN "nomusSyncedAt" TIMESTAMPTZ(6);

CREATE INDEX "Customer_nomusExternalPersonId_idx"
  ON "Customer" ("nomusExternalPersonId");

-- 2) Backfill: move o marcador "[NOMUS] externalPersonId=N" de notes para a
--    coluna nova e LIBERA notes para o usuário. Só toca linhas cujo notes é
--    EXATAMENTE o marcador (nada além dele) — qualquer texto extra é
--    potencialmente anotação humana e permanece intocado.
UPDATE "Customer"
SET
  "nomusExternalPersonId" = (regexp_match("notes", '^\[NOMUS\] externalPersonId=(\d+)$'))[1]::int,
  "notes" = NULL
WHERE "notes" ~ '^\[NOMUS\] externalPersonId=\d+$';
