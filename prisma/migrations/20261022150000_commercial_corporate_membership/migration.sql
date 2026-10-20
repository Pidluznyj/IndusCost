-- QSA comercial. Aditiva e histórica.
-- Não altera cliente, Contas a Receber nem vínculo societário já gravado.
-- Não aplicada neste ambiente.

CREATE TABLE IF NOT EXISTS "CommercialCorporateMembership" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subjectCnpj" TEXT NOT NULL,
  "subjectCustomerId" UUID,
  "source" TEXT NOT NULL,
  "consultedAt" TIMESTAMPTZ(6) NOT NULL,
  "memberKind" TEXT NOT NULL,
  "roleText" TEXT,
  "personKind" TEXT NOT NULL,
  "documentKind" TEXT NOT NULL,
  "memberCnpj" TEXT,
  "reliability" TEXT NOT NULL,
  "evidenceRef" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialCorporateMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialCorporateMembership_subjectCustomerId_fkey"
    FOREIGN KEY ("subjectCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialCorporateMembership_evidenceRef_key"
  ON "CommercialCorporateMembership"("evidenceRef");
CREATE INDEX IF NOT EXISTS "CommercialCorporateMembership_subjectCnpj_consultedAt_idx"
  ON "CommercialCorporateMembership"("subjectCnpj", "consultedAt");
CREATE INDEX IF NOT EXISTS "CommercialCorporateMembership_memberCnpj_idx"
  ON "CommercialCorporateMembership"("memberCnpj");
CREATE INDEX IF NOT EXISTS "CommercialCorporateMembership_subjectCustomerId_consultedAt_idx"
  ON "CommercialCorporateMembership"("subjectCustomerId", "consultedAt");
