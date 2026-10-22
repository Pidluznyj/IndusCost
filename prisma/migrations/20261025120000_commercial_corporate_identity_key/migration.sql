-- Hash irreversível de CPF societário válido. O CPF em claro não é gravado.
-- Aditiva. Não aplicada neste ambiente.

ALTER TABLE "CommercialCorporateMembership"
  ADD COLUMN IF NOT EXISTS "memberIdentityKey" TEXT;

CREATE INDEX IF NOT EXISTS "CommercialCorporateMembership_memberIdentityKey_idx"
  ON "CommercialCorporateMembership"("memberIdentityKey");
